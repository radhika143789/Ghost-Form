import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────
// Supabase client initialization
// Keys are read from admin-dashboard/.env.local
//
// Supabase key formats supported:
//   Legacy JWT:      eyJhbGci... (old format from Settings > API)
//   New format:      sb_publishable_... (new Supabase dashboard format)
//
// Both work with createClient — the key is sent as the `apikey` header.
// RLS policies on the DB control access, not key secrecy.
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Validate at module load time with a descriptive error in the console,
// but do NOT throw synchronously — that causes a 400 on main.jsx in Vite.
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error(
    '[Ghost Form] ❌ Missing Supabase environment variables.\n' +
    'Create admin-dashboard/.env.local with:\n' +
    '  VITE_SUPABASE_URL=https://czoleruusckauzjcmmml.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=sb_publishable_tNpP7lz1K5T5NtgnT0OqAw_THzXSU28'
  )
}

export const supabase = createClient(
  SUPABASE_URL  || 'https://czoleruusckauzjcmmml.supabase.co',
  SUPABASE_ANON || 'sb_publishable_tNpP7lz1K5T5NtgnT0OqAw_THzXSU28',
  {
    auth: {
      // Persist session in localStorage so the admin stays logged in
      // across page refreshes without re-entering credentials.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        // Identify requests from the admin dashboard in Supabase logs
        'x-client-info': 'ghost-form-admin-dashboard',
      },
    },
  }
)
