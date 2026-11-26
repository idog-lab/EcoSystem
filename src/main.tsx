import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import PlatformApp from './platform/shell/PlatformApp'
import { teamData } from './lib/teamData'

const root = createRoot(document.getElementById('root')!)

// Team data (lib/teamData.js): when this browser is connected, the team's newest files are brought in before any
// tool reads its data - at most 8 seconds; past that the app opens on what this browser holds and the sync goes on.
// A shared play or plan link (?s=, ?play, ?plan) is for players and opens at once.
const isPlayLink = /[?&](s|stage|plan)=|[?&]play(&|$)/.test(window.location.search)

async function start() {
  if (teamData.isConnected() && !isPlayLink) {
    root.render(
      <p style={{ fontFamily: 'system-ui, sans-serif', color: '#64748b', padding: '48px', textAlign: 'center' }}>Bringing in the team&apos;s data…</p>,
    )
    await Promise.race([teamData.sync(), new Promise((resolve) => setTimeout(resolve, 8000))])
  }
  root.render(
    <StrictMode>
      <PlatformApp />
    </StrictMode>,
  )
}
void start()
