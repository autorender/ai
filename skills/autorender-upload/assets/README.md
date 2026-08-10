# Upload reference files

These reference files show one way to place the documented upload API behind an
application route. Copy the route appropriate for your framework and replace the
placeholder authentication and ownership functions with your application logic.

| File | Where it goes |
|---|---|
| `app-router-upload-route.ts` | `app/api/upload/route.ts` |
| `standalone-service.mjs` | A server you control |
| `upload-client.tsx` | A browser upload component |
| `asset-routes.ts` | `app/api/assets/[fileNo]/route.ts` |

The server files call `POST https://upload.autorender.io/api/v1/uploads` with
`Authorization: Bearer <api_key>`. The browser file calls your application route;
it does not contain the confidential server API key.

Before using the files:

1. Set `AUTORENDER_API_KEY` in server environment variables.
2. Replace `getSession` or `authenticate` with your own authentication.
3. Derive the destination `folder` from the authenticated application session.
4. Keep the upload API key out of browser bundles.

The example routes also validate the file's magic bytes, cap the upload size, and sanitize
the file name before forwarding; the standalone service additionally rate-limits per caller,
while the serverless route defers rate limiting to your platform (an in-memory limiter does
not work on serverless — see each file's footer). These protections must survive any port to
another framework — copy the checks, not just the happy path.

The multipart request must include the documented `file` and `file_name` fields.
The optional upload fields include `folder`, `tags`, `transform`, `metadata`,
`custom_id`, and `random_prefix`.
