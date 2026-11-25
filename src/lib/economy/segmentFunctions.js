// THE FUNCTIONS SEGMENTS ARE MADE OF - the dictionary the app has been taught, kept in the project (like
// taught.js): each function the economist explained, with their words (`said`), the day (`on`) and who (`by`).
// Economist, 25 Nov 2026: "the next thing i want us to do is to learn the logic of as many functions as we can that
// with them we create segments"; "the BW and avg mode are very very important".
//
// A function is never invented: one that is not here is named by the reader as "not known to the app yet", never
// guessed at. What is not confirmed about a function is said in `open`.
//
// An entry: { name, label, returns, unit, args: [{ name, kind }], said, on, by, example, open? }
//   kind: 'days' (a whole number of days), 'weights' (the mode weights, 1m,2m,4m,8m), 'eventId' (an event's id,
//   digits written with U: 57634U).

const RULES = 'Economy Rules & Reward Syntax (given in chat), section 4'
const PROGRESSION_SAID = 'those fucntions return the progression in % of the user. and example can be fn_DiamondMine_Progression(57634U) > 95 - as for the segment will check if the user progression is bigger than 95%. the only thing important is the event Id which is the ####'

export const SEGMENT_FUNCTIONS = [
  {
    name: 'fn_DailyBrutWins_m4',
    label: 'Daily Brut Wins',
    returns: "the player's daily average of Brut Wins over the last given days",
    unit: 'Brut Wins a day',
    args: [{ name: 'days', kind: 'days' }, ...['1m', '2m', '4m', '8m'].map((w) => ({ name: w, kind: 'weights' }))],
    said: `${RULES}: Weighted Brut Wins = (fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m); "the BW and avg mode are very very important"`,
    on: '2026-11-24',
    by: 'economist',
    example: '(fn_DailyBrutWins_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyBrutWins_m4(14,1m,2m,4m,8m)*0.3m) > 9',
    open: 'What 1m,2m,4m,8m stand for (the game modes x1, x2, x4, x8?) is not confirmed.',
  },
  {
    name: 'fn_DailyAvgModeMultiplier_m4',
    label: 'Average mode multiplier',
    returns: "the player's average game-mode multiplier over the last given days",
    unit: 'x',
    args: [{ name: 'days', kind: 'days' }, ...['1m', '2m', '4m', '8m'].map((w) => ({ name: w, kind: 'weights' }))],
    said: `${RULES}: the mode version uses fn_DailyAvgModeMultiplier_m4, && (MODE < 3m) / && (MODE >= 3m); "the BW and avg mode are very very important"`,
    on: '2026-11-24',
    by: 'economist',
    example: '(fn_DailyAvgModeMultiplier_m4(3,1m,2m,4m,8m)*0.7m+fn_DailyAvgModeMultiplier_m4(14,1m,2m,4m,8m)*0.3m) < 3m',
    open: 'What 1m,2m,4m,8m stand for is not confirmed.',
  },
  {
    name: 'fn_DiamondMine_Progression',
    label: 'Diamond Mine progression',
    returns: "the player's progression in that Diamond Mine event",
    unit: '%',
    args: [{ name: 'event id', kind: 'eventId' }],
    said: PROGRESSION_SAID,
    on: '2026-11-25',
    by: 'economist',
    example: 'fn_DiamondMine_Progression(57634U) > 95',
  },
  {
    name: 'fn_Merge_Progression',
    label: 'Merge progression',
    returns: "the player's progression in that Merge event",
    unit: '%',
    args: [{ name: 'event id', kind: 'eventId' }],
    said: PROGRESSION_SAID,
    on: '2026-11-25',
    by: 'economist',
    example: 'fn_Merge_Progression(57634U) > 95',
  },
]
export const segmentFunction = (name) => SEGMENT_FUNCTIONS.find((f) => f.name === name) ?? null

// --- Writing a condition ------------------------------------------------------

// The progression functions, by the feature they measure.
export const PROGRESSION_FEATURES = [
  { id: 'diamond-mine', label: 'Diamond Mine', fn: 'fn_DiamondMine_Progression' },
  { id: 'merge', label: 'Merge', fn: 'fn_Merge_Progression' },
]
export const COMPARISONS = [
  { op: '>', words: 'above' },
  { op: '>=', words: 'at least' },
  { op: '<', words: 'below' },
  { op: '<=', words: 'at most' },
]
// fn_DiamondMine_Progression(57634U) > 95. An event id is digits; a % from 0 to 100, decimals written with m.
// Returns { condition, problems } - no condition while something is missing or wrong.
export function progressionCondition({ feature = 'diamond-mine', eventId = '', op = '>', percent = null } = {}) {
  const problems = []
  const f = PROGRESSION_FEATURES.find((x) => x.id === feature)
  if (!f) problems.push('Pick Diamond Mine or Merge.')
  const id = String(eventId ?? '').trim().replace(/U$/i, '')
  if (!id) problems.push('Type the event id.')
  else if (!/^\d+$/.test(id)) problems.push(`"${eventId}" is not an event id: digits only.`)
  if (!COMPARISONS.some((c) => c.op === op)) problems.push('Pick a comparison.')
  if (percent == null || percent === '') problems.push('Type the %.')
  else if (!(Number(percent) >= 0 && Number(percent) <= 100)) problems.push('A % from 0 to 100.')
  if (problems.length) return { condition: '', problems }
  const n = Number(percent)
  return { condition: `${f.fn}(${id}U) ${op} ${Number.isInteger(n) ? n : `${n}m`}`, problems }
}

// --- Reading a condition ----------------------------------------------------------

// Tokens: names, numbers (3, 0.7m, 57634U), operators, brackets, commas.
function tokenize(text) {
  const tokens = []
  const re = /\s*(?:(\d+(?:\.\d+)?)([mU]?)(?![A-Za-z0-9_])|([A-Za-z_][A-Za-z0-9_]*)|(&&|\|\||>=|<=|==|!=|[<>!+\-*/(),]))/y
  let i = 0
  const s = String(text ?? '')
  while (i < s.length) {
    if (/^\s*$/.test(s.slice(i))) break
    re.lastIndex = i
    const m = re.exec(s)
    if (!m) throw new Error(`"${s.slice(i).trim().slice(0, 12)}" cannot be read here.`)
    if (m[1] != null) tokens.push({ t: 'num', v: m[1], suffix: m[2] })
    else if (m[3] != null) tokens.push({ t: 'name', v: m[3] })
    else tokens.push({ t: 'op', v: m[4] })
    i = re.lastIndex
  }
  return tokens
}

// A tree: { k: 'or'|'and', parts } | { k: 'not', of } | { k: 'cmp', op, left, right } | { k: 'math', op, left, right }
// | { k: 'call', name, args } | { k: 'num', v, suffix } | { k: 'name', v }
function parse(tokens) {
  let p = 0
  const peek = () => tokens[p]
  const isOp = (v) => peek()?.t === 'op' && peek().v === v
  const take = (v) => {
    if (!isOp(v)) throw new Error(`"${v}" expected${peek() ? ` before "${peek().v}"` : ' at the end'}.`)
    p += 1
  }
  const list = (k, op, next) => {
    const parts = [next()]
    while (isOp(op)) {
      p += 1
      parts.push(next())
    }
    return parts.length === 1 ? parts[0] : { k, parts }
  }
  const or = () => list('or', '||', and)
  const and = () => list('and', '&&', not)
  const not = () => {
    if (isOp('!')) {
      p += 1
      return { k: 'not', of: not() }
    }
    return cmp()
  }
  const cmp = () => {
    const left = sum()
    for (const op of ['>=', '<=', '==', '!=', '>', '<'])
      if (isOp(op)) {
        p += 1
        return { k: 'cmp', op, left, right: sum() }
      }
    return left
  }
  const binary = (ops, next) => () => {
    let left = next()
    while (ops.some((o) => isOp(o))) {
      const op = peek().v
      p += 1
      left = { k: 'math', op, left, right: next() }
    }
    return left
  }
  const atom = () => {
    const tk = peek()
    if (!tk) throw new Error('The condition ends too soon.')
    if (isOp('(')) {
      p += 1
      const inner = or()
      take(')')
      return inner
    }
    if (tk.t === 'num') {
      p += 1
      return { k: 'num', v: tk.v, suffix: tk.suffix }
    }
    if (tk.t === 'name') {
      p += 1
      if (isOp('(')) {
        p += 1
        const args = []
        if (!isOp(')'))
          for (;;) {
            args.push(sum())
            if (isOp(',')) p += 1
            else break
          }
        take(')')
        return { k: 'call', name: tk.v, args }
      }
      return { k: 'name', v: tk.v }
    }
    throw new Error(`"${tk.v}" cannot stand here.`)
  }
  const product = binary(['*', '/'], atom)
  const sum = binary(['+', '-'], product)
  const tree = or()
  if (p < tokens.length) throw new Error(`"${tokens[p].v}" is left over: a bracket or an "&&" missing?`)
  return tree
}

// A number in words: 0.7m is 0.7, 57634U is 57634.
const numText = (n) => n.v

// The weighted pattern: (fn(a,...)*x + fn(b,...)*y) with the same function -> one reading.
function weighted(node) {
  if (node?.k !== 'math' || node.op !== '+') return null
  const side = (s) => (s?.k === 'math' && s.op === '*' && s.left?.k === 'call' && s.right?.k === 'num' ? { call: s.left, w: s.right } : null)
  const a = side(node.left)
  const b = side(node.right)
  if (!a || !b || a.call.name !== b.call.name) return null
  return { fn: a.call.name, parts: [a, b] }
}

// Words for a value: a function, a weighted pair, a number.
function describeValue(node, issues) {
  const w = weighted(node)
  if (w) {
    w.parts.forEach((x) => checkCall(x.call, issues))
    const f = segmentFunction(w.fn)
    const days = w.parts.map((x) => `${x.w.v} x the last ${x.call.args[0]?.v ?? '?'} days`).join(' + ')
    return `weighted ${f ? f.label : w.fn} (${days})`
  }
  if (node.k === 'call') {
    checkCall(node, issues)
    const f = segmentFunction(node.name)
    if (!f) return `${node.name}(...) [not known to the app yet]`
    const id = f.args[0]?.kind === 'eventId' ? ` in event ${String(node.args[0]?.v ?? '?')}` : f.args[0]?.kind === 'days' ? ` over the last ${node.args[0]?.v ?? '?'} days` : ''
    return `${f.label}${id}`
  }
  if (node.k === 'num') return numText(node)
  if (node.k === 'name') {
    issues.push({ level: 'warn', text: `"${node.v}" is a name the app does not know.` })
    return node.v
  }
  if (node.k === 'math') return `(${describeValue(node.left, issues)} ${node.op} ${describeValue(node.right, issues)})`
  return '?'
}

function checkCall(node, issues) {
  const f = segmentFunction(node.name)
  if (!f) {
    issues.push({ level: 'warn', text: `${node.name} is not known to the app yet: teach it in chat.`, code: 'unknown-function' })
    return
  }
  if (node.args.length !== f.args.length) issues.push({ level: 'error', text: `${node.name} takes ${f.args.length} input${f.args.length === 1 ? '' : 's'} (${f.args.map((a) => a.name).join(', ')}); it has ${node.args.length} here.` })
  f.args.forEach((a, i) => {
    const arg = node.args[i]
    if (!arg) return
    if (a.kind === 'eventId' && !(arg.k === 'num' && /^\d+$/.test(arg.v) && arg.suffix === 'U')) issues.push({ level: 'error', text: `${node.name}: the event id is digits written with U, like 57634U.`, code: 'event-id' })
    if (a.kind === 'days' && !(arg.k === 'num' && /^\d+$/.test(arg.v) && !arg.suffix)) issues.push({ level: 'error', text: `${node.name}: the days are a whole number, like 3.` })
    if (a.kind === 'weights' && !(arg.k === 'num' && arg.suffix === 'm')) issues.push({ level: 'warn', text: `${node.name}: the mode weights are written like 1m,2m,4m,8m.` })
  })
}

const OP_WORDS = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most', '==': 'exactly', '!=': 'not' }

function describe(node, issues) {
  if (node.k === 'and') return node.parts.map((x) => describe(x, issues)).join(' and ')
  if (node.k === 'or') return `(${node.parts.map((x) => describe(x, issues)).join(' or ')})`
  if (node.k === 'not') return `not (${describe(node.of, issues)})`
  if (node.k === 'cmp') {
    const left = describeValue(node.left, issues)
    const right = describeValue(node.right, issues)
    const unit = node.left.k === 'call' && segmentFunction(node.left.name)?.unit === '%' ? '%' : ''
    return `${left} is ${OP_WORDS[node.op]} ${right}${unit}`
  }
  issues.push({ level: 'warn', text: 'A part with no comparison: it does not say who is in.' })
  return describeValue(node, issues)
}

// Reads a segment condition. Returns { ok, clauses: [words], functions: [names used], issues: [{ level, text }] }.
// `ok` is false when it cannot be read or something must be fixed; an unknown function is a warning.
export function readCondition(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return { ok: false, clauses: [], functions: [], issues: [{ level: 'error', text: 'Nothing to read.' }] }
  let tree
  try {
    tree = parse(tokenize(trimmed))
  } catch (e) {
    return { ok: false, clauses: [], functions: [], issues: [{ level: 'error', text: e.message }] }
  }
  const issues = []
  const parts = tree.k === 'and' ? tree.parts : [tree]
  const clauses = parts.map((x) => describe(x, issues))
  const functions = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.k === 'call' && !functions.includes(n.name)) functions.push(n.name)
    for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') walk(v)
  }
  walk(tree)
  const seen = new Set()
  const unique = issues.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)))
  return { ok: !unique.some((i) => i.level === 'error'), clauses, functions, issues: unique }
}
