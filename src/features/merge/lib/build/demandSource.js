// WHERE A SEGMENT'S DR DEMAND COMES FROM (economist, 26 Nov 2026). Every feature is switched between two kinds:
//   - FROM LEVELS: "the effort is driven from the BW, each segment get a BW dr multiplier. its a multiplier that we
//     give on each brut win for the player, that means that the EV of a BW will give 2.5 DRs. so the total effort
//     will be BW*multiplier". Each segment's demand = its effort in Brut Wins x its DR per Brut Win - the multiplier
//     typed in the feature, per segment ("In each feature"); calculated, never typed ("Calculated, read-only").
//   - FROM EVENTS: "from events do not get their effort from the BW, they get it from the economist for the base
//     segment". The base segment's demand is typed; every other segment's is the base's x the segment's multiplier
//     between segments - the same one that sizes its rewards ("Base x segment multiplier").
// Merge Mania is From events by default ("From events"). A project saved before the switch has none: each demand is
// as it was typed, until a kind is picked.
export const DEMAND_SOURCES = [
  { id: 'events', label: 'From events', hint: 'You type the base segment\'s DR demand; every other segment\'s is the base\'s times its multiplier.' },
  { id: 'levels', label: 'From levels', hint: 'Each segment\'s DR demand is its effort in Brut Wins times its DR per Brut Win.' },
]
export const DEFAULT_DEMAND_SOURCE = 'events'
export const demandSourceOf = (value) => (DEMAND_SOURCES.some((s) => s.id === value) ? value : null)

// rows: [{ demand, factor, effortBW, drPerBW }] in segment order, the base (Segment 1) first.
// Returns per row { demand, derived, problem }: `derived` - the demand is calculated, not typed; `demand` - what it
// is (null: none - the segment is not built); `problem` - why there is none, in words.
export function demandsBySource(source, rows, chase) {
  const kind = demandSourceOf(source)
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const check = (value, made) => {
    if (value == null) return { demand: null, derived: true, problem: made }
    const d = Math.round(value)
    if (d < 0) return { demand: null, derived: true, problem: 'It comes out below 0.' }
    if (d > chase) return { demand: null, derived: true, problem: `It comes out at ${d.toLocaleString()} DR, more than the ${chase.toLocaleString()} the chain is worth.` }
    return { demand: d, derived: true, problem: null }
  }
  return rows.map((row, i) => {
    if (kind === 'events') {
      if (i === 0) return { demand: num(row.demand), derived: false, problem: null }
      const base = num(rows[0]?.demand)
      const factor = num(row.factor) ?? 1
      return check(base == null ? null : base * factor, 'Type the base segment\'s DR demand.')
    }
    if (kind === 'levels') {
      const bw = num(row.effortBW)
      const rate = num(row.drPerBW)
      return check(bw == null || rate == null ? null : bw * rate, bw == null && rate == null ? 'Needs its effort in Brut Wins and its DR per Brut Win.' : bw == null ? 'Needs its effort in Brut Wins.' : 'Needs its DR per Brut Win.')
    }
    return { demand: num(row.demand), derived: false, problem: null }
  })
}
