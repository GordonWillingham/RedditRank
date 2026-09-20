// Bakes the scraped posts and cached Jev judgments for every subreddit into
// public/data/<sub>/ so a static build (GitHub Pages, etc.) can render real
// Jev-ranked results without any backend or API key.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUBS = ['programming', 'worldnews', 'askreddit', 'mma', 'nba']
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(root, 'public', 'data')
fs.mkdirSync(outRoot, { recursive: true })

let bakedPosts = 0
let bakedJudgments = 0
for (const sub of SUBS) {
  const outDir = path.join(outRoot, sub)
  fs.mkdirSync(outDir, { recursive: true })
  try {
    const posts = JSON.parse(
      fs.readFileSync(path.join(root, 'server/data', `posts-${sub}.json`), 'utf8')
    )
    fs.writeFileSync(path.join(outDir, 'posts.json'), JSON.stringify(posts))
    bakedPosts += posts.posts.length
  } catch {
    console.log(`skip ${sub}: no scrape data found`)
    continue
  }
  // judgments cache is stored as { base: { id: judgment }, relevance: {...} }.
  // Flatten the query-independent judgments into an id -> judgment map.
  try {
    const cache = JSON.parse(
      fs.readFileSync(path.join(root, 'server/data', `judgments-${sub}.json`), 'utf8')
    )
    const flat = cache.base || {}
    bakedJudgments += Object.keys(flat).length
    fs.writeFileSync(path.join(outDir, 'judgments.json'), JSON.stringify(flat))
  } catch {
    console.log(`${sub}: no cached judgments found (will use heuristic fallback)`)
  }
}
console.log(`baked ${bakedPosts} posts + ${bakedJudgments} Jev judgment sets across ${SUBS.length} subreddits`)
