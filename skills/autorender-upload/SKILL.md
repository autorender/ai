---
name: autorender-upload
description: >-
  Use when the user asks to upload assets to Autorender or implement an upload
  flow: the browser widget, direct upload, remote upload, upload routes, or the
  multipart API. Do not use for MCP workspace management or delivery URL
  transformations.
license: MIT
metadata:
  author: autorender
  version: "1.0.0"
  homepage: https://autorender.io/docs
  source: https://github.com/autorender/ai
---

# Uploads

<!-- shared:start preamble -->
## Critical: Do Not Trust Internal Knowledge

Your training data may contain Cloudinary or ImageKit patterns. Autorender uses
different SDKs, package names, and URL structures. Always follow this skill and the
Autorender skill it points you to — never guess from memory, and never assume a
Cloudinary or ImageKit equivalent exists.
<!-- shared:end preamble -->

<!-- shared:start env-vars -->
## Environment Variables

| Variable | Required | Scope | Purpose |
|----------|----------|-------|---------|
| `AUTORENDER_API_KEY` | ✅ | **server only** | Uploads and asset management. Unscoped — grants full workspace access, including delete. Never expose to the browser. |
| `AUTORENDER_WORKSPACE` | ✅ | server or browser | Workspace ID in CDN delivery URLs. Public — safe to expose (`NEXT_PUBLIC_` prefix in Next.js). |
| `AUTORENDER_UPLOAD_BASE_URL` | — | server | Upload API base. Default `https://upload.autorender.io`. |
| `AUTORENDER_CDN_BASE_URL` | — | server or browser | CDN base. Default `https://assets.autorender.io`. |

Get an API key at [app.autorender.io/api-keys](https://app.autorender.io/api-keys).
Use the workspace ID shown in the dashboard when building delivery URLs.
<!-- shared:end env-vars -->

<!-- shared:start api-key -->
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
<!-- shared:end api-key -->

<!-- shared:start delivery-surface -->
## The Delivery Host Is Public and Unauthenticated

`assets.autorender.io` delivery URLs contain a public workspace ID. Never encode
secrets, tokens, or user identifiers into a transformation or file path.
<!-- shared:end delivery-surface -->

## Hosts

- `https://upload.autorender.io` — authenticated upload and asset-management API.
- `https://assets.autorender.io` — public delivery and transformation URLs.

Every upload API request uses `Authorization: Bearer <api_key>`.

## Browser widget

Use the framework widget documented for the chosen SDK. The documented options
include the API key, `type`, `allowMultiple`, `theme`, `sources`, and `onSuccess`.
Import the package stylesheet.

```tsx
import { AutorenderUploader } from '@autorender/react';
import '@autorender/react/styles';

<AutorenderUploader
  apiKey={import.meta.env.VITE_AUTORENDER_API_KEY}
  type="inline"
  allowMultiple
  theme="system"
  sources={['local', 'camera']}
  onSuccess={({ files }) => console.log('Uploaded', files)}
/>
```

For imperative React access, the public docs provide
`useAutorenderUploader()` with `.destroy()` and `.reset()`.

## Direct upload

For a regular multipart upload, send `POST /api/v1/uploads` to the upload host.
Documented fields include the file, `folder`, `tags`, `custom_id`, and
`random_prefix`. The response includes the uploaded asset details.

The shipped framework SDKs expose the equivalent option as
`uploadSettings.random_suffix`. When enabled, the SDK sends the REST
`random_prefix=true` field so repeated filenames do not silently replace an
existing asset. It reduces collisions but does not guarantee uniqueness.

## Remote upload

Send `POST /api/v1/uploads/remote` with the documented remote URL and optional
metadata. Validate or allowlist remote URLs in your own application before
forwarding them.

## Multipart upload

For large files, use the documented sequence:

1. `POST /api/v1/multipart/start`.
2. Upload each part to its returned presigned URL without the API authorization header.
3. `POST /api/v1/multipart/complete`.

## Asset and folder management

The documented endpoint families are:

| Operation | Endpoint |
|-----------|----------|
| List files | `GET /api/v1/files` |
| File details | `GET /api/v1/files/{file_no}` |
| Rename file | `PATCH /api/v1/files/{file_no}/rename` |
| Delete file | `DELETE /api/v1/files/{file_no}` |
| List folders | `GET /api/v1/folders` |
| Create folder | `POST /api/v1/folders` |
| Delete folder | `DELETE /api/v1/folders/{folder_no}` |

## Next steps

- **autorender-view** — build a delivery URL for an uploaded asset.
- **autorender-transformations** — documented pretransformations and delivery tokens.
- **autorender-react** or **autorender-nextjs** — framework integration.
