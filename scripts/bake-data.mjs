// Bakes the scraped posts and cached Jev judgments into public/data/ so a
// static build (GitHub Pages, etc.) can render real Jev-ranked results
// without any backend or API key.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'data')
fs.mkdirSync(outDir, { recursive: true })

const posts = JSON.parse(fs.readFileSync(path.join(root, 'server/data/posts.json'), 'utf8'))
fs.writeFileSync(path.join(outDir, 'posts.json'), JSON.stringify(posts))

// server/data/judgments.json is stored as { base: { id: judgment }, relevance: {...} }.
// Flatten the query-independent judgments into an id -> judgment map.
try {
  const cache = JSON.parse(fs.readFileSync(path.join(root, 'server/data/judgments.json'), 'utf8'))
  const flat = cache.base || cache || {}
  const count = Object.keys(flat).length
  fs.writeFileSync(path.join(outDir, 'judgments.json'), JSON.stringify(flat))
  console.log(`baked ${posts.posts.length} posts + ${count} Jev judgment sets`)
} catch {
  console.log(`baked ${posts.posts.length} posts (no cached judgments found)`)
}
