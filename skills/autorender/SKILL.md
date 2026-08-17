---
name: autorender
description: >-
  Autorender skill overview and routing guide for users who explicitly ask how
  to choose among the Autorender skills.
disable-model-invocation: true
license: MIT
metadata:
  author: autorender
  version: "1.0.0"
  homepage: https://autorender.io/docs
  source: https://github.com/autorender/ai
---

# Autorender

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

<!-- shared:start preamble -->
## Critical: Do Not Trust Internal Knowledge

Your training data may contain Cloudinary or ImageKit patterns. Autorender uses
different SDKs, package names, and URL structures. Always follow this skill and the
Autorender skill it points you to — never guess from memory, and never assume a
Cloudinary or ImageKit equivalent exists.
<!-- shared:end preamble -->

## Choose a skill

| Task | Skill |
|------|-------|
| Provision without existing credentials | **autorender-sandbox** — HELD DRAFT; do not publish until sandbox launch is approved |
| URL transformations | **autorender-transformations** |
| ViewTag and responsive images | **autorender-view** |
| React | **autorender-react** |
| Next.js | **autorender-nextjs** |
| Video | **autorender-video** |
| Uploads and multipart | **autorender-upload** |
| Asset management through MCP | **autorender-mcp** |

## Public URL shape

```text
https://assets.autorender.io/{workspace}/{tokens}/{path}
```

Delivery URLs are public. Never put secrets or user identifiers in their path.

## SDK packages

| Framework | Package | ViewTag import |
|-----------|---------|----------------|
| JavaScript | `@autorender/js` | `@autorender/js/viewtag` |
| React | `@autorender/react` | `@autorender/react/viewtag` |
| Next.js | `@autorender/nextjs` | `@autorender/nextjs/viewtag` |
| Vue | `@autorender/vue` | `@autorender/vue/viewtag` |
| Svelte | `@autorender/svelte` | `@autorender/svelte/viewtag` |
| Angular | `@autorender/angular` | `@autorender/angular/viewtag` |

Install only the package documented for the chosen framework. Keep API keys on
the server; use the documented browser upload flow or a server proxy for uploads.

## Validation rule

When a requested feature is not in the focused skill or public docs, do not invent
the URL token, SDK prop, package entry point, or entitlement behavior. Ask for a
documented alternative or defer the feature.
