-- ========================================
-- AIVORA Hub-and-Spoke Migration SQL (REVISED)
-- Split across both Supabase projects
-- ========================================

-- ===============================================
-- PART 1: RUN IN INFLUENCER MANAGEMENT SUPABASE
-- ===============================================

-- ============================================
-- 1. MODIFY: social_media_accounts (Add Hub-and-Spoke)
-- ============================================

-- Step 1: Add tier column without constraint
ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS tier text DEFAULT 'spoke';

-- Step 2: Add the CHECK constraint as a separate table constraint
ALTER TABLE public.social_media_accounts
DROP CONSTRAINT IF EXISTS social_media_accounts_tier_check;

ALTER TABLE public.social_media_accounts
ADD CONSTRAINT social_media_accounts_tier_check
CHECK (tier IN ('hub', 'spoke', 'feeder'));

-- Add hub_account_id (for spokes to reference their hub)
ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS hub_account_id text;

-- Add index for hub lookups
CREATE INDEX IF NOT EXISTS idx_accounts_tier ON public.social_media_accounts USING btree (persona, tier, account_status);
CREATE INDEX IF NOT EXISTS idx_accounts_hub_reference ON public.social_media_accounts USING btree (hub_account_id);

-- Add warm-up tracking columns
ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS warm_up_start_date date;

ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS warm_up_end_date date;

-- ============================================
-- 2. MODIFY: content_calendar (Add Content Waterfall)
-- ============================================

-- Add crop variant (for Content Waterfall)
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS crop_variant text;

ALTER TABLE public.content_calendar
DROP CONSTRAINT IF EXISTS content_calendar_crop_variant_check;

ALTER TABLE public.content_calendar
ADD CONSTRAINT content_calendar_crop_variant_check
CHECK (crop_variant IN ('4:5', '9:16', '1:1', 'original') OR crop_variant IS NULL);

-- Add caption tone
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS caption_tone text;

ALTER TABLE public.content_calendar
DROP CONSTRAINT IF EXISTS content_calendar_caption_tone_check;

ALTER TABLE public.content_calendar
ADD CONSTRAINT content_calendar_caption_tone_check
CHECK (caption_tone IN ('professional', 'casual', 'question', 'inspirational') OR caption_tone IS NULL);

-- Add quality tier (S-Tier for Hub, A-Tier for Spokes, B-Tier for Feeders)
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS quality_tier text;

ALTER TABLE public.content_calendar
DROP CONSTRAINT IF EXISTS content_calendar_quality_tier_check;

ALTER TABLE public.content_calendar
ADD CONSTRAINT content_calendar_quality_tier_check
CHECK (quality_tier IN ('S-Tier', 'A-Tier', 'B-Tier') OR quality_tier IS NULL);

-- Link to media_generations (in Media Vault Supabase)
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS media_generation_id uuid;

-- Add index for Content Waterfall queries
CREATE INDEX IF NOT EXISTS idx_calendar_waterfall ON public.content_calendar USING btree (media_generation_id);

-- ============================================
-- 3. CREATE: influencer_references (For AI generation)
-- ============================================

CREATE TABLE IF NOT EXISTS public.influencer_references (
  id uuid primary key default extensions.uuid_generate_v4(),
  persona text not null references public.influencer_profiles(persona) on delete cascade,

  -- Reference categorization
  category text not null check (category in ('face', 'body')),
  shot_type text not null check (shot_type in ('close', 'half', 'full')),

  -- Reference image
  image_url text not null,
  weight integer default 1,
  is_active boolean default true,

  created_at timestamp without time zone default now()
);

-- Index for auto-selection queries
create index if not exists idx_influencer_ref_lookup on public.influencer_references using btree (persona, category, shot_type, is_active);

-- ============================================
-- 4. CREATE: content_variants (Track Waterfall distribution)
-- ============================================

CREATE TABLE IF NOT EXISTS public.content_variants (
  id uuid primary key default extensions.uuid_generate_v4(),

  -- Link to the calendar entry
  content_calendar_id uuid references public.content_calendar(id) on delete cascade,

  -- Which account got this variant
  account_id text references public.social_media_accounts(account_id) on delete cascade,

  -- Variant details
  crop_type text check (crop_type in ('4:5', '9:16', '1:1', 'original')),
  caption_type text check (caption_type in ('professional', 'casual', 'question', 'inspirational')),

  -- Posting tracking
  post_date timestamp without time zone,
  status text not null default 'pending' check (status in ('pending', 'posted', 'failed')),

  created_at timestamp without time zone default now()
);

create index if not exists idx_content_variants_calendar on public.content_variants using btree (content_calendar_id, account_id);

-- ============================================
-- 5. MIGRATE EXISTING DATA: Mark first account per platform as Hub
-- ============================================

do $$
declare
  r record;
begin
  for r in
    select distinct persona, platform
    from public.social_media_accounts
  loop
    -- Update the first (lowest cluster_index) account as hub
    update public.social_media_accounts
    set tier = 'hub'
    where persona = r.persona
      and platform = r.platform
      and cluster_index = (
        select min(cluster_index)
        from public.social_media_accounts
        where persona = r.persona and platform = r.platform
      );

    -- Update other accounts as spokes
    update public.social_media_accounts
    set tier = 'spoke',
        hub_account_id = (
          select account_id
          from public.social_media_accounts
          where persona = r.persona
            and platform = r.platform
            and tier = 'hub'
          limit 1
        )
    where persona = r.persona
      and platform = r.platform
      and tier is distinct from 'hub';
  end loop;
end $$;

-- ============================================
-- COMPLETE: Influencer Management
-- ============================================

-- Verify the migration
select
  'social_media_accounts' as table_name,
  tier,
  count(*) as count
from public.social_media_accounts
group by tier;


-- ===============================================
-- PART 2: RUN IN AIVORA MEDIA VAULT SUPABASE
-- ===============================================

-- ============================================
-- 1. CREATE: generation_jobs (Track API Server requests)
-- ============================================

CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id text primary key,
  persona text not null,

  -- Job details
  mode text not null check (mode in ('image', 'video')),
  platform text,
  source_url text,

  -- Generation parameters
  shot_type text check (shot_type in ('close', 'half', 'full')),
  settings jsonb default '{}',

  -- Status tracking
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,

  -- Link to generated media
  media_generation_id uuid references public.media_generations(id) on delete set null,

  -- Timestamps
  created_at timestamp without time zone default now(),
  updated_at timestamp without time zone default now()
);

create index if not exists idx_generation_jobs_persona on public.generation_jobs using btree (persona);
create index if not exists idx_generation_jobs_status on public.generation_jobs using btree (status, created_at desc);
create index if not exists idx_generation_jobs_media on public.generation_jobs using btree (media_generation_id);

-- ============================================
-- 2. ADD COLUMN to media_generations (API source tracking)
-- ============================================

-- Add source tracking to metadata_json structure (no new column needed)
-- We'll store: {"source": "api", "platform": "pinterest", "source_url": "...", "job_id": "..."}

-- But let's add a convenience column for quick queries
ALTER TABLE public.media_generations
ADD COLUMN IF NOT EXISTS source text
CHECK (source IN ('python', 'api', 'manual'));

-- Update existing records to 'python'
UPDATE public.media_generations
SET source = 'python'
WHERE source IS NULL;

-- Add index for source filtering
CREATE INDEX IF NOT EXISTS idx_media_source ON public.media_generations USING btree (source);

-- ============================================
-- 3. CREATE FUNCTION: Update updated_at
-- ============================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to generation_jobs table
create trigger trigger_generation_jobs_updated_at
before update on public.generation_jobs
for each row execute function update_updated_at_column();

-- ============================================
-- COMPLETE: Media Vault
-- ============================================

-- Verify
select
  'generation_jobs' as table_name,
  status,
  count(*) as count
from public.generation_jobs
group by status;

select
  'media_generations' as table_name,
  source,
  count(*) as count
from public.media_generations
group by source;
