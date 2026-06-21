/**
 * Token storage + OAuth token exchange/refresh against TikTok's token endpoint.
 * Tokens are stored as plain JSON in private KV (single-user internal tool).
 */

import type { Env } from "./index";
import { TIKTOK, REDIRECT_URI, KV_KEYS } from "./config";

/** Refresh the access token when fewer than this many ms remain. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Thrown when we cannot produce a valid access token without the user
 * re-authorizing (no tokens stored, or the refresh token itself expired/
 * invalid). Callers should surface a "visit /login" message, not crash.
 */
export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
  /** Epoch ms when the refresh token expires. */
  refresh_expires_at: number;
  open_id: string;
  scope: string;
}

/** Raw shape returned by POST /v2/oauth/token/. */
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds, ~86400
  refresh_expires_in?: number; // seconds, ~31536000
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export async function getStoredTokens(env: Env): Promise<StoredTokens | null> {
  return env.TOKENS.get<StoredTokens>(KV_KEYS.TOKENS, "json");
}

export async function saveTokens(env: Env, tokens: StoredTokens): Promise<void> {
  await env.TOKENS.put(KV_KEYS.TOKENS, JSON.stringify(tokens));
}

/** Map a token endpoint response into our stored shape (computing absolute expiries). */
function toStored(data: TokenResponse, fallbackRefresh?: StoredTokens): StoredTokens {
  const now = Date.now();
  return {
    access_token: data.access_token!,
    // Refresh may rotate; if the response omits it, keep the previous one.
    refresh_token: data.refresh_token ?? fallbackRefresh?.refresh_token ?? "",
    expires_at: now + (data.expires_in ?? 86400) * 1000,
    refresh_expires_at: now + (data.refresh_expires_in ?? 31536000) * 1000,
    open_id: data.open_id ?? fallbackRefresh?.open_id ?? "",
    scope: data.scope ?? fallbackRefresh?.scope ?? "",
  };
}

/**
 * Exchange an authorization code for tokens (called from /callback).
 * Throws on TikTok-reported errors.
 */
export async function exchangeCodeForTokens(
  env: Env,
  code: string,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    client_secret: env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch(TIKTOK.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as TokenResponse;
  if (data.error || !data.access_token) {
    throw new Error(
      `Token exchange failed: ${data.error ?? "no access_token"} — ${data.error_description ?? ""}`.trim(),
    );
  }

  const tokens = toStored(data);
  await saveTokens(env, tokens);
  return tokens;
}

/**
 * Refresh an expired/near-expiry access token (used in Step 2).
 * Returns the new tokens, or throws if the refresh token itself is invalid.
 */
export async function refreshTokens(env: Env, current: StoredTokens): Promise<StoredTokens> {
  const body = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    client_secret: env.TIKTOK_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
  });

  const res = await fetch(TIKTOK.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as TokenResponse;
  if (data.error || !data.access_token) {
    throw new Error(
      `Token refresh failed: ${data.error ?? "no access_token"} — ${data.error_description ?? ""}`.trim(),
    );
  }

  const tokens = toStored(data, current);
  await saveTokens(env, tokens);
  return tokens;
}

/**
 * Return a valid access token, refreshing automatically if the stored one
 * is expired or within the refresh margin. This is the single entry point
 * the data pipeline uses — it never returns a stale token.
 *
 * Throws {@link ReauthRequiredError} if there are no tokens, or if the
 * refresh token is expired or rejected by TikTok (re-auth needed).
 */
export async function getValidAccessToken(env: Env): Promise<string> {
  const current = await getStoredTokens(env);
  if (!current) {
    throw new ReauthRequiredError("No tokens stored — visit /login to authorize.");
  }

  const now = Date.now();
  if (now < current.expires_at - REFRESH_MARGIN_MS) {
    return current.access_token; // still good
  }

  // Access token expired/near-expiry. If the refresh token is also dead,
  // there's no recovery without re-authorization.
  if (now >= current.refresh_expires_at) {
    throw new ReauthRequiredError(
      "Refresh token expired — visit /login to re-authorize.",
    );
  }

  console.log("[tokens] access token expired/near-expiry, refreshing…");
  try {
    const refreshed = await refreshTokens(env, current);
    console.log("[tokens] refresh OK");
    return refreshed.access_token;
  } catch (err) {
    // TikTok rejected the refresh token (revoked/invalid) — needs re-auth.
    throw new ReauthRequiredError(
      `Token refresh rejected by TikTok (${(err as Error).message}) — visit /login to re-authorize.`,
    );
  }
}
