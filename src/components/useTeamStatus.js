import { useSyncExternalStore } from 'react'
import { teamData } from '../lib/teamData'

// The team data's status (lib/teamData.js), kept up to date on screen.
export const useTeamStatus = () => useSyncExternalStore(teamData.subscribe, teamData.status, teamData.status)
