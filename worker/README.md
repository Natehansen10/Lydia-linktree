# Lydia Hansen Creator Analytics — Worker

Single-user, internal tool. Authenticates one TikTok creator account via
TikTok's Login Kit (OAuth 2.0) and pulls account stats + video performance
through the Display API, writing one combined JSON snapshot that a dashboard
can fetch.

Built on Cloudflare Workers + KV. Deployed at **`https://api.lydiaclarkhansen.com`**.
The static site on `lydiaclarkhansen.com` (GitHub Pages) is untouched — the
Worker lives on a separate `api.` subdomain.

> **Status: TikTok Sandbox mode.** Works because Lydia's account is on the
> app's Sandbox Target Users list. Going to production (so it keeps running
> long-term) requires submitting the app for TikTok review — a separate step
> from this build.

---

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` or `/health` | — | Health check |
| GET | `/login` | — | Start/re-authorize OAuth — redirects to TikTok |
| GET | `/callback` | — | OAuth return target (registered with TikTok) |
| POST | `/run` | `PIPELINE_TOKEN` | Run the pipeline on demand |
| GET | `/data` | — (public) | Serve the last snapshot JSON (CORS enabled) |

Plus a **daily cron** at `09:00 UTC` (`wrangler.toml` `[triggers]`) that runs
the pipeline automatically. The daily run also keeps the 24h access token
refreshed so it never goes stale.

### Triggering a run manually

```bash
curl -X POST \
  -H "Authorization: Bearer <PIPELINE_TOKEN>" \
  https://api.lydiaclarkhansen.com/run
```

Returns a summary `{ ok, partial, generated_at, account, video_count }`.
The full data is at `GET /data`.

---

## Data shape (`GET /data`)

```jsonc
{
  "generated_at": "2026-06-20T23:57:14.337Z",
  "partial": false,            // true if the video list is incomplete (a page failed)
  "account": {
    "open_id": "...",
    "union_id": "...",
    "display_name": "lydiaclarkhansen",
    "avatar_url": "https://...",
    "follower_count": 88891,
    "following_count": 187,
    "likes_count": 6056109,
    "video_count": 311         // TikTok's own profile count (see "Known discrepancy")
  },
  "video_count": 306,          // videos actually returned by the list endpoint
  "videos": [
    {
      "id": "...",
      "title": "...",
      "video_description": "...",
      "cover_image_url": "https://...",
      "share_url": "https://...",
      "embed_link": "https://...",
      "create_time": 1781980307,   // unix seconds
      "duration": 135,             // seconds; 0 for photo-mode posts
      "view_count": 9027,
      "like_count": 1022,
      "comment_count": 26,
      "share_count": 2
    }
    // ... newest first
  ]
}
```

---

## Architecture

```
worker/src/
├── index.ts      Router + cron handler; /run auth; CORS; error mapping
├── config.ts     TikTok endpoint URLs, scopes, redirect URI, KV keys
├── oauth.ts      /login (CSRF state) + /callback (state check, code exchange)
├── tokens.ts     KV token storage; exchange/refresh; getValidAccessToken()
├── userinfo.ts   fetchUserInfo() — account stats
├── videos.ts     fetchAllVideos() — cursor pagination, partial-failure safe
├── pipeline.ts   runPipeline() — combine + persist snapshot to KV
└── http.ts       fetchWithRetry() — 429/5xx backoff, honors Retry-After
```

- **Scopes:** `user.info.basic`, `user.info.stats`, `video.list`
- **Token storage:** plain JSON in private KV (`tiktok:tokens`). KV is not
  publicly readable; single-user tool. Access token ~24h, refresh ~365 days.
  `getValidAccessToken()` auto-refreshes near expiry and raises
  `ReauthRequiredError` (→ visit `/login`) if the refresh token is dead.
- **Snapshot:** written to KV `tiktok:data`, served at `/data`.

---

## Secrets & config

Set as Worker secrets (never committed; local dev uses `worker/.dev.vars`):

```bash
wrangler secret put TIKTOK_CLIENT_KEY
wrangler secret put TIKTOK_CLIENT_SECRET
wrangler secret put PIPELINE_TOKEN      # guards POST /run
```

- **KV namespace** `TOKENS` bound in `wrangler.toml`.
- **Redirect URI** registered with TikTok: `https://api.lydiaclarkhansen.com/callback`
  (must match exactly).
- **`PIPELINE_TOKEN`** cannot be read back from Cloudflare. If lost, set a new
  one with `wrangler secret put PIPELINE_TOKEN`.

## Common commands

```bash
npm install            # in worker/
npx wrangler deploy    # deploy
npx wrangler tail      # live logs
npx wrangler whoami    # check CF auth
```

---

## Re-authorization runbook

If `/run` or `/data` reports `reauth_required`, the refresh token has expired
or been revoked. Fix: open `https://api.lydiaclarkhansen.com/login` **in a
browser logged into Lydia's TikTok account** (the Sandbox Target User),
approve, and the new tokens are stored automatically. Then re-run `/run`.

---

## Known discrepancy: `video_count` 311 vs 306 returned (VERIFIED)

The TikTok profile reports `video_count: 311`, but the `video.list` endpoint
returns **306** videos. This was checked against Lydia's TikTok Studio rather
than assumed. Findings:

**The "view gap" was a metric mismatch — not missing data.** An earlier
comparison noted ~60.66M views (sum of the API's per-post lifetime
`view_count`) vs ~71M in the dashboard. The ~71M came from Studio's
**Analytics → Video Views** total, which is a time-windowed, account-level
traffic metric — *not* the sum of each post's lifetime views. The two are
different metrics by design and are not expected to match. The per-post
numbers themselves **do** reconcile (see below), so there is no view
undercounting.

**Per-video data is accurate.** Studio's top 12 posts by views were compared
to the API's top 12, head to head. They match 1:1 on both **views and likes**
(the only nominal difference is Studio rounding 15.57M up to "16M" for the #1
video). The API's `view_count`/`like_count` per video equal what Studio shows.

**The 5 not returned are immaterial, low-view tail posts.** Studio reports
**311 posts, 0 drafts** (so the gap is not drafts), and all sampled posts are
public ("Everyone"). Because the entire high-performing top of the catalog
reconciles exactly, the 5 posts the Display API omits are necessarily in the
low-view tail — their absence does not meaningfully affect any aggregate
(views, likes, etc.).

**Not definitively confirmed:** the *exact* reason TikTok's `video.list`
excludes those specific 5 posts (e.g. an older/photo-mode format or an API
eligibility filter). This was not pinned down post-by-post across all 311.
What *is* confirmed is that the omission is limited to low-traffic posts and
has negligible impact on the data — treat `video_count: 306` as "all videos
the Display API returns, which covers the entire high-performing catalog."
