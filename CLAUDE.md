# Lydiaclarkhansen.com

Personal brand site for creator Lydia Hansen, plus a private, single-user
TikTok analytics tool used for content strategy and brand-partnership
reporting. Two independently deployed pieces live in this one repo.

## Structure

```
index.html              Public linktree/landing page (root of the domain)
CNAME                    lydiaclarkhansen.com — GitHub Pages custom domain
profile*.jpg, shed.jpg,
Shopmy.jpg, favicon.png  Images used by the landing page

analytics-app/           Internal analytics tool (not linked from the public site)
├── index.html           "Internal tool" info page (links to terms/privacy)
├── dashboard.html        Video grid — sortable cards, hero KPI stats
├── insights.html         "Decision Hub" — 4-tab analysis app (see below)
├── privacy.html          Legal pages required for TikTok API review
└── terms.html

worker/                  Cloudflare Worker — TikTok OAuth + data pipeline
├── src/                 index.ts (router+cron), oauth.ts, tokens.ts,
│                         userinfo.ts, videos.ts, pipeline.ts, http.ts, config.ts
├── wrangler.toml         Deploy config, KV binding, custom domain, daily cron
└── README.md             Full architecture, endpoints, data shape, runbooks
                          — read this before touching worker/, don't duplicate
                          its content elsewhere
```

## Deployment (two independent targets)

- **Static site** (root + `analytics-app/`) → GitHub Pages, auto-deploys from
  `main` on every push/merge. No build step — plain HTML/CSS/JS files served
  as-is. Live at `https://lydiaclarkhansen.com`; the analytics app is at
  `/analytics-app/insights.html` and `/analytics-app/dashboard.html`.
- **Worker** (`worker/`) → Cloudflare Workers at `api.lydiaclarkhansen.com`,
  a separate subdomain so it never touches the static site. Deployed
  *manually* with `npx wrangler deploy` from inside `worker/` — pushing to
  `main` does **not** redeploy it. Also runs a daily cron (09:00 UTC) that
  refreshes the OAuth token and re-pulls TikTok data.

## Git workflow

- One feature branch per unit of work, PR'd into `main`, merged manually via
  the GitHub UI (regular merge commits, not squash/rebase — see `git log
  --graph`).
- **`gh` CLI is not installed in this environment.** To open a PR, use the
  raw compare URL: `https://github.com/Natehansen10/Lydia-linktree/pull/new/<branch>`.
  PRs must be merged by hand on github.com; there's no way to merge or check
  status via API here.
- No CI checks configured — merges are a manual judgment call.

## insights.html architecture (the analysis engine)

`analytics-app/insights.html` is a single self-contained HTML/CSS/JS file —
no build step, no framework. It's organized as:

1. **`CONFIG`** — single source of truth for every threshold (confidence
   floors, time ranges, duration buckets, outlier stddev multiple, etc.).
   Nothing downstream hardcodes a number; add new thresholds here.
2. **Pure analysis functions** (`analyzeHours`, `analyzeDays`,
   `analyzeDuration`, `analyzeFrequency`, `detectOutliers`, `analyzeVelocity`,
   `buildHeatmap`, `analyzeAll`, …) — take `(videos, cfg, ...)`, return plain
   data, touch no DOM. Exported via `module.exports` for a Node harness that
   doesn't exist yet (no test files anywhere in the repo — verification is
   manual: run a local static server and click through the UI in a browser).
3. **Render functions** (`renderPatterns`, `renderOutliers`, `renderVelocity`,
   `renderPartnerships`) — read module-scoped state (`_allVideos`, `_now`,
   per-tab range toggles like `_activeRange`/`_outliersRange`) and inject
   HTML strings into mount divs. All four tabs render eagerly once at boot
   (`init()`); tab switching is a pure visibility toggle, not lazy rendering.
   Each new tab's boot call is independently try/caught so one tab's bug
   can't blank out the others.
4. Shared visual components (`.video-card`, `.stat` KPI tiles) are ported
   from `dashboard.html` rather than reinvented — check there first before
   building new UI primitives.

Same CSS custom-property palette across every page in this repo
(`--cream`, `--stone`, `--sage`, `--sage-deep`, `--ink`, `--muted`, `--white`,
`--hairline`) with Cormorant Garamond for headlines / Inter for body text —
match it for any new UI.

## Data quirks to know before trusting a number

- **No time-series history.** The worker's daily cron overwrites a single KV
  snapshot (`tiktok:data`) — there is no historical/intraday data. Anything
  requiring a real growth curve (e.g. true "velocity" in the first hours
  after posting) isn't possible without a pipeline change; the Velocity tab
  uses `view_count ÷ days_since_posted` as an explicit, caveated proxy.
- **`video_count` discrepancy (verified, documented in `worker/README.md`):**
  TikTok's profile reports 311 videos but the Display API's `video.list`
  only returns ~306. This was checked against TikTok Studio — the missing
  ones are low-view tail posts, not a data-loss bug. Treat the `videos`
  array length as ground truth for "total videos," not `account.video_count`.
- `duration: 0` means a photo/carousel post, not a zero-length video — always
  special-case it in UI (`isPhoto = !v.duration`) rather than bucketing it.
- The Worker's `/data` endpoint is intentionally public/unauthenticated
  (CORS-open) so the static dashboard pages can fetch it client-side — this
  is by design, not an oversight.
