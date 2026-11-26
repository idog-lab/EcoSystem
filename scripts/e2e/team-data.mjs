// TEAM DATA ON GITHUB, in the real app: two browsers (the economist and a coworker) connect to the team's data
// repository - a stand-in for GitHub's API answers instead of github.com (scripts/verify/fakeGitHub.mjs) - and what
// one saves on the Economy page reaches the other, at the app's start and by "Get the team's latest".
//
//   npx vite-node scripts/e2e/team-data.mjs   (start `npm run dev` first)
import { chromium } from 'playwright'
import { BASE, createChecker } from './helpers.mjs'
import { fakeGitHub } from '../verify/fakeGitHub.mjs'

const { ok, finish } = createChecker()
const gh = fakeGitHub()
const browser = await chromium.launch()
const errors = []

// Each browser of its own (its own storage), with github.com answered by the stand-in.
async function person() {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true })
  await context.route('https://api.github.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const res = await gh.fetchFn(req.url(), { method: req.method(), headers: { Authorization: req.headers().authorization }, body: req.postData() ?? undefined })
    await route.fulfill({ status: res.status, headers: { ...cors, 'content-type': 'application/json' }, body: await res.text() })
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return page
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS' }
const text = async (l) => (await l.innerText()).replace(/\s+/g, ' ').trim()
const openEconomy = async (page) => {
  await page.goto(`${BASE}models/economy`, { waitUntil: 'networkidle' })
  await page.getByTestId('economy-header').waitFor()
}
const addCurrency = async (page, name, worth) => {
  await page.getByTestId('economy-pick-currency').selectOption('A new currency...')
  await page.getByTestId('economy-new-currency').fill(name)
  await page.getByTestId('economy-add-currency').click()
  const field = page.locator(`[data-currency="${name}"] input[aria-label$="game play worth"]`)
  await field.fill(String(worth))
  await field.blur()
}
const remoteEconomy = () => JSON.parse(gh.files.get('economy/economy.json')?.text ?? 'null')

console.log('--- 1. The economist connects ---')
const a = await person()
await a.goto(BASE, { waitUntil: 'networkidle' })
ok(`the tag says the team data is off, on the home page (${await text(a.getByTestId('team-data-badge'))})`, (await a.getByTestId('team-data-badge').getAttribute('data-state')) === 'off')
await openEconomy(a)
await addCurrency(a, 'dr-team-gem', 0.7)
await a.getByTestId('team-data-badge').click()
await a.getByTestId('team-data').waitFor()
ok('the tag leads to the Team data panel, with how to get a token', (await a.getByTestId('team-data-howto').count()) === 1 && (await a.getByTestId('team-data-connect').isDisabled()))
await a.getByTestId('team-data-token').fill('wrong-token')
await a.getByTestId('team-data-connect').click()
await a.getByTestId('team-data-message').waitFor()
ok(`a token GitHub refuses is said, and nothing is kept (${await text(a.getByTestId('team-data-message'))})`.slice(0, 200), /refused the token/.test(await text(a.getByTestId('team-data-message'))) && (await a.getByTestId('team-data-token').count()) === 1)
await a.getByTestId('team-data-token').fill('token-a')
const [backup] = await Promise.all([a.waitForEvent('download', { timeout: 10000 }).catch(() => null), a.getByTestId('team-data-connect').click()])
await a.getByTestId('team-data-who').waitFor()
ok(`connected: what this browser held was downloaded first (${backup?.suggestedFilename() ?? 'no download'})`, !!backup && /before-team-data/.test(backup.suggestedFilename()))
ok(`...and sent to the team (${await text(a.getByTestId('team-data-message'))})`.slice(0, 220), remoteEconomy()?.currencies.some((c) => c.name === 'dr-team-gem' && c.valueGameplay === 0.7) && /Connected as idog-lab/.test(await text(a.getByTestId('team-data-message'))))

console.log('--- 2. A coworker in another browser ---')
const b = await person()
await b.goto(`${BASE}browser-data`, { waitUntil: 'networkidle' })
await b.getByTestId('team-data-token').fill('token-b')
await b.getByTestId('team-data-connect').click()
await b.getByTestId('team-data-who').waitFor()
ok(`the coworker connects and the team's data is brought in (${await text(b.getByTestId('team-data-message'))})`.slice(0, 220), /brought in: Economy page/.test(await text(b.getByTestId('team-data-message'))))
await openEconomy(b)
ok('...on their Economy page: the economist\'s currency and its worth', (await b.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').inputValue()) === '0.7')
await b.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').fill('0.9')
await b.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').blur()
await b.waitForTimeout(2500)
ok(`a change by the coworker reaches the team by itself, and their tag says so (${await text(b.getByTestId('team-data-badge'))})`, remoteEconomy()?.currencies.find((c) => c.name === 'dr-team-gem')?.valueGameplay === 0.9 && (await b.getByTestId('team-data-badge').getAttribute('data-state')) === 'saved')
ok('...in a commit by the coworker', gh.commits.some((c) => c.by === 'yaacovs-dot' && /Economy page: saved by yaacovs-dot/.test(c.message)))

console.log('--- 3. Back to the economist ---')
await openEconomy(a)
ok('opening the app brings the team\'s newest in first: the coworker\'s 0.9', (await a.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').inputValue()) === '0.9')
await b.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').fill('1.1')
await b.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').blur()
await b.waitForTimeout(2500)
// (By the corner tag, without a reload: a reload would bring the team's newest in by itself.)
await a.getByTestId('team-data-badge').click()
await a.getByTestId('team-data-refresh').click()
await a.getByTestId('team-data-message').waitFor()
ok(`"Get the team's latest" brings in what the coworker changed since (${await text(a.getByTestId('team-data-message'))})`, /brought in: Economy page/.test(await text(a.getByTestId('team-data-message'))))
await openEconomy(a)
ok('...the economist now sees 1.1', (await a.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').inputValue()) === '1.1')

console.log('--- 4. Players and leaving ---')
await a.goto(`${BASE}?s=B3j9Tm1`, { waitUntil: 'networkidle' })
ok('a player\'s stage link shows no team data tag', (await a.getByTestId('team-data-badge').count()) === 0)
await a.goto(`${BASE}browser-data`, { waitUntil: 'networkidle' })
await a.getByTestId('team-data-disconnect').click()
ok('Disconnect: the tag says off, the token is gone from the browser', (await a.getByTestId('team-data-badge').getAttribute('data-state')) === 'off' && (await a.evaluate(() => !localStorage.getItem('ecotk-team-token'))))
await openEconomy(a)
ok('...and what the browser holds stays (1.1)', (await a.locator('[data-currency="dr-team-gem"] input[aria-label$="game play worth"]').inputValue()) === '1.1')

ok(`no page error (${errors.join(' | ').slice(0, 200)})`, errors.length === 0)
await browser.close()
process.exit(finish('TEAM DATA') ? 1 : 0)
