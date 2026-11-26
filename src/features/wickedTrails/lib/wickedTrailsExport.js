// THE WICKED TRAILS EXPORT, in the layout of the economist's example `t_Promo_st_WickedTrail_n_WickedTrail_d_20261116.xlsx`
// (in the project folder, not in the repository): three sheets - "segments" (Key, Definition), "Congif OPS" and
// "Config RC OPS" (names and headers transcribed literally, the parser reads them) - one row per segment. Asked:
//   - "the RC is another output the model should give. in a from level event, the effort of all tiers are 50% more
//     and the coins in the GP are 40% more": RC = every tier's requirement x 1.5, the Final Prize's coins x 1.4;
//   - "each tier should have a specific trigger in its prize. u can create any one that is good for u with good
//     naming for the feature and the tier": wicked_trails_silver_tier<n>, wicked_trails_gold_tier<n>,
//     wicked_trails_grand_prize (this app's own names, on the economist's word);
//   - the last tier of each lane is always in its chest ("Always, last tier"): chest:silver on the silver lane,
//     chest:golden on the gold lane, the trigger inside it;
//   - $_Script->FinalPrize_Res_Filter is always "chest|coins".
// From the example as it is: Right = the silver lane, Left = the gold lane; a tier's Req is the DR in all to the end
// of it (it grows tier by tier); the end trigger is trigger:wicked_trail_end; a milestone with no tier is Req 100 and
// Res [dynamic(dr-hidden:1)]; Segment is the segment's key (def_...), the segments sheet its name and condition.
import { formatReward, parseReward } from '../../../lib/economy/parse'
import { LANES, MAX_TIERS, placeKey, prizeOf, workOut } from './wickedTrails'

export const SHEET_NAMES = { segments: 'segments', ops: 'Congif OPS', rc: 'Config RC OPS' }
export const RC_TIER_EFFORT = 1.5
export const RC_FINAL_COINS = 1.4
export const END_TRIGGER = 'trigger:wicked_trail_end'
export const FINAL_FILTER = 'chest|coins'
export const UNUSED = { req: 100, res: '[dynamic(dr-hidden:1)]' }
// Right is the silver (easy) lane, Left the gold (hard) lane, as in the example.
const SIDE = { easy: 'Right', hard: 'Left' }
const CHEST = { easy: 'silver', hard: 'golden' }
export const triggerOf = (laneId, i) => `wicked_trails_${laneId === 'easy' ? 'silver' : 'gold'}_tier${i + 1}`
export const FINAL_TRIGGER = 'wicked_trails_grand_prize'

const side = (s) => [
  `$_Script->${s}_IsResource`,
  `$_Script->MilestoneNum_${s}`,
  ...Array.from({ length: MAX_TIERS }, (_, i) => `$_Script->${s}Milestone_${i}_Req`),
  ...Array.from({ length: MAX_TIERS }, (_, i) => `$_Script->${s}Milestone_${i}_Res`),
]
export const OPS_HEADERS = [
  'Segment',
  '$_Script->DR_Right',
  '$_Script->DR_Left',
  '$_Script->endTrigger',
  '$_Script->FinalPrize_Res',
  '$_Script->FinalPrize_Res_Filter',
  ...side('Left'),
  ...side('Right'),
]

const round2 = (x) => Math.round(x * 100) / 100
// The coins of a prize times `factor` (2 decimals); everything else as it is.
export function scaleCoins(text, factor) {
  const { node } = parseReward(String(text ?? ''))
  if (!node) return text
  const walk = (n) => {
    if (n.type === 'all') return { ...n, parts: n.parts.map(walk) }
    if (n.type === 'first') return { ...n, options: n.options.map(walk) }
    if (n.type === 'chest') return { ...n, inner: walk(n.inner) }
    if (n.type === 'allowance' && Number.isFinite(Number(n.coins))) return { ...n, coins: String(round2(Number(n.coins) * factor)) }
    return n
  }
  return formatReward(walk(node))
}

// A milestone's reward: its trigger, then the prize; in a chest when asked (a prize typed as a chest keeps its own).
export function milestoneRes(trigger, prize, chest = null) {
  const text = String(prize ?? '').trim()
  const { node } = text ? parseReward(text) : { node: null }
  if (node?.type === 'chest') return `chest:${node.name}(trigger:${trigger}+${formatReward(node.inner)})`
  const inner = `trigger:${trigger}${text ? `+${text}` : ''}`
  return chest ? `chest:${chest}(${inner})` : inner
}

// Every row of the three sheets, and what is missing: { segments: [[key, definition]], ops: [[...]], rc: [[...]],
// problems: [text] }. A segment that cannot be worked out is left out and named.
export function buildExport(state) {
  const problems = []
  const segments = []
  const ops = []
  const rc = []
  state.segments.forEach((seg, index) => {
    const w = workOut(state, seg)
    if (!w.lanes) {
      problems.push(`${seg.name}: left out - ${w.problems.join(' ')}`)
      return
    }
    const finalPrize = prizeOf(state, index, 'final').text
    if (!finalPrize) problems.push(`${seg.name}: the Final Prize has no prize.`)
    const row = (rcRun) => {
      const out = {
        Segment: seg.key || `def_${seg.name}`,
        '$_Script->DR_Right': LANES.find((l) => l.id === 'easy').currency,
        '$_Script->DR_Left': LANES.find((l) => l.id === 'hard').currency,
        '$_Script->endTrigger': END_TRIGGER,
        '$_Script->FinalPrize_Res': milestoneRes(FINAL_TRIGGER, rcRun ? scaleCoins(finalPrize, RC_FINAL_COINS) : finalPrize),
        '$_Script->FinalPrize_Res_Filter': FINAL_FILTER,
      }
      for (const lane of LANES) {
        const s = SIDE[lane.id]
        const tiers = w.lanes[lane.id].tiers
        out[`$_Script->${s}_IsResource`] = true
        out[`$_Script->MilestoneNum_${s}`] = tiers.length
        for (let i = 0; i < MAX_TIERS; i += 1) {
          const t = tiers[i]
          out[`$_Script->${s}Milestone_${i}_Req`] = t ? Math.round(t.drTotal * (rcRun ? RC_TIER_EFFORT : 1)) : UNUSED.req
          out[`$_Script->${s}Milestone_${i}_Res`] = t ? milestoneRes(triggerOf(lane.id, i), prizeOf(state, index, placeKey(lane.id, i)).text, i === tiers.length - 1 ? CHEST[lane.id] : null) : UNUSED.res
        }
      }
      return OPS_HEADERS.map((h) => out[h])
    }
    for (const lane of LANES) {
      const missing = w.lanes[lane.id].tiers.map((_, i) => i).filter((i) => !prizeOf(state, index, placeKey(lane.id, i)).text)
      if (missing.length) problems.push(`${seg.name}: ${lane.label}, tier ${missing.map((i) => i + 1).join(', ')} - no prize.`)
    }
    segments.push([String(seg.key || seg.name).replace(/^def_/, ''), seg.condition])
    ops.push(row(false))
    rc.push(row(true))
  })
  return { segments, ops, rc, problems }
}

// ONE ROW OF THE SHEET AS OPS GETS IT (economist, 26 Nov 2026: "we will see under the events table a live syntax of
// the row we are on"): for a tier, its Req and Res columns in Config OPS and Config RC OPS; for the Final Prize, its
// Res. The same builders the export uses, so what is shown is what is written.
// { title, cells: [{ column, ops, rc }] } or null when the place is not in the sheet.
export function rowSyntax(state, index, place) {
  const seg = state.segments[index]
  if (!seg) return null
  const prize = prizeOf(state, index, place).text
  if (place === 'final') {
    return {
      title: 'The Final Prize',
      cells: [
        { column: '$_Script->FinalPrize_Res', ops: milestoneRes(FINAL_TRIGGER, prize), rc: milestoneRes(FINAL_TRIGGER, scaleCoins(prize, RC_FINAL_COINS)) },
        { column: '$_Script->FinalPrize_Res_Filter', ops: FINAL_FILTER, rc: FINAL_FILTER },
      ],
    }
  }
  const [laneId, at] = place.split('-')
  const i = Number(at)
  const lane = LANES.find((l) => l.id === laneId)
  const shares = state.lanes[laneId]?.shares ?? []
  if (!lane || i >= shares.length) return null
  const t = workOut(state, seg).lanes?.[laneId]?.tiers[i]
  const s = SIDE[laneId]
  const res = milestoneRes(triggerOf(laneId, i), prize, i === shares.length - 1 ? CHEST[laneId] : null)
  return {
    title: `${lane.label}, tier ${i + 1}`,
    cells: [
      { column: `$_Script->${s}Milestone_${i}_Req`, ops: t ? Math.round(t.drTotal) : null, rc: t ? Math.round(t.drTotal * RC_TIER_EFFORT) : null },
      { column: `$_Script->${s}Milestone_${i}_Res`, ops: res, rc: res },
    ],
  }
}

// The file's name, as the example's: t_Promo_st_WickedTrail_n_WickedTrail_d_<yyyymmdd>.xlsx (the event's first day).
export const exportFileName = (date) => `t_Promo_st_WickedTrail_n_WickedTrail_d_${String(date ?? '').replace(/-/g, '') || 'date'}.xlsx`

// The workbook (exceljs, loaded when asked), values only, no merged cells.
export async function exportWorkbook(state) {
  const { default: ExcelJS } = await import('exceljs')
  const data = buildExport(state)
  const wb = new ExcelJS.Workbook()
  const add = (name, header, rows) => {
    const ws = wb.addWorksheet(name)
    ws.addRow(header)
    rows.forEach((r) => ws.addRow(r))
    ws.getRow(1).font = { bold: true }
  }
  add(SHEET_NAMES.segments, ['Key', 'Definition'], data.segments)
  add(SHEET_NAMES.ops, OPS_HEADERS, data.ops)
  add(SHEET_NAMES.rc, OPS_HEADERS, data.rc)
  return { workbook: wb, data }
}
