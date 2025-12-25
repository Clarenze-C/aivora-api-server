-- ========================================
-- AIVORA Supabase Database Schema
-- Hub-and-Spoke Architecture with Content Waterfall
-- ========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- 1. INFLUENCERS Table
-- ========================================
CREATE TABLE IF NOT EXISTS influencers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  persona_data JSONB,

  -- Character info
  full_name TEXT,
  age INTEGER,
  nationality TEXT,
  origin_story TEXT,

  -- Styling
  aesthetic TEXT,
  color_palette TEXT[],

  -- Status
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ========================================
-- 2. INFLUENCER_REFERENCES Table
-- ========================================
CREATE TABLE IF NOT EXISTS influencer_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id TEXT REFERENCES influencers(influencer_id) ON DELETE CASCADE,

  -- Reference categorization
  category TEXT NOT NULL CHECK (category IN ('face', 'body')),
  shot_type TEXT NOT NULL CHECK (shot_type IN ('close', 'half', 'full')),

  -- Reference image
  image_url TEXT NOT NULL,
  weight INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_influencer_ref_lookup ON influencer_references(influencer_id, category, shot_type, is_active);

-- ========================================
-- 3. GENERATION_JOBS Table
-- ========================================
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  influencer_id TEXT REFERENCES influencers(influencer_id) ON DELETE SET NULL,

  -- Job details
  mode TEXT NOT NULL CHECK (mode IN ('image', 'video')),
  platform TEXT,
  source_url TEXT,

  -- Generation parameters
  shot_type TEXT CHECK (shot_type IN ('close', 'half', 'full')),
  settings JSONB DEFAULT '{}',

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Link to generated media
  media_id UUID REFERENCES generated_media(id) ON DELETE SET NULL
);

-- Create index for status queries
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status, created_at DESC);

-- ========================================
-- 4. GENERATED_MEDIA Table
-- ========================================
CREATE TABLE IF NOT EXISTS generated_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id TEXT UNIQUE REFERENCES generation_jobs(id) ON DELETE CASCADE,

  -- Media details
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  url TEXT NOT NULL,

  -- Storage
  supabase_path TEXT,
  bucket_name TEXT DEFAULT 'aivora-gallery',

  -- Generation metadata
  model_used TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  settings JSONB DEFAULT '{}',

  -- Quality tier (for Content Waterfall)
  quality_tier TEXT CHECK (quality_tier IN ('S-Tier', 'A-Tier', 'B-Tier')),

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for media lookups
CREATE INDEX idx_generated_media_job ON generated_media(job_id);
CREATE INDEX idx_generated_media_tier ON generated_media(quality_tier, status);

-- ========================================
-- 5. ASSETS Table (The Vault)
-- ========================================
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id TEXT REFERENCES influencers(influencer_id) ON DELETE CASCADE,

  -- Scene/Content identification
  scene_id TEXT NOT NULL,
  variant_type TEXT CHECK (variant_type IN ('Wide', 'Selfie', 'Detail')),

  -- Storage
  supabase_url TEXT NOT NULL,
  bucket_name TEXT DEFAULT 'aivora-gallery',

  -- Quality tier
  quality_tier TEXT NOT NULL CHECK (quality_tier IN ('S-Tier', 'A-Tier', 'B-Tier')),

  -- Content Waterfall tracking
  waterfall_status JSONB DEFAULT '{}',
  -- e.g., {"hub_posted": true, "spoke_a_posted": true, "spoke_b_posted": false}

  -- Usage tracking
  global_usage_count INTEGER DEFAULT 0,
  last_used_date TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for scene lookups
CREATE INDEX idx_assets_scene ON assets(scene_id, quality_tier);

-- ========================================
-- 6. ACCOUNTS Table (Hub-and-Spoke)
-- ========================================
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  influencer_id TEXT REFERENCES influencers(influencer_id) ON DELETE CASCADE,

  -- Account identification
  account_id TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'twitter', 'threads')),
  username TEXT,
  handle TEXT,

  -- Hub-and-Spoke structure
  tier TEXT NOT NULL CHECK (tier IN ('hub', 'spoke', 'feeder')),
  hub_account_id TEXT REFERENCES accounts(account_id) ON DELETE SET NULL,

  -- Proxy/Infrastructure
  proxy_id TEXT,
  proxy_status TEXT CHECK (proxy_status IN ('active', 'inactive', 'error')),
  antidetect_profile_id TEXT,

  -- Account status
  account_status TEXT NOT NULL DEFAULT 'pending' CHECK (account_status IN ('pending', 'warming_up', 'active', 'shadowbanned', 'banned', 'dead')),

  -- Warm-up tracking
  warm_up_complete BOOLEAN DEFAULT false,
  warm_up_start_date TIMESTAMP WITH TIME ZONE,
  warm_up_end_date TIMESTAMP WITH TIME ZONE,

  -- Posting permissions
  can_post BOOLEAN DEFAULT false,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for account lookups
CREATE INDEX idx_accounts_influencer ON accounts(influencer_id, tier, account_status);
CREATE INDEX idx_accounts_hub ON accounts(hub_account_id);

-- ========================================
-- 7. SCHEDULE_MASTER Table (The Brain)
-- ========================================
CREATE TABLE IF NOT EXISTS schedule_master (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Account
  account_id TEXT REFERENCES accounts(account_id) ON DELETE CASCADE,

  -- Timing (with jitter)
  execution_time TIMESTAMP WITH TIME ZONE NOT NULL,
  original_scheduled_time TIMESTAMP WITH TIME ZONE,

  -- Post details
  post_type TEXT NOT NULL CHECK (post_type IN ('single_image', 'carousel', 'reel', 'story', 'tweet', 'thread')),
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,

  -- Content variant
  crop_variant TEXT CHECK (crop_variant IN ('4:5', '9:16', '1:1')),
  caption_tone TEXT CHECK (caption_tone IN ('professional', 'casual', 'question', 'inspirational')),

  -- Generated content
  final_file_url TEXT,
  caption_generated TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rendering', 'ready', 'posted', 'failed')),

  -- Engagement tracking
  posted_at TIMESTAMP WITH TIME ZONE,
  engagement_stats JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for scheduled posts
CREATE INDEX idx_schedule_execution ON schedule_master(execution_time, status);
CREATE INDEX idx_schedule_account ON schedule_master(account_id, status);

-- ========================================
-- 8. CONTENT_VARIANTS Table (Waterfall Tracking)
-- ========================================
CREATE TABLE IF NOT EXISTS content_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Link to original asset
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,

  -- Where it was posted
  account_id TEXT REFERENCES accounts(account_id) ON DELETE CASCADE,

  -- Variant details
  crop_type TEXT CHECK (crop_type IN ('4:5', '9:16', '1:1', 'original')),
  caption_type TEXT CHECK (caption_type IN ('professional', 'casual', 'question', 'inspirational')),

  -- Posting
  post_date TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for waterfall queries
CREATE INDEX idx_content_variants_asset ON content_variants(asset_id, account_id);

-- ========================================
-- 9. FUNCTIONS AND TRIGGERS
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
CREATE TRIGGER update_influencers_updated_at BEFORE UPDATE ON influencers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generation_jobs_updated_at BEFORE UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_schedule_master_updated_at BEFORE UPDATE ON schedule_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 10. ROW LEVEL SECURITY (RLS)
-- ========================================

-- Enable RLS on all tables
ALTER TABLE influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencer_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_variants ENABLE ROW LEVEL SECURITY;

-- For API server usage with service role key, we allow all
-- (The service role key bypasses RLS, but these policies are here for reference)

-- Example policy (bypassed by service role):
CREATE POLICY "Service role can do everything" ON influencers
  FOR ALL USING (auth.role() = 'service_role');

-- Apply similar policies to all tables...
-- (Service role key bypasses RLS, so these are minimal)
