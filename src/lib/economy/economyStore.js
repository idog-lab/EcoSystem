// Where the economy is kept: this browser (one copy for every feature), and
// in a file the Economy page downloads and loads. Merge Mania's backups and
// saved events carry it too (App.jsx backupPayload).
//
// The Economy page saves every change at once - it is the app's settings, not
// a project with a Save button.

import { useEffect, useState } from 'react'
import { createEconomy, normalizeEconomy } from './economyModel'
import { teamData } from '../teamData'

export const ECONOMY_STORAGE_KEY = 'superplay-economy'
const EVENT = 'superplay-economy-changed'

export function loadEconomy() {
  try {
    const raw = window.localStorage.getItem(ECONOMY_STORAGE_KEY)
    return raw ? normalizeEconomy(JSON.parse(raw)) : createEconomy()
  } catch {
    return createEconomy()
  }
}

// { ok, error }
export function saveEconomy(economy) {
  const next = { ...normalizeEconomy(economy), updatedAt: new Date().toISOString() }
  try {
    window.localStorage.setItem(ECONOMY_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(EVENT))
    // Shared with the team when connected (lib/teamData.js).
    teamData.changed(ECONOMY_STORAGE_KEY)
    return { ok: true, economy: next }
  } catch (e) {
    return { ok: false, error: e?.message ?? 'The browser did not keep it.' }
  }
}

// Was anything saved, or is this the starting economy?
export function hasSavedEconomy() {
  try {
    return !!window.localStorage.getItem(ECONOMY_STORAGE_KEY)
  } catch {
    return false
  }
}

// The economy, kept up to date when the Economy page changes it.
export function useEconomy() {
  const [economy, setEconomy] = useState(loadEconomy)
  useEffect(() => {
    const reload = () => setEconomy(loadEconomy())
    window.addEventListener(EVENT, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(EVENT, reload)
      window.removeEventListener('storage', reload)
    }
  }, [])
  return economy
}
