---
name: autorender-view
description: >-
  Use when the user asks to build responsive Autorender image markup, createAR
  URLs, responsive image attributes, or ViewTag components. Do not use for
  general transformation-token reference work, uploads, or MCP workspace
  actions.
license: MIT
metadata:
  author: autorender
  version: "1.0.0"
  homepage: https://autorender.io/docs
  source: https://github.com/autorender/ai
---

# ViewTag

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

<!-- shared:start delivery-surface -->
## The Delivery Host Is Public and Unauthenticated

`assets.autorender.io` delivery URLs contain a public workspace ID. Never encode
secrets, tokens, or user identifiers into a transformation or file path.
<!-- shared:end delivery-surface -->

## URL shape

```text
https://assets.autorender.io/{workspace}/{tokens}/{path}
```

## JavaScript client

```bash
npm install @autorender/js
```

```javascript
import { createAR } from '@autorender/js/viewtag';

const AR = createAR({
  baseUrl: 'https://assets.autorender.io',
  workspace: 'LOKVTtKVGb',
});

const url = AR.url('products/chair.jpg', {
  w: 400,
  h: 400,
  fit: 'cover',
});
```

Use `AR.transformString()` when only the transform segment is needed.

## Transform options

The documented SDK options map to the public URL tokens: dimensions (`w`, `h`,
`ar`), crop (`fit`), position (`position`), format (`f`), quality (`q`),
effects, border radius, rotation, flip, zoom, presets, and layers. Keep all
transformation options inside the `transformations` object in framework SDKs.

For the complete token list, use **autorender-transformations**.

## Framework components

Framework packages import ViewTag components from `/viewtag`:

```tsx
import { AutoRenderProvider, ARImage, ARVideo } from '@autorender/react/viewtag';
```

`ARImage` uses the provider workspace and accepts `src`, `width`, `height`,
`transformations`, `responsive`, `lazy`, `sizes`, and the documented `preset`.
`ARVideo` accepts `src`, `width`, `height`, `controls`, `preload`, and
`transformations`.

## Next steps

- **autorender-transformations** — URL token reference.
- **autorender-react** or **autorender-nextjs** — framework setup.
- **autorender-video** — documented video tokens.
