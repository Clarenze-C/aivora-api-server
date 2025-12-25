import { downloadFile, uploadToSupabase, getReferenceImages, getInfluencerProfile } from './reference.service.js';
import { processTikTokUrl, isTikTokPostUrl, isBlobUrl } from './tiktok.service.js';

// ==========================================
// WAVESPEED.AI API CONFIGURATION
// ==========================================

const WAVESPEED_CONFIG = {
  // Seedream 4.5 Edit - Image to Image
  seedreamEdit: {
    endpoint: 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v4.5/edit',
    model: 'seedream-v4.5-edit'
  },

  // WAN 2.2 Animate - Character animation/replacement
  wanAnimate: {
    endpoint: 'https://api.wavespeed.ai/api/v3/wavespeed-ai/wan-2.2/animate',
    model: 'wan-2.2-animate'
  },

  // Kling Video Generation
  kling: {
    endpoint: 'https://api.wavespeed.ai/v1/kling/video/generate',
    model: 'kling-2.6'
  },

  // Veo Video Generation
  veo: {
    endpoint: 'https://api.wavespeed.ai/v1/veo/video/generate',
    model: 'veo-3.1'
  }
};

/**
 * Generate video using WAN Animate Replace
 * Process: Source Video → Seedream Image Replacement → WAN Animate
 */
export async function generateVideoWithWanAnimate(options) {
  const {
    sourceUrl,          // TikTok video URL (can be blob URL, post URL, or direct video URL)
    pageUrl,            // TikTok post URL (required if sourceUrl is a blob URL)
    persona,            // 'Arisa'
    shotType,           // 'close', 'half', 'full'
    apiKey,
    settings = {}
  } = options;

  console.log(`[WAN Animate] Starting generation for ${persona}`);
  console.log(`[WAN Animate] Source: ${sourceUrl}`);
  console.log(`[WAN Animate] Page URL: ${pageUrl || 'N/A'}`);
  console.log(`[WAN Animate] Shot type: ${shotType}`);

  try {
    // Step 1: Get reference images
    const references = await getReferenceImages(persona, shotType);
    const profile = await getInfluencerProfile(persona);

    if (references.face.length === 0) {
      throw new Error('No face reference images found. Please add reference images to the database.');
    }

    console.log(`[WAN Animate] Using ${references.face.length} face refs, ${references.body.length} body refs`);

    // Step 2: Process TikTok URL to get downloadable video URL
    let downloadableUrl = sourceUrl;
    if (isTikTokPostUrl(sourceUrl) || isBlobUrl(sourceUrl)) {
      console.log(`[WAN Animate] Processing TikTok URL...`);
      downloadableUrl = await processTikTokUrl(sourceUrl, pageUrl);
      console.log(`[WAN Animate] Downloadable URL: ${downloadableUrl}`);
    }

    // Step 3: Download source video
    console.log(`[WAN Animate] Downloading source video...`);
    const videoBlob = await downloadFile(downloadableUrl);

    // Step 3: Upload source video to Supabase for processing
    const sourceFilename = `temp_${Date.now()}_source.mp4`;
    await uploadToSupabase(videoBlob, sourceFilename, 'temp');

    // Step 4: Call WAN Animate API
    const result = await callWanAnimateReplace({
      sourceVideoUrl: `https://hisjjecrmlszuidhiref.supabase.co/storage/v1/object/public/aivora-gallery/temp/${sourceFilename}`,
      referenceImages: references.face,
      persona,
      profile,
      apiKey
    });

    // Step 5: Download generated video
    const generatedVideoBlob = await downloadFile(result.videoUrl);

    // Step 6: Upload to Supabase Storage
    const finalFilename = `${persona}_video_${Date.now()}.mp4`;
    const { url: finalUrl } = await uploadToSupabase(generatedVideoBlob, finalFilename, `${persona}/videos`);

    console.log(`[WAN Animate] Complete! Video: ${finalUrl}`);

    return {
      success: true,
      videoUrl: finalUrl,
      model: 'wan-2.2-animate-replace',
      duration: result.duration || null
    };

  } catch (error) {
    console.error(`[WAN Animate] Error:`, error);
    throw error;
  }
}

/**
 * Call WAN Animate Replace API
 */
async function callWanAnimateReplace(options) {
  const {
    sourceVideoUrl,
    referenceImages,
    persona,
    profile,
    apiKey
  } = options;

  console.log(`[WAN API] Calling WAN Animate Replace...`);
  console.log(`[WAN API] Source: ${sourceVideoUrl}`);
  console.log(`[WAN API] References: ${referenceImages.length} images`);

  // Build prompt based on Arisa's profile
  const prompt = buildPromptFromProfile(profile);

  // Use the first reference image as the character image
  const characterImage = referenceImages[0];

  // WAN 2.2 Animate API format
  const requestBody = {
    image: characterImage,      // Character face image
    video: sourceVideoUrl,      // Source video with pose/motion
    mode: 'replace',            // Replace mode: replace person in video
    prompt: prompt,             // Optional prompt
    resolution: '720p',         // 480p or 720p
    seed: -1                    // -1 for random seed
  };

  const response = await fetch('https://api.wavespeed.ai/api/v3/wavespeed-ai/wan-2.2/animate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WAN API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  console.log(`[WAN API] Response:`, result);

  // Wavespeed returns a task ID for async processing
  if (result.data && result.data.id) {
    // Poll for completion using the result endpoint
    return await pollWanTaskResult(result.data.id, apiKey);
  }

  // Or direct video URL in outputs
  if (result.data && result.data.outputs && result.data.outputs.length > 0) {
    return {
      videoUrl: result.data.outputs[0],
      duration: null
    };
  }

  throw new Error('Unexpected API response format');
}

/**
 * Poll WAN task for completion
 */
async function pollWanTaskResult(taskId, apiKey, maxAttempts = 60) {
  console.log(`[WAN API] Polling task: ${taskId}`);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

    const response = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${taskId}/result`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to check task status: ${response.statusText}`);
    }

    const result = await response.json();

    console.log(`[WAN API] Poll ${i + 1}/${maxAttempts}: ${result.data?.status || result.status}`);

    // Check if task is completed
    if (result.data && result.data.status === 'completed' && result.data.outputs && result.data.outputs.length > 0) {
      return {
        videoUrl: result.data.outputs[0],
        duration: null
      };
    }

    // Check if task failed
    if (result.data && result.data.status === 'failed') {
      throw new Error(result.data.error || 'WAN animation failed');
    }
  }

  throw new Error('Task timed out');
}

/**
 * Build prompt from influencer profile
 */
function buildPromptFromProfile(profile) {
  const prompts = [];

  // Basic identity
  prompts.push(`A beautiful ${profile.age || 20}-year-old ${profile.nationality || 'Thai'} woman named ${profile.nickname || profile.full_name}.`);

  // Physical traits
  if (profile.backstory) {
    prompts.push(profile.backstory);
  }

  // Aesthetic
  if (profile.aesthetic) {
    const aesthetics = Object.values(profile.aesthetic).flat();
    prompts.push(`Style: ${aesthetics.join(', ')}`);
  }

  // Personality/archetype
  if (profile.archetype) {
    prompts.push(`Personality: ${profile.archetype}`);
  }

  return prompts.join(' ');
}

/**
 * Generate image using Seedream 4.5 Edit
 */
export async function generateImageWithSeedream(options) {
  const {
    sourceUrl,
    persona,
    shotType,
    apiKey,
    enableNSFW = false
  } = options;

  console.log(`[Seedream] Starting image generation for ${persona}`);
  console.log(`[Seedream] Source: ${sourceUrl}`);

  try {
    // Get reference images
    const references = await getReferenceImages(persona, shotType);
    const profile = await getInfluencerProfile(persona);

    if (references.face.length === 0) {
      throw new Error('No face reference images found.');
    }

    // Download source image
    const imageBlob = await downloadFile(sourceUrl);

    // Upload to Supabase temporarily
    const tempFilename = `temp_${Date.now()}_source.png`;
    await uploadToSupabase(imageBlob, tempFilename, 'temp');

    const uploadedSourceUrl = `https://hisjjecrmlszuidhiref.supabase.co/storage/v1/object/public/aivora-gallery/temp/${tempFilename}`;

    // Build prompt
    const prompt = buildPromptFromProfile(profile);

    // Call Seedream API
    const requestBody = {
      model: 'seedream-v4.5-edit',
      source_image: uploadedSourceUrl,
      reference_images: references.face.slice(0, 2),
      prompt: prompt,
      negative_prompt: 'blurry, low quality, distorted, deformed, ugly, bad anatomy, watermark, text, error',
      num_images: 1,
      guidance_scale: 7.5,
      seed: Math.floor(Math.random() * 1000000)
    };

    console.log(`[Seedream] Calling API...`);

    const response = await fetch('https://api.wavespeed.ai/api/v3/bytedance/seedream-v4.5/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Seedream API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Seedream] Response:`, result);

    // Handle async task
    if (result.task_id) {
      const finalResult = await pollSeedreamTask(result.task_id, apiKey);

      // Download and upload final image
      const imageBlob = await downloadFile(finalResult.imageUrl);
      const finalFilename = `${persona}_image_${Date.now()}.png`;
      const { url: finalUrl } = await uploadToSupabase(imageBlob, finalFilename, `${persona}/images`);

      return {
        success: true,
        imageUrl: finalUrl,
        model: 'seedream-v4.5-edit'
      };
    }

    // Direct result
    if (result.images?.[0]?.url) {
      const imageBlob = await downloadFile(result.images[0].url);
      const finalFilename = `${persona}_image_${Date.now()}.png`;
      const { url: finalUrl } = await uploadToSupabase(imageBlob, finalFilename, `${persona}/images`);

      return {
        success: true,
        imageUrl: finalUrl,
        model: 'seedream-v4.5-edit'
      };
    }

    throw new Error('Unexpected API response format');

  } catch (error) {
    console.error(`[Seedream] Error:`, error);
    throw error;
  }
}

/**
 * Poll Seedream task for completion
 */
async function pollSeedreamTask(taskId, apiKey, maxAttempts = 30) {
  console.log(`[Seedream] Polling task: ${taskId}`);

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const response = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${taskId}/result`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to check task status: ${response.statusText}`);
    }

    const result = await response.json();

    console.log(`[Seedream] Poll ${i + 1}/${maxAttempts}: ${result.data?.status || result.status}`);

    if (result.data && result.data.status === 'completed' && result.data.outputs && result.data.outputs.length > 0) {
      return {
        imageUrl: result.data.outputs[0]
      };
    }

    if (result.data && result.data.status === 'failed') {
      throw new Error(result.data.error || 'Seedream generation failed');
    }
  }

  throw new Error('Task timed out');
}
