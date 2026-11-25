import { ChefHat, Coins, Gauge, Gem, Layers, Puzzle, Trophy, type LucideIcon } from 'lucide-react'
import type { IconKey } from '../registry/types'

const ICONS: Record<IconKey, LucideIcon> = {
  layers: Layers,
  gem: Gem,
  'chef-hat': ChefHat,
  coins: Coins,
  gauge: Gauge,
  trophy: Trophy,
  puzzle: Puzzle,
}

export default function ModelIcon({ iconKey, size = 22 }: { iconKey: IconKey; size?: number }) {
  const Icon = ICONS[iconKey]
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />
}
