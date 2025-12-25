/**
 * TIKTOK.SERVICE.JS
 * Free TikTok video downloader - No Apify required
 *
 * Methods:
 * 1. Extract video URL from TikTok post URL
 * 2. Handle blob URLs from browser (extract post URL from page)
 * 3. Download video with proper headers and anti-scraping bypass
 */

/**
 * Extract video URL from TikTok post URL
 * This works with various TikTok URL formats:
 * - https://www.tiktok.com/@username/video/123456789
 * - https://vm.tiktok.com/ZMJxxxxxx/
 * - https://tiktok.com/@username/video/123456789
 */
export async function getTikTokVideoUrl(postUrl) {
  console.log(`[TikTok] Extracting video URL from: ${postUrl}`);

  try {
    // Method 1: Try TikTok oEmbed API (doesn't work for video URLs, but worth a try)
    // Method 2: Scrape the page HTML to find the video URL

    // Add user agent to avoid blocking
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };

    // Fetch the TikTok page
    const response = await fetch(postUrl, {
      headers,
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch TikTok page: ${response.status}`);
    }

    const html = await response.text();

    // Try to extract video URL from various patterns in the HTML
    const patterns = [
      /"playAddr":"([^"]+)"/,
      /"downloadAddr":"([^"]+)"/,
      /<video[^>]*src="([^"]+)"/,
      /contentUrl="([^"]+)"/
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let videoUrl = match[1];
        // Unescape Unicode characters
        videoUrl = videoUrl.replace(/\\u002F/g, '/').replace(/\\u003F/g, '?').replace(/\\u003D/g, '=').replace(/\\u0026/g, '&');
        console.log(`[TikTok] Found video URL: ${videoUrl}`);
        return videoUrl;
      }
    }

    // If patterns don't work, try to find data in the __NEXT_DATA__ script
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const videoUrl = nextData?.props?.pageProps?.videoContent?.ItemStruct?.video?.downloadAddr ||
                        nextData?.props?.pageProps?.itemInfo?.itemStruct?.video?.playAddr;
        if (videoUrl) {
          console.log(`[TikTok] Found video URL from __NEXT_DATA__: ${videoUrl}`);
          return videoUrl;
        }
      } catch (e) {
        console.log(`[TikTok] Failed to parse __NEXT_DATA__: ${e.message}`);
      }
    }

    throw new Error('Could not extract video URL from TikTok page');

  } catch (error) {
    console.error(`[TikTok] Error extracting video URL:`, error);
    throw error;
  }
}

/**
 * Extract post URL from current page (for blob URLs)
 * When browser sends blob URL, we need the actual post URL
 */
export function extractPostUrlFromBlobUrl(blobUrl, pageUrl) {
  // If it's a blob URL, return the page URL instead
  if (blobUrl.startsWith('blob:')) {
    console.log(`[TikTok] Blob URL detected, using page URL: ${pageUrl}`);
    return pageUrl;
  }
  // If it's already a proper URL, return as-is
  return blobUrl;
}

/**
 * Check if URL is a TikTok post URL
 */
export function isTikTokPostUrl(url) {
  return url && (
    url.includes('tiktok.com/@') ||
    url.includes('vm.tiktok.com') ||
    url.includes('vt.tiktok.com')
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
  // If it's a blob URL, we need the page URL
  if (isBlobUrl(sourceUrl)) {
    if (!pageUrl) {
      throw new Error('Blob URL detected but no page URL provided. Chrome extension needs to send the TikTok post URL.');
    }
    const postUrl = extractPostUrlFromBlobUrl(sourceUrl, pageUrl);
    return await getTikTokVideoUrl(postUrl);
  }

  // If it's already a TikTok post URL, extract the video URL
  if (isTikTokPostUrl(sourceUrl)) {
    return await getTikTokVideoUrl(sourceUrl);
  }

  // If it's already a direct video URL, return as-is
  return sourceUrl;
}
