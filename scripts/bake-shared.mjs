#!/usr/bin/env node
/**
 * Bakes shared blocks into every skill.
 *
 * Skills cannot import one another — an agent selects and loads a single
 * SKILL.md by matching a prompt against each skill's `description` — so
 * invariants that must never be missed (the anti-prior warning, the width
 * ladder, crop-mode semantics, API-key handling) live once in `shared/` and are
 * injected into each skill between markers:
 *
 *   <!-- shared:start width-ladder -->
 *   <!-- shared:end width-ladder -->
 *
 * The injected text is committed, not built at install time: `npx skills add`
 * and Claude Code read this repo raw, so there is no package step to hook. CI
 * runs `--check` and fails on a hand-edited copy instead of letting it drift.
 *
 * Two guarantees, both enforced here:
 *   consistency — a baked block always equals its source in `shared/`
 *   presence    — a file must carry the blocks `shared/required.json` demands
 *
 * Presence matters as much as consistency: without it, a skill that simply
 * never pastes the api-key block ships without it and CI stays green.
 *
 * Usage:
 *   node scripts/bake-shared.mjs                write
 *   node scripts/bake-shared.mjs --check        exit 1 if anything is stale or missing
 *   node scripts/bake-shared.mjs --root <dir>   operate on another tree (tests)
 */

import { readFile, writeFile, glob } from 'node:fs/promises';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { bakeContent, requiredBlocksFor, sourceContainsMarker } from './lib/bake.mjs';

const KNOWN_FLAGS = new Set(['--check', '--root']);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse argv strictly — an unrecognised flag must never degrade to a silent no-op. */
function parseArgs(argv) {
  let check = false;
  let root = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        fail(`--root requires a directory path (got ${value === undefined ? 'nothing' : `'${value}'`})`);
      }
      root = value;
      i++;
      continue;
    }
    fail(`unknown argument '${arg}' — supported: ${[...KNOWN_FLAGS].join(', ')}`);
  }

  return { check, root: root ?? REPO_ROOT };
}

function fail(message) {
  console.error(`bake-shared: ${message}`);
  process.exit(1);
}

const { check: CHECK, root: ROOT } = parseArgs(process.argv.slice(2));
const SHARED = join(ROOT, 'shared');

if (!existsSync(SHARED) || !statSync(SHARED).isDirectory()) {
  fail(`no shared/ directory under ${ROOT} — nothing could be baked, refusing to report success`);
}

/** Required-blocks policy. Absent file means no presence requirements. */
const POLICY_PATH = join(SHARED, 'required.json');
let policy = {};
if (existsSync(POLICY_PATH)) {
  try {
    policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  } catch (error) {
    fail(`could not parse ${relative(ROOT, POLICY_PATH)}: ${error.message}`);
  }
}

/**
 * A path is usable only if it is a REGULAR file (not a symlink) that resolves
 * inside `dir`.
 *
 * Symlinks are rejected on both the read and the write side. `writeFile` follows
 * a symlink, so a tracked link under `skills/` pointing at any writable path —
 * a shell rc file, a workflow file — would have this script overwrite it with
 * mostly attacker-controlled content. On the read side, a link under `shared/`
 * would splice an arbitrary local file into a committed, published skill.
 * Neither has a legitimate use here, so both are refused outright.
 *
 * @param {string} path
 * @param {string} dir directory the path must resolve within
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkContained(path, dir) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    return { ok: false, reason: `cannot stat (${error.code ?? error.message})` };
  }
  if (stats.isSymbolicLink()) {
    return { ok: false, reason: 'is a symbolic link — refused' };
  }
  if (!stats.isFile()) {
    return { ok: false, reason: 'is not a regular file' };
  }

  let real;
  let realDir;
  try {
    real = realpathSync(path);
    realDir = realpathSync(dir);
  } catch (error) {
    return { ok: false, reason: `cannot resolve (${error.code ?? error.message})` };
  }
  if (real !== realDir && !real.startsWith(realDir + sep)) {
    return { ok: false, reason: `resolves outside ${relative(ROOT, dir) || '.'}/` };
  }
  return { ok: true };
}

/** Candidate source paths for a block name, in precedence order. */
function blockCandidates(name) {
  return [join(SHARED, `${name}.md`), join(SHARED, 'invariants', `${name}.md`)].filter((path) =>
    existsSync(path),
  );
}

const cache = new Map();

/** Resolve a block name to its content, or null. Reports ambiguity and bad sources. */
function getBlock(name) {
  if (cache.has(name)) return cache.get(name);

  const candidates = blockCandidates(name);
  if (candidates.length === 0) {
    cache.set(name, null);
    return null;
  }
  if (candidates.length > 1) {
    fail(
      `block '${name}' is defined more than once: ` +
        `${candidates.map((path) => relative(ROOT, path)).join(' and ')} — ` +
        `delete the stale copy so it is unambiguous which one is read`,
    );
  }

  const contained = checkContained(candidates[0], SHARED);
  if (!contained.ok) {
    fail(`${relative(ROOT, candidates[0])} ${contained.reason}`);
  }

  let content;
  try {
    content = readFileSync(candidates[0], 'utf8');
  } catch (error) {
    fail(`could not read ${relative(ROOT, candidates[0])}: ${error.code ?? error.message}`);
  }

  // Strip a BOM so it is not injected mid-document.
  content = content.replace(/^\uFEFF/, '');

  if (sourceContainsMarker(content)) {
    fail(
      `${relative(ROOT, candidates[0])} contains shared marker syntax — ` +
        `injecting it would corrupt the host file and could not be re-baked`,
    );
  }

  cache.set(name, content);
  return content;
}

/** Repo-relative POSIX path, for policy matching and messages. */
const relPosix = (path) => relative(ROOT, path).split(sep).join('/');

const SKILLS = join(ROOT, 'skills');
const targets = [];
const skipped = [];

for await (const entry of glob('skills/**/*', { cwd: ROOT })) {
  // Explicit lowercase extension test: `*.md` globbing is case-insensitive on
  // macOS/APFS but not on Linux CI, so a `.MD` file would bake locally and be
  // invisible to --check in CI.
  if (!entry.endsWith('.md')) continue;

  const path = join(ROOT, entry);
  const contained = checkContained(path, SKILLS);
  if (!contained.ok) {
    skipped.push(`${entry}: ${contained.reason}`);
    continue;
  }
  targets.push(path);
}
targets.sort();

// A refused target is reported, never silently dropped — a skill that stops
// being baked because someone replaced it with a link must not pass as "in sync".
if (skipped.length) {
  console.error('bake-shared failed:');
  for (const entry of skipped) console.error(`  - ${entry}`);
  process.exit(1);
}

if (targets.length === 0) {
  fail(`no markdown files found under ${relPosix(join(ROOT, 'skills'))}/ — refusing to report success`);
}

// Pass 1: read, validate, and decide. No writes, so a failing run never leaves
// the tree half-updated.
const problems = [];
const pending = [];
let injected = 0;

for (const path of targets) {
  const rel = relPosix(path);
  let original;
  try {
    original = await readFile(path, 'utf8');
  } catch (error) {
    problems.push(`${rel}: could not read (${error.code ?? error.message})`);
    continue;
  }

  const result = bakeContent(original, getBlock);

  for (const problem of result.problems) problems.push(`${rel}: ${problem}`);
  for (const name of result.missing) {
    problems.push(
      `${rel}: no usable source in shared/ for block '${name}' — ` +
        `expected shared/${name}.md or shared/invariants/${name}.md, non-empty`,
    );
  }

  const required = requiredBlocksFor(policy, rel);
  const absent = required.filter((name) => !result.names.includes(name));
  if (absent.length) {
    problems.push(
      `${rel}: missing required shared block(s) ${absent.map((n) => `'${n}'`).join(', ')} — ` +
        `add the marker pair, or amend shared/required.json`,
    );
  }

  if (result.problems.length || result.missing.length) continue;

  injected += result.names.length;
  if (result.changed) pending.push({ path, rel, baked: result.baked });
}

if (CHECK) {
  for (const { rel } of pending) problems.push(`${rel}: shared block is stale`);
}

if (problems.length) {
  console.error('bake-shared failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  if (CHECK) console.error('\nRun `node scripts/bake-shared.mjs` and commit the result.');
  process.exit(1);
}

// Pass 2: write only once everything has validated.
for (const { path, rel, baked } of pending) {
  await writeFile(path, baked);
  console.log(`baked  ${rel}`);
}

console.log(
  CHECK
    ? `bake-shared --check ok — ${injected} block(s) across ${targets.length} file(s) in sync`
    : `bake-shared done — ${pending.length} file(s) updated, ${injected} block(s) injected`,
);
