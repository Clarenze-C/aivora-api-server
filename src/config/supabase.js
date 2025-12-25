import { createClient } from '@supabase/supabase-js';

// ==========================================
// SUPABASE CONFIGURATION
// ==========================================

// Media Vault Supabase (Storage & Generation Tracking)
const MEDIA_VAULT_URL = process.env.SUPABASE_MEDIA_VAULT_URL || 'https://hisjjecrmlszuidhiref.supabase.co';
const MEDIA_VAULT_KEY = process.env.SUPABASE_MEDIA_VAULT_KEY;

// Influencer Management Supabase (Operations & Posting)
const INFLUENCER_MGMT_URL = process.env.SUPABASE_INFLUENCER_MGMT_URL || 'https://kqnfxpqljxhyevuuwzwf.supabase.co';
const INFLUENCER_MGMT_KEY = process.env.SUPABASE_INFLUENCER_MGMT_KEY;

// Validate credentials
if (!MEDIA_VAULT_KEY) {
  console.warn('WARNING: SUPABASE_MEDIA_VAULT_KEY not found in environment variables');
}
if (!INFLUENCER_MGMT_KEY) {
  console.warn('WARNING: SUPABASE_INFLUENCER_MGMT_KEY not found in environment variables');
}

// ==========================================
// SUPABASE CLIENTS
// ==========================================

// Media Vault Client (for generation_jobs, media_generations, batches, locations)
export const mediaVaultClient = createClient(
  MEDIA_VAULT_URL,
  MEDIA_VAULT_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Influencer Management Client (for influencer_profiles, social_media_accounts, content_calendar)
export const influencerMgmtClient = createClient(
  INFLUENCER_MGMT_URL,
  INFLUENCER_MGMT_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Legacy export (defaults to Media Vault for backwards compatibility)
export const supabase = mediaVaultClient;

// ==========================================
// DATABASE TABLE NAMES
// ==========================================

// Media Vault Tables
export const MEDIA_VAULT_TABLES = {
  GENERATION_JOBS: 'generation_jobs',
  MEDIA_GENERATIONS: 'media_generations',
  BATCHES: 'batches',
  LOCATIONS: 'locations',
  GENERATION_LOGS: 'generation_logs'
};

// Influencer Management Tables
export const INFLUENCER_MGMT_TABLES = {
  INFLUENCER_PROFILES: 'influencer_profiles',
  INFLUENCER_REFERENCES: 'influencer_references',
  SOCIAL_MEDIA_ACCOUNTS: 'social_media_accounts',
  CONTENT_CALENDAR: 'content_calendar',
  CONTENT_VARIANTS: 'content_variants',
  CLUSTERS: 'clusters',
  POSTING_LOGS: 'posting_logs'
};

// Combined export for convenience
export const TABLES = {
  ...MEDIA_VAULT_TABLES,
  ...INFLUENCER_MGMT_TABLES
};

// ==========================================
// STORAGE BUCKETS
// ==========================================

export const BUCKETS = {
  GALLERY: 'aivora-gallery'
};

// ==========================================
// HELPERS
// ==========================================

/**
 * Get the right Supabase client for a given table
 */
export function getClientForTable(tableName) {
  if (Object.values(MEDIA_VAULT_TABLES).includes(tableName)) {
    return mediaVaultClient;
  }
  if (Object.values(INFLUENCER_MGMT_TABLES).includes(tableName)) {
    return influencerMgmtClient;
  }
  // Default to Media Vault
  return mediaVaultClient;
}
