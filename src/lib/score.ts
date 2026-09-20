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
const TECH_TERM_RE =
  /\b(compiler|memory|allocat|type system|async|runtime|kernel|emulat|gpu|cache|index|query|parser|lexer|garbage|borrow| ownership|parallel|concurren|distribut|raft|consensus|encryption|unicode|render|shader|ffi|abi|simd|vectoriz)\b/i

/** Heuristic fallback used until Jev judgments are available (no API key). */
function heuristicJudgment(post: Post, query: string): Judgment {
  const title = post.title
  const cb = CLICKBAIT_RE.test(title) ? 0.75 : 0.1
  let insight = 0.3
  if (TECH_TERM_RE.test(title)) insight += 0.3
  if (title.length > 45) insight += 0.15
  if (/released|announc|launch/i.test(title)) insight += 0.1
  insight = Math.min(1, insight)
  let category = 'other'
  if (/released|release|launch|announc/i.test(title)) category = 'release_news'
  else if (/attack|vulnerab|security|malware/i.test(title)) category = 'security'
  else if (/rant|opinion|law|think|why\b/i.test(title)) category = 'opinion_discussion'
  else if (/building|making|built|introducing/i.test(title)) category = 'show_project'
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
  technical_article: 'Technical article',
  release_news: 'Release news',
  opinion_discussion: 'Opinion / discussion',
  security: 'Security',
  show_project: 'Show project',
  career_meta: 'Career / meta',
  other: 'Other',
}

export function insightLabel(v: number): string {
  if (v < 0.25) return 'Shallow'
  if (v < 0.5) return 'Ordinary'
  if (v < 0.75) return 'Substantive'
  return 'Insightful'
}
