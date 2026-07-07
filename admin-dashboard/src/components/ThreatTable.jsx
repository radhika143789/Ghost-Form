import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Threat Level Badge — color-coded pill for Red / Yellow
// ─────────────────────────────────────────────────────────────
function ThreatBadge({ level }) {
  if (level === 'Red') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
                       bg-red-500/15 text-red-400 border border-red-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Red — High Risk
      </span>
    )
  }
  if (level === 'Yellow') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
                       bg-yellow-400/15 text-yellow-400 border border-yellow-400/25">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        Yellow — Suspicious
      </span>
    )
  }
  // Medium #13: Neutral fallback for unexpected or null threat_level values.
  // Previously any non-Red value (including null) showed as Yellow which is misleading.
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
                     bg-slate-700/40 text-slate-400 border border-slate-600/40">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      {level ?? 'Unknown'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Detection Method Badge
// ─────────────────────────────────────────────────────────────
function MethodBadge({ method }) {
  const isML = method === 'ML_Model'
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono font-semibold
                      ${isML
                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/25'
                        : 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                      }`}>
      {isML ? '🧠 ML Model' : '🌐 API'}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Format ISO timestamp to readable local date + time
// ─────────────────────────────────────────────────────────────
// Fix #18: Use undefined locale to respect the browser/user's regional settings
// instead of hardcoding 'en-IN' which formats dates in Indian style for all users.
function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  })
}

// ─────────────────────────────────────────────────────────────
// Skeleton row for loading state
// ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ghost-border">
      {[1,2,3,4].map(i => (
        <td key={i} className="px-5 py-4">
          <div className="h-4 bg-ghost-border rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
        </td>
      ))}
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────
// ThreatTable — main data table component
// ─────────────────────────────────────────────────────────────
export default function ThreatTable({ rows, loading, page, setPage, PAGE_SIZE }) {
  const hasPrev = page > 0
  const hasNext = rows.length === PAGE_SIZE

  return (
    <div className="card-glass rounded-2xl overflow-hidden">

      {/* Table header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ghost-border">
        <div>
          <h2 className="text-base font-semibold text-white">Telemetry Log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Showing {rows.length} rows — Page {page + 1}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          <span className="text-xs text-slate-500 font-mono">Real-time</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ghost-border text-xs text-slate-500 uppercase tracking-wider">
              <th className="text-left px-5 py-3 font-semibold">Timestamp</th>
              <th className="text-left px-5 py-3 font-semibold">Domain Flagged</th>
              <th className="text-left px-5 py-3 font-semibold">Threat Level</th>
              <th className="text-left px-5 py-3 font-semibold">Detection</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-16 text-slate-600">
                  No threat telemetry recorded yet.
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr
                  key={row.id}
                  className="border-b border-ghost-border/50 hover:bg-white/[0.02] transition-colors duration-100">

                  {/* Timestamp */}
                  <td className="px-5 py-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(row.created_at)}
                  </td>

                  {/* Domain — Fix #13: Do NOT link directly to flagged phishing sites.
                      Direct links would: (a) alert the attacker they are being monitored,
                      (b) expose the admin's IP. Use VirusTotal for safe investigation. */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-200">
                        {row.domain_flagged}
                      </span>
                      <a
                        href={`https://www.virustotal.com/gui/domain/${encodeURIComponent(row.domain_flagged)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Investigate on VirusTotal (safe)"
                        className="text-slate-500 hover:text-neon-green transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </td>

                  {/* Threat Level Badge */}
                  <td className="px-5 py-4">
                    <ThreatBadge level={row.threat_level} />
                  </td>

                  {/* Detection Method */}
                  <td className="px-5 py-4">
                    <MethodBadge method={row.detection_method} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-ghost-border">
        <button
          onClick={() => setPage(p => p - 1)}
          disabled={!hasPrev || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400
                     border border-ghost-border hover:text-white hover:border-slate-600
                     disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150">
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
        <span className="text-xs text-slate-500 font-mono">Page {page + 1}</span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={!hasNext || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400
                     border border-ghost-border hover:text-white hover:border-slate-600
                     disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150">
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
