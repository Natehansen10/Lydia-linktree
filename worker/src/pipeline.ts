/**
 * Step 5 — combined pipeline.
 * Ensures a valid token, pulls account stats + the full video list, and
 * writes one combined JSON snapshot to KV under tiktok:data.
 */

import type { Env } from "./index";
import { KV_KEYS } from "./config";
import { fetchUserInfo, type AccountStats } from "./userinfo";
import { fetchAllVideos, type VideoStat } from "./videos";

/** The single combined snapshot written to KV / served at /data. */
export interface AnalyticsSnapshot {
  /** ISO timestamp of when this snapshot was generated. */
  generated_at: string;
  account: AccountStats;
  video_count: number;
  videos: VideoStat[];
}

/**
 * Run the full pipeline and persist the result to KV.
 * Account stats and video list are fetched independently so a failure in
 * one is reported clearly. Token validity/refresh is handled inside each
 * fetch via getValidAccessToken.
 */
export async function runPipeline(env: Env): Promise<AnalyticsSnapshot> {
  console.log("[pipeline] starting run");

  console.log("[pipeline] step 1/2: account stats");
  const account = await fetchUserInfo(env);

  console.log("[pipeline] step 2/2: video list");
  const videos = await fetchAllVideos(env);

  const snapshot: AnalyticsSnapshot = {
    generated_at: new Date().toISOString(),
    account,
    video_count: videos.length,
    videos,
  };

  await env.TOKENS.put(KV_KEYS.DATA, JSON.stringify(snapshot));
  console.log(
    `[pipeline] done — ${account.display_name}, ${account.follower_count} followers, ${videos.length} videos written to KV`,
  );
  return snapshot;
}

/** Read the last-generated snapshot from KV (served at /data). */
export async function getSnapshot(env: Env): Promise<AnalyticsSnapshot | null> {
  return env.TOKENS.get<AnalyticsSnapshot>(KV_KEYS.DATA, "json");
}
