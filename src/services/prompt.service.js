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
 * For Seedream 4.5 Edit - requires extremely detailed and explicit prompts for NSFW content
 */
async function editPromptWithOpenRouter(reversePrompt, profile, faceCount, bodyCount, isSFW = false) {
  const model = OPENROUTER_MODELS.MYTHOMAX_L2_13B;
  const modelName = model.name;

  // Build extremely detailed and explicit prompt for NSFW/Seedream
  const editPrompt = `You are an expert prompt editor for NSFW AI image generation using Seedream 4.5 Edit. You MUST be extremely detailed, explicit, and specific about EVERY element.

SOURCE IMAGE DESCRIPTION:
${reversePrompt}

TARGET CHARACTER APPEARANCE:
${profile.physical_traits ? `- Hair: ${profile.physical_traits.hair_color || 'not specified'}, ${profile.physical_traits.hair_style || 'standard style'}
- Eyes: ${profile.physical_traits.eye_color || 'not specified'}
- Skin: ${profile.physical_traits.skin_tone || 'not specified'}
- Face: ${profile.physical_traits.face_shape || 'oval'}` : 'Young woman appearance'}

STYLE & AESTHETIC:
${profile.style || 'Natural, photorealistic style'}

REFERENCE IMAGES:
- Images 1 and 2: Face reference (use for facial feature matching)
- Images 3 and 4: Body reference (use for body proportions and anatomical accuracy)

CRITICAL SEEDREAM 4.5 NSFW PROMPTING RULES:

Seedream 4.5 Edit requires EXPLICIT anatomical detail. Vague descriptions will result in censored/generic output.

1. **BE SPECIFIC ABOUT BODY PARTS**: Never say "breasts" - say "bare breasts with visible nipples", "large natural breasts with pink areolas", "perky breasts with erect nipples", etc.
2. **DESCRIBE CLOTHING FIT**: "tight translucent top revealing nipples", "see-through fabric", "sheer lingerie", "form-fitting dress showing contours", "clothing clinging to body"
3. **BE EXPLICIT ABOUT ACTIONS**: "spreading legs", "bent over pose", "arched back", "leaning forward", "lying down with legs apart", "posing seductively"
4. **DETAIL ANATOMICAL FEATURES**: nipple color/size, areola visibility, body hair, skin texture, muscle tone, body shape, curves
5. **DESCRIBE EXPOSURE**: "fully visible", "partially covered", "see-through", "sheer", "translucent", "strategically placed", "revealing", "exposed"

PROMPT STRUCTURE:

PART 1 - Subject Description (BE EXTREMELY DETAILED):
"A [NSFW/safe-for-work] [shot type: close-up/portrait/half-body/full body/nude] of a [age] [gender] with [detailed physical description: height, body type, skin tone, hair color/style, eye color].

[IF NUDE/EXPOSED]: Explicitly describe ALL visible body parts with anatomical precision. Include: breast size/shape/nipple details, genital visibility, body hair, skin texture, curves, muscle definition.

[CLOTHING]: Describe every item of clothing with specific details about: color, fabric type (sheer/see-through/translucent/tight/loose), fit (form-fitting/flowing/revealing), how it contours to body, what it reveals or conceals.

[POSE]: Describe exact body position: stance, arm placement, leg positioning, spinal alignment, head tilt, facial expression."

PART 2 - Action and Expression:
"[ACTION verb: standing/sitting/lying/bending/leaning] with [detailed description of movement and gesture]. [FACIAL EXPRESSION: smiling/seductive/aroused/neutral] with [eye contact/looking away/closed eyes]."

PART 3 - Environment:
"[Background/setting description] with [props/objects/furniture]. [Lighting: natural/artificial, direction, intensity]. [Atmosphere: intimate/dramatic/playful]."

PART 4 - Technical Details:
"[Camera: shot type, lens, angle]. [Composition: framing, depth of field]. [Style: photorealistic/artistic]."

PART 5 - Reference Instructions (MANDATORY):
"Use images 1 and 2 as face reference to replace the face exactly. Match facial features: eye shape, nose, lips, jawline. Use images 3 and 4 as body reference for anatomical accuracy and proportions. Preserve all other elements from the original scene: clothing, pose, background, lighting."

EXAMPLE EXPLICIT NSFW PROMPTS:

Example 1 (Nude):
"A photorealistic full body nude of a 25-year-old woman with medium natural breasts with light pink areolas and visible nipples, slender waist, wide hips, and smooth shaved vulva. She is standing with one arm covering her breasts and the other at her side, looking directly at camera with a soft sensual expression. The setting is a dimly lit bedroom with satin sheets. Soft warm lighting creates an intimate mood. Captured with a 50mm lens at eye level. Use images 1 and 2 as face reference. Use images 3 and 4 as body reference."

Example 2 (Lingerie):
"A photorealistic half-body portrait of a woman wearing sheer black lingerie that barely covers her breasts, with nipples clearly visible through the translucent fabric. The lingerie is tight and form-fitting, accentuating her curves. She is leaning forward with a seductive smile, soft lighting coming from the left creating shadows that emphasize her cleavage. Captured with an 85mm portrait lens, shallow depth of field, bokeh background. Use images 1 and 2 as face reference. Use images 3 and 4 as body reference."

YOUR TASK:
Rewrite the source image description into an extremely detailed, explicit prompt for NSFW Seedream 4.5 Edit generation.

MANDATORY REQUIREMENTS:
- Be EXPLICIT about ALL body parts (use proper anatomical terms)
- Specify exact clothing state: nude, sheer, see-through, tight, loose, etc.
- Describe exact pose with body positioning details
- Include facial expression and eye direction
- Specify lighting direction and quality
- Mention camera/lens details
- ALWAYS include reference image instructions at the end

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
            content: 'You are an expert prompt editor for NSFW AI image generation and adult content. You write extremely detailed, explicit prompts for Seedream 4.5 Edit. You use precise anatomical terminology and never shy away from explicit descriptions of body parts, sexual content, or adult themes. You understand that vague prompts result in censored output, so you are maximally specific about every detail.'
          },
          { role: 'user', content: editPrompt }
        ],
        temperature: 0.8,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${modelName} error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const finalPrompt = result.choices?.[0]?.message?.content;

    if (finalPrompt) {
      console.log(`[Prompt] NSFW prompt edited with ${modelName}`);
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
