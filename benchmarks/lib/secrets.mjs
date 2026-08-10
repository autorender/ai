/**
 * Credential handling for the benchmark.
 *
 * The benchmark is the only thing in this repository that touches a real API key, so
 * the rules are enforced in code rather than documented and hoped for:
 *
 * 1. The key comes from `AUTORENDER_BENCH_API_KEY` — deliberately NOT
 *    `AUTORENDER_API_KEY`. A different name means a production key already exported
 *    in your shell cannot be picked up by accident, which is the realistic way this
 *    goes wrong.
 * 2. Nothing the benchmark writes — log, CSV, error, stack trace — may contain it.
 *    `redact()` is applied at every boundary that reaches disk or stdout.
 * 3. The key is never passed as a command-line argument. Argv is visible to every
 *    other process on the machine via `ps`.
 */

/** Env var deliberately distinct from the production one. See rule 1 above. */
export const KEY_ENV = 'AUTORENDER_BENCH_API_KEY';
export const WORKSPACE_ENV = 'AUTORENDER_BENCH_WORKSPACE';

/**
 * Everything that must never appear in output. Collected once at startup so
 * `redact` stays cheap and cannot miss a value that was read later.
 */
const secrets = new Set();

/**
 * @param value            the string to redact everywhere
 * @param opts.minLength   floor below which registration is REFUSED rather than skipped.
 *                         Defaults to 12, the floor for a credential. The workspace id
 *                         passes a lower one: it is ~10 characters, still distinctive
 *                         enough to redact safely, and it is not a credential — but it
 *                         must not be silently skipped either, because this file's
 *                         contract says everything it handles stays out of output.
 */
export function registerSecret(value, { minLength = 12 } = {}) {
  // Short values would redact half the output — but silently skipping one means a
  // credential the harness believes it is protecting appears in the clear. Refuse.
  if (typeof value !== 'string' || value.length < minLength) {
    throw new Error(
      `registerSecret: refusing a value shorter than ${minLength} characters. Redacting a ` +
        'short string would corrupt unrelated output, so it cannot be protected — use a ' +
        'realistic credential rather than a placeholder.',
    );
  }
  secrets.add(value);
}

/**
 * Replace every known secret with a marker.
 *
 * Applied to anything heading for disk or a terminal. Handles non-strings so a
 * caller can pass an error or an object without a guard at every call site.
 */
export function redact(input) {
  let text;
  if (typeof input === 'string') {
    text = input;
  } else if (input instanceof Error) {
    // Walk the cause chain. `fetch` reports a bare "fetch failed" and puts the real
    // reason (ECONNREFUSED, certificate errors) in `cause`, so dropping it leaves the
    // harness undebuggable — which is what tempts someone to log the raw error
    // instead, and the raw error is the thing that might carry a header.
    const parts = [];
    for (let err = input, depth = 0; err && depth < 5; err = err.cause, depth += 1) {
      parts.push(err.stack ?? err.message ?? String(err));
    }
    text = parts.join('\n  caused by: ');
  } else {
    text = String(input);
  }

  for (const secret of secrets) {
    text = text.split(secret).join('«REDACTED»');
  }
  return text;
}

/**
 * Read the credential, refusing to run rather than falling back to something unsafe.
 *
 * Returns null when absent, which the caller treats as "skip the live checks" — the
 * source checks are still worth running and need no credential at all.
 */
export function loadCredentials({ required = false } = {}) {
  const key = process.env[KEY_ENV];
  const workspace = process.env[WORKSPACE_ENV];

  if (!key) {
    if (required) {
      throw new Error(
        `${KEY_ENV} is not set. The live checks need a key for a DEDICATED benchmark ` +
          `workspace — never a production key, since the benchmark uploads real assets. ` +
          `Set it in your shell or as a CI secret; never in a file in this repository.`,
      );
    }
    return null;
  }

  // Refuse the production variable even if someone wires it through deliberately.
  if (process.env.AUTORENDER_API_KEY && process.env.AUTORENDER_API_KEY === key) {
    throw new Error(
      `${KEY_ENV} is identical to AUTORENDER_API_KEY. The benchmark uploads real assets ` +
        `and must run against a dedicated workspace, not production.`,
    );
  }

  if (!workspace) {
    throw new Error(`${WORKSPACE_ENV} must be set alongside ${KEY_ENV}.`);
  }

  registerSecret(key);
  // The workspace ID is not a secret in the cryptographic sense — it appears in every
  // delivery URL. It is registered anyway: this file promises that nothing it handles
  // reaches output, and relying on GitHub's own masking for a value we claim to redact
  // ourselves is the wrong contract, and does nothing at all for a local run.
  //
  // Registered UNCONDITIONALLY. It used to be gated on `length >= 12`, which meant a short
  // workspace id was silently not protected while the comment above and the README both
  // said it was — the exact silent skip `registerSecret` refuses to make for a key. A
  // short id is redactable; it is only the 12-char floor for KEYS that exists, and that
  // floor is about refusing to trust a suspiciously short credential.
  registerSecret(workspace, { minLength: 6 });

  return { key, workspace };
}

/** Console that cannot leak. Use this instead of `console` anywhere a key is in scope. */
export const safeLog = {
  info: (...args) => console.log(args.map(redact).join(' ')),
  warn: (...args) => console.warn(args.map(redact).join(' ')),
  error: (...args) => console.error(args.map(redact).join(' ')),
};
