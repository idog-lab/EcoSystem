// A STAND-IN FOR GITHUB'S API, for the team data checks (verify-team-data.mjs, e2e/team-data.mjs): the contents
// API as the app uses it - a write with a stale or missing sha is refused (409), a bad token is refused (401), a file
// over BIG bytes comes by its blob as GitHub's over 1 MB does.
import { DATA_REPO } from '../../src/lib/teamData.js'

export const BIG = 400 // files over this many bytes come by their blob, as GitHub's over 1 MB
export function fakeGitHub() {
  const files = new Map() // path -> { sha, text }
  const commits = []
  let n = 0
  let down = false
  const users = { 'token-a': 'idog-lab', 'token-b': 'yaacovs-dot' }
  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body == null ? '' : JSON.stringify(body)) })
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64')
  const fetchFn = async (url, { method = 'GET', headers = {}, body } = {}) => {
    if (down) throw new TypeError('Failed to fetch')
    const login = users[String(headers.Authorization ?? '').replace('Bearer ', '')]
    if (!login) return json(401, { message: 'Bad credentials' })
    const u = new URL(url)
    const p = decodeURIComponent(u.pathname)
    if (p === '/user') return json(200, { login, name: login })
    const repo = `/repos/${DATA_REPO.owner}/${DATA_REPO.repo}`
    if (p === repo) return json(200, { full_name: `${DATA_REPO.owner}/${DATA_REPO.repo}`, permissions: { push: true } })
    if (p.startsWith(`${repo}/git/blobs/`)) {
      const sha = p.split('/').pop()
      const f = [...files.values()].find((x) => x.sha === sha)
      return f ? json(200, { sha, content: b64(f.text), encoding: 'base64' }) : json(404, null)
    }
    const path = p.slice(`${repo}/contents/`.length)
    const req = body ? JSON.parse(body) : {}
    if (method === 'GET') {
      if (files.has(path)) {
        const f = files.get(path)
        const size = Buffer.byteLength(f.text)
        return json(200, { type: 'file', sha: f.sha, size, content: size > BIG ? '' : b64(f.text), encoding: size > BIG ? 'none' : 'base64' })
      }
      const inDir = [...files.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
      if (inDir.length) return json(200, inDir.map((k) => ({ type: 'file', name: k.split('/').pop(), path: k, sha: files.get(k).sha })))
      return json(404, { message: 'Not Found' })
    }
    if (method === 'PUT') {
      const cur = files.get(path)
      if (cur ? req.sha !== cur.sha : req.sha) return json(409, { message: `${path} does not match` })
      const sha = `sha${++n}`
      files.set(path, { sha, text: Buffer.from(req.content, 'base64').toString('utf8') })
      commits.push({ path, message: req.message, by: login })
      return json(cur ? 200 : 201, { content: { sha, path } })
    }
    if (method === 'DELETE') {
      const cur = files.get(path)
      if (!cur) return json(404, null)
      if (req.sha !== cur.sha) return json(409, { message: 'does not match' })
      files.delete(path)
      commits.push({ path, message: req.message, by: login })
      return json(200, {})
    }
    return json(405, null)
  }
  return { fetchFn, files, commits, setDown: (v) => (down = v) }
}
