import { mediaVaultClient, influencerMgmtClient } from '../config/supabase.js';

export async function checkSupabaseConnection() {
  const checks = {
    mediaVault: { status: 'unknown' },
    influencerMgmt: { status: 'unknown' }
  };

  // Check Media Vault connection
  try {
    const { error } = await mediaVaultClient
      .from('media_generations')
      .select('id')
      .limit(1);

    if (error) {
      checks.mediaVault = { status: 'error', message: error.message };
    } else {
      checks.mediaVault = { status: 'healthy', message: 'Media Vault connection successful' };
    }
  } catch (error) {
    checks.mediaVault = { status: 'error', message: error.message };
  }

  // Check Influencer Management connection
  try {
    const { error } = await influencerMgmtClient
      .from('influencer_profiles')
      .select('persona')
      .limit(1);

    if (error) {
      checks.influencerMgmt = { status: 'error', message: error.message };
    } else {
      checks.influencerMgmt = { status: 'healthy', message: 'Influencer Management connection successful' };
    }
  } catch (error) {
    checks.influencerMgmt = { status: 'error', message: error.message };
  }

  return checks;
}
