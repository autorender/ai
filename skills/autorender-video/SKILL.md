---
name: autorender-video
description: >-
  Use when the user asks to deliver or transform Autorender video, including
  thumbnails, resize, padding, trimming, GIF output, flipping, rotation, or
  `ARVideo` and its `/viewtag/video` import. Do not use for image-only URL
  tokens, uploads, or MCP workspace actions.
compatibility: >-
  Requires Node 22 (recommended) or Node 20 minimum. video.js 8 is an optional
  peer dependency and is required for ARVideo. React 18 or 19, Next.js 14, 15 or
  16, Vue 3, Svelte 3, 4 or 5, Angular 15 through 18.
license: MIT
metadata:
  author: autorender
  version: "1.0.0"
  homepage: https://autorender.io/docs
  source: https://github.com/autorender/ai
---

# Video

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

<!-- shared:start delivery-surface -->
## The Delivery Host Is Public and Unauthenticated

`assets.autorender.io` delivery URLs contain a public workspace ID. Never encode
secrets, tokens, or user identifiers into a transformation or file path.
<!-- shared:end delivery-surface -->

## URL shape

```text
https://assets.autorender.io/{workspace}/{tokens}/{path}
```

## Documented video tokens

| Category | Tokens | Example |
|----------|--------|---------|
| Thumbnail | `thumb_ar` | `thumb_ar` |
| Dimensions | `w_`, `h_`, `ar_` | `w_500,ar_1:1` |
| Padding | `cm_pad_resize`, `bg_` | `w_400,h_400,cm_pad_resize,bg_white` |
| Time | `so_`, `eo_`, `d_` | `so_5,eo_15` |
| Format | `f_gif` | `f_gif,so_5,d_10,w_400` |
| Flip | `flip_h`, `flip_v`, `flip_hv` | `flip_h` |
| Rotation | `r_90`, `r_180`, `r_270` | `r_90` |

Examples:

```text
https://assets.autorender.io/LOKVTtKVGb/thumb_ar/docs/skateboarding.mp4
https://assets.autorender.io/LOKVTtKVGb/w_500,ar_1:1/docs/skateboarding.mp4
https://assets.autorender.io/LOKVTtKVGb/so_5,eo_15,w_400/docs/skateboarding.mp4
https://assets.autorender.io/LOKVTtKVGb/f_gif,so_5,d_10,w_400/docs/skateboarding.mp4
```

`thumb_ar` returns a WebP image and `f_gif` returns a GIF; use an `<img>` for
those outputs. Other documented transforms return video.

## SDK components

`ARVideo` is exported from the framework package's `/viewtag/video` entry so
image-only apps never resolve the optional `video.js` dependency:

```tsx
import { ARVideo } from '@autorender/react/viewtag/video';
// Next.js, Vue, Svelte, and Angular use their corresponding /viewtag/video entry.
```

Install `video.js` when rendering `ARVideo`; image-only apps do not need it.

Install the framework package documented for the chosen framework, provide the
workspace through its provider, and pass `transformations` to `ARVideo`.

```tsx
<ARVideo
  src="docs/skateboarding.mp4"
  width={960}
  height={540}
  controls
  transformations={{ w: 960, h: 540 }}
/>
```

## Next steps

- **autorender-transformations** — documented image and video URL tokens.
- **autorender-react** or **autorender-nextjs** — framework setup.
