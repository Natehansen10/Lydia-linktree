/**
 * Lydia Hansen Creator Analytics — Cloudflare Worker
 * Single-user, internal tool. TikTok Login Kit (OAuth 2.0) + Display API.
 *
 * Step -1 scaffold: placeholder handler only. OAuth (/login, /callback),
 * token refresh, and the data pipeline are added in later steps.
 */

export interface Env {
  /** KV namespace holding OAuth tokens (fixed key) and pipeline output JSON. */
  TOKENS: KVNamespace;
  /** TikTok app credentials — set as secrets, never hardcoded. */
  TIKTOK_CLIENT_KEY: string;
  TIKTOK_CLIENT_SECRET: string;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("Hello World — Lydia analytics worker is live.", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
