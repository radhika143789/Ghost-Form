import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { Shield, Mail, Lock, AlertCircle, Loader2 } from 'lucide-react'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // Normalize Supabase error messages into user-friendly copy
      if (error.message.includes('Invalid login')) {
        setError('Incorrect email or password. Please try again.')
      } else if (error.message.includes('Email not confirmed')) {
        setError('Please verify your email address before logging in.')
      } else {
        setError(error.message)
      }
    }
    // On success, App.jsx's onAuthStateChange listener handles the redirect
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-ghost-black flex items-center justify-center p-4"
         style={{
           backgroundImage: `
             linear-gradient(rgba(0,255,136,0.03) 1px, transparent 1px),
             linear-gradient(90deg, rgba(0,255,136,0.03) 1px, transparent 1px)
           `,
           backgroundSize: '60px 60px',
         }}>

      {/* Radial glow */}
      <div className="absolute inset-0 pointer-events-none"
           style={{ background: 'radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0,255,136,0.06) 0%, transparent 70%)' }} />

      <div className="relative w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
               style={{ background: 'linear-gradient(135deg, #00ff88, #00ccaa)' }}>
            <Shield className="w-7 h-7 text-ghost-black" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-white">Ghost Form</h1>
          <p className="text-slate-500 text-sm mt-1">Admin Dashboard</p>
        </div>

        {/* Card */}
        <div className="card-glass rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-white mb-6">Sign in to continue</h2>

          <form onSubmit={handleLogin} className="space-y-5">

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-3 bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-400 mb-2">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@ghostform.dev"
                  className="w-full bg-ghost-black border border-ghost-border rounded-xl pl-10 pr-4 py-3
                             text-white placeholder-slate-600 text-sm
                             focus:outline-none focus:border-neon-green focus:ring-1 focus:ring-neon-green/30
                             transition-colors duration-200"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-400 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full bg-ghost-black border border-ghost-border rounded-xl pl-10 pr-4 py-3
                             text-white placeholder-slate-600 text-sm
                             focus:outline-none focus:border-neon-green focus:ring-1 focus:ring-neon-green/30
                             transition-colors duration-200"
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-ghost-black text-sm
                         flex items-center justify-center gap-2
                         disabled:opacity-60 disabled:cursor-not-allowed
                         transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: loading ? '#00cc6a' : 'linear-gradient(135deg, #00ff88, #00ccaa)' }}>
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
              ) : (
                <>Sign In</>
              )}
            </button>

          </form>
        </div>

        {/* Footer note */}
        <p className="text-center text-slate-600 text-xs mt-6">
          Access restricted to authorized administrators only.
        </p>
      </div>
    </div>
  )
}
