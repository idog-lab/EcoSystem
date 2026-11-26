import { Candy, Castle, ChefHat, Coins, Disc3, FerrisWheel, Flag, Footprints, Gauge, Gem, Image, Layers, Map as MapIcon, MoonStar, Package, PawPrint, Puzzle, ShoppingBasket, Tornado, TrainTrack, Trophy, WandSparkles, Zap, type LucideIcon } from 'lucide-react'
import type { IconKey } from '../registry/types'

const ICONS: Record<IconKey, LucideIcon> = {
  layers: Layers,
  gem: Gem,
  'chef-hat': ChefHat,
  coins: Coins,
  gauge: Gauge,
  trophy: Trophy,
  puzzle: Puzzle,
  footprints: Footprints,
  flag: Flag,
  'paw-print': PawPrint,
  'wand-sparkles': WandSparkles,
  'moon-star': MoonStar,
  package: Package,
  tornado: Tornado,
  'ferris-wheel': FerrisWheel,
  'shopping-basket': ShoppingBasket,
  zap: Zap,
  'disc-3': Disc3,
  'train-track': TrainTrack,
  map: MapIcon,
  castle: Castle,
  candy: Candy,
  image: Image,
}

export default function ModelIcon({ iconKey, size = 22 }: { iconKey: IconKey; size?: number }) {
  const Icon = ICONS[iconKey]
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />
}
