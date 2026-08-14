import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

export default function ThreatChart() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      
      const { data: telemetry, error } = await supabase
        .from('threat_telemetry')
        .select('created_at, threat_level')
        .gte('created_at', thirtyDaysAgo.toISOString())
      
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      const grouped = telemetry.reduce((acc, curr) => {
        const date = new Date(curr.created_at).toISOString().split('T')[0]
        if (!acc[date]) {
          acc[date] = { date, Red: 0, Yellow: 0 }
        }
        if (curr.threat_level === 'Red') acc[date].Red++
        if (curr.threat_level === 'Yellow') acc[date].Yellow++
        return acc
      }, {})

      const sortedData = Object.values(grouped).sort((a, b) => new Date(a.date) - new Date(b.date))
      setData(sortedData)
      setLoading(false)
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="card-glass rounded-2xl p-6">
        <h2 className="text-base font-semibold text-white mb-4">Threat Trend (30 Days)</h2>
        <div className="h-[300px] flex items-center justify-center">
          <div className="h-full w-full bg-ghost-border rounded-lg animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="card-glass rounded-2xl p-6">
      <h2 className="text-base font-semibold text-white mb-4">Threat Trend (30 Days)</h2>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!error && data.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center">
          <p className="text-slate-600 text-sm">No threat data yet</p>
        </div>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#16161f', borderColor: 'rgba(255,255,255,0.06)', borderRadius: '0.75rem' }}
                itemStyle={{ color: '#f1f5f9' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
              <Line type="monotone" dataKey="Red" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="Yellow" stroke="#fbbf24" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
