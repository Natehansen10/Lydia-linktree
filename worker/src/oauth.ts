/**
 * OAuth route handlers: /login (redirect to TikTok) and /callback
 * (verify state, exchange code for tokens).
 */

import type { Env } from "./index";
import { TIKTOK, SCOPES, REDIRECT_URI, KV_KEYS, STATE_TTL_SECONDS } from "./config";
import { exchangeCodeForTokens } from "./tokens";

/** Cryptographically random URL-safe string for the CSRF state parameter. */
function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * GET /login — start the OAuth flow.
 * Generates a state, stores it in KV (short TTL), redirects to TikTok.
 */
export async function handleLogin(env: Env): Promise<Response> {
  const state = randomState();
  await env.TOKENS.put(KV_KEYS.STATE_PREFIX + state, "1", {
    expirationTtl: STATE_TTL_SECONDS,
  });

  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
  });

  const authUrl = `${TIKTOK.AUTHORIZE_URL}?${params.toString()}`;
  console.log("[oauth] redirecting to TikTok authorize page");
  return Response.redirect(authUrl, 302);
}

/**
 * GET /callback — TikTok redirects here with ?code & ?state (or ?error).
 * Verifies state against KV, exchanges the code for tokens.
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // TikTok may redirect back with an error (e.g. user denied access).
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const desc = url.searchParams.get("error_description") ?? "";
    console.error(`[oauth] callback error: ${oauthError} ${desc}`);
    return text(`Authorization failed: ${oauthError} ${desc}`, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return text("Missing code or state in callback.", 400);
  }

  // CSRF check: the state must match one we issued and stored.
  const stateKey = KV_KEYS.STATE_PREFIX + state;
  const known = await env.TOKENS.get(stateKey);
  if (!known) {
    console.error("[oauth] state mismatch / expired — possible CSRF");
    return text("Invalid or expired state parameter.", 400);
  }
  // One-time use: consume it.
  await env.TOKENS.delete(stateKey);

  try {
    const tokens = await exchangeCodeForTokens(env, code);
    console.log(`[oauth] token exchange OK for open_id=${tokens.open_id}`);
    return text(
      "✅ Authorization complete. Tokens stored. You can close this tab.\n" +
        `Scopes granted: ${tokens.scope}`,
      200,
    );
  } catch (err) {
    console.error("[oauth] token exchange failed:", err);
    return text(`Token exchange failed: ${(err as Error).message}`, 502);
  }
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
