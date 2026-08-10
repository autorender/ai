import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bakeContent,
  matchesPattern,
  requiredBlocksFor,
  sourceContainsMarker,
  tokenizeMarkers,
  validateMarkers,
} from './bake.mjs';

/** Resolver over a plain object, returning null for unknown names. */
const resolver = (blocks) => (name) => (name in blocks ? blocks[name] : null);

const LADDER = 'Pick every width from the edge ladder: 320, 480, 720.';
const CROP = '`c_fill` does not mean "cover".';

test('injects block content between markers', () => {
  const content = ['# Skill', '', '<!-- shared:start ladder -->', '<!-- shared:end ladder -->', ''].join('\n');

  const { baked, changed, names } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, true);
  assert.deepEqual(names, ['ladder']);
  assert.equal(
    baked,
    ['# Skill', '', '<!-- shared:start ladder -->', LADDER, '<!-- shared:end ladder -->', ''].join('\n'),
  );
});

test('replaces stale content between markers', () => {
  const content = [
    '<!-- shared:start ladder -->',
    'this text is out of date and must go',
    'across several lines',
    '<!-- shared:end ladder -->',
  ].join('\n');

  const { baked, changed } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, true);
  assert.equal(baked, ['<!-- shared:start ladder -->', LADDER, '<!-- shared:end ladder -->'].join('\n'));
  assert.ok(!baked.includes('out of date'));
});

test('is idempotent — baking an already-baked file changes nothing', () => {
  const content = ['<!-- shared:start ladder -->', 'stale', '<!-- shared:end ladder -->'].join('\n');
  const get = resolver({ ladder: LADDER });

  const first = bakeContent(content, get);
  const second = bakeContent(first.baked, get);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false, 'second bake must be a no-op');
  assert.equal(second.baked, first.baked);
});

test('normalises trailing whitespace in the source block', () => {
  const content = ['<!-- shared:start ladder -->', '<!-- shared:end ladder -->'].join('\n');

  const { baked } = bakeContent(content, resolver({ ladder: `${LADDER}\n\n\n` }));

  assert.equal(baked, ['<!-- shared:start ladder -->', LADDER, '<!-- shared:end ladder -->'].join('\n'));
});

test('bakes multiple distinct blocks in one file', () => {
  const content = [
    '<!-- shared:start ladder -->',
    '<!-- shared:end ladder -->',
    'prose in between is preserved',
    '<!-- shared:start crop -->',
    '<!-- shared:end crop -->',
  ].join('\n');

  const { baked, names } = bakeContent(content, resolver({ ladder: LADDER, crop: CROP }));

  assert.deepEqual(names, ['ladder', 'crop']);
  assert.ok(baked.includes(LADDER));
  assert.ok(baked.includes(CROP));
  assert.ok(baked.includes('prose in between is preserved'));
});

test('bakes the same block twice in one file', () => {
  const content = [
    '<!-- shared:start ladder -->',
    '<!-- shared:end ladder -->',
    '<!-- shared:start ladder -->',
    'stale copy',
    '<!-- shared:end ladder -->',
  ].join('\n');

  const { baked, names } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.deepEqual(names, ['ladder', 'ladder']);
  assert.equal(baked.split(LADDER).length - 1, 2, 'both occurrences bake');
  assert.ok(!baked.includes('stale copy'));
});

test('leaves a file with no markers untouched', () => {
  const content = '# Skill\n\nNothing shared here.\n';

  const { baked, changed, names } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, false);
  assert.deepEqual(names, []);
  assert.equal(baked, content);
});

test('preserves surrounding content byte for byte', () => {
  const before = '# Title\n\nIntro paragraph with `code` and a [link](https://example.com).\n\n';
  const after = '\n\n## Later section\n\nTrailing prose.\n';
  const content = `${before}<!-- shared:start ladder -->\n<!-- shared:end ladder -->${after}`;

  const { baked } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.ok(baked.startsWith(before));
  assert.ok(baked.endsWith(after));
});

test('reports an unknown block name and refuses to rewrite the file', () => {
  const content = [
    '<!-- shared:start ladder -->',
    '<!-- shared:end ladder -->',
    '<!-- shared:start typo-name -->',
    '<!-- shared:end typo-name -->',
  ].join('\n');

  const { baked, changed, missing } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.deepEqual(missing, ['typo-name']);
  assert.equal(changed, false, 'must not partially bake');
  assert.equal(baked, content, 'the good block must not be written either');
});

test('detects a start marker whose end marker is misspelled', () => {
  // The dangerous case: a silent no-op if we only looked for well-formed pairs.
  const content = ['<!-- shared:start ladder -->', 'body', '<!-- shared:end laddr -->'].join('\n');

  const { pairs, problems } = validateMarkers(content);

  assert.equal(pairs.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /mismatched marker names/);
});

test('a file with malformed markers is reported and left alone', () => {
  const content = ['<!-- shared:start ladder -->', 'body', '<!-- shared:end laddr -->'].join('\n');

  const { changed, baked, problems } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, false);
  assert.equal(baked, content);
  assert.ok(problems.length > 0);
});

test('detects a stray end marker with no start', () => {
  const content = ['some prose', '<!-- shared:end ladder -->'].join('\n');

  const { pairs, problems } = validateMarkers(content);

  assert.equal(pairs.length, 0);
  assert.match(problems[0], /stray 'end' marker/);
});

test('a well-formed pair produces no problems', () => {
  const content = ['<!-- shared:start ladder -->', LADDER, '<!-- shared:end ladder -->'].join('\n');

  const { pairs, problems } = validateMarkers(content);

  assert.equal(pairs.length, 1);
  assert.deepEqual(problems, []);
});

test('an empty shared source is treated as missing, not as valid empty content', () => {
  // Reversed deliberately: an intentionally-blank invariant has no use case, but
  // an accidentally-blanked one would strip a safety-critical block from every
  // skill with a green build.
  const content = ['<!-- shared:start empty -->', 'real security text', '<!-- shared:end empty -->'].join('\n');

  const { baked, changed, missing } = bakeContent(content, resolver({ empty: '' }));

  assert.deepEqual(missing, ['empty']);
  assert.equal(changed, false);
  assert.equal(baked, content, 'existing text must not be wiped');
});

test('a whitespace-only shared source is treated as missing', () => {
  const content = ['<!-- shared:start blank -->', 'real security text', '<!-- shared:end blank -->'].join('\n');

  const { changed, missing, baked } = bakeContent(content, resolver({ blank: '\n\n  \t\n' }));

  assert.deepEqual(missing, ['blank']);
  assert.equal(changed, false);
  assert.match(baked, /real security text/);
});

test('block content containing markdown tables and pipes survives intact', () => {
  const table = ['| Token | Meaning |', '|---|---|', '| `c_crop` | cover |'].join('\n');
  const content = ['<!-- shared:start crop -->', '<!-- shared:end crop -->'].join('\n');

  const { baked } = bakeContent(content, resolver({ crop: table }));

  assert.ok(baked.includes(table));
});

test('does not treat an uppercase or malformed marker as a block', () => {
  const content = [
    '<!-- SHARED:START ladder -->',
    '<!-- shared:start Ladder -->',
    '<!-- shared:start  ladder -->',
  ].join('\n');

  assert.deepEqual(tokenizeMarkers(content), []);
  assert.deepEqual(validateMarkers(content).problems, []);
});

// ── Regressions for findings the architect review found by breaking the tool ──

test('nested markers are rejected — the inner block must not be swallowed', () => {
  // Was silently deleting the inner invariant and exiting 0.
  const content = [
    '<!-- shared:start outer -->',
    'old-outer',
    '<!-- shared:start inner -->',
    'old-inner',
    '<!-- shared:end inner -->',
    '<!-- shared:end outer -->',
  ].join('\n');

  const { changed, baked, problems } = bakeContent(content, resolver({ outer: 'OUTER', inner: 'INNER' }));

  assert.equal(changed, false);
  assert.equal(baked, content);
  assert.ok(baked.includes('old-inner'), 'the inner block must survive');
  assert.match(problems.join('\n'), /nested or duplicate 'start' marker/);
});

test('a duplicated start with a single end is rejected', () => {
  // The likelier real-world trigger: a copy-paste that lost one end line.
  const content = [
    '<!-- shared:start ladder -->',
    'first',
    '<!-- shared:start ladder -->',
    'second',
    '<!-- shared:end ladder -->',
  ].join('\n');

  const { changed, baked, problems } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, false);
  assert.ok(baked.includes('first'), 'no content may be dropped');
  assert.match(problems.join('\n'), /nested or duplicate/);
});

test('an unclosed start marker is rejected', () => {
  const content = ['<!-- shared:start ladder -->', 'body with no end marker'].join('\n');

  const { changed, problems } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, false);
  assert.match(problems.join('\n'), /unclosed 'start' marker/);
});

test('CRLF line endings in the host file still bake', () => {
  const content = ['<!-- shared:start ladder -->', 'stale', '<!-- shared:end ladder -->'].join('\r\n');

  const { changed, baked, problems } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.deepEqual(problems, [], 'CRLF must not read as a malformed marker');
  assert.equal(changed, true);
  assert.ok(baked.includes(LADDER));
});

test('CRLF in the shared source is normalised to LF before injection', () => {
  const content = ['<!-- shared:start ladder -->', '<!-- shared:end ladder -->'].join('\n');

  const { baked } = bakeContent(content, resolver({ ladder: 'line one\r\nline two\r\n' }));

  assert.ok(!baked.includes('\r'), 'must not commit mixed line endings');
  assert.ok(baked.includes('line one\nline two'));
});

test('a file with no trailing newline bakes correctly', () => {
  const content = '<!-- shared:start ladder -->\nstale\n<!-- shared:end ladder -->';

  const { baked, changed } = bakeContent(content, resolver({ ladder: LADDER }));

  assert.equal(changed, true);
  assert.ok(baked.endsWith('<!-- shared:end ladder -->'));
});

test('unicode, emoji and CJK in a block round-trip byte-exact', () => {
  const exotic = 'Ünïcödé · 🎨 · 日本語 · مرحبا';
  const content = ['<!-- shared:start i18n -->', '<!-- shared:end i18n -->'].join('\n');

  const { baked } = bakeContent(content, resolver({ i18n: exotic }));

  assert.ok(baked.includes(exotic));
});

test('sourceContainsMarker flags a shared source that carries marker syntax', () => {
  // Injecting such a source corrupts the host on run 1 and cannot self-heal.
  assert.equal(sourceContainsMarker('plain prose'), false);
  assert.equal(sourceContainsMarker('text <!-- shared:end ladder --> more'), true);
  assert.equal(sourceContainsMarker('<!-- shared:start ladder -->'), true);
});

// ── Required-blocks policy (the presence half of the guarantee) ──

test('matchesPattern handles * as a single segment and ** as many', () => {
  assert.equal(matchesPattern('skills/*/SKILL.md', 'skills/upload/SKILL.md'), true);
  assert.equal(matchesPattern('skills/*/SKILL.md', 'skills/upload/references/SKILL.md'), false);
  assert.equal(matchesPattern('skills/**/*.md', 'skills/upload/references/sizing.md'), true);
  assert.equal(matchesPattern('skills/*/SKILL.md', 'other/upload/SKILL.md'), false);
});

test('matchesPattern does not let a dot act as a wildcard', () => {
  assert.equal(matchesPattern('skills/*/SKILL.md', 'skills/upload/SKILLxmd'), false);
});

test('requiredBlocksFor unions the requirements of every matching pattern', () => {
  const policy = {
    'skills/*/SKILL.md': ['preamble', 'api-key'],
    'skills/**/*.md': ['preamble'],
  };

  assert.deepEqual(requiredBlocksFor(policy, 'skills/upload/SKILL.md').sort(), ['api-key', 'preamble']);
  assert.deepEqual(requiredBlocksFor(policy, 'skills/upload/references/x.md'), ['preamble']);
  assert.deepEqual(requiredBlocksFor(policy, 'README.md'), []);
});

test('requiredBlocksFor ignores documentation keys beginning with underscore', () => {
  const policy = { _comment: ['not', 'a', 'pattern'], 'skills/*/SKILL.md': ['preamble'] };

  assert.deepEqual(requiredBlocksFor(policy, 'skills/upload/SKILL.md'), ['preamble']);
  assert.deepEqual(requiredBlocksFor(policy, '_comment'), []);
});

test('a pathological marker-like input does not hang the validator', () => {
  // Guards against catastrophic backtracking on contributor-supplied markdown.
  const hostile = '<!-- shared:start a -->\n'.repeat(2000) + 'x'.repeat(50000);

  const started = Date.now();
  const { problems } = validateMarkers(hostile);
  const elapsed = Date.now() - started;

  assert.ok(problems.length > 0);
  assert.ok(elapsed < 2000, `validation took ${elapsed}ms — expected well under 2s`);
});

// ── Regressions for the security review ──

test('matchesPattern stays linear with many ** segments', () => {
  // Was catastrophic backtracking: 32 path segments took ~9.3 s via regex.
  const pattern = `skills/${'**/'.repeat(12)}x.md`;
  const path = `skills/${Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')}/nope.txt`;

  const started = Date.now();
  const result = matchesPattern(pattern, path);
  const elapsed = Date.now() - started;

  assert.equal(result, false);
  assert.ok(elapsed < 250, `took ${elapsed}ms — expected linear time`);
});

test('matchesPattern treats ? as a literal instead of throwing', () => {
  // Was an uncaught SyntaxError: /^?$/ Nothing to repeat.
  assert.equal(matchesPattern('?', 'x'), false);
  assert.equal(matchesPattern('a?.md', 'a?.md'), true);
  assert.equal(matchesPattern('a?.md', 'ab.md'), false);
});

test('** matches zero segments as well as many', () => {
  assert.equal(matchesPattern('skills/**/*.md', 'skills/c.md'), true);
  assert.equal(matchesPattern('skills/**/*.md', 'skills/a/b/c.md'), true);
});
