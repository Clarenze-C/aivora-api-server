-- ========================================
-- AIVORA Hub-and-Spoke Migration SQL
-- Run this in Influencer Management Supabase
-- ========================================

-- ============================================
-- 1. MODIFY: social_media_accounts (Add Hub-and-Spoke)
-- ============================================

-- Add tier column (hub/spoke/feeder)
ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS tier text DEFAULT 'spoke'
CHECK (tier IN ('hub', 'spoke', 'feeder'));

-- Add hub_account_id (for spokes to reference their hub)
ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS hub_account_id text;

-- Add index for hub lookups
CREATE INDEX IF NOT EXISTS idx_accounts_tier ON public.social_media_accounts USING btree (persona, tier, account_status);
CREATE INDEX IF NOT EXISTS idx_accounts_hub_reference ON public.social_media_accounts USING btree (hub_account_id);

-- Add warm-up tracking columns (if not exist)
ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS warm_up_start_date date;

ALTER TABLE public.social_media_accounts
ADD COLUMN IF NOT EXISTS warm_up_end_date date;

-- ============================================
-- 2. MODIFY: content_calendar (Add Content Waterfall)
-- ============================================

-- Add crop variant (for Content Waterfall)
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS crop_variant text
CHECK (crop_variant IN ('4:5', '9:16', '1:1', 'original'));

-- Add caption tone
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS caption_tone text
CHECK (caption_tone IN ('professional', 'casual', 'question', 'inspirational'));

-- Add quality tier (S-Tier for Hub, A-Tier for Spokes, B-Tier for Feeders)
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS quality_tier text
CHECK (quality_tier IN ('S-Tier', 'A-Tier', 'B-Tier'));

-- Add waterfall_source_id (links to the original asset that was distributed)
ALTER TABLE public.content_calendar
ADD COLUMN IF NOT EXISTS waterfall_source_id uuid;

-- Add index for Content Waterfall queries
CREATE INDEX IF NOT EXISTS idx_calendar_waterfall ON public.content_calendar USING btree (waterfall_source_id, tier);

-- ============================================
-- 3. CREATE: generation_jobs (Track AI generation)
-- ============================================

CREATE TABLE IF NOT EXISTS public.generation_jobs (
  id text primary key,
  persona text not null references public.influencer_profiles(persona) on delete set null,

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

  -- Timestamps
  created_at timestamp without time zone default now(),
  updated_at timestamp without time zone default now()
);

create index if not exists idx_generation_jobs_persona on public.generation_jobs using btree (persona);
create index if not exists idx_generation_jobs_status on public.generation_jobs using btree (status, created_at desc);

-- ============================================
-- 4. CREATE: generated_media (Store AI results)
-- ============================================

CREATE TABLE IF NOT EXISTS public.generated_media (
  id uuid primary key default extensions.uuid_generate_v4(),
  job_id text unique references public.generation_jobs(id) on delete cascade,

  -- Media details
  media_type text not null check (media_type in ('image', 'video')),
  url text not null,

  -- Supabase storage
  supabase_path text,
  bucket_name text default 'aivora-gallery',

  -- Generation metadata
  model_used text,
  prompt text,
  settings jsonb default '{}',

  -- Quality tier (for Content Waterfall distribution)
  quality_tier text check (quality_tier in ('S-Tier', 'A-Tier', 'B-Tier')),

  -- Status
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),

  created_at timestamp without time zone default now()
);

create index if not exists idx_generated_media_job on public.generated_media using btree (job_id);
create index if not exists idx_generated_media_tier on public.generated_media using btree (quality_tier, status);

-- Link content_calendar to generated_media (if not exist)
alter table public.content_calendar
add column if not exists generated_media_id uuid references public.generated_media(id) on delete set null;

create index if not exists idx_calendar_generated_media on public.content_calendar using btree (generated_media_id);

-- ============================================
-- 5. CREATE: influencer_references (For AI generation)
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
-- 6. CREATE: content_variants (Track Waterfall distribution)
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
-- 7. CREATE FUNCTION: Update updated_at
-- ============================================

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply to new tables
create trigger trigger_generation_jobs_updated_at
before update on public.generation_jobs
for each row execute function update_updated_at_column();

create trigger trigger_generated_media_updated_at
before update on public.generated_media
for each row execute function update_updated_at_column();

-- ============================================
-- 8. MIGRATE EXISTING DATA: Mark first account per platform as Hub
-- ============================================

-- This marks the earliest created account for each (persona, platform) as the Hub
-- You can adjust this logic based on your actual Hub accounts

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
-- COMPLETE!
-- ============================================

-- Verify the migration
select
  'social_media_accounts' as table_name,
  tier,
  count(*) as count
from public.social_media_accounts
group by tier
union all
select
  'content_calendar' as table_name,
  quality_tier as tier,
  count(*) as count
from public.content_calendar
group by quality_tier;
