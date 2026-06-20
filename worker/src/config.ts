/**
 * Shared constants: TikTok endpoints, scopes, KV keys, redirect URI.
 * Endpoint URLs verified against developers.tiktok.com (v2 API).
 */

export const TIKTOK = {
  // Login Kit authorization page (user is redirected here to grant access).
  AUTHORIZE_URL: "https://www.tiktok.com/v2/auth/authorize/",
  // Token exchange + refresh (same endpoint, different grant_type).
  TOKEN_URL: "https://open.tiktokapis.com/v2/oauth/token/",
  // Display API.
  USER_INFO_URL: "https://open.tiktokapis.com/v2/user/info/",
  VIDEO_LIST_URL: "https://open.tiktokapis.com/v2/video/list/",
} as const;

// Approved scopes for this app (Sandbox): basic profile, stats, video list.
export const SCOPES = ["user.info.basic", "user.info.stats", "video.list"].join(",");

// Production redirect URI — must EXACTLY match the TikTok dashboard entry.
export const REDIRECT_URI = "https://api.lydiaclarkhansen.com/callback";

// Fixed KV keys (single-user app, so one key per thing).
export const KV_KEYS = {
  TOKENS: "tiktok:tokens", // { access_token, refresh_token, expires_at, refresh_expires_at, open_id, scope }
  STATE_PREFIX: "oauth:state:", // + random state value, short TTL
  DATA: "tiktok:data", // pipeline output JSON
} as const;

// How long a pending OAuth state is valid (seconds).
export const STATE_TTL_SECONDS = 600;
