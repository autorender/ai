## Environment Variables

| Variable | Required | Scope | Purpose |
|----------|----------|-------|---------|
| `AUTORENDER_API_KEY` | ✅ | **server only** | Uploads and asset management. Unscoped — grants full workspace access, including delete. Never expose to the browser. |
| `AUTORENDER_WORKSPACE` | ✅ | server or browser | Workspace ID in CDN delivery URLs. Public — safe to expose (`NEXT_PUBLIC_` prefix in Next.js). |
| `AUTORENDER_UPLOAD_BASE_URL` | — | server | Upload API base. Default `https://upload.autorender.io`. |
| `AUTORENDER_CDN_BASE_URL` | — | server or browser | CDN base. Default `https://assets.autorender.io`. |

Get an API key at [app.autorender.io/api-keys](https://app.autorender.io/api-keys).
Use the workspace ID shown in the dashboard when building delivery URLs.
