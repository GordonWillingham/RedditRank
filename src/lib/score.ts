import type { Post, Judgment, Engine } from '@/types'

export interface Weights {
  insight: number
  relevance: number
  community: number
  freshness: number
}

export interface ScoredPost {
  post: Post
  judgment: Judgment
  engine: Engine
  components: {
    insight: number
    relevance: number
    community: number
    freshness: number
  }
  composite: number
  ageHours: number
}

const CLICKBAIT_RE =
  /(you won't believe|won't believe|shocking|outrage|epic fail|destroyed|is dead|is dying|gone wrong|\brant\b|existential risk|violently|skyrocket|mind-blowing|insane|rip |\[rant\])/i
const SUBSTANTIVE_RE =
  /\b(compiler|memory|allocat|type system|async|runtime|kernel|emulat|gpu|cache|index|query|parser|lexer|garbage|borrow| ownership|parallel|concurren|distribut|raft|consensus|encryption|unicode|render|shader|ffi|abi|simd|vectoriz|signing|trade|acquisition|injury|championship|verdict|ceasefire|election|sanction|inflation|treatment|breakthrough|hypothetical)\b/i

export const SUBS: { key: string; display: string; placeholder: string }[] = [
  { key: 'programming', display: 'r/programming', placeholder: 'What do you want to read about? e.g. memory management, compilers, developer careers' },
  { key: 'worldnews', display: 'r/worldnews', placeholder: 'What do you want to read about? e.g. Ukraine, climate, elections' },
  { key: 'askreddit', display: 'r/AskReddit', placeholder: 'What kind of stories do you want? e.g. workplace, travel, childhood' },
  { key: 'mma', display: 'r/MMA', placeholder: 'What do you want to read about? e.g. UFC, Dana White, striking' },
  { key: 'nba', display: 'r/nba', placeholder: 'What do you want to read about? e.g. Lakers, trades, playoffs' },
]

export const SUB_CATEGORY_LABELS: Record<string, Record<string, string>> = {
  programming: {
    technical_article: 'Technical article',
    release_news: 'Release news',
    opinion_discussion: 'Opinion / discussion',
    security: 'Security',
    show_project: 'Show project',
    career_meta: 'Career / meta',
    other: 'Other',
  },
  worldnews: {
    politics: 'Politics',
    conflict: 'Conflict',
    economy: 'Economy',
    science_tech: 'Science / tech',
    disaster: 'Disaster',
    society: 'Society',
    other: 'Other',
  },
  askreddit: {
    story_sharing: 'Story sharing',
    opinion_debate: 'Opinion / debate',
    hypothetical: 'Hypothetical',
    advice: 'Advice',
    would_you_rather: 'Would you rather',
    other: 'Other',
  },
  mma: {
    fight_news: 'Fight news',
    event_coverage: 'Event coverage',
    analysis: 'Analysis',
    rumor: 'Rumor',
    discussion: 'Discussion',
    other: 'Other',
  },
  nba: {
    game_recap: 'Game recap',
    trade_rumors: 'Trade rumors',
    player_news: 'Player news',
    analysis: 'Analysis',
    discussion: 'Discussion',
    other: 'Other',
  },
}

const HEURISTIC_CATEGORY_KEYWORDS: Record<string, [string, RegExp][]> = {
  programming: [
    ['release_news', /released|release|launch|announc/i],
    ['security', /attack|vulnerab|security|malware/i],
    ['opinion_discussion', /rant|opinion|law|think|why\b/i],
    ['show_project', /building|making|built|introducing/i],
  ],
  worldnews: [
    ['conflict', /war|missile|strike|troops|ceasefire|attack/i],
    ['economy', /inflation|market|trade|tariff|economy|gdp/i],
    ['science_tech', /nasa|space|ai\b|quantum|clinical|vaccine/i],
    ['disaster', /earthquake|flood|wildfire|hurricane|death toll/i],
    ['politics', /election|president|minister|parliament|senat/i],
  ],
  askreddit: [
    ['story_sharing', /what is the|what's the|what was|most memorable|ever had|experience/i],
    ['would_you_rather', /would you rather/i],
    ['hypothetical', /what if|if you could|if you were/i],
    ['advice', /should i\b|how do i\b|need help/i],
  ],
  mma: [
    ['fight_news', /announc|scheduled|vs\.|booking|sign/i],
    ['event_coverage', /ufc \d+|results?|recap|highlight/i],
    ['rumor', /rumor|reportedly|linked to/i],
  ],
  nba: [
    ['game_recap', /beat|win|wins? over|finals?|game \d/i],
    ['trade_rumors', /trade|signing|contract|waiv/i],
    ['injury', /injury|out for|torn/i],
    ['analysis', /stats?|ranked|rating|efficiency/i],
  ],
}

/** Heuristic fallback used until Jev judgments are available (no API key). */
function heuristicJudgment(post: Post, query: string): Judgment {
  const title = post.title
  const cb = CLICKBAIT_RE.test(title) ? 0.75 : 0.1
  let insight = 0.3
  if (SUBSTANTIVE_RE.test(title)) insight += 0.3
  if (title.length > 45) insight += 0.15
  if (/released|announc|launch|signing|trade|election|results?/i.test(title)) insight += 0.1
  insight = Math.min(1, insight)
  let category = 'other'
  const sub = post.subreddit?.replace(/^r\//i, '').toLowerCase() ?? ''
  const rules = HEURISTIC_CATEGORY_KEYWORDS[sub] ?? []
  for (const [cat, re] of rules) {
    if (re.test(title)) {
      category = cat
      break
    }
  }
  let relevance = 0.5
  if (query) {
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean)
    const hit = terms.filter((t) => title.toLowerCase().includes(t)).length
    relevance = terms.length ? Math.min(1, 0.2 + 0.8 * (hit / terms.length)) : 0.5
  }
  return {
    insight,
    insightConf: 0.3,
    clickbait: cb,
    category,
    categoryConf: 0.3,
    relevance,
    relevanceConf: 0.3,
  }
}

export function ageHours(post: Post, now: number): number {
  return Math.max(0, (now - new Date(post.created).getTime()) / 3.6e6)
}

export function domainOf(url: string): string {
  if (url.startsWith('/')) return 'reddit.com'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function scoreAll(
  posts: Post[],
  judgments: Record<string, Judgment>,
  engine: Engine,
  weights: Weights,
  query: string,
  now: number
): ScoredPost[] {
  const engRaw = posts.map((p) => Math.log10(1 + p.score) * 0.7 + Math.log10(1 + p.comments) * 0.3)
  const maxEng = Math.max(...engRaw, 1e-6)

  const total = weights.insight + weights.relevance + weights.community + weights.freshness || 1

  return posts.map((post, i) => {
    const j = judgments[post.id] ?? (engine === 'heuristic' ? heuristicJudgment(post, query) : {})
    const h = ageHours(post, now)
    const components = {
      insight: j.insight ?? 0.5,
      relevance: query ? (j.relevance ?? 0.5) : 0.5,
      community: engRaw[i] / maxEng,
      freshness: Math.exp(-h / 30),
    }
    const composite =
      (weights.insight * components.insight +
        weights.relevance * components.relevance +
        weights.community * components.community +
        weights.freshness * components.freshness) /
      total
    return { post, judgment: j, engine, components, composite, ageHours: h }
  })
}

export function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

export const CATEGORY_LABELS: Record<string, string> = {
  ...SUB_CATEGORY_LABELS.programming,
  ...SUB_CATEGORY_LABELS.worldnews,
  ...SUB_CATEGORY_LABELS.askreddit,
  ...SUB_CATEGORY_LABELS.mma,
  ...SUB_CATEGORY_LABELS.nba,
}

const INSIGHT_LABELS: Record<string, [string, string, string, string]> = {
  programming: ['Shallow', 'Ordinary', 'Substantive', 'Insightful'],
  worldnews: ['Trivial', 'Minor', 'Significant', 'Major'],
  askreddit: ['Low effort', 'Decent', 'Good', 'Great'],
  mma: ['Low value', 'Routine', 'Solid', 'Must-see'],
  nba: ['Low value', 'Routine', 'Solid', 'Must-see'],
}

export function insightLabel(v: number, sub = 'programming'): string {
  const labels = INSIGHT_LABELS[sub] ?? INSIGHT_LABELS.programming
  if (v < 0.25) return labels[0]
  if (v < 0.5) return labels[1]
  if (v < 0.75) return labels[2]
  return labels[3]
}
