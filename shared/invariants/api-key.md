## Security Rules

**Keep `AUTORENDER_API_KEY` in server env.** Keys are unscoped: one key can read,
rename and delete every asset in its workspace.

1. Public-facing uploads go through a backend route you own. The browser posts to
   your route; your route calls `POST /api/v1/uploads` with the key.
2. The browser widget requires `apiKey` in client code and has no token mode, so
   it is only for internal tools where every viewer already has workspace access.
   Even then, **never** source it from `NEXT_PUBLIC_*` or `VITE_*` — those are
   compiled into the bundle and served to everyone. Fetch it at runtime from an
   authenticated admin route.
   In the Next.js App Router, **do not pass the key as a prop from a Server
   Component to a Client Component.** Props crossing that boundary are serialized
   into the RSC payload and shipped to the browser, so `<Uploader apiKey={process
   .env.AUTORENDER_API_KEY!} />` leaks it just as surely as a `NEXT_PUBLIC_*` var
   does. The client component must fetch it itself, at runtime, from a route
   handler that checks the session.
3. Server uploads use the `Authorization: Bearer <api_key>` header.
4. Derive the destination `folder` from the authenticated session, never from the
   request body — a client-controlled folder lets any caller write anywhere.
5. **Rate-limit and authenticate your own proxy route.** The upstream limit on
   `POST /api/v1/uploads` is **per workspace, not per caller**, so every visitor of
   your app shares one budget and a single abuser can exhaust it for everyone.
6. **Validate what you forward.** A proxy route that passes the client's file
   straight through inherits every problem with it. Cap the size **as the body
   streams** — a `Content-Length` check is not enough, since a client that omits
   the header makes the check pass and the parse then buffers everything — and
   validate the **bytes**, not the label: `Content-Type` is client-supplied, so a
   type-only allowlist accepts an HTML or SVG payload declared `image/png`. Check
   the magic-byte signature against the claimed type and reject a mismatch. This
   matters because delivery URLs are public, unauthenticated and permanent — a
   mislabelled upload is script served from your own CDN path.
7. **Never accept `remote_url` or `webhook_url` from the client.** A
   client-supplied `remote_url` makes our servers fetch any URL on the caller's
   behalf; a client-supplied `webhook_url` is an outbound-callback primitive.
   Derive both server-side, or allowlist them.
8. CDN delivery URLs (`assets.autorender.io`) are public and need no auth, and the
   workspace ID in them is not a secret.
9. **There is no private-asset mode.** No signed or expiring delivery URLs, no
   per-asset ACL, no referrer allowlist. Anyone holding a URL can fetch it for as
   long as the asset exists, and deleting the row from your own database does not
   revoke it. Treat every upload as world-readable, and if the user asks for
   private or members-only assets, tell them this before building it.
10. **Do not proxy `GET /api/v1/files` to end users.** It is unscoped and returns
    the whole workspace, so one user's request would list everyone's assets. Build
    feeds and galleries from your own database. You cannot make it safe by adding
    a filter: an unrecognized query parameter is **ignored, not rejected**, so
    `?user_id=…` returns the full listing while looking like it scoped it. Only
    `?folder_no=` actually filters, and a caller who can reach the proxy can change it.
11. A proxy for `DELETE /api/v1/files/{file_no}` or the rename endpoint must
    verify the caller owns that `file_no` against your own database before
    forwarding. The key is unscoped, so the API deletes whatever `file_no` it is
    handed — taking one from the request body lets any signed-in user delete
    another user's assets.

Server API calls use `Authorization: Bearer <api_key>` or the documented
`x-api-key` header. Presigned multipart part URLs are called without the API key.
