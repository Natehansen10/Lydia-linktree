// api/tiktok-stats.js
// Deploy this to Vercel — it lives at /api/tiktok-stats

let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms

export default async function handler(req, res) {
  // CORS headers — update origin to your actual domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  // Serve from cache if fresh
  if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
    return res.status(200).json(cache.data);
  }

  try {
    const username = 'lydiaclarkhansen';
    const url = `https://www.tiktok.com/@${username}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const html = await response.text();

    // TikTok embeds stats in a __UNIVERSAL_DATA__ JSON blob in the page
    const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);

    if (!match) throw new Error('Could not find TikTok data blob');

    const json = JSON.parse(match[1]);

    // Navigate the nested structure to find user stats
    const defaultScope = json['__DEFAULT_SCOPE__'] || {};
    const userData =
      defaultScope['webapp.user-detail']?.userInfo ||
      defaultScope['seo.abtest']?.canonical; // fallback

    let stats = { followers: null, likes: null, videos: null, nickname: null, avatar: null, verified: false };

    if (defaultScope['webapp.user-detail']?.userInfo) {
      const info = defaultScope['webapp.user-detail'].userInfo;
      const user = info.user || {};
      const s = info.stats || {};

      stats = {
        nickname: user.nickname || 'Lydia Clark Hansen',
        username: user.uniqueId || username,
        avatar: user.avatarMedium || user.avatarLarger || null,
        verified: user.verified || false,
        followers: s.followerCount ?? null,
        following: s.followingCount ?? null,
        likes: s.heartCount ?? s.heart ?? null,
        videos: s.videoCount ?? null,
        bio: user.signature || '',
      };
    }

    // Format large numbers
    const fmt = (n) => {
      if (n === null || n === undefined) return '—';
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return n.toString();
    };

    const result = {
      ...stats,
      followersFormatted: fmt(stats.followers),
      likesFormatted: fmt(stats.likes),
      videosFormatted: fmt(stats.videos),
      fetchedAt: new Date().toISOString(),
    };

    cache = { data: result, timestamp: Date.now() };
    return res.status(200).json(result);
  } catch (err) {
    console.error('TikTok fetch error:', err.message);
    // Return cached stale data if available, else error
    if (cache.data) return res.status(200).json({ ...cache.data, stale: true });
    return res.status(500).json({ error: 'Failed to fetch TikTok stats', message: err.message });
  }
}
