/**
 * Lydia Hansen Creator Analytics — Cloudflare Worker
 * Single-user, internal tool. TikTok Login Kit (OAuth 2.0) + Display API.
 *
 * Routes:
 *   GET /            health check
 *   GET /login       start OAuth — redirect to TikTok
 *   GET /callback    OAuth redirect target — verify state, exchange code
 *
 * Added in later steps: /run (pipeline), /data (output JSON).
 */

import { handleLogin, handleCallback } from "./oauth";

export interface Env {
  /** KV namespace holding OAuth tokens (fixed key) and pipeline output JSON. */
  TOKENS: KVNamespace;
  /** TikTok app credentials — set as secrets, never hardcoded. */
  TIKTOK_CLIENT_KEY: string;
  TIKTOK_CLIENT_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/":
      case "/health":
        return new Response("Hello World — Lydia analytics worker is live.", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });

      case "/login":
        return handleLogin(env);

      case "/callback":
        return handleCallback(request, env);

      default:
        return new Response("Not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
