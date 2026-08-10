/**
 * Pure logic for baking shared blocks into skill files.
 *
 * Kept free of fs/process so it can be tested directly. The CLI in
 * ../bake-shared.mjs supplies file reading, globbing and exit codes.
 *
 * Design note: markers are validated as a FLAT token stream, not matched as
 * regex pairs. Deriving validity from a `start …(.*?)… end` regex is unsafe —
 * the lazy body happily swallows a nested or duplicated marker, so a second
 * invariant inside the span is silently deleted on bake. Blocks do not nest;
 * validating the stream makes that structural rule explicit and catches
 * nesting, duplicate starts, mismatched names and strays in one pass.
 */

/** Any start or end marker. Names are restricted so they cannot escape a path. */
const MARKER_RE = /<!-- shared:(start|end) ([a-z0-9-]+) -->/g;

/**
 * @typedef {{type: 'start'|'end', name: string, index: number, length: number}} Marker
 */

/**
 * Every marker in document order.
 * @param {string} content
 * @returns {Marker[]}
 */
export function tokenizeMarkers(content) {
  return [...content.matchAll(MARKER_RE)].map((m) => ({
    type: /** @type {'start'|'end'} */ (m[1]),
    name: m[2],
    index: m.index,
    length: m[0].length,
  }));
}

/**
 * Validate the marker stream and return well-formed pairs.
 *
 * Blocks are flat: exactly `start X, end X, start Y, end Y, …`.
 *
 * @param {string} content
 * @returns {{pairs: {name: string, start: Marker, end: Marker}[], problems: string[]}}
 */
export function validateMarkers(content) {
  const tokens = tokenizeMarkers(content);
  const pairs = [];
  const problems = [];
  let open = null;

  for (const token of tokens) {
    const at = `at offset ${token.index}`;

    if (token.type === 'start') {
      if (open) {
        problems.push(
          `nested or duplicate 'start' marker for block '${token.name}' ${at} — ` +
            `block '${open.name}' is still open (started at offset ${open.index}); ` +
            `shared blocks must not nest`,
        );
        continue;
      }
      open = token;
      continue;
    }

    // token.type === 'end'
    if (!open) {
      problems.push(`stray 'end' marker for block '${token.name}' ${at} — no matching 'start'`);
      continue;
    }
    if (open.name !== token.name) {
      problems.push(
        `mismatched marker names ${at} — 'start ${open.name}' is closed by 'end ${token.name}'; ` +
          `a mismatched pair would silently never be injected`,
      );
      open = null;
      continue;
    }
    pairs.push({ name: open.name, start: open, end: token });
    open = null;
  }

  if (open) {
    problems.push(
      `unclosed 'start' marker for block '${open.name}' at offset ${open.index} — ` +
        `missing '<!-- shared:end ${open.name} -->'`,
    );
  }

  return { pairs, problems };
}

/**
 * Match a POSIX-style path against a minimal glob supporting `*` (one segment)
 * and `**` (any number of segments). Used to apply the required-blocks policy to
 * paths without pulling in a dependency.
 *
 * @param {string} pattern e.g. `skills/*​/SKILL.md`
 * @param {string} path repo-relative, forward slashes
 * @returns {boolean}
 */
/**
 * Match one path segment against a pattern segment containing literal
 * characters and `*` wildcards.
 *
 * Iterative single-star backtracking, O(pattern × segment) worst case.
 * @param {string} pattern
 * @param {string} segment
 * @returns {boolean}
 */
function matchSegment(pattern, segment) {
  let p = 0;
  let s = 0;
  let star = -1;
  let resume = 0;

  while (s < segment.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      resume = s;
    } else if (p < pattern.length && pattern[p] === segment[s]) {
      p++;
      s++;
    } else if (star !== -1) {
      p = star + 1;
      s = ++resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/**
 * Match a POSIX-style path against a minimal glob supporting `*` (within one
 * segment) and `**` (zero or more whole segments).
 *
 * Deliberately NOT regex-based. Translating `**` into a regex means nesting
 * unbounded quantifiers, and a policy pattern with several `**` against a long
 * non-matching path then backtracks catastrophically — seconds of CPU, growing
 * exponentially with path depth, from a value a contributor controls in
 * `shared/required.json`. This is the standard linear-time glob walk instead.
 *
 * @param {string} pattern e.g. `skills/*​/SKILL.md`
 * @param {string} path repo-relative, forward slashes
 * @returns {boolean}
 */
export function matchesPattern(pattern, path) {
  const pats = pattern.split('/');
  const segs = path.split('/');

  let p = 0;
  let s = 0;
  let star = -1;
  let resume = 0;

  while (s < segs.length) {
    if (p < pats.length && pats[p] === '**') {
      star = p++;
      resume = s;
    } else if (p < pats.length && pats[p] !== '**' && matchSegment(pats[p], segs[s])) {
      p++;
      s++;
    } else if (star !== -1) {
      p = star + 1;
      s = ++resume;
    } else {
      return false;
    }
  }
  while (p < pats.length && pats[p] === '**') p++;
  return p === pats.length;
}

/**
 * Blocks that a file must contain, per the policy map. A file may match several
 * patterns; the requirements union.
 *
 * @param {Record<string, string[]>} policy pattern -> required block names
 * @param {string} path repo-relative, forward slashes
 * @returns {string[]}
 */
export function requiredBlocksFor(policy, path) {
  const required = new Set();
  for (const [pattern, names] of Object.entries(policy)) {
    // Keys starting with `_` are documentation (e.g. `_comment`), not patterns.
    if (pattern.startsWith('_')) continue;
    if (matchesPattern(pattern, path)) {
      for (const name of names) required.add(name);
    }
  }
  return [...required];
}

/**
 * True if a shared source itself contains marker syntax. Injecting such a
 * source corrupts the host file on the first run and cannot self-heal on the
 * second, so it is rejected at load time.
 * @param {string} source
 * @returns {boolean}
 */
export function sourceContainsMarker(source) {
  return tokenizeMarkers(source).length > 0;
}

/**
 * Inject shared content into every validated marker pair.
 *
 * Injection is idempotent: the source block is trimmed of trailing whitespace
 * and rewritten with exactly one newline on each side of the markers, so baking
 * an already-baked file is a no-op. Line endings inside an injected block are
 * normalised to LF.
 *
 * A file that cannot be fully resolved is returned unchanged — never partially
 * baked.
 *
 * @param {string} content
 * @param {(name: string) => string | null} getBlock resolves a block name to its source, or null
 * @returns {{baked: string, names: string[], missing: string[], problems: string[], changed: boolean}}
 */
export function bakeContent(content, getBlock) {
  const { pairs, problems } = validateMarkers(content);
  const names = pairs.map((pair) => pair.name);

  const missing = [];
  for (const name of new Set(names)) {
    const block = getBlock(name);
    // An empty or whitespace-only source counts as missing: an intentionally
    // blank invariant has no use case, whereas an accidentally blanked one would
    // silently strip a safety-critical block out of every skill.
    if (block == null || String(block).trim() === '') missing.push(name);
  }

  if (problems.length || missing.length) {
    return { baked: content, names, missing, problems, changed: false };
  }

  // Rebuild from marker offsets rather than regex-replacing, so the replaced
  // span is exactly the one validation agreed on.
  let baked = '';
  let cursor = 0;
  for (const { name, start, end } of pairs) {
    const block = String(getBlock(name)).replace(/\r\n/g, '\n').trimEnd();
    baked += content.slice(cursor, start.index + start.length);
    baked += `\n${block}\n`;
    cursor = end.index;
  }
  baked += content.slice(cursor);

  return { baked, names, missing, problems, changed: baked !== content };
}
