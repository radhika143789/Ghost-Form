-- =============================================================================
-- Ghost Form — Complete Supabase Schema
-- Run this ENTIRE file in: Supabase Dashboard > SQL Editor > New query > Run
-- =============================================================================
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / DO blocks
-- so running it again will NOT duplicate anything.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1: Create the threat_level ENUM type
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'threat_level_enum'
  ) THEN
    CREATE TYPE public.threat_level_enum AS ENUM ('Yellow', 'Red');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2: Create the threat_telemetry table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.threat_telemetry (

  id               UUID         NOT NULL DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  domain_flagged   VARCHAR(253) NOT NULL,
  threat_level     public.threat_level_enum NOT NULL,
  detection_method VARCHAR(20)  NOT NULL,

  CONSTRAINT threat_telemetry_pkey
    PRIMARY KEY (id),

  CONSTRAINT domain_not_empty
    CHECK (length(trim(domain_flagged)) > 0),

  CONSTRAINT domain_safe_chars
    CHECK (domain_flagged ~ '^[a-zA-Z0-9][a-zA-Z0-9\-\.]*[a-zA-Z0-9]$'),

  CONSTRAINT detection_method_valid
    CHECK (detection_method IN ('ML_Model', 'API'))

  -- PRIVACY: No user_id, no ip_address, no user_agent, no page_content.
);


-- -----------------------------------------------------------------------------
-- STEP 3: Performance indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_threat_telemetry_created_at
  ON public.threat_telemetry (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threat_telemetry_threat_level
  ON public.threat_telemetry (threat_level);

CREATE INDEX IF NOT EXISTS idx_threat_telemetry_level_created
  ON public.threat_telemetry (threat_level, created_at DESC);


-- -----------------------------------------------------------------------------
-- STEP 4: Enable Row Level Security (RLS)
-- -----------------------------------------------------------------------------
ALTER TABLE public.threat_telemetry ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- STEP 5: RLS Policies (drop-then-create for idempotency)
-- -----------------------------------------------------------------------------

-- 5a. anon INSERT: extension users can report threats
DROP POLICY IF EXISTS "anon_can_insert_telemetry" ON public.threat_telemetry;
CREATE POLICY "anon_can_insert_telemetry"
  ON public.threat_telemetry FOR INSERT TO anon
  WITH CHECK (true);

-- 5b. authenticated INSERT: admin can also insert (for testing)
DROP POLICY IF EXISTS "authenticated_can_insert_telemetry" ON public.threat_telemetry;
CREATE POLICY "authenticated_can_insert_telemetry"
  ON public.threat_telemetry FOR INSERT TO authenticated
  WITH CHECK (true);

-- 5c. authenticated SELECT: admin dashboard can read all rows
DROP POLICY IF EXISTS "authenticated_can_select_telemetry" ON public.threat_telemetry;
CREATE POLICY "authenticated_can_select_telemetry"
  ON public.threat_telemetry FOR SELECT TO authenticated
  USING (true);

-- 5d. anon SELECT: returns zero rows (not an error) - hides schema from probing
DROP POLICY IF EXISTS "anon_cannot_select_telemetry" ON public.threat_telemetry;
CREATE POLICY "anon_cannot_select_telemetry"
  ON public.threat_telemetry FOR SELECT TO anon
  USING (false);

-- 5e. Block UPDATE for everyone - telemetry rows are immutable
DROP POLICY IF EXISTS "nobody_can_update_telemetry" ON public.threat_telemetry;
CREATE POLICY "nobody_can_update_telemetry"
  ON public.threat_telemetry FOR UPDATE TO anon, authenticated
  USING (false);

-- 5f. Block DELETE for everyone - data retention requirement
DROP POLICY IF EXISTS "nobody_can_delete_telemetry" ON public.threat_telemetry;
CREATE POLICY "nobody_can_delete_telemetry"
  ON public.threat_telemetry FOR DELETE TO anon, authenticated
  USING (false);


-- -----------------------------------------------------------------------------
-- STEP 6: Table-level GRANTs (required in addition to RLS policies)
-- RLS handles row-level access; GRANTs handle table-level access.
-- Without GRANTs, the RLS policies are never even reached.
-- -----------------------------------------------------------------------------
GRANT INSERT                ON public.threat_telemetry TO anon;
GRANT INSERT, SELECT        ON public.threat_telemetry TO authenticated;
REVOKE UPDATE, DELETE       ON public.threat_telemetry FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- STEP 7: Pre-aggregated dashboard view
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.threat_stats AS
  SELECT
    date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
    threat_level,
    detection_method,
    COUNT(*) AS total_blocks
  FROM public.threat_telemetry
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 2, 3;

GRANT SELECT ON public.threat_stats TO authenticated;
REVOKE ALL   ON public.threat_stats FROM anon;


-- -----------------------------------------------------------------------------
-- STEP 8: Enable Realtime (required for live dashboard updates)
-- Without this, supabase.channel() subscriptions receive no events.
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.threat_telemetry;


-- =============================================================================
-- VERIFICATION — run this SELECT after the above to confirm health
-- =============================================================================
SELECT
  'threat_telemetry table'   AS object,
  'EXISTS'                   AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'threat_telemetry'
)
UNION ALL
SELECT
  'RLS enabled',
  CASE WHEN relrowsecurity THEN 'ENABLED OK' ELSE '!! DISABLED - FIX NEEDED' END
FROM pg_class WHERE relname = 'threat_telemetry'
UNION ALL
SELECT
  'threat_level_enum type',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'threat_level_enum'
  ) THEN 'EXISTS OK' ELSE '!! MISSING - FIX NEEDED' END
UNION ALL
SELECT
  'RLS policy count (' || COUNT(*)::text || ') — expect 6',
  CASE WHEN COUNT(*) = 6 THEN 'OK' ELSE '!! WRONG COUNT - re-run schema' END
FROM pg_policies WHERE tablename = 'threat_telemetry'
UNION ALL
SELECT
  'threat_stats view',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'threat_stats'
  ) THEN 'EXISTS OK' ELSE '!! MISSING' END;
