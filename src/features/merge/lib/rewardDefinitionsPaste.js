// Bulk entry for reward definitions: tab-separated rows pasted straight from
// Excel / Google Sheets, shared by the Rewards tab (every resource) and the
// Twister tab (Twister DR only).
//
// Row shape: Resource | Rank | Item syntax | Prize [| Asset ID] - resource by
// label ("Merge Energy", "Twister DR"), key ("energy", "twister") or short
// key ("dr-twister"), case-insensitive. With `fixedType`, the Resource column
// may be left out entirely (Rank | Item syntax | Prize [| Asset ID]).
//
// All-or-nothing: any invalid row is reported with its line number and
// NOTHING is applied, so a half-applied paste can never silently mix old and
// new definitions.
import { ALL_REWARD_TYPES, REWARD_TYPE_LABELS, REWARD_TYPE_SHORT_KEY, REWARD_MAX_RANK } from './rewardChain'

export function parseRewardDefinitionRows(text, rewardChainConfig, { allowedTypes = ALL_REWARD_TYPES, fixedType = null } = {}) {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return { ok: false, messages: ['Nothing to paste - copy rows from your sheet first.'] }

  const nameToType = {}
  for (const type of ALL_REWARD_TYPES) {
    nameToType[type] = type
    nameToType[REWARD_TYPE_LABELS[type].toLowerCase()] = type
    nameToType[REWARD_TYPE_SHORT_KEY[type]] = type
  }
  const errors = []
  const updates = []
  lines.forEach((line, i) => {
    let cells = line.split('\t').map((c) => c.trim())
    if (cells.length === 1) cells = line.split(/\s{2,}/).map((c) => c.trim()) // tolerate a copy that used runs of spaces
    if (/^(resource|rank)$/i.test(cells[0] ?? '')) return // header row - skip silently
    let type = nameToType[(cells[0] ?? '').toLowerCase()]
    if (fixedType && !type) {
      // No resource column: the row starts at Rank.
      type = fixedType
      cells = [fixedType, ...cells]
    }
    const [resRaw, rankRaw, syntax = '', prizeRaw = '', asset] = cells
    if (!type || !allowedTypes.includes(type)) {
      errors.push(`Line ${i + 1}: unknown resource "${resRaw}" (use ${allowedTypes.map((t) => REWARD_TYPE_LABELS[t]).join(' / ')}).`)
      return
    }
    const rank = Number(rankRaw)
    if (!Number.isInteger(rank) || rank < 1 || rank > REWARD_MAX_RANK) {
      errors.push(`Line ${i + 1}: rank "${rankRaw}" must be a whole number 1-${REWARD_MAX_RANK}.`)
      return
    }
    const prize = Number(prizeRaw)
    if (prizeRaw === '' || !Number.isFinite(prize) || prize < 0) {
      errors.push(`Line ${i + 1}: value "${prizeRaw}" must be a non-negative number.`)
      return
    }
    updates.push({ type, rank, syntax, prize, asset })
  })
  if (errors.length > 0) return { ok: false, messages: errors }
  if (updates.length === 0) return { ok: false, messages: ['No data rows found (only a header?).'] }

  const next = JSON.parse(JSON.stringify(rewardChainConfig))
  for (const u of updates) {
    next[u.type][u.rank - 1] = {
      ...next[u.type][u.rank - 1],
      syntax: u.syntax,
      prizeAmount: u.prize,
      ...(u.asset != null && u.asset !== '' ? { asset: u.asset } : {}),
    }
  }
  return { ok: true, rewardChainConfig: next, messages: [`Applied ${updates.length} row${updates.length === 1 ? '' : 's'}.`] }
}
