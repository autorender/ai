---
name: autorender-mcp
description: >-
  Use when the user asks to inspect or manage files in an Autorender workspace
  through the remote MCP server: list, upload, rename, tag, delete, or perform
  multipart uploads. Do not use for application upload code; use the
  autorender-upload skill. The MCP host is not a REST API proxy.
compatibility: >-
  Requires an MCP-capable client. Authorize once at api-mcp.autorender.io/authorize;
  the key is held server-side per connection.
license: MIT
metadata:
  author: autorender
  version: "1.0.0"
  homepage: https://autorender.io/docs
  source: https://github.com/autorender/ai
---

# MCP Tools

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
| `AUTORENDER_PUBLIC_KEY` | for browser uploads | server or browser | Uploads only. Safe to expose (`NEXT_PUBLIC_`/`VITE_` prefix) — it cannot list, read, rename, or delete. |
| `AUTORENDER_API_KEY` | for server-side asset work | **server only** | A **private** key: uploads plus asset management. Grants full workspace access, including delete. Never expose to the browser. |
| `AUTORENDER_WORKSPACE` | ✅ | server or browser | Workspace ID in CDN delivery URLs. Public — safe to expose (`NEXT_PUBLIC_` prefix in Next.js). |
| `AUTORENDER_UPLOAD_BASE_URL` | — | server | Upload API base. Default `https://upload.autorender.io`. |
| `AUTORENDER_CDN_BASE_URL` | — | server or browser | CDN base. Default `https://assets.autorender.io`. |

Which key you need follows from where the code runs: browser or mobile code takes the
public key, server code that lists, renames, or deletes takes a private key. An app can
use both.

Both are at [app.autorender.io/api-keys](https://app.autorender.io/api-keys) — the public
key is shown there permanently, a private key only once when you create it. Use the
workspace ID shown in the dashboard when building delivery URLs.
<!-- shared:end env-vars -->

<!-- shared:start api-key -->
## Security Rules

**Two key types, two scopes.** A workspace has one **public key** and any number of
**private keys**, and the API enforces the difference on every request:

| | Public key | Private key |
|---|---|---|
| Scope | Upload endpoints only | Everything: upload, list, read, rename, delete |
| Client-side | **Safe** — that is its purpose | **Never** |
| Env var | `AUTORENDER_PUBLIC_KEY` | `AUTORENDER_API_KEY` (server only) |

A public key on anything other than an upload endpoint returns `403`. It cannot list,
read, rename, or delete, so publishing it in a bundle costs you nothing but upload
quota. A private key can do all of those to **every asset in the workspace**.

1. **Browser uploads have two valid shapes. Pick deliberately.**
   - **Direct with the public key.** The browser holds `AUTORENDER_PUBLIC_KEY` and posts
     straight to `POST /api/v1/uploads`. Fewer moving parts, no proxy to run, and no
     credential to leak — the key is meant to be seen.
   - **Through a backend route you own, with a private key.** Choose this when you need
     something a direct upload cannot give you: validating the bytes, enforcing a
     per-user quota, or recording the upload in your own database. The browser posts to
     your route; your route calls the API with `AUTORENDER_API_KEY`.

   The tradeoff is not about the credential, it is about the **chokepoint**: a direct
   upload has no server step, so rules 5 and 6 below are yours to give up or keep.
2. **Never put a private key in client code.** Do not source it from `NEXT_PUBLIC_*` or
   `VITE_*` — those are compiled into the bundle and served to everyone. In the Next.js
   App Router, **do not pass a private key as a prop from a Server Component to a Client
   Component** either: props crossing that boundary are serialized into the RSC payload
   and shipped to the browser, so `<Uploader apiKey={process.env.AUTORENDER_API_KEY!} />`
   leaks it just as surely as a `NEXT_PUBLIC_*` var does.

   The public key is the opposite: `NEXT_PUBLIC_AUTORENDER_PUBLIC_KEY`,
   `VITE_AUTORENDER_PUBLIC_KEY`, and crossing the RSC boundary as a prop are all fine.
   The browser widget takes it directly, so a widget on a public page no longer needs an
   authenticated admin route to fetch a key at runtime.
3. Server API calls use the `Authorization: Bearer <api_key>` header.
4. Derive the destination `folder` from the authenticated session, never from the
   request body — a client-controlled folder lets any caller write anywhere.
5. **Rate limits are per workspace, not per caller.** Every visitor of your app shares
   one budget on `POST /api/v1/uploads`, and a single abuser can exhaust it for everyone.
   This bites hardest on a **direct public-key upload**, where you have no server step to
   throttle: the key is in the page, so anyone can replay it. If abuse is a real risk for
   your app, use the proxy shape and rate-limit and authenticate your own route. The
   public key cannot be rotated or revoked, so rate limiting is the only lever you have.
6. **Validate what you forward — and note that a direct upload cannot.** A proxy route
   that passes the client's file straight through inherits every problem with it. Cap the
   size **as the body streams** — a `Content-Length` check is not enough, since a client
   that omits the header makes the check pass and the parse then buffers everything — and
   validate the **bytes**, not the label: `Content-Type` is client-supplied, so a
   type-only allowlist accepts an HTML or SVG payload declared `image/png`. Check the
   magic-byte signature against the claimed type and reject a mismatch. This matters
   because delivery URLs are public, unauthenticated and permanent — a mislabelled upload
   is script served from your own CDN path. **If you need this guarantee, you need the
   proxy shape**; a direct public-key upload has no server step in which to enforce it.
7. **Never accept `remote_url` or `webhook_url` from the client.** A client-supplied
   `remote_url` makes our servers fetch any URL on the caller's behalf; a client-supplied
   `webhook_url` is an outbound-callback primitive. Derive both server-side, or allowlist
   them.
8. CDN delivery URLs (`assets.autorender.io`) are public and need no auth, and the
   workspace ID in them is not a secret.
9. **There is no private-asset mode.** No signed or expiring delivery URLs, no per-asset
   ACL, no referrer allowlist. Anyone holding a URL can fetch it for as long as the asset
   exists, and deleting the row from your own database does not revoke it. Treat every
   upload as world-readable, and if the user asks for private or members-only assets,
   tell them this before building it.
10. **Do not proxy `GET /api/v1/files` to end users.** A private key sees the whole
    workspace, so one user's request would list everyone's assets. Build feeds and
    galleries from your own database. You cannot make it safe by adding a filter: an
    unrecognized query parameter is **ignored, not rejected**, so `?user_id=…` returns
    the full listing while looking like it scoped it. Only `?folder_no=` actually
    filters, and a caller who can reach the proxy can change it. A public key cannot
    reach this endpoint at all — it returns `403` — so a gallery built on the public key
    fails rather than over-shares.
11. A proxy for `DELETE /api/v1/files/{file_no}` or the rename endpoint must verify the
    caller owns that `file_no` against your own database before forwarding. A private key
    deletes whatever `file_no` it is handed, so taking one from the request body lets any
    signed-in user delete another user's assets. These endpoints reject a public key.

Server API calls use `Authorization: Bearer <api_key>` or the documented `x-api-key`
header. Presigned multipart part URLs are called without any API key.
<!-- shared:end api-key -->

The Autorender MCP server gives an agent **13** tools for reading and writing
real assets while it builds: list, upload, tag, rename, and delete files and
folders, plus a three-call multipart flow for large files.

It is a remote server at `https://api-mcp.autorender.io/sse`. Authorize once at
`https://api-mcp.autorender.io/authorize`. The API key is held server-side per
connection and injected into each call, so the key never reaches the model and
never appears in a transcript.

## The two hosts are not interchangeable

| Host | Who calls it |
|------|--------------|
| `https://api-mcp.autorender.io/sse` | The agent, during a build, through these tools |
| `https://upload.autorender.io/api/v1` | The application backend you scaffold, with `Authorization: Bearer <api_key>` |

The MCP host is not a REST proxy. `fetch('https://api-mcp.autorender.io/files')`
returns `404`. Generated application code always calls
`https://upload.autorender.io/api/v1` from a server, never from the browser — see
the **autorender-upload** skill.

## Every tool

Each tool is a thin wrapper over one REST endpoint, so the table doubles as the
endpoint map for the backend routes you write.

| Tool | Endpoint | Required arguments |
|------|----------|--------------------|
| `list_files` | `GET /files` | — |
| `get_file` | `GET /files/{file_no}` | `file_no` |
| `upload_file` | `POST /uploads` | `file_base64`, `file_name` |
| `update_file` | `PATCH /files/{file_no}` | `file_no`, plus one of `add_tags`, `remove_tags`, `metadata` |
| `rename_file` | `PATCH /files/{file_no}/rename` | `file_no`, `name` |
| `delete_file` | `DELETE /files/{file_no}` | `file_no` |
| `list_folders` | `GET /folders` | — |
| `create_folder` | `POST /folders` | `name` |
| `rename_folder` | `POST /folders/rename/{folder_no}` | `folder_no`, `name` |
| `delete_folder` | `DELETE /folders/{folder_no}` | `folder_no` |
| `multipart_start` | `POST /multipart/start` | `file_name`, `size`, `format` |
| `multipart_upload_part` | `PUT <presigned_url>` | `presigned_url`, `part_base64` |
| `multipart_complete` | `POST /multipart/complete` | `session_id` |

## Reading files

`list_files` returns `{ files: [...], meta: { page, limit, total, hasNext, hasPrev } }`.

| Parameter | Values |
|-----------|--------|
| `page` | Integer **1** or higher |
| `limit` | **1** to **100** |
| `sort_field` | `created_at`, `file_size`, or `name` |
| `sort_order` | `asc` or `desc` |
| `path` | Path prefix, e.g. `products/chairs` |
| `name` | Filename filter |
| `tags` | Comma-separated with **no spaces**, e.g. `hero,banner` |
| `folder_no` | From `list_folders` |

`tags` is a comma-separated string here and a string array on `upload_file`. A
`tags: ["hero", "banner"]` passed to `list_files` does not filter.

Each file carries both `id` and `file_no`. Every path parameter takes `file_no` —
`id` is the internal record UUID and is not accepted anywhere.

```jsonc
{
  "id": "49a3999c-8e2b-4f6a-9c1d-7b0a2e5f8d34",
  "file_no": "f_8Kd2mQ",
  "name": "showroom.jpg",
  "folder_no": "fd_3Nq7",
  "folder_name": "hero",
  "format": "jpg",
  "mime_type": "image/jpeg",
  "size": 284713,
  "width": 2400,
  "height": 1600,
  "path": "hero/showroom.jpg",
  "url": "https://assets.autorender.io/Xq4mB7nRzT/hero/showroom.jpg", // host follows the workspace CDN domain — read it, do not assume it
  "created_at": "2026-07-14T09:22:41.000Z",
  "tags": ["hero", "product"]
}
```

`width` and `height` are `null` for formats where the dimensions are unknown, so
never pass them straight into an `<img>` without a null check.

## Turning a listed file into a delivery URL

The returned `url` is an untransformed original. Do not string-append tokens to
it and do not hardcode its host into application code — build the transformed URL
from `path`, which is the only field the delivery URL needs:

```typescript
import { createAR } from '@autorender/js/viewtag';

const ar = createAR({ workspace: 'LOKVTtKVGb' });

// file.path is "hero/showroom.jpg"
const src = ar.url(file.path, { w: 720 });
// https://assets.autorender.io/Xq4mB7nRzT/w_720/hero/showroom.jpg
```

Use `file.thumbnail ?? file.url` only as an immediate preview, and only for the
poster frame of a video. `thumbnail` is absent on most images.

## Uploading

`upload_file` takes the bytes as `file_base64`; the server decodes them and sends
the `file` multipart field. `file_name` is required and must include the
extension — the upload returns `400 FILE_NAME_REQUIRED` without it.

Two arguments change stored state in ways that are not obvious:

- **`transform`** (e.g. `w_360,h_240,c_crop`) transforms the asset before it is
  stored, so the original is gone. Use it only when the original is genuinely
  unwanted; for everything else store the original and apply tokens at delivery
  time, which costs nothing extra and stays reversible.
- **`random_prefix: true`** prevents overwrite. A repeated `file_name` in the same
  folder replaces the stored asset and still returns success, so pass
  `random_prefix: true` on any name you did not choose yourself.

`metadata` is an object and merges into whatever is already stored. `custom_id`
is the field for your own primary key.

## Large files

Files above the direct-upload limit go through three calls. `multipart_start`
returns a `session_id` and one presigned `PUT` URL per part.

1. `multipart_start` with `file_name`, `size` in bytes, and `format` as a MIME
   type (`video/mp4`, not `mp4`).
2. `multipart_upload_part` once per entry in `parts`, passing that entry's `url`
   as `presigned_url` and the chunk as `part_base64`.
3. `multipart_complete` with the `session_id`. It returns the finished asset
   object.

Step 2 makes an outbound `PUT` from the MCP server to S3. An MCP runtime without
network egress fails here, and the fix is to run the multipart flow from your own
backend against `https://upload.autorender.io/api/v1` instead.

## Deleting

`delete_file` and `delete_folder` are permanent, and the MCP server holds a private
key with unrestricted access, so
both accept `dry_run`. Call with `dry_run: true` first and show the returned
`would_delete` payload to the user before calling again without it.

```jsonc
// delete_file with dry_run: true
{ "dry_run": true, "would_delete": { "file_no": "f_8Kd2mQ", "name": "showroom.jpg", "size": 284713 } }
```

Never take a `file_no` for deletion straight from an HTTP request body in the
code you scaffold. Check ownership against your own database first — the API
deletes whatever `file_no` it is handed.

## Folders

`create_folder` returns `{ folder_no, name }`. Nest by passing
`parent_folder_no`. `list_folders` sorts on `created_at` only, and each folder
reports `total_items` and `total_size`.

`rename_file` takes the basename with **no extension** — `vacation`, not
`vacation.jpg`. The extension is unchanged and `file_no` stays stable across both
file and folder renames, so stored references keep working.

## Next steps

- the **autorender-upload** skill — the same endpoints from application code, and where the API key can live
- the **autorender-transformations** skill — every delivery token, verified against the parser
- the **autorender-view** skill — rendering the listed assets responsively
