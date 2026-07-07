import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { Save, User, Key, CheckCircle, AlertCircle } from 'lucide-react'

export default function SettingsPanel() {
  const [user,    setUser]    = useState(null)
  const [saved,   setSaved]   = useState(false)
  const [loading, setLoading] = useState(false)
  // High #4: Replace both alert() calls with an inline error state.
  // alert() blocks the browser event loop, breaks dark-mode UX, and
  // is especially jarring inside a polished admin dashboard.
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null))
  }, [])

  async function handlePasswordChange(e) {
    e.preventDefault()
    setFormError(null) // clear previous errors on each attempt

    const newPassword = e.target.password.value

    // HTML5 minLength already enforces this visually, but we guard here too
    // so the server is never called with a trivially short password.
    if (newPassword.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)

    if (error) {
      // Normalize common Supabase auth error messages into user-friendly copy
      if (error.message.toLowerCase().includes('same password')) {
        setFormError('New password must be different from your current password.')
      } else {
        setFormError(error.message)
      }
    } else {
      setSaved(true)
      setFormError(null)
      e.target.reset()
      setTimeout(() => setSaved(false), 3000)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your admin account</p>
      </div>

      {/* Account Info */}
      <div className="card-glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-ghost-border">
          <User className="w-4 h-4 text-neon-green" />
          <h2 className="text-base font-semibold text-white">Account</h2>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1 font-mono uppercase tracking-wider">Admin Email</label>
          <p className="text-white font-mono text-sm">{user?.email ?? '...'}</p>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1 font-mono uppercase tracking-wider">Last Sign In</label>
          <p className="text-slate-400 text-sm font-mono">
            {user?.last_sign_in_at
              ? new Date(user.last_sign_in_at).toLocaleString()
              : '—'}
          </p>
        </div>
      </div>

      {/* Change Password */}
      <div className="card-glass rounded-2xl p-6">
        <div className="flex items-center gap-3 pb-4 border-b border-ghost-border mb-5">
          <Key className="w-4 h-4 text-neon-green" />
          <h2 className="text-base font-semibold text-white">Change Password</h2>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">New Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="Minimum 8 characters"
              className="w-full bg-ghost-black border border-ghost-border rounded-xl px-4 py-3
                         text-white placeholder-slate-600 text-sm
                         focus:outline-none focus:border-neon-green focus:ring-1 focus:ring-neon-green/30
                         transition-colors duration-200"
            />
          </div>

          {/* Inline error — replaces both alert() calls (High #4) */}
          {formError && (
            <div className="flex items-start gap-2.5 bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-red-400 text-sm leading-snug">{formError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-ghost-black
                       disabled:opacity-60 transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #00ff88, #00ccaa)' }}>
            {saved
              ? <><CheckCircle className="w-4 h-4" /> Saved!</>
              : <><Save className="w-4 h-4" /> {loading ? 'Saving...' : 'Update Password'}</>
            }
          </button>
        </form>
      </div>
    </div>
  )
}
