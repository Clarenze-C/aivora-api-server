import { mediaVaultClient, influencerMgmtClient, MEDIA_VAULT_TABLES, INFLUENCER_MGMT_TABLES, BUCKETS } from '../config/supabase.js';

/**
 * Fetch reference images for a persona based on shot type
 */
export async function getReferenceImages(persona, shotType) {
  console.log(`[References] Fetching for persona: ${persona}, shotType: ${shotType}`);

  // Determine which categories we need
  const needsFace = ['close', 'half', 'full'].includes(shotType);
  const needsBody = ['half', 'full'].includes(shotType);

  const references = {
    face: [],
    body: []
  };

  // Fetch face references
  if (needsFace) {
    const { data: faceRefs } = await influencerMgmtClient
      .from(INFLUENCER_MGMT_TABLES.INFLUENCER_REFERENCES)
      .select('*')
      .eq('persona', persona)
      .eq('category', 'face')
      .eq('is_active', true)
      .order('shot_type');

    // For close-up, prefer 'close' type, otherwise take any
    const faceByType = faceRefs?.reduce((acc, ref) => {
      if (!acc[ref.shot_type]) acc[ref.shot_type] = [];
      acc[ref.shot_type].push(ref.image_url);
      return acc;
    }, {});

    // Use the most specific match, fallback to any face ref
    if (faceByType?.[shotType]?.length > 0) {
      references.face = faceByType[shotType];
    } else if (faceByType?.close?.length > 0) {
      references.face = faceByType.close;
    } else if (faceRefs?.length > 0) {
      references.face = faceRefs.map(r => r.image_url);
    }
  }

  // Fetch body references
  if (needsBody) {
    const { data: bodyRefs } = await influencerMgmtClient
      .from(INFLUENCER_MGMT_TABLES.INFLUENCER_REFERENCES)
      .select('*')
      .eq('persona', persona)
      .eq('category', 'body')
      .eq('is_active', true)
      .order('shot_type');

    // Prefer matching shot type, fallback to half or close
    const bodyByType = bodyRefs?.reduce((acc, ref) => {
      if (!acc[ref.shot_type]) acc[ref.shot_type] = [];
      acc[ref.shot_type].push(ref.image_url);
      return acc;
    }, {});

    if (bodyByType?.[shotType]?.length > 0) {
      references.body = bodyByType[shotType];
    } else if (bodyByType?.half?.length > 0) {
      references.body = bodyByType.half;
    } else if (bodyByType?.close?.length > 0) {
      references.body = bodyByType.close;
    } else if (bodyRefs?.length > 0) {
      references.body = bodyRefs.map(r => r.image_url);
    }
  }

  console.log(`[References] Found: ${references.face.length} face refs, ${references.body.length} body refs`);

  return references;
}

/**
 * Fetch influencer profile data
 */
export async function getInfluencerProfile(persona) {
  const { data } = await influencerMgmtClient
    .from(INFLUENCER_MGMT_TABLES.INFLUENCER_PROFILES)
    .select('*')
    .eq('persona', persona)
    .single();

  return data;
}

/**
 * Upload file to Supabase Storage
 */
export async function uploadToSupabase(file, filename, folder) {
  const filePath = `${folder}/${filename}`;

  const { data, error } = await mediaVaultClient
    .storage
    .from(BUCKETS.GALLERY)
    .upload(filePath, file);

  if (error) {
    throw new Error(`Failed to upload to Supabase: ${error.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = mediaVaultClient
    .storage
    .from(BUCKETS.GALLERY)
    .getPublicUrl(filePath);

  console.log(`[Storage] Uploaded: ${publicUrl}`);

  return {
    path: filePath,
    url: publicUrl
  };
}

/**
 * Download file from URL
 */
export async function downloadFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  return await response.blob();
}
