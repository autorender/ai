#!/usr/bin/env node
/**
 * Contract test — does the PLATFORM still behave the way the skills say it does?
 *
 *   AUTORENDER_BENCH_API_KEY=… AUTORENDER_BENCH_WORKSPACE=… node benchmarks/contract.mjs
 *
 * This is the drift detector, and it is a different question from the grader.
 *
 * `run.mjs` grades a candidate app against rules the skills teach. Those rules are a
 * SECOND COPY of the docs, so if the platform changes underneath, the docs go stale and
 * the grader goes stale in the same direction — a candidate built from stale docs still
 * scores green. The grader can never redden on its own.
 *
 * This file asserts the platform's behaviour directly, so when reality moves it fails
 * regardless of what the docs say. It needs no agent and no candidate app.
 *
 * Every assertion below quotes the claim it is testing and where that claim lives, so a
 * failure tells you which line of which skill to go and fix.
 *
 * Uploads real assets, so it needs the DEDICATED benchmark workspace — never production.
 */

import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

import { loadCredentials, redact, safeLog } from './lib/secrets.mjs';

/**
 * Build a two-tone PNG of any size, with no image library and no huge base64 constant.
 *
 * Generated rather than embedded because the width-ladder assertions need a 2000 px source
 * and its base64 would be a 12 KB literal in the middle of this file. Two-tone rather than
 * flat: a solid colour compresses to nearly the same size whether it was squashed or
 * cropped, which would make the byte comparisons in the crop assertion meaningless.
 */
function makePng(width, height) {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf) => {
    let r = 0xffffffff;
    for (const b of buf) r = crcTable[(r ^ b) & 0xff] ^ (r >>> 8);
    return (r ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3); // leading 0 = no filter
    for (let x = 0; x < width; x += 1) {
      const o = 1 + x * 3;
      const left = x < width / 2;
      row[o] = left ? 220 : 30;
      row[o + 1] = 60;
      row[o + 2] = left ? 40 : 200;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Only Autorender hosts, only https: this request carries an unscoped key.
 *
 * Resolved ONCE at startup rather than per request. Called lazily, a misconfigured host
 * threw inside every assertion and was reported as `DRIFT` — so a typo in an env var
 * would have read as "the platform changed", which is the one conclusion this file must
 * never reach by accident.
 */
export function resolveUploadBase() {
  const configured = process.env.AUTORENDER_UPLOAD_BASE_URL;
  if (!configured) return 'https://upload.autorender.io';
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('AUTORENDER_UPLOAD_BASE_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.autorender\.io$/.test(url.hostname)) {
    throw new Error(
      `refusing to send the API key to ${url.protocol}//${url.hostname} — ` +
        'AUTORENDER_UPLOAD_BASE_URL must be https and an *.autorender.io host',
    );
  }
  return url.origin;
}

/**
 * Classify width observations without network access so the known-drift allowlist is
 * regression-testable. A result outside both the specification and the AR-181 signature
 * is novel drift and must never be hidden by the temporary XFAIL.
 */
export function classifyWidthBucketObservations(observed) {
  const unexpected = observed.filter(
    ({ width, expected, knownDrift }) => width !== expected && width !== knownDrift,
  );
  if (unexpected.length) return { status: 'drift', failures: unexpected };

  const knownFailures = observed.filter(({ width, expected }) => width !== expected);
  if (knownFailures.length) return { status: 'known-drift', failures: knownFailures };

  return { status: 'holds', failures: [] };
}

/** Set in main(), before any assertion runs. */
let UPLOAD_BASE;

/**
 * Deliberately NOT host-validated, unlike the upload base.
 *
 * Every request built on this sends no `Authorization` header and no body, so pointing it
 * elsewhere leaks only the workspace id and path the operator already supplied — the worst
 * case is a fabricated DRIFT result, i.e. a broken test, not a disclosure.
 *
 * That reasoning depends entirely on there being no credential on these requests. If you
 * ever add a header here, validate this the way `resolveUploadBase` does, or this becomes
 * the one-variable exfiltration primitive that guard exists to prevent.
 */
const CDN_BASE = process.env.AUTORENDER_CDN_BASE_URL ?? 'https://assets.autorender.io';

/** A 1x1 PNG. Small enough that a run costs almost nothing. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * A 64x32 source, non-square, for the crop assertions.
 *
 * Non-square is what makes a mode that DISTORTS distinguishable from one that covers. The
 * size matters too: an earlier version used a 2x1 source and asked for a 320x320 box, which
 * no crop mode can satisfy without enlarging — so it was asserting the wrong thing
 * entirely. A 64x32 source asked for a 32x32 box needs no enlargement in either mode.
 */
const PNG_64X32 = makePng(64, 32);

/**
 * A 2000x1000 source, for the width-bucketing claims.
 *
 * The source is wider than every bucket so the assertions can distinguish normalization
 * from the separate no-upscale rule. It covers the <=240 exact-width bypass, an on-bucket
 * request, and the off-bucket round-up cases tracked in AR-181.
 */
const PNG_2000X1000 = makePng(2000, 1000);

/**
 * A claim this workspace cannot decide either way. Reported as SKIP rather than HOLDS,
 * because "I could not test it" and "it still works" are different answers and conflating
 * them is how a suite starts manufacturing confidence.
 */
export class Inconclusive extends Error {
  name = 'Inconclusive';
}

/** A recognized, tracked platform deviation that is visible but neutral to the verdict. */
export class KnownDrift extends Error {
  name = 'KnownDrift';
}

/**
 * Is this a transport or capacity problem rather than a change in behaviour?
 *
 * `resolveUploadBase` is called at startup precisely so a config typo cannot be reported
 * as drift. The same reasoning applies to the network, and on a weekly cron it is the far
 * more frequent case: a DNS blip, a CDN 503 or a 429 would otherwise print "the platform
 * no longer behaves the way the skills describe" and exit 1. A detector that cries wolf
 * gets muted, and then it is worth nothing.
 */
function isTransportFailure(cause) {
  if (cause instanceof RateLimited || cause instanceof Upstream) return true;
  const name = cause?.name ?? '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  // undici surfaces connect/reset failures as a TypeError carrying a cause.
  return cause instanceof TypeError && cause.cause !== undefined;
}

/** Thrown for a 429, so an assertion body does not have to special-case it. */
class RateLimited extends Error {
  name = 'RateLimited';
}

/** Thrown for a 5xx, which says nothing about documented behaviour. */
class Upstream extends Error {
  name = 'Upstream';
}

/** Reject the statuses that mean "ask again later" rather than "this is the contract". */
function refuseTransient(status, what) {
  if (status === 429) throw new RateLimited(`${what} was rate limited (429)`);
  if (status >= 500) throw new Upstream(`${what} returned ${status}`);
}

/** One retry, because a single blip should not need a human to re-dispatch the job. */
async function withRetry(what, fn) {
  try {
    return await fn();
  } catch (cause) {
    if (!isTransportFailure(cause)) throw cause;
    await new Promise((r) => setTimeout(r, 1500));
    return fn();
  }
}

/**
 * Build an isolated assertion runner. Exported so the status/counter semantics can be
 * tested without credentials or network access.
 */
export function createAssertionRunner(logger = safeLog) {
  const state = { failures: 0, skipped: 0, knownDrift: 0, results: [] };

  return {
    state,
    async assertClaim(claim, source, fn) {
      try {
        const note = await fn();
        state.results.push({ ok: true, claim, source, note: note ?? '' });
        logger.info(`  HOLDS  ${claim}${note ? ` — ${note}` : ''}`);
      } catch (cause) {
        if (cause instanceof KnownDrift) {
          state.knownDrift += 1;
          state.results.push({ ok: null, knownDrift: true, claim, source, note: cause.message });
          logger.warn(`  XFAIL  ${claim}\n         ${cause.message}`);
          return;
        }
        if (cause instanceof Inconclusive || isTransportFailure(cause)) {
          state.skipped += 1;
          // `.message`, not `redact(cause)`: an Inconclusive is control flow, not an error,
          // and dumping its stack into the human summary buried the reason.
          const why = cause instanceof Inconclusive ? cause.message : `transport: ${redact(cause)}`;
          state.results.push({ ok: null, claim, source, note: why });
          logger.warn(`  SKIP   ${claim}\n         ${why}`);
          return;
        }
        state.failures += 1;
        state.results.push({ ok: false, claim, source, note: redact(cause) });
        logger.error(`  DRIFT  ${claim}\n         claimed in: ${source}\n         ${redact(cause)}`);
      }
    }
  };
}

/** The direct runner still uses process.exit(2) for harness failures. */
export function contractExitCode({ failures = 0, skipped = 0, harnessFailure = false }) {
  if (harnessFailure) return 2;
  return failures ? 1 : skipped ? 3 : 0;
}

/** Print the verdict summary independently of cleanup and process control. */
export function writeContractSummary(state, logger = safeLog) {
  if (state.failures) {
    logger.error(
      `${state.failures} claim(s) DRIFTED. The platform no longer behaves the way the skills ` +
        'describe. Fix the skills (or the platform) before shipping docs that are wrong.',
    );
  } else {
    const held = state.results.filter((r) => r.ok === true).length;
    logger.info(`all ${held} testable claim(s) hold.`);
  }
  if (state.knownDrift) {
    logger.warn(
      `${state.knownDrift} claim(s) are known platform drift, tracked in AR-181 — ` +
        'XFAIL, not failing the run.',
    );
  }
  if (state.skipped) {
    logger.warn(
      `${state.skipped} claim(s) could NOT be tested in this workspace and were neither confirmed nor ` +
        'denied. Read the SKIP lines above — an untested claim is not a holding one.',
    );
  }
}

function upload(key, form) {
  return withRetry('upload', async () => {
    const res = await fetch(`${UPLOAD_BASE}/api/v1/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    refuseTransient(res.status, 'upload');
    return res;
  });
}

function pngForm(bytes, fields = {}) {
  const form = new FormData();
  form.append('file', new File([bytes], 'contract.png', { type: 'image/png' }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

/** Unwrap the listing payload, whichever envelope it arrives in. */
function filesOf(body) {
  return Array.isArray(body) ? body : (body.files ?? body.data ?? []);
}

function listFiles(key, query = '') {
  return withRetry('listing', async () => {
    const res = await fetch(`${UPLOAD_BASE}/api/v1/files${query}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    refuseTransient(res.status, 'listing');
    return res;
  });
}

/**
 * Intrinsic dimensions of PNG, JPEG or WebP bytes, without an image library.
 *
 * Format sniffing is not optional here. Delivery RE-ENCODES: a PNG source requested
 * without an `f_` token comes back as `image/jpeg`. An earlier version parsed every
 * response as a PNG IHDR, read the JPEG's bytes at those offsets, and reported a
 * 134217728x100667905 image — which surfaced as two confident DRIFT results against a
 * platform that was behaving correctly. A parser that cannot tell it was handed the wrong
 * format will invent a failure rather than report one.
 */
export function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      // SOF0..SOF15 carry the frame dimensions; DHT/JPG/DAC share the range but do not.
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { format: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      const len = b.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
    return { format: 'jpeg', width: null, height: null };
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return { format: 'webp', width: null, height: null };
  }
  return { format: 'unknown', width: null, height: null };
}

/** Fetch a rendition and fail loudly rather than parsing an error page as an image. */
async function rendition(workspace, tokens, path, { format } = {}) {
  const renditionTokens = format ? [tokens, `f_${format}`].filter(Boolean).join(',') : tokens;
  const url = renditionTokens
    ? `${CDN_BASE}/${workspace}/${renditionTokens}/${path}`
    : `${CDN_BASE}/${workspace}/${path}`;
  return withRetry('delivery', async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    refuseTransient(res.status, `delivery of ${tokens || '(no tokens)'}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', bytes };
  });
}

/**
 * Remove the folder tree this run created. Returns whether it worked.
 *
 * Deliberately swallows every error: this runs after the verdict is decided and must not
 * be able to change it.
 */
async function deleteFolder(key, folderNo) {
  if (!folderNo) return false;
  try {
    const res = await fetch(`${UPLOAD_BASE}/api/v1/folders/${encodeURIComponent(folderNo)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Just the status, for the token-handling sweeps where the body is irrelevant. */
async function renditionStatus(workspace, tokens, path) {
  return withRetry('delivery', async () => {
    const res = await fetch(`${CDN_BASE}/${workspace}/${tokens}/${path}`, {
      signal: AbortSignal.timeout(20_000),
      method: 'GET',
    });
    refuseTransient(res.status, `delivery of ${tokens}`);
    await res.arrayBuffer().catch(() => {});
    return res.status;
  });
}

async function main() {
  const runner = createAssertionRunner();
  const { assertClaim, state } = runner;
  const { key, workspace } = loadCredentials({ required: true });
  // Before anything else: a bad host must abort, not be reported as drift.
  UPLOAD_BASE = resolveUploadBase();
  const folder = `contract/${Date.now()}`;
  let uploaded = false;
  // This run's own subfolder, captured from the first upload that succeeds. Deleting THIS
  // rather than the shared `contract` parent matters: a concurrent or previous run's
  // folder is a sibling, and cleanup must never take someone else's data with it.
  let runFolderNo;

  safeLog.info('Autorender contract test — asserting platform behaviour, not docs\n');

  await assertClaim(
    'omitting file_name returns 400 FILE_NAME_REQUIRED',
    // NOT api-key.md — it says nothing about file_name. The claim is duplicated across
    // six files, which is itself the argument for promoting it to a shared block: a
    // changed error code currently means six edits.
    'skills/autorender-upload/SKILL.md (and five other files repeating it)',
    async () => {
      const res = await upload(key, pngForm(PNG_1X1, { folder }));
      if (res.status !== 400) {
        throw new Error(`expected 400, got ${res.status} — file_name may no longer be required`);
      }
      const body = await res.text();
      if (!/FILE_NAME_REQUIRED/.test(body)) {
        throw new Error(`400 returned but not FILE_NAME_REQUIRED; the error code changed`);
      }
      return 'still 400 FILE_NAME_REQUIRED';
    },
  );

  await assertClaim(
    'a repeated file_name in the same folder REPLACES the asset and still returns 201',
    'autorender-upload/SKILL.md — the reason random_prefix exists',
    async () => {
      const name = `dup-${Date.now()}.png`;
      const first = await upload(key, pngForm(PNG_1X1, { file_name: name, folder }));
      if (first.status !== 201) throw new Error(`first upload returned ${first.status}, expected 201`);
      uploaded = true;
      const a = await first.json();
      runFolderNo ??= a.folder_no;

      const second = await upload(key, pngForm(PNG_1X1, { file_name: name, folder }));
      if (second.status === 409) {
        throw new Error('a duplicate name now returns 409 — the silent-replace warning is obsolete');
      }
      if (second.status !== 201) throw new Error(`duplicate returned ${second.status}, expected 201`);
      const b = await second.json();
      if (b.path !== a.path) {
        throw new Error(`duplicate produced a different path (${b.path}) — it no longer replaces`);
      }
      return 'still replaces silently with 201';
    },
  );

  await assertClaim(
    'random_prefix=true prevents the replacement',
    'autorender-upload/SKILL.md and assets/app-router-upload-route.ts',
    async () => {
      const name = `pref-${Date.now()}.png`;
      const one = await upload(key, pngForm(PNG_1X1, { file_name: name, folder, random_prefix: 'true' }));
      const two = await upload(key, pngForm(PNG_1X1, { file_name: name, folder, random_prefix: 'true' }));
      if (one.status !== 201 || two.status !== 201) {
        throw new Error(`random_prefix uploads returned ${one.status}/${two.status}, expected 201`);
      }
      const [a, b] = [await one.json(), await two.json()];
      if (a.path === b.path) throw new Error('random_prefix no longer produces distinct paths');
      return 'distinct paths';
    },
  );

  // The crop, ladder and token assertions all need one real non-square asset.
  let widePath;
  let wideFolderNo;
  await assertClaim(
    'uploading the 64x32 fixture the delivery assertions need',
    'benchmarks/contract.mjs — harness precondition, not a platform claim',
    async () => {
      const res = await upload(key, pngForm(PNG_64X32, { file_name: `wide-${Date.now()}.png`, folder }));
      if (res.status !== 201) throw new Error(`fixture upload returned ${res.status}`);
      const body = await res.json();
      widePath = body.path;
      wideFolderNo = body.folder_no;
      runFolderNo ??= body.folder_no;
      uploaded = true;
      if (body.width !== 64 || body.height !== 32) {
        throw new Error(
          `the stored asset is ${body.width}x${body.height}, not 64x32 — the fixture or the ` +
            'upload pipeline changed, and every dimension assertion below would be meaningless',
        );
      }
      return `stored 64x32 at ${widePath}`;
    },
  );

  await assertClaim(
    'delivery URLs are public and do not require an Authorization header',
    'shared/invariants/delivery-surface.md — public unauthenticated delivery host',
    async () => {
      if (!widePath) throw new Inconclusive('the delivery fixture upload did not succeed');
      const res = await rendition(workspace, '', widePath);
      if (res.status !== 200) throw new Error(`public delivery returned ${res.status}`);
      if (!res.bytes.length) throw new Error('public delivery returned an empty body');
      return `200 without credentials (${res.contentType || 'unknown content type'})`;
    },
  );

  await assertClaim(
    'c_fill covers the box (fills it and crops overflow), matching c_crop; c_fit fits inside instead',
    'shared/invariants/crop-modes.md — the single most load-bearing correction we make',
    async () => {
      if (!widePath) throw new Inconclusive('the fixture upload did not succeed');

      // A 64x32 (2:1) source asked for a 32x32 box. We assert only what the crop-modes
      // table states and what is robustly decidable from dimensions and byte-equality — no
      // undocumented behaviour (no c_scale, no claim about whether c_fit pads).
      //
      // NOTE: dimensions alone cannot tell cover apart from a hypothetical distort (both
      // fill the box to 32x32). Proving "covers, does not distort" at the pixel level needs
      // a purpose-built two-tone fixture and is validated by the live run, not asserted here.
      //
      // 1. c_fill COVERS -> it returns the exact box, 32x32 (a fit would keep the 2:1
      //    aspect and come back 32x16).
      const filled = await rendition(workspace, 'c_fill,w_32,h_32', widePath, { format: 'png' });
      if (filled.status !== 200) throw new Error(`c_fill delivery returned ${filled.status}`);
      const fs = imageSize(filled.bytes);
      if (fs.width !== 32 || fs.height !== 32) {
        throw new Error(
          `c_fill returned ${fs.width}x${fs.height} (${fs.format}), not 32x32 — it no longer covers the box`,
        );
      }

      // 2. c_crop is documented as the same crop-to-fill behaviour, and w_+h_ with no crop
      //    mode is documented as the same again. Both must return 32x32, and w_+h_ must
      //    match c_crop byte for byte — a non-vacuous equality that reddens if either of
      //    the two documented-identical modes moves.
      const cropped = await rendition(workspace, 'c_crop,w_32,h_32', widePath, { format: 'png' });
      if (cropped.status !== 200) throw new Error(`c_crop delivery returned ${cropped.status}`);
      const cs = imageSize(cropped.bytes);
      if (cs.width !== 32 || cs.height !== 32) {
        throw new Error(`c_crop returned ${cs.width}x${cs.height}, not 32x32 — it no longer fills the box`);
      }
      const noMode = await rendition(workspace, 'w_32,h_32', widePath, { format: 'png' });
      if (noMode.status !== 200) throw new Error(`w_32,h_32 delivery returned ${noMode.status}`);
      if (Buffer.compare(noMode.bytes, cropped.bytes) !== 0) {
        throw new Error(
          'w_+h_ with no crop mode no longer matches c_crop byte for byte, though the crop-modes ' +
            'table calls them the same — one of the two changed',
        );
      }

      // 3. c_fit FITS the whole image inside the box — a different operation from covering
      //    it, so their encoded bytes must differ. We assert only that they differ, not
      //    c_fit's exact dimensions: the docs do not state whether it pads, and pinning a
      //    number here would invent an undocumented claim.
      const fit = await rendition(workspace, 'c_fit,w_32,h_32', widePath, { format: 'png' });
      if (fit.status !== 200) throw new Error(`c_fit delivery returned ${fit.status}`);
      if (Buffer.compare(filled.bytes, fit.bytes) === 0) {
        throw new Error(
          'c_fill and c_fit returned identical bytes — cover and fit are documented as different ' +
            'operations, so identical output means one no longer behaves as the table describes',
        );
      }

      return (
        `c_fill covers to 32x32, c_crop and w_+h_ agree byte for byte, ` +
        `c_fill (${filled.bytes.length}B) differs from c_fit (${fit.bytes.length}B)`
      );
    },
  );

  await assertClaim(
    'a width larger than the source does not enlarge it',
    // Documented in the resize reference, not the crop-modes table.
    'https://autorender.io/docs/transformations/resize-and-aspect-ratio.md — no upscaling beyond source',
    async () => {
      if (!widePath) throw new Inconclusive('the fixture upload did not succeed');
      const res = await rendition(workspace, 'w_500', widePath, { format: 'png' });
      if (res.status !== 200) throw new Error(`w_500 delivery returned ${res.status}`);
      const { width, format } = imageSize(res.bytes);
      if (width === null) throw new Error(`could not read dimensions from a ${format} response`);
      if (width > 64) {
        throw new Error(`w_500 returned width ${width} from a 64px source — it now enlarges`);
      }
      return `w_500 -> ${width}px from a 64px source (${format}); no enlargement, as documented`;
    },
  );

  let ladderPath;
  await assertClaim(
    'uploading the 2000x1000 fixture the width-ladder assertions need',
    'benchmarks/contract.mjs — harness precondition, not a platform claim',
    async () => {
      const res = await upload(key, pngForm(PNG_2000X1000, { file_name: `ladder-${Date.now()}.png`, folder }));
      if (res.status !== 201) throw new Error(`fixture upload returned ${res.status}`);
      const body = await res.json();
      ladderPath = body.path;
      runFolderNo ??= body.folder_no;
      uploaded = true;
      if (body.width !== 2000) throw new Error(`the stored asset is ${body.width}px wide, not 2000`);
      return `stored 2000x1000`;
    },
  );

  await assertClaim(
    'width bucketing preserves the <=240 exact-width bypass and on-bucket widths',
    'shared/invariants/width-ladder.md — width bucket normalization',
    async () => {
      if (!ladderPath) throw new Inconclusive('the ladder fixture upload did not succeed');
      const expected = [
        ['w_200', 200],
        ['w_240', 240],
        ['w_241', 320],
        ['w_720', 720],
      ];
      const wrong = [];
      for (const [token, want] of expected) {
        const res = await rendition(workspace, token, ladderPath, { format: 'png' });
        if (res.status !== 200) throw new Error(`${token} delivery returned ${res.status}`);
        const { width, format } = imageSize(res.bytes);
        if (width === null) throw new Error(`could not read dimensions from a ${format} response`);
        if (width !== want) wrong.push(`${token} -> ${width}, expected ${want}`);
      }
      if (wrong.length) {
        throw new Error(`stable width-bucketing behaviour changed: ${wrong.join('; ')}`);
      }
      return expected.map(([t, w]) => `${t}->${w}`).join(', ');
    },
  );

  await assertClaim(
    'off-bucket widths round up after DPR is folded into the requested width',
    'Image Size Bucketing & Normalization; https://linear.app/autorenderhq/issue/AR-181',
    async () => {
      if (!ladderPath) throw new Inconclusive('the ladder fixture upload did not succeed');
      const cases = [
        ['w_501', 720, 480],
        ['w_800', 1080, 720],
        ['w_1125', 1440, 1080],
        ['w_400,dpr_2', 1080, 720],
      ];
      const observed = [];
      for (const [token, expected, knownDrift] of cases) {
        const res = await rendition(workspace, token, ladderPath, { format: 'png' });
        if (res.status !== 200) throw new Error(`${token} delivery returned ${res.status}`);
        const { width, format } = imageSize(res.bytes);
        if (width === null) throw new Error(`could not read dimensions from a ${format} response`);
        observed.push({ token, width, expected, knownDrift });
      }

      const classification = classifyWidthBucketObservations(observed);
      if (classification.status === 'drift') {
        throw new Error(
          `width bucketing has unexpected drift: ${classification.failures
            .map(({ token, width, expected }) => `${token} -> ${width}, expected ${expected}`)
            .join('; ')}`,
        );
      }

      if (classification.status === 'known-drift') {
        throw new KnownDrift(
          'width bucketing rounds nearest, not up — tracked in AR-181 ' +
            '(https://linear.app/autorenderhq/issue/AR-181); re-enable the round-up assertion ' +
            `when the platform fix lands. Observed: ${classification.failures
              .map(({ token, width, expected }) => `${token} -> ${width}, expected ${expected}`)
              .join('; ')}`,
        );
      }

      return observed.map(({ token, width }) => `${token}->${width}`).join(', ');
    },
  );

  await assertClaim(
    'an invalid token is sometimes dropped and sometimes a 404 — both behaviours still exist',
    'shared/invariants/unknown-tokens.md',
    async () => {
      if (!widePath) throw new Inconclusive('the fixture upload did not succeed');

      // This claim is deliberately two-sided. The invariant used to say unknown tokens are
      // ALWAYS dropped with a 200, and a live run proved that wrong — so the assertion has
      // to fail if either half stops being true, including if the platform "fixes" this by
      // making it uniform. Uniform behaviour would be an improvement AND a doc change.
      const dropped = [];
      const notFound = [];
      for (const token of ['c_bogus', 'e_bogus', 'r_bogus', 'w_bogus', 'q_bogus', 'g_face']) {
        const status = await renditionStatus(workspace, token, widePath);
        if (status === 200) dropped.push(token);
        else if (status === 404) notFound.push(token);
        else throw new Error(`${token} returned ${status}, which is neither the 200 nor the 404 we document`);
      }
      if (dropped.length === 0) {
        throw new Error(
          `every invalid token now 404s (${notFound.join(', ')}) — the "silently dropped" half of the ` +
            'invariant is obsolete',
        );
      }
      if (notFound.length === 0) {
        throw new Error(
          `every invalid token now returns 200 (${dropped.join(', ')}) — the 404 warning is obsolete, ` +
            'and the older, simpler guidance was right after all',
        );
      }
      return `dropped: ${dropped.join(', ')} · 404: ${notFound.join(', ')}`;
    },
  );

  await assertClaim(
    'only the first path segment is parsed as transformations; a second one 404s',
    'shared/invariants/unknown-tokens.md',
    async () => {
      if (!widePath) throw new Inconclusive('the fixture upload did not succeed');
      const twoSegments = await renditionStatus(workspace, 'w_32/q_80', widePath);
      if (twoSegments !== 404) {
        throw new Error(
          `w_32/q_80 returned ${twoSegments} — multiple transformation segments may now be supported, ` +
            'which would make the comma-only guidance unnecessarily restrictive',
        );
      }
      const oneSegment = await renditionStatus(workspace, 'w_32,q_80', widePath);
      if (oneSegment !== 200) {
        throw new Error(`the comma form w_32,q_80 returned ${oneSegment} — the documented form is broken`);
      }
      return 'w_32/q_80 -> 404, w_32,q_80 -> 200';
    },
  );

  await assertClaim(
    'an unsupported f_ value skips re-encoding and returns a Content-Type that lies about the bytes',
    'autorender-transformations/SKILL.md — the f_ token table',
    async () => {
      if (!widePath) throw new Inconclusive('the fixture upload did not succeed');
      const res = await rendition(workspace, 'f_bogus', widePath);
      if (res.status !== 200) throw new Error(`f_bogus returned ${res.status}, expected it to be tolerated`);
      const { format } = imageSize(res.bytes);
      // Parse the header rather than string-replacing it. `image/png; charset=utf-8` left
      // `claimed` as "png; charset=utf-8", which can never equal a sniffed format — so a
      // routine CDN change adding a parameter would have made this assertion pass forever.
      const claimed = res.contentType.split(';')[0].trim().toLowerCase().replace('image/', '');
      if (format !== 'png') {
        throw new Error(
          `f_bogus returned ${format} bytes — re-encoding is no longer skipped, so the "resizes ` +
            'but skips re-encoding" half of the claim is obsolete',
        );
      }
      if (format === claimed) {
        throw new Error(
          `f_bogus now returns ${format} bytes with a matching Content-Type — the header no longer ` +
            'lies, so the warning in the f_ table should be removed',
        );
      }
      return `header says ${res.contentType}, bytes are ${format}`;
    },
  );

  await assertClaim(
    'an unrecognized filter on GET /api/v1/files is IGNORED, not rejected',
    'shared/invariants/api-key.md rule 10',
    async () => {
      if (!wideFolderNo) throw new Inconclusive('the fixture upload did not succeed, so its folder is unknown');

      // WHY THIS CLAIM AND NOT "the listing is workspace-wide".
      //
      // Rule 10's headline is that one user's request lists everyone's assets. That is a
      // TWO-IDENTITY property, and this harness holds one credential — so an assertion
      // built on it cannot fail: if per-caller scoping shipped tomorrow, the single key
      // would still see its own workspace and the check would still say HOLDS. The
      // previous version tried anyway, and its failure branch was literally unreachable
      // (the root listing never contains this run's uploads, so "anything outside our
      // folder" matched everything, always). It said HOLDS every run for no reason.
      //
      // What IS decidable with one key is the operational half of the same rule, and it
      // is the half an implementer gets wrong: you cannot bolt scoping onto this endpoint
      // from the caller side, because an unknown parameter is silently dropped rather
      // than refused. A proxy that "filters by user" returns the entire workspace.
      const scoped = await listFiles(key, `?folder_no=${encodeURIComponent(wideFolderNo)}`);
      if (!scoped.ok) throw new Error(`folder-scoped listing returned ${scoped.status}`);
      const scopedFiles = filesOf(await scoped.json());
      if (scopedFiles.length === 0) {
        throw new Error(
          `?folder_no=${wideFolderNo} returned nothing though this run just uploaded there — ` +
            'either the filter stopped working or the listing does not reflect new assets',
        );
      }

      const bogus = await listFiles(key, '?user_id=someone-else');
      if (!bogus.ok) throw new Error(`listing with an unknown parameter returned ${bogus.status}`);
      const bogusFiles = filesOf(await bogus.json());
      const unfiltered = await listFiles(key);
      if (!unfiltered.ok) throw new Error(`unfiltered listing returned ${unfiltered.status}`);
      const allFiles = filesOf(await unfiltered.json());

      if (allFiles.length === 0) {
        throw new Inconclusive(
          'the workspace root listing is empty, so an ignored filter is indistinguishable from ' +
            'an honoured one — put a file at the workspace root to make this decidable',
        );
      }
      if (bogusFiles.length !== allFiles.length) {
        throw new Error(
          `?user_id=… returned ${bogusFiles.length} of ${allFiles.length} assets — an unknown ` +
            'parameter now changes the result, so it is being interpreted. Rule 10 should say ' +
            'what the new behaviour is: rejected, or honoured as a real filter?',
        );
      }
      return `?folder_no= filters (${scopedFiles.length}), ?user_id= is ignored (${bogusFiles.length} of ${allFiles.length})`;
    },
  );

  safeLog.info('');
  // Loudly, and after the headline. A skip that reads as a pass rebuilds exactly the
  // vacuous-confidence problem this file exists to remove.
  writeContractSummary(state);
  if (uploaded) {
    // Clean up after ourselves. On a weekly cron, "delete them when convenient" was 52
    // abandoned folders a year — and the listing assertion above is easier to reason
    // about in a workspace that is not full of our own litter.
    //
    // Best-effort and reported as a NOTE, never as a claim: a failed cleanup is our
    // problem, not evidence the platform drifted. One request, well inside the documented
    // 30/min budget for delete.
    const removed = await deleteFolder(key, runFolderNo);
    if (removed) {
      safeLog.info(`\nRemoved this run's test folder '${folder}'.`);
    } else {
      safeLog.warn(
        `\nNOTE: could not remove '${folder}' — delete it manually. Cleanup failing is a ` +
          'harness problem and is deliberately not counted as drift.',
      );
    }
  }

  // 0 all testable claims hold · 1 drift · 2 could not run · 3 something was untestable.
  //
  // A skip HAS to move the exit code. Nobody reads a green job's log, so "1 skipped" and
  // "0 skipped" were indistinguishable in CI — which is the conflation the SKIP state was
  // introduced to remove, reappearing one layer up at the only signal the workflow reads.
  // `run.mjs` already uses 3 for "not a failure, but a human must look".
  //
  // exitCode rather than exit(): stdout to a pipe is async and exit() can truncate the
  // summary, which is the entire deliverable.
  process.exitCode = contractExitCode(state);
}

/**
 * Only run when invoked directly. The parsers below are exported so they can be unit
 * tested — and `imageSize` in particular MUST be, since the version that could not tell a
 * JPEG from a PNG is what reported a healthy platform as drifting.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.on('unhandledRejection', (cause) => {
    safeLog.error(`unhandled rejection: ${redact(cause)}`);
    process.exit(2);
  });
  // Matches run.mjs. In a file whose whole job is not leaking a key, the default printer
  // must never be the thing that reports an error — node prints AggregateError.errors,
  // which redact() does not walk.
  process.on('uncaughtException', (cause) => {
    safeLog.error(`uncaught exception: ${redact(cause)}`);
    process.exit(2);
  });

  main().catch((cause) => {
    safeLog.error(`contract test could not run: ${redact(cause)}`);
    process.exit(2);
  });
}
