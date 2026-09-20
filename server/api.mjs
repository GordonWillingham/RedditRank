// RedditRank API — served as Vite dev-server middleware so `npm run dev`
// serves frontend + backend in one process. The TypeSafe API key stays here,
// server-side, never in the client bundle.
//
// Multi-subreddit: posts and Jev judgment caches live per subreddit under
// server/data/posts-<sub>.json and judgments-<sub>.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const ENV_FILE = path.join(__dirname, '.env')
const TS_URL = 'https://api.typesafe.ai/v1/systemone'

// ---- Subreddit registry: each gets its own Jev rubric tuned to the domain ----

export const SUBREDDITS = {
  programming: {
    display: 'r/programming',
    insight:
      'Rate how substantive and valuable this Reddit post is likely to be for a working programmer, based on its title and flair. Favor technical depth, novel ideas, and strong practical lessons; penalize memes, shallow chatter, and content-free linkbait.',
    insightCriteria: [
      'Shallow or meme-tier: little substance for a programmer',
      'Ordinary: decent but unremarkable technical content',
      'Substantive: real technical depth, a novel idea, or strong practical lessons',
      'Insightful: likely to change how a programmer thinks or works',
    ],
    categories: {
      technical_article: 'Explains a technical concept, technique, or deep dive',
      release_news: 'Announcement of a release, version, or launch',
      opinion_discussion: 'Opinion piece, essay, rant, or discussion prompt',
      security: 'Security vulnerability, attack, or defensive practice',
      show_project: 'Someone showing off something they built',
      career_meta: 'Career, hiring, workplace, or industry-meta topic',
      other: 'Anything else',
    },
  },
  worldnews: {
    display: 'r/worldnews',
    insight:
      'Rate how newsworthy and significant this post is for someone keeping up with global events, based on its title and flair. Favor major geopolitical developments, impactful events, and credible reporting; penalize minor incidents, repetitive stories, and sensational filler.',
    insightCriteria: [
      'Trivial: minor local incident or filler with little global significance',
      'Minor: some interest but limited broader impact',
      'Significant: a real development people following world events should know',
      'Major: a consequential event likely to shape geopolitics or global headlines',
    ],
    categories: {
      politics: 'Elections, governments, diplomacy, or political developments',
      conflict: 'War, military action, terrorism, or civil unrest',
      economy: 'Trade, markets, inflation, or economic policy',
      science_tech: 'Scientific discovery, space, or technology news',
      disaster: 'Natural disasters, accidents, or humanitarian crises',
      society: 'Social movements, human rights, or cultural developments',
      other: 'Anything else',
    },
  },
  askreddit: {
    display: 'r/AskReddit',
    insight:
      "Rate how good this AskReddit prompt is at sparking interesting stories and discussion, based on its title. Favor prompts that invite vivid personal stories, novel hypotheticals, or genuine debate; penalize over-asked reposts, yes/no questions, and low-effort prompts.",
    insightCriteria: [
      'Low effort: a yes/no question, an over-asked repost, or prompts no real stories',
      'Decent: should get ordinary answers but nothing memorable',
      'Good: likely to draw engaging personal stories or lively debate',
      'Great: a prompt people will still be telling stories about in the comments',
    ],
    categories: {
      story_sharing: 'Asks people to share personal stories or experiences',
      opinion_debate: 'Invites opinions, preferences, or debate',
      hypothetical: 'A "what would you do / what if" scenario',
      advice: 'Asks for advice or help with a situation',
      would_you_rather: "A 'would you rather' style either/or prompt",
      other: 'Anything else',
    },
  },
  mma: {
    display: 'r/MMA',
    insight:
      'Rate how valuable this post is to a mixed martial arts fan, based on its title and flair. Favor fight announcements, results, matchup news, and quality analysis; penalize shitposts, repetitive rumors, and low-effort memes.',
    insightCriteria: [
      'Low value: shitpost, meme, or content most fans would scroll past',
      'Routine: ordinary fan content with limited new information',
      'Solid: real fight news, results, or analysis worth a fan’s time',
      'Must-see: breaking news or elite analysis the community will talk about',
    ],
    categories: {
      fight_news: 'Fight announcements, results, or card changes',
      event_coverage: 'Live event discussion, highlights, or recaps',
      analysis: 'Technical breakdowns, strategy, or fighter evaluation',
      rumor: 'Unsigned rumors, speculation, or negotiation reports',
      discussion: 'Fan questions, debates, or community topics',
      other: 'Anything else',
    },
  },
  nba: {
    display: 'r/nba',
    insight:
      'Rate how valuable this post is to an NBA fan, based on its title and flair. Favor trades, signings, injury news, game highlights, and sharp analysis; penalize low-effort memes, stale reposts, and off-court filler.',
    insightCriteria: [
      'Low value: meme, shitpost, or content most fans would scroll past',
      'Routine: ordinary fan content with limited new information',
      'Solid: real basketball news, highlights, or analysis worth a fan’s time',
      'Must-see: breaking news or a moment the community will be talking about',
    ],
    categories: {
      game_recap: 'Game results, highlights, or post-game coverage',
      trade_rumors: 'Trades, signings, or transaction rumors',
      player_news: 'Injuries, milestones, or off-court player news',
      analysis: 'Strategy, stats, or basketball analysis',
      discussion: 'Fan questions, debates, or community topics',
      other: 'Anything else',
    },
  },
}

export function resolveSub(raw) {
  const sub = String(raw || '').toLowerCase().replace(/^r\//, '')
  return SUBREDDITS[sub] ? sub : null
}

const postsFile = (sub) => path.join(DATA_DIR, `posts-${sub}.json`)
const cacheFile = (sub) => path.join(DATA_DIR, `judgments-${sub}.json`)

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
  const url = new URL(req.url || '', 'http://localhost')
  const sub = resolveSub(url.searchParams.get('sub')) || 'programming'
  sendJson(res, 200, readJson(postsFile(sub), { posts: [] }))
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

function baseQuestions(rubric) {
  return {
    insight: {
      type: 'score',
      instructions: rubric.insight,
      criteria: rubric.insightCriteria,
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
      criteria: rubric.categories,
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
    const body = await readBody(req)
    const sub = resolveSub(body.sub)
    if (!sub) {
      sendJson(res, 400, { ok: false, error: `Unknown subreddit: ${body.sub}` })
      return
    }
    const rubric = SUBREDDITS[sub]
    const { query = '' } = body
    const posts = readJson(postsFile(sub), { posts: [] }).posts
    const CACHE = cacheFile(sub)
    const cache = readJson(CACHE, { base: {}, relevance: {} })
    cache.base = cache.base || {}
    cache.relevance = cache.relevance || {}
    const q = String(query).trim()

    // 1. Query-independent judgments (insight / clickbait / category), cached per post.
    const needBase = posts.filter((p) => !cache.base[p.id])
    if (needBase.length) {
      await mapWithConcurrency(needBase, 5, async (post) => {
        const out = await tsEvaluate(apiKey, postState(post), baseQuestions(rubric))
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

    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2))

    const judgments = {}
    for (const p of posts) {
      judgments[p.id] = {
        ...cache.base[p.id],
        ...(relevance && relevance[p.id] ? relevance[p.id] : {}),
      }
    }
    sendJson(res, 200, { ok: true, model: 'jev-latest', sub, query: q, judgments })
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) })
  }
}
