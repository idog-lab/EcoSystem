import { Burst } from './Celebrations'

// A burst anchored inside a `relative` box (the rank track's node, when a
// reward rank is reached). The play boards' own merge celebrations are drawn
// by PlayEffects.jsx, which knows when a sliding item has arrived.
export default function MergeCelebration({ tier, color = '#f59e0b', size = 28 }) {
  return (
    <div className="absolute left-1/2 top-1/2 pointer-events-none z-20">
      <Burst tier={tier} color={color} size={size} />
    </div>
  )
}
