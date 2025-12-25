/**
 * TIKTOK.SERVICE.JS
 * Free TikTok video downloader - No Apify required
 *
 * Uses free public APIs:
 * - tikwm.com API (no auth required, rate limited but free)
 */

/**
 * Get TikTok video data using tikwm.com API (free, no auth)
 * Works with various TikTok URL formats:
 * - https://www.tiktok.com/@username/video/123456789
 * - https://vm.tiktok.com/ZMJxxxxxx/
 * - https://vt.tiktok.com/ZMJxxxxxx/
 */
export async function getTikTokVideoUrl(postUrl) {
  console.log(`[TikTok] Getting video URL from: ${postUrl}`);

  try {
    // Use tikwm.com free API
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(postUrl)}`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`TikWM API returned ${response.status}`);
    }

    const data = await response.json();
    console.log(`[TikTok] TikWM response:`, JSON.stringify(data, null, 2));

    if (data.code === 0 && data.data && data.data.play) {
      const videoUrl = data.data.play;
      console.log(`[TikTok] Found video URL: ${videoUrl}`);
      return videoUrl;
    }

    // If play URL not available, try other URLs in response
    if (data.data && data.data.wmplay) {
      console.log(`[TikTok] Using watermark URL as fallback`);
      return data.data.wmplay;
    }

    throw new Error(`TikWM API error: ${data.msg || 'Unknown error'}`);

  } catch (error) {
    console.error(`[TikTok] Error getting video URL:`, error);
    throw error;
  }
}

/**
 * Check if URL is a TikTok post URL
 */
export function isTikTokPostUrl(url) {
  return url && (
    url.includes('tiktok.com/@') ||
    url.includes('vm.tiktok.com') ||
    url.includes('vt.tiktok.com') ||
    url.includes('tiktok.com/t/')
  );
}

/**
 * Check if URL is a blob URL (from browser)
 */
export function isBlobUrl(url) {
  return url && url.startsWith('blob:');
}

/**
 * Process TikTok URL - convert to downloadable video URL
 */
export async function processTikTokUrl(sourceUrl, pageUrl = null) {
  // If it's a blob URL, use the page URL
  if (isBlobUrl(sourceUrl)) {
    if (!pageUrl) {
      throw new Error('Blob URL detected but no page URL provided.');
    }
    console.log(`[TikTok] Blob URL detected, using page URL: ${pageUrl}`);
    return await getTikTokVideoUrl(pageUrl);
  }

  // If it's already a TikTok post URL, extract the video URL
  if (isTikTokPostUrl(sourceUrl)) {
    return await getTikTokVideoUrl(sourceUrl);
  }

  // If it's already a direct video URL, return as-is
  return sourceUrl;
}
