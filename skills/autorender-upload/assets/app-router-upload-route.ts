/**
 * Autorender upload proxy — Next.js App Router route handler.
 *
 * Copy to `app/api/upload/route.ts`. Pair with `upload-client.tsx`.
 *
 * This is the ONLY correct shape for a public-facing app. Autorender API keys are
 * unscoped — one key can read, rename and delete every asset in the workspace —
 * and there is no client-token mode, so the key must never reach the browser.
 *
 * Requires:
 *   AUTORENDER_API_KEY   server env only. Never NEXT_PUBLIC_, and never passed as a
 *                        prop from a Server Component to a Client Component: props
 *                        crossing that boundary are serialized into the RSC payload
 *                        and reach the browser.
 *
 * Replace `getSession` with your real auth. Everything else runs as written.
 *
 * Platform limits worth knowing before you deploy:
 *   - Vercel caps serverless request bodies at 4.5 MB. MAX_BYTES below is set under
 *     that deliberately; RAISING it does nothing on Vercel, because the platform
 *     returns its own 413 before this handler runs. Larger files need the multipart
 *     flow (see the skill) or a deployment without that cap.
 *   - Self-hosted Next.js has no default body limit, which is why this caps the body
 *     as it streams rather than trusting a header. Do not rely on your host to do it.
 */

// Node runtime: this reads a full body and calls fetch with FormData.
export const runtime = 'nodejs';

const UPLOAD_BASE = process.env.AUTORENDER_UPLOAD_BASE_URL ?? 'https://upload.autorender.io';
const UPLOAD_URL = `${UPLOAD_BASE}/api/v1/uploads`;

const MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB serverless body cap

/**
 * Ceiling for the whole multipart envelope, which is larger than the file inside it:
 * every part carries a boundary and headers. Cap the file at MAX_BYTES and the
 * envelope slightly above, or a legitimate MAX_BYTES file is rejected by its own
 * framing.
 */
const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;

/**
 * Two time limits, because neither one alone is correct.
 *
 * BODY_IDLE_MS is the longest gap allowed BETWEEN chunks. It catches the common case —
 * a client that opens a request and stops — quickly, without penalising a slow
 * connection that is still making progress.
 *
 * BODY_TOTAL_MS is the absolute ceiling. It is needed because an idle timeout does NOT
 * stop a deliberate trickle: a caller sending one byte just inside the idle window
 * resets the clock forever and holds the handler open indefinitely.
 *
 * Note the total is necessarily a floor on required throughput
 * (MAX_BODY_BYTES / BODY_TOTAL_MS ≈ 35 kB/s here, about 0.3 Mbps), which is why it is
 * set generously rather than tightly. RAISE IT IF YOU RAISE MAX_BYTES — the two are
 * coupled, and a 4 MB-era total against a 25 MB cap rejects everyone on mobile.
 */
const BODY_IDLE_MS = 15_000;
const BODY_TOTAL_MS = 120_000;

/** Thrown by the limiter. Distinguishes "too large" from "malformed multipart". */
class BodyTooLarge extends Error {
  name = 'BodyTooLarge';
}

/** Thrown by the limiter when the client stalls or trickles. */
class BodyTooSlow extends Error {
  name = 'BodyTooSlow';
}

/**
 * Re-wraps the request so its body cannot exceed `maxBodyBytes`, cannot pause longer
 * than `idleMs` between chunks, and cannot take longer than `totalMs` overall.
 *
 * A `Content-Length` check is not sufficient on its own. The header is a client claim:
 * omit it, send `Transfer-Encoding: chunked`, and the check reads `0` and passes.
 * `req.formData()` then buffers the entire body — however large — before any
 * authoritative size check can run, so a header-only guard protects the API key while
 * leaving the process itself unbounded. Vercel's platform cap hides this; a
 * self-hosted deployment has no such cap.
 *
 * Bytes, time and concurrency are three separate limits. This covers the first two;
 * see the note at the foot of this file for the third.
 *
 * Note this locks `req.body`. Read anything you need off the original request BEFORE
 * calling this — `await req.text()` afterwards throws.
 */
function withBoundedBody(
  req: Request,
  maxBodyBytes: number,
  idleMs = BODY_IDLE_MS,
  totalMs = BODY_TOTAL_MS,
): Request {
  let seen = 0;
  const stalled = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;

  // Armed once, never reset: this is the limit a trickling client cannot dodge.
  const total = setTimeout(() => stalled.abort(new BodyTooSlow('total time exceeded')), totalMs);
  total.unref?.(); // never keep a serverless instance alive for a timer alone

  // Re-armed on every chunk, so this clock measures silence rather than elapsed time.
  // Armed here too, which covers a client that opens the request and then sends nothing
  // at all — `transform` would never run for it.
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stalled.abort(new BodyTooSlow('idle too long')), idleMs);
    idle.unref?.();
  };
  armIdle();

  const stop = () => {
    clearTimeout(idle);
    clearTimeout(total);
  };

  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBodyBytes) {
        // Errors the stream, which rejects the pending formData() and cancels the
        // source — the client's remaining bytes are never read.
        stop();
        controller.error(new BodyTooLarge('body exceeded the size ceiling'));
        return;
      }
      armIdle();
      controller.enqueue(chunk);
    },
    flush: stop,
  });

  // `duplex: 'half'` is required for a streaming body and is missing from lib.dom's
  // RequestInit in current TypeScript. Widen the type rather than casting the whole
  // object, which would also swallow a typo in a file copiers are expected to edit.
  const init: RequestInit & { duplex: 'half' } = {
    method: req.method,
    // Only the content type is needed downstream, and it carries the multipart
    // boundary. Forwarding every header would copy `cookie` and `authorization` into
    // a synthetic request and guarantee a `content-length` that no longer matches the
    // possibly-truncated stream.
    headers: { 'content-type': req.headers.get('content-type') ?? '' },
    // The signal aborts the pipe when the client stalls, which cancels the source.
    body: req.body?.pipeThrough(limiter, { signal: stalled.signal }),
    duplex: 'half',
  };
  return new Request(req.url, init);
}

/**
 * Magic-byte signatures, checked against the claimed type.
 *
 * `file.type` is a client-supplied multipart header — a claim, not evidence. An
 * HTML or SVG payload declared `image/png` passes a type-only allowlist, and the
 * stored object is then served from a public, unauthenticated, permanent URL on an
 * origin shared with every other workspace. That origin does not currently send
 * `X-Content-Type-Options: nosniff`, so a sniffing browser is the only thing
 * between a mislabelled upload and script execution on that host.
 *
 * Sniffing the bytes is therefore mandatory here, not advisory. Note that matching
 * a signature proves the header is not lying about the container — it does not
 * prove the file is harmless. The only complete defense is re-encoding the image
 * server-side, which this reference does not do.
 * A Map, not an object literal: `object[clientSuppliedType]` walks the prototype
 * chain, so `Content-Type: constructor` (or `toString`) returns an inherited function
 * and passes a `!signature` guard — arbitrary HTML accepted as an image. A Map has no
 * such keys.
 */
const SIGNATURES = new Map<string, (bytes: Uint8Array, size: number) => boolean>([
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  [
    'image/webp',
    (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
  ],
  [
    // ISO-BMFF: bytes 0..3 are the box length, 4..7 are "ftyp", 8..11 the brand.
    // The length MUST be checked: leaving bytes 0..3 free admits
    // `<!--ftypavif-->` + markup as a valid "AVIF", and `<!--` reads as a ~1 GB box.
    'image/avif',
    (b, size) => {
      const boxSize = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
      if (boxSize < 16 || boxSize > size) return false;
      const tag = String.fromCharCode(b[4], b[5], b[6], b[7]);
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      return tag === 'ftyp' && (brand === 'avif' || brand === 'avis');
    },
  ],
]);

/** Extension forced from the validated type, so the name cannot disagree with the bytes. */
const EXTENSION = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);

/**
 * `file.name` is fully client-controlled — a crafted multipart part can set it to
 * anything, including `../../../evil.png`. Deriving `folder` from the session is
 * pointless if the name can climb out of it, so reduce to a basename, allowlist the
 * characters, cap the length, and force the extension from the validated MIME.
 */
function safeFileName(rawName: string, mime: string): string {
  const base = rawName.split(/[\\/]/).pop() ?? '';
  const stem = base
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[.]+/, '')
    .slice(0, 100);
  return `${stem || 'upload'}.${EXTENSION.get(mime)}`;
}

/**
 * Replace with your auth.
 *
 * Return `null` when the caller is not signed in — that is the contract the caller
 * below relies on. Until you implement it this throws, which is deliberate: an
 * unwired copy must fail closed rather than upload for anyone. `userId` should be an
 * opaque identifier, not an email, and must not contain `/`, since it becomes part
 * of the storage folder.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getSession(req: Request): Promise<{ userId: string } | null> {
  throw new Error('Wire this to your auth before using this route.');
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!process.env.AUTORENDER_API_KEY) {
      // Otherwise this sends `Bearer undefined`, gets a 401 upstream, and surfaces
      // as a generic 502 that is only diagnosable from the log.
      throw new Error('AUTORENDER_API_KEY is not set');
    }

    const session = await getSession(req);
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The folder is built from this, so a userId containing `/` would climb out of
    // the per-user prefix. Enforce it rather than only documenting it.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(session.userId)) {
      throw new Error('session userId must be an opaque token');
    }

    if (!req.body) {
      return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    // Cheap fast path only: reject a body that ADMITS to being oversized without
    // reading a byte. This is an optimization, not the guard — see withBoundedBody.
    const declaredLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return Response.json({ error: 'Request body too large' }, { status: 413 });
    }

    // Built OUTSIDE the try below, deliberately. `new Request` throws on a relative
    // URL, which happens if this handler is ported to a runtime that passes a path
    // rather than an absolute URL. Inside the try that throw would be swallowed as
    // "malformed multipart" — every upload failing with a message blaming the client.
    const bounded = withBoundedBody(req, MAX_BODY_BYTES);

    let incoming: FormData;
    try {
      incoming = await bounded.formData();
    } catch (cause) {
      // A limiter trip surfaces as the sentinel itself on current Node; check the
      // `cause` chain too, since a parser is free to wrap what the stream threw.
      const inner = (cause as { cause?: unknown })?.cause;
      if (cause instanceof BodyTooLarge || inner instanceof BodyTooLarge) {
        return Response.json({ error: 'Request body too large' }, { status: 413 });
      }
      if (cause instanceof BodyTooSlow || inner instanceof BodyTooSlow) {
        return Response.json({ error: 'Upload stalled' }, { status: 408 });
      }
      return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const file = incoming.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'Expected a file in the "file" field' }, { status: 400 });
    }

    // The stream ceiling is the ENVELOPE (MAX_BODY_BYTES); this holds the FILE to
    // MAX_BYTES. Both are needed — neither implies the other.
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'File too large' }, { status: 413 });
    }

    const signature = SIGNATURES.get(file.type);
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!signature || !signature(header, file.size)) {
      // Deliberately generic: do not echo the client's claimed type back.
      console.warn('autorender upload rejected: type/bytes mismatch', file.type);
      return Response.json({ error: 'Unsupported or malformed image' }, { status: 415 });
    }

    const form = new FormData();
    form.append('file', file);

    // REQUIRED, and separate from the File's own name — omitting it returns
    // 400 FILE_NAME_REQUIRED.
    form.append('file_name', safeFileName(file.name, file.type));

    // Derive the folder from the session, NEVER from the request body. A
    // client-controlled folder lets any caller write anywhere in the workspace.
    form.append('folder', `users/${session.userId}`);

    // Without this, re-uploading a name that already exists in the folder REPLACES
    // the stored asset and still returns 201. The old binary is gone.
    form.append('random_prefix', 'true');

    const upstream = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AUTORENDER_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    // Forward 429 specifically: the limit is per workspace, so the client needs to
    // know to back off rather than treating it as a generic failure.
    if (upstream.status === 429) {
      return Response.json(
        { error: 'Rate limited' },
        { status: 429, headers: { 'Retry-After': upstream.headers.get('retry-after') ?? '10' } },
      );
    }

    if (!upstream.ok) {
      // Never forward the upstream body — it can carry workspace detail. Log it,
      // return something generic.
      console.error('autorender upload failed', upstream.status, await upstream.text());
      return Response.json({ error: 'Upload failed' }, { status: 502 });
    }

    const asset = await upstream.json();

    // Persist `file_no` as your foreign key and `path` for delivery URLs. Keep
    // `width`/`height` if you render a masonry or anything that needs the aspect
    // ratio before the image loads.
    return Response.json(
      {
        file_no: asset.file_no,
        path: asset.path,
        url: asset.url,
        width: asset.width, // null when the asset has no intrinsic dimensions
        height: asset.height,
      },
      { status: 201 }, // matches what the upstream returns
    );
  } catch (cause) {
    console.error('autorender upload route error', cause);
    return Response.json({ error: 'Upload failed' }, { status: 500 });
  }
}

/**
 * Still yours to add:
 *
 * - **Rate limiting.** The upstream limit on POST /uploads is 60 requests per 10
 *   seconds PER WORKSPACE, not per caller, so one abuser exhausts it for every user
 *   of your app. An in-memory counter does not work on serverless — each invocation
 *   may be a fresh instance — so use a shared store (Redis, Upstash, your database)
 *   keyed on the session.
 * - **CSRF.** This route relies on your auth library's cookie `SameSite` policy. If
 *   yours issues `SameSite=None`, add an Origin check or a CSRF token.
 * - **A concurrency cap, if you self-host.** The size cap and the deadline bound one
 *   request; they say nothing about how many run at once. Peak memory is roughly
 *   MAX_BYTES x 3 per in-flight upload — the envelope the parser buffers, the parsed
 *   File, and the FormData re-serialized for the upstream fetch — so ~100 simultaneous
 *   legitimate uploads is on the order of a gigabyte. Serverless platforms bound this
 *   for you by isolating invocations; a single self-hosted Node process does not.
 */
