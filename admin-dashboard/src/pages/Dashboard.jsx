import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Settings, LogOut, Shield,
  Menu, X, ChevronRight
} from 'lucide-react'
import { supabase } from '../supabaseClient'
import Overview from '../components/Overview'
import SettingsPanel from '../components/SettingsPanel'

const NAV_ITEMS = [
  { to: '/dashboard',          label: 'Overview',  Icon: LayoutDashboard, end: true },
  { to: '/dashboard/settings', label: 'Settings',  Icon: Settings },
]

function Sidebar({ onClose }) {
  const navigate   = useNavigate()
  const [loading, setLoading] = useState(false)

  async function handleLogout() {
    setLoading(true)
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="flex flex-col h-full bg-ghost-slate border-r border-ghost-border w-64 shrink-0">

      {/* Logo */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-ghost-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-ghost-black"
               style={{ background: 'linear-gradient(135deg, #00ff88, #00ccaa)' }}>
            GF
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">Ghost Form</p>
            <p className="text-xs text-slate-500 mt-0.5">Admin Panel</p>
          </div>
        </div>
        {/* Mobile close button */}
        {onClose && (
          <button onClick={onClose} className="md:hidden text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group
               ${isActive
                 ? 'bg-neon-green/10 text-neon-green border border-neon-green/20'
                 : 'text-slate-400 hover:bg-ghost-card hover:text-white'
               }`
            }>
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 ${isActive ? 'text-neon-green' : 'text-slate-500 group-hover:text-slate-300'}`} />
                {label}
                {isActive && <ChevronRight className="w-3 h-3 ml-auto text-neon-green" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-ghost-border">
        <button
          onClick={handleLogout}
          disabled={loading}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-medium
                     text-slate-400 hover:bg-red-900/20 hover:text-red-400 hover:border-red-500/20
                     border border-transparent transition-all duration-150">
          <LogOut className="w-4 h-4" />
          {loading ? 'Signing out...' : 'Log Out'}
        </button>
      </div>
    </aside>
  )
}

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on large screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-ghost-black">

      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)} />
          <div className="relative h-full">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Top Navbar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-ghost-border bg-ghost-slate/50">
          {/* Mobile hamburger */}
          <button
            className="md:hidden text-slate-400 hover:text-white"
            onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-green" />
            <span className="text-sm text-slate-400 font-medium">Ghost Form Dashboard</span>
          </div>

          {/* Live status indicator */}
          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
            Live
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="settings" element={<SettingsPanel />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
