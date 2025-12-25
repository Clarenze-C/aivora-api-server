/**
 * Prompt Building Service with Reverse Prompting
 * Handles SFW (Gemini) and NSFW (OpenRouter) prompt generation
 */

import { downloadFile } from './reference.service.js';

// ==========================================
// LLM CONFIGURATION
// ==========================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// OpenRouter Models (for NSFW prompt editing)
const OPENROUTER_MODELS = {
  MYTHOMAX_L2_13B: {
    id: 'gryphe/mythomax-l2-13b',
    name: 'MythoMax L2 13B',
    pricing: '$0.10/1M input, $0.10/1M output',
    uncensored: true
  },
  HERMES_MIXTRAL: {
    id: 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
    name: 'Nous Hermes 2 Mixtral 8x7B',
    pricing: '$0.30/1M input, $0.30/1M output',
    uncensored: true
  }
};

// Default model for NSFW prompt editing
const DEFAULT_NSFW_MODEL = OPENROUTER_MODELS.MYTHOMAX_L2_13B;

// ==========================================
// REVERSE PROMPTING
// ==========================================

/**
 * Reverse prompt: Describe what's in the source image
 * Uses Gemini Vision Flash (fast, free with Google API)
 */
export async function reversePromptImage(imageUrl, enableNSFW = false) {
  console.log(`[Prompt] Reverse prompting image: ${imageUrl}`);
  console.log(`[Prompt] NSFW mode: ${enableNSFW}`);

  try {
    // Download image and convert to base64
    const imageBlob = await downloadFile(imageUrl);
    const imageBuffer = await imageBlob.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageBlob.type || 'image/png';

    // Build reverse prompt based on NSFW mode
    const analysisPrompt = enableNSFW
      ? `Describe this image in detail for AI image generation. Include:
1. Subject(s): person/people, their appearance, clothing, pose
2. Setting/location and background elements
3. Lighting and atmosphere
4. Camera angle and framing
5. Mood and expression
6. Any props or objects
Be explicit and detailed. Include any NSFW elements if present.`
      : `Describe this image in detail for AI image generation. Include:
1. Subject(s): person/people, their appearance, clothing, pose
2. Setting/location and background elements
3. Lighting and atmosphere
4. Camera angle and framing
5. Mood and expression
6. Any props or objects
Be detailed but family-friendly.`;

    // Call Gemini Flash (fast and free)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: analysisPrompt },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }]
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Vision error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Extract description
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      const description = result.candidates[0].content.parts[0].text;
      console.log(`[Prompt] Reverse prompt generated: ${description.substring(0, 200)}...`);
      return description;
    }

    throw new Error('No description in Gemini response');

  } catch (error) {
    console.error(`[Prompt] Reverse prompting failed:`, error);
    // Fallback to basic description
    console.warn(`[Prompt] Using fallback description`);
    return 'A person in a setting with clothing and background.';
  }
}

// ==========================================
// PROMPT EDITING
// ==========================================

/**
 * Edit prompt by combining reverse prompt + reference image instructions
 * Routes to Gemini (SFW) or OpenRouter/MythoMax (NSFW)
 */
export async function buildGenerationPrompt(reversePrompt, profile, references, enableNSFW = false) {
  console.log(`[Prompt] Building generation prompt (NSFW: ${enableNSFW})`);

  const faceCount = references.face?.length || 0;
  const bodyCount = references.body?.length || 0;

  if (enableNSFW) {
    // NSFW: Use OpenRouter with MythoMax
    return await editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount);
  } else {
    // SFW: Use Gemini
    return await editPromptWithGemini(reversePrompt, profile, faceCount, bodyCount);
  }
}

/**
 * SFW prompt editing with Gemini
 */
async function editPromptWithGemini(reversePrompt, profile, faceCount, bodyCount) {
  const editPrompt = `You are a prompt editor for AI image generation. I will provide:
1. A reverse prompt describing the source image
2. Information about the target character

Your task: Rewrite the prompt to instruct the AI to recreate the scene from the reverse prompt, but replace the person with the target character.

Reverse Prompt:
${reversePrompt}

Target Character: ${profile.name || 'Arisa'}
${profile.physical_traits ? `- Appearance: ${JSON.stringify(profile.physical_traits)}` : ''}
${profile.style ? `- Style: ${profile.style}` : ''}

Reference Images Available:
- ${faceCount} face reference images (use for facial features)
- ${bodyCount} body reference images (use for body proportions and pose reference)

Instructions:
1. Start with "Recreate the following scene:"
2. Include all details from the reverse prompt (clothing, background, lighting, pose, etc.)
3. Add explicit instructions to use the reference images for face replacement
4. Keep the original outfit, background, and pose intact - only replace the face
5. Do NOT mention the character name or personality traits
6. Output ONLY the final prompt, no explanations

Final Prompt:`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: editPrompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini edit error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const finalPrompt = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (finalPrompt) {
      console.log(`[Prompt] SFW prompt edited with Gemini`);
      return finalPrompt.trim();
    }

    throw new Error('No prompt in Gemini response');

  } catch (error) {
    console.error(`[Prompt] Gemini editing failed:`, error);
    return fallbackPrompt(reversePrompt, faceCount, bodyCount);
  }
}

/**
 * NSFW prompt editing with OpenRouter (MythoMax L2 13B)
 */
async function editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount) {
  const editPrompt = `<|im_start|>system
You are an expert prompt editor for NSFW AI image generation. You write detailed, explicit prompts for adult content generation while maintaining quality and consistency.<|im_end|>
<|im_start|>user
I need you to rewrite a prompt for AI image generation. Here's what you have:

SOURCE IMAGE DESCRIPTION:
${reversePrompt}

TARGET CHARACTER: ${profile.name || 'Arisa'}
${profile.physical_traits ? `PHYSICAL TRAITS: ${JSON.stringify(profile.physical_traits)}` : ''}
${profile.style ? `STYLE: ${profile.style}` : ''}

REFERENCE IMAGES:
- ${faceCount} face reference images for facial feature matching
- ${bodyCount} body reference images for body proportions

TASK:
Create a detailed prompt that instructs the AI to:
1. Recreate the exact scene from the source description (clothing, background, pose, lighting)
2. Replace the person's face with the character's face using the reference images
3. Keep all original clothing, pose, and background - only change the face
4. Be explicit about any NSFW elements present in the source
5. Do NOT include character names, backstory, or personality

Output ONLY the final prompt, nothing else.<|im_end|>
<|im_start|>assistant
`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://aivora.ai',
        'X-Title': 'AIVORA'
      },
      body: JSON.stringify({
        model: DEFAULT_NSFW_MODEL.id,
        messages: [
          { role: 'system', content: 'You are an expert prompt editor for NSFW AI image generation.' },
          { role: 'user', content: editPrompt }
        ],
        temperature: 0.8,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const finalPrompt = result.choices?.[0]?.message?.content;

    if (finalPrompt) {
      console.log(`[Prompt] NSFW prompt edited with ${DEFAULT_NSFW_MODEL.name}`);
      return finalPrompt.trim();
    }

    throw new Error('No prompt in OpenRouter response');

  } catch (error) {
    console.error(`[Prompt] OpenRouter editing failed:`, error);
    return fallbackPrompt(reversePrompt, faceCount, bodyCount);
  }
}

/**
 * Fallback prompt if LLM editing fails
 */
function fallbackPrompt(reversePrompt, faceCount, bodyCount) {
  return `${reversePrompt}

Instructions:
- Use the ${faceCount} face reference images to replace the person's face
- Keep the original clothing, pose, and background
- Match facial features from reference images
- ${bodyCount > 0 ? `Use body reference images for proportions` : ''}`;
}

// ==========================================
// EXPORTS
// ==========================================

export { OPENROUTER_MODELS, DEFAULT_NSFW_MODEL };
