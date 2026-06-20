/**
 * Step 3 — account stats via the Display API user info endpoint.
 * GET https://open.tiktokapis.com/v2/user/info/?fields=...
 * Field names verified against the live API response.
 */

import type { Env } from "./index";
import { TIKTOK } from "./config";
import { getValidAccessToken } from "./tokens";
import { fetchWithRetry } from "./http";

// Fields we request — basic profile + stats. Comma-joined in the query.
const USER_FIELDS = [
  // user.info.basic
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  // user.info.stats
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
] as const;

/** Clean account-stats shape we expose to the pipeline / dashboard. */
export interface AccountStats {
  open_id: string;
  union_id: string;
  display_name: string;
  avatar_url: string;
  follower_count: number;
  following_count: number;
  likes_count: number;
  video_count: number;
}

/** Raw TikTok response envelope for /v2/user/info/. */
interface UserInfoResponse {
  data?: { user?: Partial<AccountStats> };
  error?: { code?: string; message?: string; log_id?: string };
}

/**
 * Fetch the authenticated creator's profile + stats.
 * Throws on a TikTok API error (error.code !== "ok").
 */
export async function fetchUserInfo(env: Env): Promise<AccountStats> {
  const accessToken = await getValidAccessToken(env);
  const url = `${TIKTOK.USER_INFO_URL}?fields=${USER_FIELDS.join(",")}`;

  console.log("[userinfo] fetching account stats…");
  const res = await fetchWithRetry(
    url,
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    "user/info",
  );

  const body = (await res.json()) as UserInfoResponse;

  // TikTok returns error.code === "ok" on success.
  if (body.error && body.error.code && body.error.code !== "ok") {
    throw new Error(
      `user/info error: ${body.error.code} — ${body.error.message ?? ""} (log_id=${body.error.log_id ?? "?"})`,
    );
  }

  const u = body.data?.user;
  if (!u) {
    throw new Error("user/info returned no user data");
  }

  console.log(`[userinfo] OK — ${u.display_name ?? "?"}, ${u.follower_count ?? "?"} followers`);
  return {
    open_id: u.open_id ?? "",
    union_id: u.union_id ?? "",
    display_name: u.display_name ?? "",
    avatar_url: u.avatar_url ?? "",
    follower_count: u.follower_count ?? 0,
    following_count: u.following_count ?? 0,
    likes_count: u.likes_count ?? 0,
    video_count: u.video_count ?? 0,
  };
}
