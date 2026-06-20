/**
 * Shared fetch wrapper with rate-limit (429) and transient-error backoff.
 * Used by all TikTok API calls so retry/backoff lives in one place.
 */

/** Retryable HTTP statuses: rate limit + transient server errors. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * fetch() with exponential backoff on 429 / 5xx. Honors a numeric
 * Retry-After header when present. Throws after MAX_RETRIES exhausted, or
 * immediately on a non-retryable error status (caller handles those).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);
    if (!RETRYABLE.has(res.status)) {
      return res; // success or a non-retryable error — let caller inspect
    }

    lastStatus = res.status;
    if (attempt === MAX_RETRIES) break;

    // Prefer server-provided Retry-After (seconds); else exponential backoff.
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BASE_DELAY_MS * 2 ** attempt;

    console.warn(
      `[http] ${label} got ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
    );
    await sleep(delay);
  }

  throw new Error(`${label} failed after ${MAX_RETRIES} retries (last status ${lastStatus})`);
}
