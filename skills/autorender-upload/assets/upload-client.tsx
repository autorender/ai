'use client';

/**
 * Autorender upload — browser half.
 *
 * Copy to `components/upload-zone.tsx`. Pair with `app-router-upload-route.ts`.
 *
 * No API key appears anywhere in this file, and none should. The browser talks
 * only to your own route; that route holds the key.
 *
 * Progress uses XMLHttpRequest deliberately: `fetch` reports download progress but
 * not upload progress. Drop the progress state and you can use `fetch` instead.
 */

import { useState } from 'react';

export type UploadedAsset = {
  file_no: string;
  path: string;
  url: string;
  width: number | null;
  height: number | null;
};

/** The field name is a contract with your route, which reads `file`. */
const FIELD = 'file';

/**
 * Mirrors of the server's limits, for UX only. The server remains the control — it
 * re-checks the size and validates the actual bytes. Keep these in step with the
 * MAX_BYTES and signature list in whichever server file you deployed.
 */
// 4 MB matches app-router-upload-route.ts. standalone-service.mjs allows 10 MB —
// raise this to match whichever server you deployed, or users see a late rejection.
const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

function uploadWithProgress(
  file: File,
  endpoint: string,
  onProgress: (percent: number) => void,
  authToken?: string,
): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(FIELD, file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.timeout = 60_000;

    // Cross-origin proxy: send a bearer token. Cookies are NOT sent cross-origin
    // unless the server also returns Access-Control-Allow-Credentials and you set
    // xhr.withCredentials — see standalone-service.mjs for why bearer is the
    // default here. Same-origin (the Next.js route) needs neither.
    if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedAsset);
        } catch {
          reject(new Error('Malformed response from upload route'));
        }
      } else {
        // Surface the server's `error` field, not the raw body — this string is
        // rendered, and a raw body can carry detail the user should not see.
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (typeof body?.error === 'string') message = body.error;
        } catch {
          // Non-JSON response: keep the generic message.
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    // Without these the promise never settles and the UI stays stuck on "busy".
    xhr.onabort = () => reject(new Error('Upload cancelled'));

    // Do NOT set Content-Type. The browser derives it from the FormData and adds the
    // multipart boundary; a hand-written header omits the boundary and the server's
    // formData() parse fails.
    xhr.send(form);
  });
}

export function UploadZone({
  endpoint = '/api/upload',
  authToken,
  onUploaded,
}: {
  /** Same-origin route, or the full URL of your standalone service. */
  endpoint?: string;
  /** Required only when `endpoint` is cross-origin — see the note in the helper. */
  authToken?: string;
  onUploaded?: (asset: UploadedAsset) => void;
}) {
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED.includes(file.type as (typeof ACCEPTED)[number])) {
      setError('Choose a JPEG, PNG, WebP or AVIF image.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That image is too large.');
      event.target.value = '';
      return;
    }

    setError(null);
    setPercent(0);

    try {
      const asset = await uploadWithProgress(file, endpoint, setPercent, authToken);
      onUploaded?.(asset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    } finally {
      setPercent(null);
      // Allow re-selecting the same file.
      event.target.value = '';
    }
  }

  const busy = percent !== null;

  return (
    <div>
      <label>
        <span>{busy ? `Uploading ${percent}%` : 'Choose an image'}</span>
        <input
          type="file"
          accept={ACCEPTED.join(',')}
          onChange={handleChange}
          disabled={busy}
        />
      </label>

      {busy && <progress value={percent ?? 0} max={100} />}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/**
 * Two things worth knowing:
 *
 * - The `accept` attribute is a convenience, not a control — it filters the file
 *   picker and nothing else. The server's magic-byte check is what enforces type.
 * - `error` is rendered, so the server must return generic messages. Both reference
 *   server files do; if you change them, do not echo upstream bodies or the client's
 *   own claimed MIME type back to the browser.
 */
