/**
 * Autorender delete and rename — Next.js App Router route handler.
 *
 * Copy to `app/api/assets/[fileNo]/route.ts`.
 *
 * These are the destructive operations, and a private key is unrestricted: it deletes or
 * renames whatever `file_no` it is handed, with no notion of who owns it. So the
 * ownership check below is not defence in depth — it is the ONLY thing standing
 * between a signed-in user and every other user's assets.
 *
 * Getting this wrong is not recoverable. Delivery URLs are public, and a shared
 * URL remains usable until the asset is removed from the workspace.
 *
 * Requires:
 *   AUTORENDER_API_KEY   server env only, never exposed to the browser
 *
 * Replace `getSession` and `assertOwnership` with your real auth and database.
 * Both throw until you do.
 */

export const runtime = 'nodejs';

const API_BASE = process.env.AUTORENDER_UPLOAD_BASE_URL ?? 'https://upload.autorender.io';

/** `file_no` comes from the URL, so constrain it before it reaches an upstream path. */
const FILE_NO = /^[A-Za-z0-9_-]{1,64}$/;

/** Replace with your auth. Return null when the caller is not signed in. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getSession(req: Request): Promise<{ userId: string } | null> {
  throw new Error('Wire this to your auth before using these routes.');
}

/**
 * Return true only if THIS user owns THIS asset, according to your own database.
 *
 * Query your own records — the row you wrote when the upload succeeded. Do not ask
 * Autorender: the API answers for the whole workspace, so it will happily confirm
 * that a file exists and let you delete it regardless of who uploaded it. The
 * `folder` convention (`users/<id>/…`) is a storage layout, not an authorization
 * model, and must not be used as one either — a caller who learns another user's ID
 * would otherwise be authorized by construction.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function assertOwnership(userId: string, fileNo: string): Promise<boolean> {
  throw new Error('Wire this to your database before using these routes.');
}

type Ctx = { params: Promise<{ fileNo: string }> };

/** What a handler receives once ownership has been proven. */
type Owned = { fileNo: string; userId: string };

/**
 * Wraps a handler so the ownership check cannot be skipped.
 *
 * This is a wrapper rather than a helper you remember to call: a handler added later
 * — a batch endpoint, a "move" — physically cannot reach the upstream API without
 * passing through here first. On this file that is the whole safety property, because
 * the API key deletes whatever `file_no` it is handed.
 */
function withOwnership(handler: (req: Request, owned: Owned) => Promise<Response>) {
  return async function (req: Request, ctx: Ctx): Promise<Response> {
    try {
      if (!process.env.AUTORENDER_API_KEY) {
        throw new Error('AUTORENDER_API_KEY is not set');
      }

      let session: { userId: string } | null;
      try {
        session = await getSession(req);
      } catch (cause) {
        // Log it: a database outage must be distinguishable from a genuine rejection.
        console.error('autorender asset route: auth failed', cause);
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (!session) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { fileNo } = await ctx.params;
      if (!FILE_NO.test(fileNo)) {
        return Response.json({ error: 'Invalid file id' }, { status: 400 });
      }

      // A throw here fails closed: the catch below returns 500, never the upstream call.
      if (!(await assertOwnership(session.userId, fileNo))) {
        // The only signal that someone is probing other users' ids. Log it.
        console.warn('autorender asset route: ownership denied', { userId: session.userId, fileNo });
        // 404, not 403. A 403 confirms the asset exists, which turns this endpoint
        // into an oracle for enumerating other users' file ids. Do not "fix" this
        // to a 403 — the status is deliberately indistinguishable from "no such file".
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      return await handler(req, { fileNo, userId: session.userId });
    } catch (cause) {
      console.error('autorender asset route error', cause);
      return Response.json({ error: 'Request failed' }, { status: 500 });
    }
  };
}

/** Forward 429 so the caller backs off; log anything else and stay generic. */
function upstreamFailure(kind: string, upstream: Response, body: string): Response {
  if (upstream.status === 429) {
    return Response.json(
      { error: 'Rate limited' },
      { status: 429, headers: { 'Retry-After': upstream.headers.get('retry-after') ?? '10' } },
    );
  }
  // Already gone upstream: report it as absent rather than as a server fault, so a
  // retry after a partial failure converges instead of looping on a 502.
  if (upstream.status === 404) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  console.error(`autorender ${kind} failed`, upstream.status, body);
  return Response.json({ error: `${kind} failed` }, { status: 502 });
}

export const DELETE = withOwnership(async (_req, { fileNo }) => {
  const upstream = await fetch(`${API_BASE}/api/v1/files/${encodeURIComponent(fileNo)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.AUTORENDER_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!upstream.ok) {
    return upstreamFailure('Delete', upstream, await upstream.text());
  }

  // Delete your own row too, or the asset is gone while your feed still lists it.
  // Do this after the upstream call succeeds, and make it idempotent: a retry must
  // not fail because the row is already absent.

  return new Response(null, { status: 204 });
});

/**
 * Extensions a rename may produce.
 *
 * The upload route derives the extension from validated magic bytes precisely
 * because the delivery origin is public, shared across workspaces, and sends no
 * `X-Content-Type-Options: nosniff`. A rename that accepted any extension would hand
 * that back to the client — `payload.html` on your own CDN path — so it is
 * constrained here too. This is NOT the same as upload's sanitizer: upload knows the
 * real bytes, whereas rename only knows what the caller asks for. So this allowlist
 * still permits swapping one image extension for another — a PNG can become `x.avif`.
 * If that matters to you, compare against the extension you recorded at upload time
 * and reject a change, which is strictly safer than trusting the request.
 */
const RENAME_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);

export const PATCH = withOwnership(async (req, { fileNo }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const requested = (body as { name?: unknown })?.name;
  if (typeof requested !== 'string' || requested.length === 0) {
    return Response.json({ error: 'Expected a "name" string' }, { status: 400 });
  }

  // Basename only: a rename must not become a way to move the asset.
  const base = requested.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const extension = dot === -1 ? '' : base.slice(dot + 1).toLowerCase();

  if (!RENAME_EXTENSIONS.has(extension)) {
    return Response.json(
      { error: 'Name must end in .jpg, .jpeg, .png, .webp or .avif' },
      { status: 400 },
    );
  }

  // Slice the stem, then re-append — slicing the whole name can cut the extension off.
  const stem = base
    .slice(0, dot)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[.]+/, '')
    .slice(0, 100);

  if (!stem) {
    return Response.json({ error: 'Invalid name' }, { status: 400 });
  }

  const upstream = await fetch(`${API_BASE}/api/v1/files/${encodeURIComponent(fileNo)}/rename`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.AUTORENDER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: `${stem}.${extension}` }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!upstream.ok) {
    return upstreamFailure('Rename', upstream, await upstream.text());
  }

  // The rename has already happened upstream, so a parse failure here must NOT be
  // reported as a failure — the client would retry a mutation that already applied.
  // Treat the upstream 2xx as authoritative and return whatever could be read.
  const asset = (await upstream.json().catch(() => null)) as
    | { file_no?: string; path?: string; url?: string }
    | null;

  // A rename changes `path`, so every delivery URL you cached or stored for this
  // asset is now stale. Update your own row from this response. If it came back
  // empty, re-read the asset rather than assuming the old path still works.
  return Response.json({ file_no: asset?.file_no, path: asset?.path, url: asset?.url });
});

/**
 * Two things this file deliberately does NOT do:
 *
 * - **Folder delete.** `DELETE /api/v1/folders/{folder_no}` removes a folder and
 *   everything under it. There is no per-asset ownership to check, so exposing it to
 *   end users is almost never right — keep it in an admin path behind your own
 *   authorization.
 * - **Batch operations.** Accepting an array of `file_no` invites a loop that checks
 *   ownership for the first and deletes all of them. `withOwnership` proves one id,
 *   so a batch handler must check every id itself before touching any — as ONE query
 *   over all the ids, not a loop that can pass halfway. And note a partially applied
 *   batch cannot be rolled back: there is no undo.
 *
 * Still yours to add, and more urgent here than on upload:
 *
 * - **Rate limiting.** Rename and delete share a budget of **30 requests per minute
 *   per workspace** — a fifth of the upload budget — so one user's delete loop starves
 *   everyone. Key a limiter on the session, in a shared store if you run more than one
 *   instance.
 * - **CSRF.** These are the irreversible operations. Both force a CORS preflight, so a
 *   cross-origin form cannot reach them and a `SameSite=Lax` cookie is enough — but if
 *   your auth issues `SameSite=None`, add an Origin check or a CSRF token here first.
 * - **The ownership row itself.** `assertOwnership` reads a row that
 *   `app-router-upload-route.ts` only writes in a comment. Until you implement that
 *   write, every delete and rename returns 404. That is fail-closed and correct — do
 *   NOT "fix" it by making `assertOwnership` return true.
 *
 * One hazard rename does NOT remove: a name that already exists in the same folder.
 * On upload, a repeated name replaces the stored asset and still returns success,
 * which is why the upload route sends `random_prefix`. Rename has no such flag, so if
 * you expose renaming, expect collisions and decide deliberately whether to detect
 * them in your own database first.
 */
