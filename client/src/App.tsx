import { useState, useEffect, useCallback } from 'react'

interface MountStatus {
  path: string
  listeners: number
  listenerPeak: number
  sourceType: string
  sourceUrl: string | null
  title: string
  name: string
  genre: string
  bitrate: number
}

function App() {
  const [mounts, setMounts] = useState<MountStatus[]>([])
  const [relayUrl, setRelayUrl] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [authenticated, setAuthenticated] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/admin/status')
      const data = await res.json()
      setMounts(data.mounts)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const switchSource = async (type: 'relay' | 'playlist', url?: string) => {
    if (!authenticated) {
      setMessage('Admin password required')
      return
    }
    try {
      const body: Record<string, string> = { type, mount: '/stream' }
      if (url) body.url = url

      const res = await fetch('/admin/source', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa('admin:' + password),
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        setMessage(`Source switched to ${data.source}${data.url ? ': ' + data.url : ''}`)
      } else {
        setMessage(`Error: ${data.error}`)
      }
      fetchStatus()
    } catch {
      setMessage('Request failed')
    }
  }

  const mount = mounts[0]

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 600, margin: '40px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 24 }}>s-stream Admin</h1>

      {mount ? (
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 20, marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>{mount.name} ({mount.path})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 14 }}>
            <div>Source: <strong>{mount.sourceType}</strong></div>
            <div>Bitrate: <strong>{mount.bitrate} kbps</strong></div>
            <div>Listeners: <strong>{mount.listeners}</strong> (peak: {mount.listenerPeak})</div>
            <div>Genre: <strong>{mount.genre}</strong></div>
          </div>
          {mount.title && (
            <div style={{ marginTop: 12, fontSize: 14 }}>
              Now Playing: <strong>{mount.title}</strong>
            </div>
          )}
          {mount.sourceUrl && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#666', wordBreak: 'break-all' }}>
              Relay: {mount.sourceUrl}
            </div>
          )}
        </div>
      ) : (
        <p>Loading...</p>
      )}

      {!authenticated ? (
        <div style={{ background: '#fff3cd', borderRadius: 8, padding: 20, marginBottom: 20 }}>
          <label style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>Admin Password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="password"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc' }}
              onKeyDown={e => e.key === 'Enter' && setAuthenticated(true)}
            />
            <button
              onClick={() => setAuthenticated(true)}
              style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: '#333', color: '#fff', cursor: 'pointer' }}
            >
              Login
            </button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#f0f0f0', borderRadius: 8, padding: 20, marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, margin: '0 0 12px' }}>Switch Source</h3>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>Relay URL</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                value={relayUrl}
                onChange={e => setRelayUrl(e.target.value)}
                placeholder="https://example.com/stream"
                style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: '1px solid #ccc' }}
              />
              <button
                onClick={() => relayUrl && switchSource('relay', relayUrl)}
                disabled={!relayUrl}
                style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: '#0066cc', color: '#fff', cursor: 'pointer', opacity: relayUrl ? 1 : 0.5 }}
              >
                Relay
              </button>
            </div>
          </div>

          <button
            onClick={() => switchSource('playlist')}
            style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}
          >
            Playlist に戻す
          </button>
        </div>
      )}

      {message && (
        <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 12, fontSize: 14 }}>
          {message}
        </div>
      )}
    </div>
  )
}

export default App
