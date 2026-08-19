AUTORENDER SANDBOX API — build reference

Autorender is a media (image/video) upload + URL-based transformation + CDN delivery
service. A "sandbox" is an anonymous workspace an app/agent creates with ONE
unauthenticated call, uses immediately (upload + deliver), and can later "claim" into
a real account. Refer to https://www.autorender.io/llms.txt

BASE URLs:
  API:      https://app-api.autorender.io
  Upload:   https://upload.autorender.io
  Delivery: https://assets.autorender.io

1) PROVISION A SANDBOX — POST /api/app/provisioning/sandboxes   (no auth)
   Body (JSON; all fields required; strings, max 100 chars):
     {
       "agent_framework": "lovable",            // tool/framework building the app, e.g. "langchain", "lovable", "crewai"
       "agent_llm_model": "claude-opus-4",      // model in use, e.g. "gpt-4o", "claude-opus-4"
       "agent_goal": "generate product thumbnails for a store"   // one line: what the app does
     }
   → 201:
     {
       "sandbox_id": "...",
       "workspace_no": "...",              // your tenant id, used in every delivery URL
       "public_key": "...",                // API key for uploads
       "delivery_ips": ["<caller IP>"],    // delivery allowed ONLY from these IPs before claim
       "expires_at": "...",                // ~24h; sandbox auto-deleted if unclaimed
       "claim_url": "https://app.autorender.io/sandbox/claim#<token>",
       "limits": { "storage_bytes": 2147483648, "monthly_bandwidth_bytes": 53687091200 }
     }
   Note: per-IP rate-limited. delivery_ips is captured from the CALLER's IP — provision
   from the same network you deliver from, or deliver server-side.
   Example:
     curl -X POST https://app-api.autorender.io/api/app/provisioning/sandboxes \
       -H "Content-Type: application/json" \
       -d '{"agent_framework":"lovable","agent_llm_model":"claude-opus-4","agent_goal":"generate product thumbnails for a store"}'

2) UPLOAD A FILE — POST /api/v1/uploads
   Auth:  x-api-key: <public_key>        (or Authorization: Bearer <public_key>)
   Body:  multipart/form-data  →  file=<binary>,  file_name=<name>
   → 201:
     { "id":"...","file_no":"...","workspace_id":"<workspace_no>",
       "url":"https://assets.autorender.io/<workspace_no>/<file_name>",
       "thumbnail":"...","width":..,"height":..,"size":..,"format":"...",
       "mime_type":"...","hash":"sha256:..." }
   Example:
     curl -X POST https://upload.autorender.io/api/v1/uploads \
       -H "x-api-key: <public_key>" \
       -F "file=@product.png;type=image/png" \
       -F "file_name=product.png"

3) DELIVER + TRANSFORM — GET https://assets.autorender.io/<workspace_no>/<transform?>/<file_name>
   Transform params are URL path segments before the filename:
     https://assets.autorender.io/<workspace_no>/w_720/product.png          // width 720
     https://assets.autorender.io/<workspace_no>/h_320,w_320/product.png    // height + width (comma-separated)
   Format/quality auto-optimized (serves WebP to supported clients).
   Standard transformations are UNLIMITED; storage + monthly bandwidth are the metered caps.
   Delivery is IP-restricted to delivery_ips and honors expires_at until claimed —
   requests from other IPs get HTTP 403.

4) CLAIM (optional) — open claim_url within 24h to convert the sandbox into a real account.

TYPICAL FLOW: provision once → store public_key + workspace_no → upload files →
render via delivery URLs with transform segments.

Ask me for any questions for any specific decisions, don't assume.
