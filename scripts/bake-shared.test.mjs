import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), 'bake-shared.mjs');

let root;

/** Build a throwaway repo: shared/ sources plus one skill file. */
async function fixture({ skill, shared = {}, invariants = {} }) {
  await mkdir(join(root, 'shared', 'invariants'), { recursive: true });
  await mkdir(join(root, 'skills', 'demo'), { recursive: true });

  for (const [name, body] of Object.entries(shared)) {
    await writeFile(join(root, 'shared', `${name}.md`), body);
  }
  for (const [name, body] of Object.entries(invariants)) {
    await writeFile(join(root, 'shared', 'invariants', `${name}.md`), body);
  }
  await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), skill);
}

const skillFile = () => readFile(join(root, 'skills', 'demo', 'SKILL.md'), 'utf8');

/** Run the CLI, resolving with exit code and output instead of throwing. */
async function cli(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, '--root', root, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bake-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('writes the shared block into the skill and exits 0', async () => {
  await fixture({
    invariants: { 'width-ladder': 'Ladder: 320, 480, 720.\n' },
    skill: '# Demo\n\n<!-- shared:start width-ladder -->\n<!-- shared:end width-ladder -->\n',
  });

  const { code, stdout } = await cli();

  assert.equal(code, 0);
  assert.match(stdout, /baked {2}skills\/demo\/SKILL\.md/);
  assert.match(await skillFile(), /Ladder: 320, 480, 720\./);
});

test('resolves a block from shared/ as well as shared/invariants/', async () => {
  await fixture({
    shared: { preamble: 'Do not trust internal knowledge.\n' },
    invariants: { 'width-ladder': 'Ladder text.\n' },
    skill: [
      '<!-- shared:start preamble -->',
      '<!-- shared:end preamble -->',
      '<!-- shared:start width-ladder -->',
      '<!-- shared:end width-ladder -->',
      '',
    ].join('\n'),
  });

  assert.equal((await cli()).code, 0);

  const baked = await skillFile();
  assert.match(baked, /Do not trust internal knowledge\./);
  assert.match(baked, /Ladder text\./);
});

test('--check exits 1 when a copy is stale, without modifying the file', async () => {
  const stale = '# Demo\n\n<!-- shared:start width-ladder -->\nOLD TEXT\n<!-- shared:end width-ladder -->\n';
  await fixture({ invariants: { 'width-ladder': 'NEW TEXT\n' }, skill: stale });

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1);
  assert.match(stderr, /shared block is stale/);
  assert.equal(await skillFile(), stale, '--check must not write');
});

test('--check exits 0 once the tree has been baked', async () => {
  await fixture({
    invariants: { 'width-ladder': 'Ladder text.\n' },
    skill: '<!-- shared:start width-ladder -->\nstale\n<!-- shared:end width-ladder -->\n',
  });

  assert.equal((await cli()).code, 0);
  const { code, stdout } = await cli('--check');

  assert.equal(code, 0);
  assert.match(stdout, /in sync/);
});

test('exits 1 and names the block when shared/ has no such source', async () => {
  await fixture({
    invariants: {},
    skill: '<!-- shared:start does-not-exist -->\n<!-- shared:end does-not-exist -->\n',
  });

  const { code, stderr } = await cli();

  assert.equal(code, 1);
  assert.match(stderr, /no usable source in shared\/ for block 'does-not-exist'/);
});

test('exits 1 on a mismatched marker pair rather than silently skipping it', async () => {
  const content = '<!-- shared:start width-ladder -->\nbody\n<!-- shared:end wdith-ladder -->\n';
  await fixture({ invariants: { 'width-ladder': 'Ladder text.\n' }, skill: content });

  const { code, stderr } = await cli();

  assert.equal(code, 1);
  assert.match(stderr, /mismatched marker names/);
  assert.equal(await skillFile(), content, 'nothing is written when markers are malformed');
});

test('bakes reference files under a skill, not just SKILL.md', async () => {
  await fixture({
    invariants: { 'width-ladder': 'Ladder text.\n' },
    skill: '# Demo\n',
  });
  await mkdir(join(root, 'skills', 'demo', 'references'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'demo', 'references', 'sizing.md'),
    '<!-- shared:start width-ladder -->\n<!-- shared:end width-ladder -->\n',
  );

  assert.equal((await cli()).code, 0);

  const ref = await readFile(join(root, 'skills', 'demo', 'references', 'sizing.md'), 'utf8');
  assert.match(ref, /Ladder text\./);
});

test('ignores markdown outside skills/', async () => {
  await fixture({ invariants: { 'width-ladder': 'Ladder text.\n' }, skill: '# Demo\n' });
  const outside = join(root, 'README.md');
  const content = '<!-- shared:start does-not-exist -->\n<!-- shared:end does-not-exist -->\n';
  await writeFile(outside, content);

  const { code } = await cli();

  assert.equal(code, 0, 'a bad marker outside skills/ must not fail the run');
  assert.equal(await readFile(outside, 'utf8'), content);
});

test('running twice in a row is a no-op the second time', async () => {
  await fixture({
    invariants: { 'width-ladder': 'Ladder text.\n' },
    skill: '<!-- shared:start width-ladder -->\nstale\n<!-- shared:end width-ladder -->\n',
  });

  await cli();
  const first = await skillFile();
  const { stdout } = await cli();

  assert.equal(await skillFile(), first);
  assert.match(stdout, /0 file\(s\) updated/);
});

// ── Guards against a vacuous pass: the whole gate rests on these ──

test('refuses to report success when no shared/ directory exists', async () => {
  await mkdir(join(root, 'skills', 'demo'), { recursive: true });
  await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), '# Demo\n');

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1, 'a missing shared/ must not pass');
  assert.match(stderr, /no shared\/ directory/);
});

test('refuses to report success when there are no markdown targets', async () => {
  await mkdir(join(root, 'shared'), { recursive: true });

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1, 'zero targets must not pass');
  assert.match(stderr, /no markdown files found/);
});

test('rejects --root with no value instead of falling back to the real repo', async () => {
  const { stdout, stderr } = await run(process.execPath, [CLI, '--root'], { reject: false }).catch((e) => e);

  assert.match(`${stdout ?? ''}${stderr ?? ''}`, /--root requires a directory path/);
});

test('rejects --root swallowing a following flag', async () => {
  const result = await run(process.execPath, [CLI, '--root', '--check']).catch((e) => e);

  assert.match(`${result.stdout ?? ''}${result.stderr ?? ''}`, /--root requires a directory path/);
});

test('rejects an unknown flag rather than silently writing', async () => {
  await fixture({ invariants: { ladder: 'x\n' }, skill: '# Demo\n' });

  const { code, stderr } = await cli('-c');

  assert.equal(code, 1, "'-c' must not be accepted as --check");
  assert.match(stderr, /unknown argument '-c'/);
});

// ── Required-blocks policy ──

test('fails when a skill is missing a required shared block', async () => {
  await fixture({
    invariants: { 'api-key': 'Keep the key on the server.\n' },
    shared: { preamble: 'Do not trust internal knowledge.\n' },
    skill: '# Demo\n\nNo markers at all.\n',
  });
  await writeFile(
    join(root, 'shared', 'required.json'),
    JSON.stringify({ 'skills/*/SKILL.md': ['preamble', 'api-key'] }),
  );

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1, 'a skill with no invariants must not pass');
  assert.match(stderr, /missing required shared block\(s\) 'preamble', 'api-key'/);
});

test('passes once the required blocks are present', async () => {
  await fixture({
    shared: { preamble: 'Do not trust internal knowledge.\n' },
    skill: '<!-- shared:start preamble -->\n<!-- shared:end preamble -->\n',
  });
  await writeFile(join(root, 'shared', 'required.json'), JSON.stringify({ 'skills/*/SKILL.md': ['preamble'] }));

  assert.equal((await cli()).code, 0);
  assert.equal((await cli('--check')).code, 0);
});

test('a malformed required.json fails loudly', async () => {
  await fixture({ invariants: { ladder: 'x\n' }, skill: '# Demo\n' });
  await writeFile(join(root, 'shared', 'required.json'), '{ not json');

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1);
  assert.match(stderr, /could not parse/);
});

// ── Source hygiene ──

test('fails when a block name is defined in both shared/ and shared/invariants/', async () => {
  await fixture({
    shared: { 'api-key': 'FROM-ROOT\n' },
    invariants: { 'api-key': 'FROM-INVARIANTS\n' },
    skill: '<!-- shared:start api-key -->\n<!-- shared:end api-key -->\n',
  });

  const { code, stderr } = await cli();

  assert.equal(code, 1, 'ambiguous source must not resolve silently');
  assert.match(stderr, /defined more than once/);
});

test('fails when a shared source itself contains marker syntax', async () => {
  await fixture({
    invariants: { ladder: 'Docs about <!-- shared:end ladder --> the mechanism.\n' },
    skill: '<!-- shared:start ladder -->\n<!-- shared:end ladder -->\n',
  });

  const { code, stderr } = await cli();

  assert.equal(code, 1);
  assert.match(stderr, /contains shared marker syntax/);
});

// ── Whole-run atomicity ──

test('a failing run writes nothing at all, not even the valid files', async () => {
  await fixture({
    invariants: { ladder: 'LADDER TEXT\n' },
    skill: '<!-- shared:start ladder -->\nstale\n<!-- shared:end ladder -->\n',
  });
  // A second skill, sorted after the first, that cannot validate.
  await mkdir(join(root, 'skills', 'zzz'), { recursive: true });
  const broken = '<!-- shared:start ladder -->\nbody\n<!-- shared:end laddr -->\n';
  await writeFile(join(root, 'skills', 'zzz', 'SKILL.md'), broken);

  const { code } = await cli();

  assert.equal(code, 1);
  assert.match(await skillFile(), /stale/, 'the valid-but-stale file must be left untouched');
  assert.equal(await readFile(join(root, 'skills', 'zzz', 'SKILL.md'), 'utf8'), broken);
});

test('accounts for blocks across several skills', async () => {
  await fixture({
    invariants: { ladder: 'LADDER\n' },
    skill: '<!-- shared:start ladder -->\n<!-- shared:end ladder -->\n',
  });
  await mkdir(join(root, 'skills', 'second'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'second', 'SKILL.md'),
    '<!-- shared:start ladder -->\n<!-- shared:end ladder -->\n',
  );

  assert.equal((await cli()).code, 0);
  const { stdout } = await cli('--check');

  assert.match(stdout, /2 block\(s\) across 2 file\(s\)/);
});

test('--check lists every stale file, not just the first', async () => {
  await fixture({
    invariants: { ladder: 'LADDER\n' },
    skill: '<!-- shared:start ladder -->\nstale\n<!-- shared:end ladder -->\n',
  });
  await mkdir(join(root, 'skills', 'second'), { recursive: true });
  await writeFile(
    join(root, 'skills', 'second', 'SKILL.md'),
    '<!-- shared:start ladder -->\nalso stale\n<!-- shared:end ladder -->\n',
  );

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1);
  assert.match(stderr, /skills\/demo\/SKILL\.md: shared block is stale/);
  assert.match(stderr, /skills\/second\/SKILL\.md: shared block is stale/);
});

// ── Symlink containment (security review, HIGH + MEDIUM) ──

test('refuses a symlinked target under skills/ instead of writing through it', async () => {
  // writeFile follows symlinks, so this was an arbitrary-file-overwrite primitive.
  await fixture({
    invariants: { ladder: 'LADDER\n' },
    skill: '<!-- shared:start ladder -->\n<!-- shared:end ladder -->\n',
  });
  const victimDir = await mkdtemp(join(tmpdir(), 'bake-victim-'));
  const victim = join(victimDir, 'victim.txt');
  await writeFile(victim, 'DO NOT OVERWRITE\n');
  await symlink(victim, join(root, 'skills', 'demo', 'link.md'));

  const { code, stderr } = await cli();

  assert.equal(code, 1);
  assert.match(stderr, /is a symbolic link — refused/);
  assert.equal(await readFile(victim, 'utf8'), 'DO NOT OVERWRITE\n', 'must not write through the link');
  await rm(victimDir, { recursive: true, force: true });
});

test('refuses a symlinked block source instead of splicing in an arbitrary file', async () => {
  await fixture({
    invariants: {},
    skill: '<!-- shared:start ladder -->\nplaceholder\n<!-- shared:end ladder -->\n',
  });
  const secretDir = await mkdtemp(join(tmpdir(), 'bake-secret-'));
  const secret = join(secretDir, 'token.txt');
  await writeFile(secret, 'FAKE_SECRET_BODY\n');
  await symlink(secret, join(root, 'shared', 'invariants', 'ladder.md'));

  const { code, stderr } = await cli();

  assert.equal(code, 1);
  assert.match(stderr, /is a symbolic link — refused/);
  assert.ok(!(await skillFile()).includes('FAKE_SECRET_BODY'), 'must not inject foreign content');
  await rm(secretDir, { recursive: true, force: true });
});

test('--check also refuses a symlinked target rather than reporting in sync', async () => {
  await fixture({
    invariants: { ladder: 'LADDER\n' },
    skill: '<!-- shared:start ladder -->\nLADDER\n<!-- shared:end ladder -->\n',
  });
  const otherDir = await mkdtemp(join(tmpdir(), 'bake-other-'));
  const other = join(otherDir, 'elsewhere.md');
  await writeFile(other, '<!-- shared:start ladder -->\n<!-- shared:end ladder -->\n');
  await symlink(other, join(root, 'skills', 'demo', 'link.md'));

  const { code, stderr } = await cli('--check');

  assert.equal(code, 1, 'a skill replaced by a link must not pass as in sync');
  assert.match(stderr, /symbolic link/);
  await rm(otherDir, { recursive: true, force: true });
});
