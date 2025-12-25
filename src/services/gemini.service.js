import { downloadFile, uploadToSupabase, getReferenceImages, getInfluencerProfile } from './reference.service.js';

/**
 * Generate image using Google AI Studio API (Nano Banana Pro / gemini-3-pro-image-preview)
 * Direct API call - NOT through Wavespeed
 * Uses your Google AI Studio credits
 */
export async function generateImageWithGemini(options) {
  const {
    sourceUrl,
    persona,
    shotType,
    apiKey,
    settings = {}
  } = options;

  const GOOGLE_API_KEY = apiKey || process.env.GOOGLE_API_KEY;

  // Map resolution and aspect ratio to Google API format
  const aspectRatio = settings.aspectRatio || '3:4';
  const imageSize = settings.resolution || '2K'; // 1K, 2K, or 4K

  console.log(`[Gemini] Starting image generation for ${persona}`);
  console.log(`[Gemini] Source: ${sourceUrl}`);
  console.log(`[Gemini] Aspect Ratio: ${aspectRatio}, Size: ${imageSize}`);

  try {
    // Get reference images
    const references = await getReferenceImages(persona, shotType);
    const profile = await getInfluencerProfile(persona);

    if (references.face.length === 0) {
      throw new Error('No face reference images found.');
    }

    console.log(`[Gemini] Using ${references.face.length} face refs`);

    // Step 1: Upload reference image to Google
    console.log(`[Gemini] Uploading reference image to Google...`);
    const referenceFile = await uploadFileToGoogle(references.face[0], GOOGLE_API_KEY);

    // Step 2: Upload source image to Google
    const sourceBlob = await downloadFile(sourceUrl);
    console.log(`[Gemini] Uploading source image to Google...`);
    const sourceFile = await uploadBlobToGoogle(sourceBlob, GOOGLE_API_KEY);

    // Step 3: Generate image
    const prompt = buildPromptFromProfile(profile);
    console.log(`[Gemini] Prompt: ${prompt}`);

    const imageBase64 = await generateWithGoogleAPI(
      prompt,
      referenceFile,
      sourceFile,
      aspectRatio,
      imageSize,
      GOOGLE_API_KEY
    );

    // Step 4: Convert base64 to blob
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    // Step 5: Upload to Supabase
    const finalFilename = `${persona}_image_${Date.now()}.png`;
    const { url: finalUrl } = await uploadToSupabase(blob, finalFilename, `${persona}/images`);

    return {
      success: true,
      imageUrl: finalUrl,
      model: 'gemini-3-pro-image-preview'
    };

  } catch (error) {
    console.error(`[Gemini] Error:`, error);
    throw error;
  }
}

/**
 * Upload file URL to Google AI Studio
 */
async function uploadFileToGoogle(fileUrl, apiKey) {
  // First download the file
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download reference image: ${response.statusText}`);
  }
  const blob = await response.blob();
  return await uploadBlobToGoogle(blob, apiKey);
}

/**
 * Upload blob to Google AI Studio Files API
 */
async function uploadBlobToGoogle(blob, apiKey) {
  const formData = new FormData();
  formData.append('file', blob);

  const uploadResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      body: formData
    }
  );

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Google upload failed: ${uploadResponse.status} - ${errorText}`);
  }

  const uploadResult = await uploadResponse.json();
  console.log(`[Gemini] Upload result:`, uploadResult);

  // Wait for processing to complete
  const fileId = uploadResult.file?.name || uploadResult.name;
  if (!fileId) {
    throw new Error('No file ID returned from Google upload');
  }

  // Poll for file to be ACTIVE
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const checkResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files/${fileId}?key=${apiKey}`
    );

    if (checkResponse.ok) {
      const fileResult = await checkResponse.json();
      if (fileResult.state === 'ACTIVE') {
        console.log(`[Gemini] File ${fileId} is active`);
        return `gs://${fileId}`;
      }
    }
  }

  throw new Error('File processing timed out');
}

/**
 * Generate image using Google Gemini API
 */
async function generateWithGoogleAPI(prompt, referenceUri, sourceUri, aspectRatio, imageSize, apiKey) {
  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          { file_data: { file_uri: referenceUri } },
          { file_data: { file_uri: sourceUri } }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: aspectRatio,
        imageSize: imageSize
      }
    }
  };

  console.log(`[Gemini] Calling Google API...`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  console.log(`[Gemini] API response received`);

  // Extract image from response
  if (result.candidates && result.candidates[0] && result.candidates[0].content) {
    for (const part of result.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) {
        console.log(`[Gemini] Image generated successfully`);
        return part.inlineData.data;
      }
    }
  }

  throw new Error('No image in response');
}

/**
 * Build prompt for Gemini - simple and focused
 */
function buildPromptFromProfile(profile) {
  const parts = [];

  // Face replacement instruction
  parts.push('Replace the face in the second image with the face from the first image');

  // Physical traits
  if (profile.physical_traits) {
    const traits = [];
    if (profile.physical_traits.hair_color) traits.push(`${profile.physical_traits.hair_color} hair`);
    if (profile.physical_traits.eye_color) traits.push(`${profile.physical_traits.eye_color} eyes`);
    if (profile.physical_traits.skin_tone) traits.push(profile.physical_traits.skin_tone);
    if (traits.length > 0) {
      parts.push('Target appearance: ' + traits.join(', '));
    }
  }

  // Keep original everything
  parts.push('Preserve the original outfit, background, and pose from the second image');

  return parts.join('. ') + '.';
}
