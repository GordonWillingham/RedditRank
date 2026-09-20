// RedditRank API — served as Vite dev-server middleware so `npm run dev`
// serves frontend + backend in one process. The TypeSafe API key stays here,
// server-side, never in the client bundle.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const POSTS_FILE = path.join(DATA_DIR, 'posts.json')
const CACHE_FILE = path.join(DATA_DIR, 'judgments.json')
const ENV_FILE = path.join(__dirname, '.env')
const TS_URL = 'https://api.typesafe.ai/v1/systemone'

export function readApiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim()
  try {
    const text = fs.readFileSync(ENV_FILE, 'utf8')
    const m = text.match(/^TYPESAFE_API_KEY\s*=\s*(.+)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  return null
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data ? JSON.parse(data) : {}))
    req.on('error', reject)
  })
}

export async function handlePosts(req, res) {
  sendJson(res, 200, readJson(POSTS_FILE, { posts: [] }))
}

// ---- TypeSafe / Jev integration ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function tsEvaluate(apiKey, state, questions, retries = 4) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(TS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, model: 'jev-latest', questions }),
    })
    if (r.ok) return await r.json()
    if ((r.status === 429 || r.status === 529) && attempt < retries) {
      await sleep(500 * 2 ** attempt)
      continue
    }
    const text = await r.text().catch(() => '')
    throw new Error(`TypeSafe ${r.status}: ${text.slice(0, 300)}`)
  }
}

function baseQuestions() {
  return {
    insight: {
      type: 'score',
      instructions:
        'Rate how substantive and valuable this Reddit post is likely to be for a working programmer, based on its title and flair. Favor technical depth, novel ideas, and strong practical lessons; penalize memes, shallow chatter, and content-free linkbait.',
      criteria: [
        'Shallow or meme-tier: little substance for a programmer',
        'Ordinary: decent but unremarkable technical content',
        'Substantive: real technical depth, a novel idea, or strong practical lessons',
        'Insightful: likely to change how a programmer thinks or works',
      ],
    },
    clickbait: {
      type: 'noul',
      instructions:
        'Does this post title use clickbait or ragebait tactics — sensationalism, outrage bait, curiosity gaps that the content is unlikely to fill, or ALL-CAPS alarmism?',
      criteria: {
        true: 'Title relies on sensationalism, outrage, or curiosity-gap bait',
        false: 'Title is a plain, accurate description of the content',
      },
    },
    category: {
      type: 'choice',
      instructions: 'Pick the single best category for this post.',
      criteria: {
        technical_article: 'Explains a technical concept, technique, or deep dive',
        release_news: 'Announcement of a release, version, or launch',
        opinion_discussion: 'Opinion piece, essay, rant, or discussion prompt',
        security: 'Security vulnerability, attack, or defensive practice',
        show_project: 'Someone showing off something they built',
        career_meta: 'Career, hiring, workplace, or industry-meta topic',
        other: 'Anything else',
      },
    },
  }
}

function relevanceQuestion(query) {
  return {
    type: 'score',
    instructions: `Rate how relevant this Reddit post is to the reader's stated interest: "${query}". Judge by the title and flair; do not guess at unseen article content.`,
    criteria: [
      'Completely unrelated to the interest',
      'Tangential: mentions the topic only in passing',
      'Relevant: clearly connected to the interest',
      'Directly and specifically about the interest',
    ],
  }
}

function postState(post) {
  return {
    subreddit: post.subreddit,
    title: post.title,
    flair: post.flair || null,
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function handleScore(req, res) {
  const apiKey = readApiKey()
  if (!apiKey) {
    sendJson(res, 401, {
      ok: false,
      error: 'TYPESAFE_API_KEY not set (server/.env). Frontend will use heuristic fallback.',
    })
    return
  }
  try {
    const { query = '' } = await readBody(req)
    const posts = readJson(POSTS_FILE, { posts: [] }).posts
    const cache = readJson(CACHE_FILE, { base: {}, relevance: {} })
    cache.base = cache.base || {}
    cache.relevance = cache.relevance || {}
    const q = query.trim()

    // 1. Query-independent judgments (insight / clickbait / category), cached per post.
    const needBase = posts.filter((p) => !cache.base[p.id])
    if (needBase.length) {
      await mapWithConcurrency(needBase, 5, async (post) => {
        const out = await tsEvaluate(apiKey, postState(post), baseQuestions())
        const a = out.answers
        cache.base[post.id] = {
          insight: a.insight.score / 3,
          insightConf: a.insight.confidence,
          clickbait: a.clickbait.noul,
          category: a.category.choice,
          categoryConf: a.category.confidence,
        }
      })
    }

    // 2. Relevance to the current query, cached per (query, post).
    let relevance = null
    if (q) {
      if (!cache.relevance[q]) {
        cache.relevance[q] = {}
        await mapWithConcurrency(posts, 5, async (post) => {
          const out = await tsEvaluate(
            apiKey,
            { ...postState(post), interest: q },
            { relevance: relevanceQuestion(q) }
          )
          cache.relevance[q][post.id] = {
            relevance: out.answers.relevance.score / 3,
            relevanceConf: out.answers.relevance.confidence,
          }
        })
      }
      relevance = cache.relevance[q]
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))

    const judgments = {}
    for (const p of posts) {
      judgments[p.id] = {
        ...cache.base[p.id],
        ...(relevance && relevance[p.id] ? relevance[p.id] : {}),
      }
    }
    sendJson(res, 200, { ok: true, model: 'jev-latest', query: q, judgments })
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) })
  }
}
