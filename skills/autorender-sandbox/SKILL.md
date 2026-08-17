---
name: autorender-sandbox
description: >-
  Use when an AI coding agent needs to start using Autorender without existing
  credentials by provisioning a temporary, anonymous, claimable sandbox account,
  uploading an asset, delivering it from an allowed IP, and handing the human a
  claim link. Do not use after the user already has Autorender credentials.
license: MIT
metadata:
  author: autorender
  version: "0.1.0"
  homepage: https://autorender.io/docs/sandbox-accounts
  source: https://github.com/autorender/ai
---

<!-- HELD DRAFT — DO NOT PUBLISH OR MERGE until sandbox launch is approved. Pending AR-195 safety path. -->

# Provision a sandbox account

> **HELD DRAFT — DO NOT PUBLISH OR MERGE until sandbox launch is approved.**
> Keep this skill unavailable and undiscoverable until edge enforcement, quota
> enforcement, and the AR-195 safety path are deployed and approved.

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

## Sandbox credential exception

The general environment table describes a regular private API key. This workflow instead returns `public_key`, an upload-only credential: it can upload but cannot list, rename, or delete. Put that value in the server-only `AUTORENDER_API_KEY` variable while the sandbox is active. Never expose it in browser code even though its authority is limited.

## Contract

Provisioning is exactly one unauthenticated call:

```http
POST https://upload.autorender.io/api/app/provisioning/sandboxes
Content-Type: application/json
```

```json
{
  "agent_framework": "Claude Code",
  "agent_llm_model": "claude-opus-4-1",
  "agent_goal": "Add an optimized product gallery",
  "sdk_framework": "nextjs",
  "delivery_ips": ["203.0.113.4", "2001:db8:1234::/64"]
}
```

Required strings: `agent_framework` and `agent_llm_model` are limited to 100 characters; `agent_goal` is limited to 300. `sdk_framework` is optional and limited to 100. `delivery_ips` is optional, accepts at most 20 IPv4/IPv6 literals or CIDR ranges, and rejects `/0`. When it is absent or empty, the request's source IP becomes the only delivery address.

The success response is `201`:

```json
{
  "sandbox_id": "00000000-0000-0000-0000-000000000201",
  "workspace_no": "9876543210",
  "public_key": "pk_example_public_key",
  "delivery_ips": ["203.0.113.4"],
  "expires_at": "2030-01-02T03:04:05.000Z",
  "claim_url": "https://autorender.io/sandbox/claim#example-claim-token",
  "limits": {
    "storage_bytes": 2147483648,
    "monthly_bandwidth_bytes": 53687091200,
    "monthly_image_transforms": 20,
    "monthly_video_transforms": 100
  },
  "guidance": "Use public_key to upload immediately. Deliver only from delivery_ips until claimed. Open claim_url to claim this sandbox within 24 hours or it is deleted."
}
```

Use the response's `limits`, rather than copied numeric defaults, as the source of truth.

## Agent workflow

1. Determine where the preview will fetch delivered assets from. Supply that machine's public IP or CIDR in `delivery_ips`. If omitted, delivery works only from the agent/provisioner source IP.
2. Provision once. On `429`, respect `Retry-After`. On `503`, tell the user provisioning is unavailable; do not retry in a tight loop.
3. Store `public_key` only in the app's server-side environment as `AUTORENDER_API_KEY`. Store `workspace_no` as `AUTORENDER_WORKSPACE` (or the framework's documented public workspace variable).
4. Upload with the public key. Use the returned upload `data.url` directly, or use the documented workspace URL format for known paths.
5. Give `claim_url` to the human in the private conversation. Do not put it in source, `.env`, generated UI, logs, issue text, or a public transcript.
6. Tell the human the sandbox and its files are deleted after 24 hours unless claimed.

There is no verified delivery-allowlist update endpoint in this contract. Do not invent a PATCH route. If the chosen IPs are wrong, provision a replacement sandbox with the correct allowlist and discard the old key and claim URL.

## Copy-paste JavaScript

This endpoint is plain REST; no published Autorender SDK helper wraps account provisioning. The following Node.js 20+ snippet provisions, uploads, and prints only the non-secret delivery result. It intentionally keeps the claim URL separate for the agent to relay privately.

```js
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const inputPath = process.argv[2];
const deliveryIp = process.env.PREVIEW_PUBLIC_IP;

if (!inputPath) throw new Error('Usage: node provision-and-upload.mjs <asset-path>');
if (!deliveryIp) throw new Error('Set PREVIEW_PUBLIC_IP to the delivery viewer IP or CIDR');

const provisionResponse = await fetch(
  'https://upload.autorender.io/api/app/provisioning/sandboxes',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent_framework: 'your-agent-name',
      agent_llm_model: 'your-model-name',
      agent_goal: 'Upload and deliver an asset for the current project',
      sdk_framework: 'javascript',
      delivery_ips: [deliveryIp],
    }),
  }
);

if (!provisionResponse.ok) {
  const retryAfter = provisionResponse.headers.get('retry-after');
  throw new Error(
    `Sandbox provisioning failed (${provisionResponse.status})` +
      (retryAfter ? `; retry after ${retryAfter}s` : '')
  );
}

const sandbox = await provisionResponse.json();
const bytes = await readFile(inputPath);
const fileName = basename(inputPath);
const upload = new FormData();
upload.set('file', new Blob([bytes]), fileName);
upload.set('file_name', fileName);

const uploadResponse = await fetch('https://upload.autorender.io/api/v1/uploads', {
  method: 'POST',
  headers: { authorization: `Bearer ${sandbox.public_key}` },
  body: upload,
});

if (!uploadResponse.ok) {
  throw new Error(`Upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`);
}

const uploaded = await uploadResponse.json();
console.log({
  workspace: sandbox.workspace_no,
  expiresAt: sandbox.expires_at,
  deliveryIps: sandbox.delivery_ips,
  limits: sandbox.limits,
  deliveryUrl: uploaded.data.url,
});

// Relay sandbox.claim_url privately to the human. Never log or commit it.
```

Do not set the multipart `Content-Type` header manually; `fetch` adds the boundary for `FormData`.

## Delivery behavior

Until claim completion, edge delivery only allows viewer IPs matching `delivery_ips`. A denial is `403` with `error: "sandbox_delivery_denied"`, the edge-observed `viewer_ip`, and a `reason` of `ip_not_allowed`, `expired`, `deny_flag`, or `malformed`. Never derive the viewer identity from `X-Forwarded-For`.

After claim completion, the delivery restriction is removed and the same workspace, public key, files, and delivery URLs remain in place.

## Claim mechanics to explain to the user

- The claim secret exists only after `#` in `claim_url`. Anyone holding it can claim the sandbox.
- The claim page extracts the fragment and sends `{ "token": "..." }` once to `POST /api/app/provisioning/sandboxes/claim/session`.
- Success sets a 15-minute, opaque `sbx_claim` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`) and returns non-secret agent metadata.
- The human continues with Google or GitHub OAuth. The callback uses the pending cookie to create a new account and atomically adopt the existing workspace.
- An email already attached to an Autorender account is refused. Invalid, used, or expired links receive the same coarse error.

## Never

- Never invent fields, an allowlist PATCH endpoint, or an SDK provisioning method.
- Never expose the claim URL in generated application code or public output.
- Never claim on the user's behalf or ask for OAuth credentials.
- Never describe the sandbox as durable storage; unclaimed data is deleted after 24 hours.
- Never treat the public key as a private management key.
