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
 * Follows Gemini's recommended template structure
 */
async function editPromptWithGemma(reversePrompt, profile, faceCount, bodyCount) {
  // Build detailed prompt following Gemini's template from official docs
  const editPrompt = `You are an expert prompt editor for Gemini image generation. Follow Gemini's recommended template structure exactly.

SOURCE IMAGE DESCRIPTION:
${reversePrompt}

TARGET CHARACTER APPEARANCE:
${profile.physical_traits ? `- Hair: ${profile.physical_traits.hair_color || 'not specified'}, ${profile.physical_traits.hair_style || 'standard style'}
- Eyes: ${profile.physical_traits.eye_color || 'not specified'}
- Skin: ${profile.physical_traits.skin_tone || 'not specified'}
- Face: ${profile.physical_traits.face_shape || 'oval'}` : 'Standard female appearance'}

STYLE & AESTHETIC:
${profile.style || 'Natural, photorealistic style'}

REFERENCE IMAGES:
- Images 1 and 2: Face reference (use for facial feature matching)
- Images 3 and 4: Body reference (use for body proportions and pose reference)

FOLLOW GEMINI'S TEMPLATE STRUCTURE:

Start with: "A photorealistic [shot type] of [subject], [action or expression], set in [environment]."

Then add: "The scene is illuminated by [lighting description], creating a [mood] atmosphere."

Then add: "Captured with a [camera/lens details], emphasizing [key textures and details]."

Finally add: "Use images 1 and 2 as face reference to replace the face. Use images 3 and 4 as body reference for proportions. Preserve all other elements from the original scene exactly."

EXAMPLE GEMINI PROMPT:
"A photorealistic close-up portrait of an elderly Japanese ceramicist with deep, sun-etched wrinkles and a warm, knowing smile. He is carefully inspecting a freshly glazed tea bowl. The setting is his rustic, sun-drenched workshop. The scene is illuminated by soft, golden hour light streaming through a window, highlighting the fine texture of the clay. Captured with an 85mm portrait lens, resulting in a soft, blurred background (bokeh). The overall mood is serene and masterful."

YOUR TASK:
Rewrite the source image description into a prompt following this exact structure. Use photography terms like "85mm portrait lens", "golden hour", "bokeh", "soft diffused lighting", "three-point setup", "wide-angle", "macro", "depth of field".

IMPORTANT RULES:
- Follow the 4-part template structure exactly
- Write in natural, flowing paragraphs - NOT keyword lists
- Keep the original outfit, pose, and background - only replace the face using images 1 and 2
- Use images 3 and 4 for body proportions
- DO NOT mention character names or backstory
- Output ONLY the final prompt

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
          { role: 'system', content: 'You are an expert prompt editor for Gemini image generation. You follow Gemini\'s official template structure: shot type + subject + action + environment + lighting + mood + camera/lens + textures.' },
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
 * Follows Seedream's Action + Object + Attribute formula with explicit reference instructions
 */
async function editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount, isSFW = false) {
  const model = isSFW ? OPENROUTER_MODELS.GEMMA_3_4B : OPENROUTER_MODELS.MYTHOMAX_L2_13B;
  const modelName = model.name;

  // Build detailed prompt following Seedream's Action + Object + Attribute formula
  const editPrompt = `You are an expert prompt editor for ${isSFW ? 'SFW' : 'NSFW'} AI image generation using Seedream. Follow Seedream's prompting formula: Action + Object + Attribute.

SOURCE IMAGE DESCRIPTION:
${reversePrompt}

TARGET CHARACTER APPEARANCE:
${profile.physical_traits ? `- Hair: ${profile.physical_traits.hair_color || 'not specified'}
- Eyes: ${profile.physical_traits.eye_color || 'not specified'}
- Skin: ${profile.physical_traits.skin_tone || 'not specified'}
- Face: ${profile.physical_traits.face_shape || 'oval'}` : 'Young woman appearance'}

STYLE & AESTHETIC:
${profile.style || 'Natural, photorealistic style'}

REFERENCE IMAGES:
- Images 1 and 2: Face reference (use for facial feature matching)
- Images 3 and 4: Body reference (use for body proportions and pose reference)

FOLLOW SEEDREAM'S FORMULA: Action + Object + Attribute

Describe in natural language: Subject + Action + Environment + Style/Color/Lighting/Composition

EXAMPLE SEEDREAM PROMPT:
"A girl in elegant clothing, holding a parasol, walking down a tree-lined avenue, Monet oil painting style"

YOUR TASK:
Rewrite the source image description into a detailed natural language prompt following this structure.

START WITH:
"A [photorealistic/stylized] [shot type: close-up/portrait/full body] of [subject description], [action/expression], set in [environment]."

THEN ADD:
"The scene is illuminated by [lighting: golden hour/soft diffused/three-point/studio], creating a [mood: serene/dramatic/playful] atmosphere."

THEN ADD:
"Captured with [camera/lens: 85mm portrait lens/wide-angle/macro], emphasizing [textures: fabric details/skin texture/material surfaces]."

FINALLY ADD (CRITICAL):
"Use images 1 and 2 as face reference to replace the face. Use images 3 and 4 as body reference for proportions. Preserve all other elements from the original scene exactly."

PHOTOGRAPHY TERMS TO USE:
- Shot types: close-up, portrait, half-body, full body, wide shot
- Camera: 85mm portrait lens, wide-angle, macro, 50mm, 35mm
- Lighting: golden hour, soft diffused, three-point setup, natural window light, studio lighting
- Composition: bokeh, depth of field, rule of thirds, leading lines
- Mood: serene, dramatic, playful, intimate, mysterious

CRITICAL RULES:
- Write in natural, flowing paragraphs - NOT keyword lists
- Include all details from source: clothing colors/fabrics, background, pose, lighting
- Keep original outfit, pose, background - ONLY replace the face using images 1 and 2
- Use images 3 and 4 for body proportions
- ${!isSFW ? 'Be explicit and detailed about all elements including anatomical features, clothing fit, body contours, and any adult themes present.' : 'Be detailed but family-friendly.'}
- DO NOT include character names or backstory
- Output ONLY the final prompt

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
              ? 'You are an expert prompt editor for AI image generation. You follow Seedream\'s Action + Object + Attribute formula and use photography terminology.'
              : 'You are an expert prompt editor for NSFW AI image generation and adult content. You follow Seedream\'s Action + Object + Attribute formula and write detailed, explicit prompts with rich descriptions.'
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

Use images 1 and 2 as face reference to replace the person's face while preserving the original clothing, pose, and background. Match facial features exactly from the reference images. Use images 3 and 4 as body reference for proportions.`;
}

// ==========================================
// EXPORTS
// ==========================================

export { OPENROUTER_MODELS };
