// WHAT THE APP HAS BEEN TAUGHT about the economy - kept in the project, the
// same for everyone who opens the app (economist, 25 Nov 2026, asked where
// what they and their coworker teach should be kept: "In the project"; and
// how they teach: "Explain in chat").
//
// How a value gets here: the economist (or their coworker) explains it in
// chat, and it is written below with their words (`said`), the day (`on`) and
// who said it (`by`). It reaches the other person through a pull request, and
// the published site once that is merged.
//
// A value here WINS over one typed on the Economy page in a browser: the page
// shows it as "Taught" and does not let it be changed there. A value typed in a
// browser that is not here stays in that browser only - the Worth tab lists
// those, ready to be sent in chat and taught here.
//
// Never invent an entry: everything below was said, in so many words. A key
// (currency, preset, pack, chest, trigger, bucket) is the game's, as given.

const RULES_TEXT = 'Economy Rules & Reward Syntax (given in chat)'

// The value table: the allowance worth of one of each resource.
export const TAUGHT_RESOURCES = {
  coins: { value: 1, said: `${RULES_TEXT}: coins are allowance, worth 1`, on: '2026-11-24', by: 'economist' },
  wild: { value: 2.5, said: `${RULES_TEXT}: Wild 2.5`, on: '2026-11-24', by: 'economist' },
  stock: { value: 2, said: `${RULES_TEXT}: Extra Stock 2`, on: '2026-11-24', by: 'economist' },
  undo: { value: 0.25, said: `${RULES_TEXT}: Undo 0.25`, on: '2026-11-24', by: 'economist' },
  entry: { value: 1, said: `${RULES_TEXT}: Free Round / Entry 1`, on: '2026-11-24', by: 'economist' },
}

// A Chef basket's worth by its tier.
const BASKETS_SAID = 'as for now the basket values are like i gave u, when the chef model in the app will be better we will change its value daily'
export const TAUGHT_CHEF_BASKETS = {
  Basic: { value: 0.25, said: BASKETS_SAID, on: '2026-11-24', by: 'economist' },
  Rare: { value: 1, said: BASKETS_SAID, on: '2026-11-24', by: 'economist' },
  Epic: { value: 4, said: BASKETS_SAID, on: '2026-11-24', by: 'economist' },
}

// Currencies (dynamic resources). Each: { name, valueGameplay?, daily?, feature?, note?, said, on, by }.
// `daily` is the dated map "2026-11-30=0.0376875|2026-12-01=0.0333518|..." for one that loses value by day.
export const TAUGHT_CURRENCIES = [
  { name: 'dr-pack-counter', valueGameplay: 0, said: 'packs are prices with 0', on: '2026-11-24', by: 'economist' },
  { name: 'dr-hidden', valueGameplay: 0, said: `${RULES_TEXT}: dr-hidden is worth 0`, on: '2026-11-24', by: 'economist' },
]

const CHESTS_SAID = 'also what about the chests? wooden, silver,golden purple - here is an example chest:wooden(...'

// Keys of the game, by list (presets, packs, chests, triggers, buckets). Each: { key, value?, note?, said, on, by }.
// A key here is added to its list if a browser does not have it; `value` is its worth in allowance (presets, packs).
export const TAUGHT_KEYS = {
  presets: [],
  packs: [],
  // The four chests, written by their name alone ("here is an example chest:wooden(..."); "Only the four" - the
  // pink-chest and yellow-chest the list held before (from the reward examples) are taken off (economyModel).
  chests: [
    { key: 'wooden', said: CHESTS_SAID, on: '2026-11-25', by: 'economist' },
    { key: 'silver', said: CHESTS_SAID, on: '2026-11-25', by: 'economist' },
    { key: 'golden', said: CHESTS_SAID, on: '2026-11-25', by: 'economist' },
    { key: 'purple', said: CHESTS_SAID, on: '2026-11-25', by: 'economist' },
  ],
  triggers: [],
  buckets: [],
}
