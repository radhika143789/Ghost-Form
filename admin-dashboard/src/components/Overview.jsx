import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ShieldAlert, ShieldX, ShieldCheck, RefreshCw } from 'lucide-react'
import ThreatTable from './ThreatTable'

// ─────────────────────────────────────────────────────────────
// StatsCard — individual summary card
// ─────────────────────────────────────────────────────────────
function StatsCard({ icon: Icon, label, value, color, loading }) {
  const colorMap = {
    green:  { bg: 'bg-neon-green/10', border: 'border-neon-green/20', icon: 'text-neon-green' },
    red:    { bg: 'bg-red-500/10',    border: 'border-red-500/20',    icon: 'text-red-400'    },
    yellow: { bg: 'bg-yellow-400/10', border: 'border-yellow-400/20', icon: 'text-yellow-400' },
  }
  const c = colorMap[color] ?? colorMap.green

  return (
    <div className={`card-glass rounded-2xl p-6 border ${c.border} ${c.bg} transition-all duration-300 hover:scale-[1.02]`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-slate-400 text-sm font-medium">{label}</span>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.bg} border ${c.border}`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
      {loading ? (
        <div className="h-9 w-20 bg-ghost-border rounded-lg animate-pulse" />
      ) : (
        <p className="text-4xl font-black text-white tracking-tight">{value ?? 0}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Overview — main content panel
// ─────────────────────────────────────────────────────────────
export default function Overview() {
  const [rows,       setRows]       = useState([])
  const [totalCount, setTotalCount] = useState(null)  // Fix #12: true total from DB count query
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [page,       setPage]       = useState(0)
  const PAGE_SIZE = 20

  async function fetchData(currentPage = 0, signal) {
    setLoading(true)
    setError(null)

    const from = currentPage * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    // Fix #17: Check for abort before setting state
    if (signal?.aborted) return;

    // Fix #12: Fetch the true total count alongside the page rows
    const [pageResult, countResult] = await Promise.all([
      supabase
        .from('threat_telemetry')
        .select('id, created_at, domain_flagged, threat_level, detection_method')
        .order('created_at', { ascending: false })
        .range(from, to),
      supabase
        .from('threat_telemetry')
        .select('*', { count: 'exact', head: true }),
    ])

    if (signal?.aborted) return; // Fix #17: Component may have unmounted while awaiting

    if (pageResult.error) {
      setError(pageResult.error.message)
    } else {
      setRows(pageResult.data ?? [])
      setTotalCount(countResult.count ?? 0)
    }
    setLoading(false)
  }

  useEffect(() => {
    // Fix #17: AbortController so in-flight fetch is cancelled on unmount
    const controller = new AbortController()
    fetchData(page, controller.signal)

    // Subscribe to real-time inserts so the table updates live
    const channel = supabase
      .channel('telemetry-live')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'threat_telemetry' },
        (payload) => {
          // Prepend the new row only on the first page
          if (page === 0) {
            setRows(prev => [payload.new, ...prev].slice(0, PAGE_SIZE))
            // Also bump the total count on new inserts
            setTotalCount(prev => (prev ?? 0) + 1)
          }
        }
      )
      .subscribe()

    return () => {
      controller.abort()
      supabase.removeChannel(channel)
    }
  }, [page])

  // Derived stats from the loaded page rows (Red/Yellow from current page)
  const red    = rows.filter(r => r.threat_level === 'Red').length
  const yellow = rows.filter(r => r.threat_level === 'Yellow').length

  return (
    <div className="space-y-8 max-w-7xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Threat Overview</h1>
          <p className="text-slate-500 text-sm mt-1">
            Real-time phishing telemetry from Ghost Form users
          </p>
        </div>
        <button
          onClick={() => fetchData(page)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                     text-slate-400 border border-ghost-border hover:text-white hover:border-neon-green/40
                     transition-all duration-200 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatsCard
          icon={ShieldCheck}
          label="Total Threats Blocked"
          value={totalCount}
          color="green"
          loading={loading}
        />
        <StatsCard
          icon={ShieldX}
          label="Red Threats (High Risk)"
          value={red}
          color="red"
          loading={loading}
        />
        <StatsCard
          icon={ShieldAlert}
          label="Yellow Threats (Suspicious)"
          value={yellow}
          color="yellow"
          loading={loading}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 bg-red-900/20 border border-red-500/30 rounded-xl px-5 py-4">
          <ShieldX className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Data Table */}
      <ThreatTable rows={rows} loading={loading} page={page} setPage={setPage} PAGE_SIZE={PAGE_SIZE} />
    </div>
  )
}
