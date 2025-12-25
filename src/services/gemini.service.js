import { downloadFile, uploadToSupabase, getReferenceImages, getInfluencerProfile } from './reference.service.js';

/**
 * Generate image using Gemini 2.5 Flash Image Preview Edit
 * This is the SFW model - uses Google's Gemini through Wavespeed
 */
export async function generateImageWithGemini(options) {
  const {
    sourceUrl,
    persona,
    shotType,
    apiKey
  } = options;

  console.log(`[Gemini] Starting image generation for ${persona}`);
  console.log(`[Gemini] Source: ${sourceUrl}`);

  try {
    // Get reference images
    const references = await getReferenceImages(persona, shotType);
    const profile = await getInfluencerProfile(persona);

    if (references.face.length === 0) {
      throw new Error('No face reference images found.');
    }

    console.log(`[Gemini] Using ${references.face.length} face refs`);

    // Download source image
    const imageBlob = await downloadFile(sourceUrl);

    // Upload to Supabase temporarily
    const tempFilename = `temp_${Date.now()}_source.png`;
    await uploadToSupabase(imageBlob, tempFilename, 'temp');

    const uploadedSourceUrl = `https://hisjjecrmlszuidhiref.supabase.co/storage/v1/object/public/aivora-gallery/temp/${tempFilename}`;

    // Build prompt - simpler for Gemini
    const prompt = buildPromptFromProfile(profile);

    // Gemini 2.5 Flash Image Preview Edit API
    const requestBody = {
      image: uploadedSourceUrl,
      reference_image: references.face[0],  // Gemini uses single reference image
      prompt: prompt
    };

    console.log(`[Gemini] Calling API...`);

    const response = await fetch('https://api.wavespeed.ai/api/v3/google/gemini-2.5-flash-image-preview-edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Gemini] Response:`, result);

    // Handle async task
    if (result.data && result.data.id) {
      const finalResult = await pollGeminiTask(result.data.id, apiKey);

      // Download and upload final image
      const imageBlob = await downloadFile(finalResult.imageUrl);
      const finalFilename = `${persona}_image_${Date.now()}.png`;
      const { url: finalUrl } = await uploadToSupabase(imageBlob, finalFilename, `${persona}/images`);

      return {
        success: true,
        imageUrl: finalUrl,
        model: 'gemini-2.5-flash-image-preview-edit'
      };
    }

    // Direct result
    if (result.data && result.data.outputs && result.data.outputs.length > 0) {
      const imageBlob = await downloadFile(result.data.outputs[0]);
      const finalFilename = `${persona}_image_${Date.now()}.png`;
      const { url: finalUrl } = await uploadToSupabase(imageBlob, finalFilename, `${persona}/images`);

      return {
        success: true,
        imageUrl: finalUrl,
        model: 'gemini-2.5-flash-image-preview-edit'
      };
    }

    throw new Error('Unexpected API response format');

  } catch (error) {
    console.error(`[Gemini] Error:`, error);
    throw error;
  }
}

/**
 * Poll Gemini task for completion
 */
async function pollGeminiTask(taskId, apiKey, maxAttempts = 30) {
  console.log(`[Gemini] Polling task: ${taskId}`);

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

    console.log(`[Gemini] Poll ${i + 1}/${maxAttempts}: ${result.data?.status || result.status}`);

    if (result.data && result.data.status === 'completed' && result.data.outputs && result.data.outputs.length > 0) {
      return {
        imageUrl: result.data.outputs[0]
      };
    }

    if (result.data && result.data.status === 'failed') {
      throw new Error(result.data.error || 'Gemini generation failed');
    }
  }

  throw new Error('Task timed out');
}

/**
 * Build prompt for Gemini - keep it simple
 */
function buildPromptFromProfile(profile) {
  const parts = [];

  if (profile.nickname) {
    parts.push(`Replace face with ${profile.nickname}'s face`);
  } else {
    parts.push('Replace face');
  }

  // Physical traits
  if (profile.physical_traits) {
    const traits = [];
    if (profile.physical_traits.hair_color) traits.push(`${profile.physical_traits.hair_color} hair`);
    if (profile.physical_traits.eye_color) traits.push(`${profile.physical_traits.eye_color} eyes`);
    if (profile.physical_traits.skin_tone) traits.push(profile.physical_traits.skin_tone);
    if (traits.length > 0) {
      parts.push(traits.join(', '));
    }
  }

  // Keep original outfit and background
  parts.push('preserve original outfit and background');

  return parts.join('. ') + '.';
}
