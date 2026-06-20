/**
 * Step 4 — video list via the Display API.
 * POST https://open.tiktokapis.com/v2/video/list/?fields=...
 * Cursor-based pagination (cursor + has_more), max_count 20 per page.
 * Field names verified against the live API response.
 */

import type { Env } from "./index";
import { TIKTOK } from "./config";
import { getValidAccessToken } from "./tokens";
import { fetchWithRetry } from "./http";

// Fields requested per video (passed as the `fields` query param).
const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "cover_image_url",
  "share_url",
  "embed_link",
  "create_time",
  "duration",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
] as const;

const MAX_COUNT = 20; // TikTok's per-page maximum
const MAX_PAGES = 100; // safety cap (2000 videos) so a bug can't loop forever

/** Clean per-video shape exposed to the pipeline / dashboard. */
export interface VideoStat {
  id: string;
  title: string;
  video_description: string;
  cover_image_url: string;
  share_url: string;
  embed_link: string;
  create_time: number; // unix seconds
  duration: number; // seconds
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
}

interface VideoListResponse {
  data?: {
    videos?: Partial<VideoStat>[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string; log_id?: string };
}

function normalize(v: Partial<VideoStat>): VideoStat {
  return {
    id: v.id ?? "",
    title: v.title ?? "",
    video_description: v.video_description ?? "",
    cover_image_url: v.cover_image_url ?? "",
    share_url: v.share_url ?? "",
    embed_link: v.embed_link ?? "",
    create_time: v.create_time ?? 0,
    duration: v.duration ?? 0,
    view_count: v.view_count ?? 0,
    like_count: v.like_count ?? 0,
    comment_count: v.comment_count ?? 0,
    share_count: v.share_count ?? 0,
  };
}

/** Fetch a single page of videos. */
async function fetchVideoPage(
  accessToken: string,
  cursor?: number,
): Promise<{ videos: VideoStat[]; cursor: number; hasMore: boolean }> {
  const url = `${TIKTOK.VIDEO_LIST_URL}?fields=${VIDEO_FIELDS.join(",")}`;
  const reqBody: Record<string, unknown> = { max_count: MAX_COUNT };
  if (cursor !== undefined) reqBody.cursor = cursor;

  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    },
    "video/list",
  );

  const body = (await res.json()) as VideoListResponse;
  if (body.error && body.error.code && body.error.code !== "ok") {
    throw new Error(
      `video/list error: ${body.error.code} — ${body.error.message ?? ""} (log_id=${body.error.log_id ?? "?"})`,
    );
  }

  const videos = (body.data?.videos ?? []).map(normalize);
  return {
    videos,
    cursor: body.data?.cursor ?? 0,
    hasMore: body.data?.has_more ?? false,
  };
}

export interface VideoListResult {
  videos: VideoStat[];
  /** True if pagination stopped early due to a page error (data incomplete). */
  partial: boolean;
}

/**
 * Fetch ALL of the creator's videos, paginating until has_more is false.
 *
 * Resilience: fetchVideoPage already retries transient HTTP errors (429/5xx)
 * via fetchWithRetry. If a page STILL fails after that, we don't discard the
 * whole run — we log it, mark the result partial, and return the videos
 * gathered so far. The pipeline persists partial data rather than nothing.
 */
export async function fetchAllVideos(env: Env): Promise<VideoListResult> {
  const accessToken = await getValidAccessToken(env);
  const all: VideoStat[] = [];
  let cursor: number | undefined = undefined;
  let partial = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    let result: Awaited<ReturnType<typeof fetchVideoPage>>;
    try {
      result = await fetchVideoPage(accessToken, cursor);
    } catch (err) {
      // Page failed even after retries — keep what we have, flag partial.
      console.error(`[videos] page ${page + 1} failed, stopping with partial data:`, err);
      partial = true;
      break;
    }

    all.push(...result.videos);
    console.log(
      `[videos] page ${page + 1}: +${result.videos.length} (total ${all.length}), has_more=${result.hasMore}`,
    );

    if (!result.hasMore || result.videos.length === 0) break;
    cursor = result.cursor;
  }

  console.log(`[videos] done — ${all.length} videos${partial ? " (PARTIAL)" : ""}`);
  return { videos: all, partial };
}
