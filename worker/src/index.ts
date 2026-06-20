/**
 * Lydia Hansen Creator Analytics — Cloudflare Worker
 * Single-user, internal tool. TikTok Login Kit (OAuth 2.0) + Display API.
 *
 * Routes:
 *   GET  /            health check
 *   GET  /login       start OAuth — redirect to TikTok
 *   GET  /callback    OAuth redirect target — verify state, exchange code
 *   POST /run         run the data pipeline (requires PIPELINE_TOKEN)
 *   GET  /data        serve the last pipeline snapshot JSON (public read)
 *
 * Also runs on a daily cron (see [triggers] in wrangler.toml).
 */

import { handleLogin, handleCallback } from "./oauth";
import { runPipeline, getSnapshot } from "./pipeline";
import { ReauthRequiredError } from "./tokens";

export interface Env {
  /** KV namespace holding OAuth tokens (fixed key) and pipeline output JSON. */
  TOKENS: KVNamespace;
  /** TikTok app credentials — set as secrets, never hardcoded. */
  TIKTOK_CLIENT_KEY: string;
  TIKTOK_CLIENT_SECRET: string;
  /** Shared secret guarding POST /run (set via `wrangler secret put`). */
  PIPELINE_TOKEN: string;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

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

      case "/run": {
        if (request.method !== "POST") return json({ error: "use POST" }, 405);
        if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
        return runAndReport(env);
      }

      case "/data": {
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        const snapshot = await getSnapshot(env);
        if (!snapshot) {
          return json({ error: "no data yet — run the pipeline first" }, 404, CORS_HEADERS);
        }
        return json(snapshot, 200, CORS_HEADERS);
      }

      default:
        return new Response("Not found", { status: 404 });
    }
  },

  /** Daily cron trigger — runs the pipeline automatically. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("[cron] scheduled pipeline run");
    ctx.waitUntil(
      runPipeline(env)
        .then((s) => console.log(`[cron] OK — ${s.video_count} videos`))
        .catch((err) => console.error("[cron] pipeline failed:", err)),
    );
  },
} satisfies ExportedHandler<Env>;

/** Constant-time-ish bearer/query token check for /run. */
function isAuthorized(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const provided = bearer || url.searchParams.get("token") || "";
  return provided.length > 0 && provided === env.PIPELINE_TOKEN;
}

/** Run the pipeline and return a compact summary (not the full payload). */
async function runAndReport(env: Env): Promise<Response> {
  try {
    const s = await runPipeline(env);
    return json({
      ok: true,
      generated_at: s.generated_at,
      account: {
        display_name: s.account.display_name,
        follower_count: s.account.follower_count,
        likes_count: s.account.likes_count,
      },
      video_count: s.video_count,
    });
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      return json({ ok: false, error: "reauth_required", message: err.message }, 401);
    }
    console.error("[run] pipeline failed:", err);
    return json({ ok: false, error: "pipeline_failed", message: (err as Error).message }, 502);
  }
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
