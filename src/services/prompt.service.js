/**
 * Prompt Building Service with Reverse Prompting
 * Handles SFW (Gemma 3 4B) and NSFW (MythoMax L2 13B) prompt generation via OpenRouter
 * Uses Llama 3.2 11B Vision for reverse prompting
 */

import { downloadFile } from './reference.service.js';

// ==========================================
// LLM CONFIGURATION
// ==========================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// OpenRouter Models
const OPENROUTER_MODELS = {
  // Vision model for reverse prompting
  LLAMA_VISION: {
    id: 'meta-llama/llama-3.2-11b-vision-instruct',
    name: 'Llama 3.2 11B Vision',
    pricing: '$0.049/1M input, $0.049/1M output, $0.079/1K images'
  },
  // SFW prompt editing
  GEMMA_3_4B: {
    id: 'google/gemma-3-4b-it:free',
    name: 'Gemma 3 4B',
    pricing: '$0.01/1M input, $0.01/1M output',
    sfw: true
  },
  // NSFW prompt editing (uncensored, good for creative writing/roleplay)
  MYTHOMAX_L2_13B: {
    id: 'gryphe/mythomax-l2-13b',
    name: 'MythoMax L2 13B',
    pricing: '$0.10/1M input, $0.10/1M output',
    uncensored: true
  }
};

// ==========================================
// REVERSE PROMPTING
// ==========================================

/**
 * Reverse prompt: Describe what's in the source image
 * Uses Llama 3.2 11B Vision via OpenRouter (cheapest vision model)
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

    // Detailed reverse prompt following Gemini prompting guide
    // Include photography terms: camera angles, lens types, lighting, fine details
    const analysisPrompt = enableNSFW
      ? `You are analyzing an image for AI image generation. Describe this image in extreme detail using the following structure:

1. **Subject(s)**: Person/people - age, gender, appearance, facial features, hair, skin tone, body type
2. **Clothing & Accessories**: Exact colors, fabrics, styles, patterns, how clothing fits, any accessories
3. **Pose & Body Language**: Body position, gestures, expression, posture, stance
4. **Setting/Location**: Environment, background elements, props, objects, architectural details
5. **Lighting & Atmosphere**: Light source type (natural/artificial), direction, intensity, color temperature, mood
6. **Camera & Composition**: Shot type (close-up, portrait, full body), camera angle (eye-level, high angle, low angle), framing, depth of field
7. **Technical Details**: Any visible textures, materials, reflections, shadows
8. **Style & Aesthetic**: Overall visual style, color palette, era, artistic influences

Be explicit and detailed. Include any NSFW elements if present with precise anatomical and descriptive language.`
      : `You are analyzing an image for AI image generation. Describe this image in extreme detail using the following structure:

1. **Subject(s)**: Person/people - age, gender, appearance, facial features, hair, skin tone, body type
2. **Clothing & Accessories**: Exact colors, fabrics, styles, patterns, how clothing fits, any accessories
3. **Pose & Body Language**: Body position, gestures, expression, posture, stance
4. **Setting/Location**: Environment, background elements, props, objects, architectural details
5. **Lighting & Atmosphere**: Light source type (natural/artificial), direction, intensity, color temperature, mood
6. **Camera & Composition**: Shot type (close-up, portrait, full body), camera angle (eye-level, high angle, low angle), framing, depth of field
7. **Technical Details**: Any visible textures, materials, reflections, shadows
8. **Style & Aesthetic**: Overall visual style, color palette, era, artistic influences

Use photography terminology: mention specific lens types (e.g., "85mm portrait lens", "wide-angle"), lighting setups (e.g., "golden hour", "softbox", "three-point lighting"), and composition techniques (e.g., "bokeh", "depth of field", "rule of thirds"). Be detailed but family-friendly.`;

    // Call Llama 3.2 11B Vision via OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://aivora.ai',
        'X-Title': 'AIVORA'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODELS.LLAMA_VISION.id,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: analysisPrompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Llama Vision error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Extract description
    if (result.choices?.[0]?.message?.content) {
      const description = result.choices[0].message.content;
      console.log(`[Prompt] Reverse prompt generated: ${description.substring(0, 200)}...`);
      return description;
    }

    throw new Error('No description in Llama Vision response');

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
 * Routes to Gemma 3 4B (SFW) or MythoMax L2 13B (NSFW) via OpenRouter
 */
export async function buildGenerationPrompt(reversePrompt, profile, references, enableNSFW = false) {
  console.log(`[Prompt] Building generation prompt (NSFW: ${enableNSFW})`);

  const faceCount = references.face?.length || 0;
  const bodyCount = references.body?.length || 0;

  if (enableNSFW) {
    // NSFW: Use OpenRouter with MythoMax
    return await editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount);
  } else {
    // SFW: Use OpenRouter with Gemma 3 4B
    return await editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount, true);
  }
}

/**
 * SFW prompt editing with Gemma 3 4B via OpenRouter
 */
async function editPromptWithGemma(reversePrompt, profile, faceCount, bodyCount) {
  // Build detailed prompt following Seedream's Action + Object + Attribute formula
  const editPrompt = `You are an expert prompt editor for AI image generation. Your task is to rewrite descriptions into detailed, natural language prompts that follow photography best practices.

SOURCE IMAGE DESCRIPTION:
${reversePrompt}

TARGET CHARACTER APPEARANCE:
${profile.physical_traits ? `- Hair: ${profile.physical_traits.hair_color || 'not specified'}, ${profile.physical_traits.hair_style || 'standard style'}
- Eyes: ${profile.physical_traits.eye_color || 'not specified'}
- Skin: ${profile.physical_traits.skin_tone || 'not specified'}
- Face shape: ${profile.physical_traits.face_shape || 'oval'}` : 'Standard female appearance'}

STYLE & AESTHETIC:
${profile.style || 'Natural, photorealistic style'}

REFERENCE IMAGES AVAILABLE:
- ${faceCount} face reference images for facial feature matching
- ${bodyCount} body reference images for body proportions

TASK:
Create a detailed, natural language prompt for AI image generation using this formula:
1. **Subject**: Describe the main subject clearly (person, clothing, pose)
2. **Action**: What they are doing (standing, sitting, expression, gesture)
3. **Environment**: Setting, background, location details
4. **Style**: Photography style, lighting, mood, color palette

IMPORTANT RULES:
- Describe the scene in natural, flowing paragraphs - NOT a list of keywords
- Use photography terms: camera angle (eye-level, low-angle, high-angle), lens type (85mm portrait, wide-angle), lighting (golden hour, soft diffused, three-point setup), composition (bokeh, depth of field, rule of thirds)
- Include specific details: fabric textures, material types, lighting direction, color temperatures
- Keep the original outfit, pose, and background from the source - only change the face to match the reference images
- DO NOT mention character names or backstory
- Add instruction: "Use the face reference images to replace the face while preserving everything else"

Output ONLY the final prompt, nothing else.

FINAL PROMPT:`;

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
        model: OPENROUTER_MODELS.GEMMA_3_4B.id,
        messages: [
          { role: 'system', content: 'You are an expert prompt editor for AI image generation. You write detailed, natural language prompts following photography best practices and Seedream prompting guidelines.' },
          { role: 'user', content: editPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemma error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const finalPrompt = result.choices?.[0]?.message?.content;

    if (finalPrompt) {
      console.log(`[Prompt] SFW prompt edited with ${OPENROUTER_MODELS.GEMMA_3_4B.name}`);
      return finalPrompt.trim();
    }

    throw new Error('No prompt in Gemma response');

  } catch (error) {
    console.error(`[Prompt] Gemma editing failed:`, error);
    return fallbackPrompt(reversePrompt, faceCount, bodyCount);
  }
}

/**
 * NSFW prompt editing with MythoMax L2 13B via OpenRouter
 * MythoMax excels at creative writing and roleplay - good for descriptive prompts
 */
async function editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount, isSFW = false) {
  const model = isSFW ? OPENROUTER_MODELS.GEMMA_3_4B : OPENROUTER_MODELS.MYTHOMAX_L2_13B;
  const modelName = model.name;

  // Build detailed prompt for NSFW/SFW generation
  const editPrompt = `You are an expert prompt editor for ${isSFW ? 'SFW' : 'NSFW'} AI image generation. Your task is to create detailed, explicit prompts for image generation.

SOURCE IMAGE DESCRIPTION:
${reversePrompt}

TARGET CHARACTER APPEARANCE:
${profile.physical_traits ? `- Hair: ${profile.physical_traits.hair_color || 'not specified'}
- Eyes: ${profile.physical_traits.eye_color || 'not specified'}
- Skin: ${profile.physical_traits.skin_tone || 'not specified'}
- Face: ${profile.physical_traits.face_shape || 'oval'}` : 'Young woman appearance'}

STYLE & AESTHETIC:
${profile.style || 'Natural, photorealistic style'}

REFERENCE IMAGES AVAILABLE:
- ${faceCount} face reference images for facial feature matching
- ${bodyCount} body reference images for body proportions

TASK:
Create a detailed, natural language prompt for AI image generation.

STRUCTURE YOUR PROMPT WITH:
1. **Subject**: Clear description of the person and what they're wearing (colors, fabrics, fit, style)
2. **Action**: Pose, expression, gesture, body language
3. **Environment**: Complete setting description - background, location, props, objects
4. **Lighting**: Light source, direction, quality (soft, harsh, diffused), color temperature
5. **Technical Details**: Camera angle, lens type, depth of field, composition
6. **Mood**: Overall atmosphere and emotional tone

CRITICAL RULES:
- Write in natural, flowing paragraphs - NOT keyword lists
- Use specific photography terminology (85mm lens, golden hour, bokeh, etc.)
- Include all details from the source description exactly
- Keep original clothing, pose, background - ONLY replace the face
- ${!isSFW ? 'Be explicit and detailed about all elements including anatomical features, clothing fit, body contours, and any adult themes present.' : 'Be detailed but family-friendly.'}
- Add: "Use the provided face reference images to replace the face while preserving all other elements exactly as described."
- DO NOT include character names or backstory

Output ONLY the final prompt, nothing else.

FINAL PROMPT:`;

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
        model: model.id,
        messages: [
          {
            role: 'system',
            content: isSFW
              ? 'You are an expert prompt editor for SFW AI image generation. You write detailed, natural language prompts using photography terminology.'
              : 'You are an expert prompt editor for NSFW AI image generation and adult content. You write detailed, explicit prompts with rich descriptions while maintaining quality and consistency.'
          },
          { role: 'user', content: editPrompt }
        ],
        temperature: 0.8,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${modelName} error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const finalPrompt = result.choices?.[0]?.message?.content;

    if (finalPrompt) {
      console.log(`[Prompt] ${isSFW ? 'SFW' : 'NSFW'} prompt edited with ${modelName}`);
      return finalPrompt.trim();
    }

    throw new Error(`No prompt in ${modelName} response`);

  } catch (error) {
    console.error(`[Prompt] ${modelName} editing failed:`, error);
    return fallbackPrompt(reversePrompt, faceCount, bodyCount);
  }
}

/**
 * Fallback prompt if LLM editing fails
 */
function fallbackPrompt(reversePrompt, faceCount, bodyCount) {
  return `${reversePrompt}

Use the ${faceCount} face reference images to replace the person's face while preserving the original clothing, pose, and background. Match facial features exactly from the reference images.${bodyCount > 0 ? ' Use body reference images for proportions.' : ''}`;
}

// ==========================================
// EXPORTS
// ==========================================

export { OPENROUTER_MODELS };
