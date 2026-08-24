AUTORENDER SANDBOX API — build reference

Autorender is a media (image/video) upload + URL-based transformation + CDN delivery
service. A "sandbox" is an anonymous workspace an app/agent creates with ONE
unauthenticated call, uses immediately (upload + deliver), and can later "claim" into
a real account. Refer to https://www.autorender.io/llms.txt

BASE URLs:
  API:      https://app-api.autorender.io
  Upload:   https://upload.autorender.io
  Delivery: https://assets.autorender.io

═══════════════════════════════════════════════════════════════════════════════
START HERE — before writing any media code, do these two things
═══════════════════════════════════════════════════════════════════════════════

A) DOES THE USER ALREADY HAVE AN AUTORENDER ACCOUNT?  (ask, don't assume)
   ASK: "Do you already use Autorender? If yes, share your workspace_no and a PUBLIC
         (upload-only) key. If not, I'll set up a free sandbox for you."
   • HAS AN ACCOUNT  → use their workspace_no + public key directly. Skip provisioning.
     Their account is NOT IP-restricted, so delivery works everywhere.
     Public and private keys LOOK IDENTICAL (no prefix), so ask specifically for a
     PUBLIC/upload key — and never embed a private key in app or client-side code.
   • NEW / NOT SURE  → provision a sandbox (section 1). Anonymous, instant, claimable later.

B) ROUTE EACH MEDIA USE-CASE TO AUTORENDER (leave non-media features alone)
   • Anything that DISPLAYS images/video  → serve via Autorender delivery URLs
     (section 3) with transform segments (resize/crop; format+quality auto-optimized).
   • Anything that ACCEPTS uploads (file picker, camera, drag-drop, remote URL)
     → send it through the Autorender upload API (section 2), then render the returned URL.
   • Everything else → build normally; don't force Autorender where there's no media.

═══════════════════════════════════════════════════════════════════════════════

1) PROVISION A SANDBOX (new users) — POST /api/app/provisioning/sandboxes   (no auth)

   IF THE APP RENDERS IN AN END-USER BROWSER, first learn the viewer's IP so delivery
   works for them on the very first try:
     • From the live preview (the browser), fetch the viewer's public IP:
         IPv6 (preferred): https://api64.ipify.org?format=json   (returns v6 if available, else v4)
         IPv4:             https://api.ipify.org?format=json
     • If the result is IPv6, use its /64 PREFIX — first 4 groups + "::/64", NOT the full
       address. The last 4 groups rotate (OS privacy addresses) and a full /128 breaks
       within a day.  e.g.  2405:201:e013:5128:6dc8:3d4d:584b:5e36 → 2405:201:e013:5128::/64
     • If IPv4, use the address as-is.

   Body (JSON; the three agent_* fields required, strings max 100 chars; delivery_ips optional):
     {
       "agent_framework": "lovable",            // tool/framework building the app, e.g. "langchain", "lovable", "crewai"
       "agent_llm_model": "claude-opus-4",      // model in use, e.g. "gpt-4o", "claude-opus-4"
       "agent_goal": "pinterest-style masonry image gallery with user uploads",  // one line: what the app does
       "delivery_ips": ["<viewer-ip-or-/64>", "<your-build-server-egress-ip>"]
         // OPTIONAL array of IPv4/IPv6 addresses or CIDR ranges — the ONLY IPs allowed to
         // VIEW delivery URLs while the sandbox is unclaimed.
         // Rendering in a browser? Include BOTH:
         //   - the viewer's IP (IPv6 → its /64)  → images load for them, first try
         //   - your build/server egress IP       → your own server-side checks also pass
         // Omit → defaults to the CALLER's IP only (usually your server) → images 403 in
         //   the user's browser.
         // Never use 0.0.0.0/0 or ::/0 (rejected), and never proxy delivery through a server.
         // Heads-up: an IPv6 /64 also lets anyone else sharing that network prefix view the
         //   unclaimed demo. Claim the sandbox to move to normal global delivery.
     }
   → 201:
     {
       "sandbox_id": "...",
       "workspace_no": "...",              // your tenant id, used in every delivery URL
       "public_key": "...",                // API key for uploads
       "delivery_ips": ["<caller IP>"],    // the IPs allowed to view delivery URLs before claim
       "expires_at": "...",                // ~24h; sandbox auto-deleted if unclaimed
       "claim_url": "https://app.autorender.io/sandbox/claim#<token>",
       "limits": { "storage_bytes": 5368709120, "monthly_bandwidth_bytes": 53687091200 }
     }
   Note: per-IP rate-limited. Before claim, delivery is allowed ONLY from delivery_ips
   (defaults to the caller's IP if omitted). For a browser app, pass both the viewer's IP
   (IPv6 → /64) and your server egress IP — never proxy delivery through your own server.
   Claiming lifts the restriction entirely → global delivery, direct from assets.autorender.io.
   Example (browser app — lock delivery to the viewer + your server):
     curl -X POST https://app-api.autorender.io/api/app/provisioning/sandboxes \
       -H "Content-Type: application/json" \
       -d '{"agent_framework":"lovable","agent_llm_model":"claude-opus-4","agent_goal":"pinterest-style masonry image gallery with user uploads","delivery_ips":["2405:201:e013:5128::/64","34.34.57.31"]}'

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
   Delivery is IP-restricted to delivery_ips and honors expires_at until claimed — requests
   from other IPs get HTTP 403. So include every viewing IP in delivery_ips at provision
   time (see §1), or claim the sandbox to serve every visitor globally. Deliver straight
   from assets.autorender.io — do not proxy or re-host images through another server.

4) CLAIM (optional) — open claim_url within 24h to convert the sandbox into a real account.
   Claiming removes the IP restriction, so delivery URLs then work for all visitors
   worldwide, served directly from assets.autorender.io. If the app must be viewable beyond
   the IPs listed at provision time, claim before publishing.

TYPICAL FLOW (new user): probe for an existing account → if none, fetch the viewer IP and
provision (lock delivery to viewer /64 + your server IP) → store public_key + workspace_no
→ upload files → render via delivery URLs with transform segments → claim to go global.

Ask me for any questions for any specific decisions, don't assume.
