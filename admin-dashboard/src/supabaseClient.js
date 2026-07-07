import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────
// Replace these two values with your Supabase project details.
// Find them at: https://supabase.com/dashboard/project/YOUR_ID/settings/api
//
// SAFE TO COMMIT: The anon key is public-facing by design.
// Row Level Security (RLS) policies on the DB protect your data.
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error(
    '[Ghost Form] Missing Supabase environment variables.\n' +
    'Create an admin-dashboard/.env.local file with:\n' +
    '  VITE_SUPABASE_URL=https://your-project.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=your-anon-key'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)
