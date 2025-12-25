import { mediaVaultClient, influencerMgmtClient, MEDIA_VAULT_TABLES, INFLUENCER_MGMT_TABLES, BUCKETS } from '../config/supabase.js';
import { nanoid } from 'nanoid';
import { generateImageWithSeedream, generateVideoWithWanAnimate } from './wavespeed.service.js';
import { generateImageWithGemini } from './gemini.service.js';

// Default persona (can be overridden by request)
const DEFAULT_PERSONA = 'arisa';

// AI Model configurations (from existing batch processors)
const AI_MODELS = {
  // SFW Image Models
  NANO_BANANA_PRO: {
    name: 'Nano Banana Pro',
    endpoint: 'https://api.nanobanana.pro/v1/generate',
    sfw: true,
    type: 'image'
  },
  GEMINI_IMAGE: {
    name: 'Gemini 3 Pro Image',
    usesGoogleSDK: true,
    sfw: true,
    type: 'image'
  },
  SEEDREAM_40: {
    name: 'Seedream 4.0',
    endpoint: 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v4.0/edit',
    sfw: true,
    type: 'image'
  },
  // NSFW Image Models
  SEEDREAM_45_EDIT: {
    name: 'Seedream 4.5 Edit',
    endpoint: 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v4.5/edit',
    sfw: false,
    type: 'image'
  },
  // Video Models
  WAN_22_ANIMATE: {
    name: 'WAN 2.2 Animate',
    falModel: 'fal-ai/wan/video/to-video/image-condition',
    sfw: true,
    nsfw: true,
    type: 'video'
  },
  KLING_25: {
    name: 'Kling 2.5',
    falModel: 'fal-ai/kling-video/kling-v-1-5-2',
    sfw: true,
    nsfw: true,
    type: 'video'
  },
  VEO_31: {
    name: 'Veo 3.1',
    falModel: 'fal-ai/veo-3-1-generate',
    sfw: true,
    nsfw: true,
    type: 'video'
  }
};

/**
 * Handle image generation request
 */
export async function handleImageGeneration({ platform, sourceUrl, shotType, settings, timestamp, persona }) {
  const jobId = nanoid(10);
  const influencerPersona = persona || settings.persona || DEFAULT_PERSONA;

  console.log(`[${jobId}] Starting image generation for persona: ${influencerPersona}...`);

  // 1. Create job record in Media Vault Supabase
  const { data: job, error: jobError } = await mediaVaultClient
    .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
    .insert({
      id: jobId,
      persona: influencerPersona,
      mode: 'image',
      platform,
      source_url: sourceUrl,
      shot_type: shotType || null,
      settings,
      status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (jobError) {
    console.error(`[${jobId}] Failed to create job:`, jobError);
    throw new Error(`Failed to create job: ${jobError.message}`);
  }

  // 2. Select appropriate AI model based on NSFW setting
  const enableNSFW = settings.enableNSFW || false;
  const model = selectImageModel(enableNSFW);

  console.log(`[${jobId}] Selected model: ${model.name}`);

  // 3. Trigger generation (async - don't await)
  generateImageAsync(jobId, influencerPersona, platform, sourceUrl, shotType, settings, model);

  return {
    jobId,
    status: 'pending',
    message: `Image generation started with ${model.name}`,
    estimatedTime: '30-60 seconds'
  };
}

/**
 * Handle video generation request
 */
export async function handleVideoGeneration({ platform, sourceUrl, shotType, settings, timestamp, persona }) {
  const jobId = nanoid(10);
  const influencerPersona = persona || settings.persona || DEFAULT_PERSONA;

  console.log(`[${jobId}] Starting video generation for persona: ${influencerPersona}...`);

  // 1. Create job record in Media Vault Supabase
  const { data: job, error: jobError } = await mediaVaultClient
    .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
    .insert({
      id: jobId,
      persona: influencerPersona,
      mode: 'video',
      platform,
      source_url: sourceUrl,
      shot_type: shotType || null,
      settings,
      status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (jobError) {
    console.error(`[${jobId}] Failed to create job:`, jobError);
    throw new Error(`Failed to create job: ${jobError.message}`);
  }

  // 2. Select appropriate video model
  const model = selectVideoModel(settings.videoModel || 'wan-22');

  console.log(`[${jobId}] Selected model: ${model.name}`);

  // 3. Trigger generation (async)
  generateVideoAsync(jobId, influencerPersona, platform, sourceUrl, shotType, settings, model);

  return {
    jobId,
    status: 'pending',
    message: `Video generation started with ${model.name}`,
    estimatedTime: '2-5 minutes'
  };
}

/**
 * Select appropriate image model based on NSFW setting
 */
function selectImageModel(enableNSFW) {
  if (enableNSFW) {
    return AI_MODELS.SEEDREAM_45_EDIT;
  }
  return AI_MODELS.GEMINI_IMAGE;
}

/**
 * Select video model
 */
function selectVideoModel(modelName) {
  const modelMap = {
    'wan-22': AI_MODELS.WAN_22_ANIMATE,
    'kling-25': AI_MODELS.KLING_25,
    'veo-31': AI_MODELS.VEO_31
  };
  return modelMap[modelName] || AI_MODELS.WAN_22_ANIMATE;
}

/**
 * Generate batch ID for API-generated content
 * Format: {persona}_api_{timestamp}
 */
function generateBatchId(persona) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${persona}_API_${year}${month}${day}_${hour}${minute}`;
}

/**
 * Async image generation worker
 */
async function generateImageAsync(jobId, persona, platform, sourceUrl, shotType, settings, model) {
  try {
    console.log(`[${jobId}] Starting async image generation with ${model.name}...`);

    // Update job status to processing
    await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    // Route to appropriate service based on model
    let result;
    const capitalizedPersona = persona.charAt(0).toUpperCase() + persona.slice(1);

    if (model.name === 'Gemini 3 Pro Image' || model.name.includes('Gemini')) {
      // SFW - Use Gemini
      console.log(`[${jobId}] Using Gemini (SFW)`);
      result = await generateImageWithGemini({
        sourceUrl,
        persona: capitalizedPersona,
        shotType: shotType || 'close',
        apiKey: process.env.WAVESPEED_API_KEY
      });
    } else {
      // NSFW - Use Seedream 4.5 Edit
      console.log(`[${jobId}] Using Seedream (NSFW)`);
      result = await generateImageWithSeedream({
        sourceUrl,
        persona: capitalizedPersona,
        shotType: shotType || 'close',
        apiKey: process.env.WAVESPEED_API_KEY,
        enableNSFW: true
      });
    }

    console.log(`[${jobId}] Image generation complete:`, result.imageUrl);

    // Create media_generations record (following your existing schema)
    const batchId = generateBatchId(persona);
    const variationId = 1; // API-generated are always single variations
    const uniqueKey = `${batchId}_scene1_v${variationId}`;

    const { data: mediaGen, error: mediaError } = await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.MEDIA_GENERATIONS)
      .insert({
        batch_id: batchId,
        batch_full_id: batchId,
        persona,
        scene_id: null,
        variation_id: variationId,
        unique_key: uniqueKey,
        base_prompt: settings.prompt || 'Generated from ' + sourceUrl,
        clean_prompt: settings.prompt || 'Generated from ' + sourceUrl,
        location_trigger: null,
        location_id: null,
        background_used: false,
        filename: `${uniqueKey}.png`,
        supabase_url: result.imageUrl,
        model_used: model.name,
        resolution: '2K',
        aspect_ratio: settings.aspectRatio || '3:4',
        status: 'completed',
        content_type: 'image',
        shot_type: shotType || null,
        nsfw_level: settings.enableNSFW ? 1 : 0,
        source: 'api',
        metadata_json: {
          source: 'api',
          platform,
          source_url: sourceUrl,
          job_id: jobId,
          generated_via: 'chrome_extension'
        },
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (mediaError) {
      console.error(`[${jobId}] Failed to create media_generation:`, mediaError);
      throw mediaError;
    }

    // Update job with media_generation_id
    await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
      .update({
        status: 'completed',
        media_generation_id: mediaGen.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`[${jobId}] Image generation completed! Media ID: ${mediaGen.id}`);

    // TODO: Trigger n8n webhook for Content Waterfall scheduling
    // Send media_generation_id to n8n, which will create content_calendar entries

  } catch (error) {
    console.error(`[${jobId}] Image generation failed:`, error);

    await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}

/**
 * Async video generation worker
 */
async function generateVideoAsync(jobId, persona, platform, sourceUrl, shotType, settings, model) {
  try {
    console.log(`[${jobId}] Starting async video generation...`);

    await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    // Call actual WAN Animate API via wavespeed service
    const result = await generateVideoWithWanAnimate({
      sourceUrl,
      persona: persona.charAt(0).toUpperCase() + persona.slice(1), // Capitalize: arisa -> Arisa
      shotType: shotType || 'full',
      apiKey: process.env.WAVESPEED_API_KEY,
      settings: settings || {}
    });

    console.log(`[${jobId}] WAN Animate generation complete:`, result.videoUrl);

    // Create media_generations record
    const batchId = generateBatchId(persona);
    const variationId = 1;
    const uniqueKey = `${batchId}_scene1_v${variationId}`;

    const { data: mediaGen, error: mediaError } = await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.MEDIA_GENERATIONS)
      .insert({
        batch_id: batchId,
        batch_full_id: batchId,
        persona,
        scene_id: null,
        variation_id: variationId,
        unique_key: uniqueKey,
        base_prompt: settings.prompt || 'Generated from ' + sourceUrl,
        clean_prompt: settings.prompt || 'Generated from ' + sourceUrl,
        location_trigger: null,
        location_id: null,
        background_used: false,
        filename: `${uniqueKey}.mp4`,
        supabase_url: result.videoUrl,
        model_used: model.name,
        resolution: '720p',
        aspect_ratio: '9:16',
        status: 'completed',
        content_type: 'video',
        shot_type: shotType || null,
        nsfw_level: settings.enableNSFW ? 1 : 0,
        source: 'api',
        metadata_json: {
          source: 'api',
          platform,
          source_url: sourceUrl,
          job_id: jobId,
          generated_via: 'chrome_extension'
        },
        completed_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (mediaError) {
      console.error(`[${jobId}] Failed to create media_generation:`, mediaError);
      throw mediaError;
    }

    await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
      .update({
        status: 'completed',
        media_generation_id: mediaGen.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`[${jobId}] Video generation completed! Media ID: ${mediaGen.id}`);

    // TODO: Trigger n8n webhook for Content Waterfall scheduling

  } catch (error) {
    console.error(`[${jobId}] Video generation failed:`, error);

    await mediaVaultClient
      .from(MEDIA_VAULT_TABLES.GENERATION_JOBS)
      .update({
        status: 'failed',
        error_message: error.message,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}
