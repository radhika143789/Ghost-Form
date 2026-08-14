import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ChevronLeft, ChevronRight } from 'lucide-react'

function RiskBadge({ count }) {
  if (count > 50) return <span className="badge badge-red">Critical</span>
  if (count > 10) return <span className="badge badge-yellow">Elevated</span>
  return <span className="badge badge-green">Low</span>
}

export default function UserTable() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 10

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      const { data: telemetry, error } = await supabase
        .from('threat_telemetry')
        .select('domain_flagged, threat_level, created_at')

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      const domainMap = {}
      telemetry.forEach(row => {
        const domain = row.domain_flagged
        if (!domain) return
        if (!domainMap[domain]) {
          domainMap[domain] = { domain, totalDetections: 0, lastSeen: row.created_at }
        }
        domainMap[domain].totalDetections++
        if (new Date(row.created_at) > new Date(domainMap[domain].lastSeen)) {
          domainMap[domain].lastSeen = row.created_at
        }
      })

      const sortedData = Object.values(domainMap)
        .sort((a, b) => b.totalDetections - a.totalDetections)
        .slice(0, 20) // Top 20

      setData(sortedData)
      setLoading(false)
    }

    fetchData()
  }, [])

  const currentRows = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const hasNext = (page + 1) * PAGE_SIZE < data.length
  const hasPrev = page > 0

  return (
    <div className="card-glass rounded-2xl overflow-hidden mt-8">
      <div className="flex items-center justify-between px-6 py-4 border-b border-ghost-border">
        <h2 className="text-base font-semibold text-white">Top Threat Domains</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Total Detections</th>
              <th>Last Seen</th>
              <th>Risk Level</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={4} className="px-5 py-4">
                    <div className="h-4 bg-ghost-border rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : currentRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-16 text-slate-600">
                  No domain data yet
                </td>
              </tr>
            ) : (
              currentRows.map((row, i) => (
                <tr key={i}>
                  <td className="font-mono">{row.domain}</td>
                  <td>{row.totalDetections}</td>
                  <td className="font-mono text-xs">{new Date(row.lastSeen).toLocaleDateString()}</td>
                  <td><RiskBadge count={row.totalDetections} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-ghost-border">
        <button
          onClick={() => setPage(p => p - 1)}
          disabled={!hasPrev || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400 border border-ghost-border hover:text-white disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <span className="text-xs text-slate-500 font-mono">Page {page + 1}</span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={!hasNext || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400 border border-ghost-border hover:text-white disabled:opacity-30">
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
