import type { ComponentType } from 'react'
import type { ModuleKey } from './catalog'
import type { ModelEntry } from './types'

// Every page module, loaded only when its model is opened. Each model owns
// its page, layout and workflow; the platform only gives it this:
export type ModelPageProps = {
  model: ModelEntry
  /** Back to the home page (where the user came from, search and folder kept). */
  onHome: () => void
}

type PageModule = { default: ComponentType<ModelPageProps> }

export const MODEL_MODULES: Record<ModuleKey, () => Promise<PageModule>> = {
  'merge-mania': () => import('../../models/mergeMania/MergeManiaPage'),
  'diamond-mine': () => import('../../features/diamondMine/components/DiamondMineApp.jsx'),
  chef: () => import('../../features/chef/components/ChefApp.jsx'),
  economy: () => import('../../features/economy/EconomyApp.jsx'),
  'not-migrated': () => import('../../models/notMigrated/NotMigratedPage'),
}
