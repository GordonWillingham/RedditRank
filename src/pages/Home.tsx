import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Sparkles, ExternalLink, MessageSquare, ArrowUpRight, RefreshCw } from 'lucide-react'
import '../App.css'
import type { PostFile, Judgment, Engine } from '@/types'
import {
  scoreAll,
  formatAge,
  domainOf,
  CATEGORY_LABELS,
  insightLabel,
  type Weights,
  type ScoredPost,
} from '@/lib/score'

interface WeightSliderProps {
  label: string
  value: number
  onChange: (v: number) => void
}

function WeightSlider({ label, value, onChange }: WeightSliderProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{value}</span>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} max={100} step={5} />
    </div>
  )
}

export default function Home() {
  const [postFile, setPostFile] = useState<PostFile | null>(null)
  const [judgments, setJudgments] = useState<Record<string, Judgment>>({})
  const [engine, setEngine] = useState<Engine>('heuristic')
  const [hasKey, setHasKey] = useState(false)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [scoring, setScoring] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [weights, setWeights] = useState<Weights>({
    insight: 50,
    relevance: 30,
    community: 40,
    freshness: 20,
  })
  const [clickbaitTol, setClickbaitTol] = useState(70)
  const [cats, setCats] = useState<Set<string> | null>(null)

  const loadBakedJudgments = async (): Promise<boolean> => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/judgments.json`)
      if (!r.ok) return false
      const baked = (await r.json()) as Record<string, Judgment>
      if (!baked || Object.keys(baked).length === 0) return false
      setJudgments(baked)
      setEngine('jev')
      setNotice('Static build — showing Jev judgments cached at build time. Run locally with a TypeSafe key for live scoring.')
      return true
    } catch {
      return false
    }
  }

  useEffect(() => {
    fetch('/api/posts')
      .then((r) => {
        if (!r.ok) throw new Error('no api')
        return r.json()
      })
      .then((d: PostFile) => setPostFile(d))
      .catch(() => {
        // Static hosting (e.g. GitHub Pages): fall back to baked-in scrape data.
        fetch(`${import.meta.env.BASE_URL}data/posts.json`)
          .then((r) => r.json())
          .then((d: PostFile) => setPostFile(d))
          .catch(() => setNotice('Could not load scraped posts.'))
      })
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        setHasKey(!!d.key)
        if (d.key) runJev('')
        else void loadBakedJudgments()
      })
      .catch(() => {
        setHasKey(false)
        void loadBakedJudgments()
      })
  }, [])

  const runJev = async (q: string) => {
    setScoring(true)
    setNotice(null)
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const d = await r.json()
      if (!d.ok) {
        const usedBaked = await loadBakedJudgments()
        if (!usedBaked) {
          setNotice(d.error || 'Jev scoring failed; using heuristic mode.')
          setEngine('heuristic')
        }
      } else {
        setJudgments(d.judgments)
        setEngine('jev')
      }
    } catch {
      const usedBaked = await loadBakedJudgments()
      if (!usedBaked) {
        setNotice('Jev scoring failed; using heuristic mode.')
        setEngine('heuristic')
      }
    } finally {
      setScoring(false)
    }
  }

  const scored: ScoredPost[] = useMemo(() => {
    if (!postFile) return []
    const now = Date.now()
    return scoreAll(postFile.posts, judgments, engine, weights, query, now)
  }, [postFile, judgments, engine, weights, query])

  const allCats = useMemo(
    () => Array.from(new Set(scored.map((s) => s.judgment.category).filter(Boolean))) as string[],
    [scored]
  )

  const visible = useMemo(() => {
    return scored
      .filter((s) => (s.judgment.clickbait ?? 0) <= clickbaitTol / 100)
      .filter((s) => !cats || cats.size === 0 || cats.has(s.judgment.category ?? ''))
      .sort((a, b) => b.composite - a.composite)
  }, [scored, clickbaitTol, cats])

  const toggleCat = (c: string) => {
    setCats((prev) => {
      const next = new Set(prev ?? allCats)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  const scrapeTime = postFile?.scrapeTime
    ? new Date(postFile.scrapeTime).toLocaleString()
    : ''

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">RedditRank</h1>
            <Badge variant={engine === 'jev' ? 'default' : 'secondary'} className="gap-1">
              <Sparkles className="h-3 w-3" />
              {engine === 'jev' ? 'Ranked by Jev' : 'Heuristic mode'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            r/programming · hot · scraped in-app · semantic judgments by TypeSafe System One (Jev),
            blended with community signals in plain code
            {scrapeTime ? ` · scraped ${scrapeTime}` : ''}
          </p>
        </header>

        <Card className="p-4 space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="What do you want to read about? e.g. memory management, compilers, developer careers"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setQuery(queryInput.trim())
                  if (hasKey) runJev(queryInput.trim())
                }
              }}
            />
            <Button
              onClick={() => {
                setQuery(queryInput.trim())
                if (hasKey) runJev(queryInput.trim())
              }}
              disabled={scoring}
            >
              {scoring ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {scoring ? 'Judging…' : hasKey ? 'Rank with Jev' : 'Apply topic'}
            </Button>
          </div>
          {!hasKey && engine !== 'jev' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No TYPESAFE_API_KEY found on the server — running keyword heuristics instead of Jev
              judgments. Add the key to <code>app/server/.env</code> and click “Rank with Jev”.
            </p>
          )}
          {notice && <p className="text-xs text-destructive">{notice}</p>}

          <Separator />

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <WeightSlider label="Insight weight" value={weights.insight} onChange={(v) => setWeights((w) => ({ ...w, insight: v }))} />
            <WeightSlider label="Topic relevance" value={weights.relevance} onChange={(v) => setWeights((w) => ({ ...w, relevance: v }))} />
            <WeightSlider label="Community (votes)" value={weights.community} onChange={(v) => setWeights((w) => ({ ...w, community: v }))} />
            <WeightSlider label="Freshness" value={weights.freshness} onChange={(v) => setWeights((w) => ({ ...w, freshness: v }))} />
            <WeightSlider label="Clickbait tolerance" value={clickbaitTol} onChange={setClickbaitTol} />
          </div>

          {allCats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allCats.map((c) => {
                const active = !cats || cats.has(c)
                return (
                  <Badge
                    key={c}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleCat(c)}
                  >
                    {CATEGORY_LABELS[c] ?? c}
                  </Badge>
                )
              })}
            </div>
          )}
        </Card>

        <div className="space-y-2">
          {visible.map((s, i) => (
            <Card key={s.post.id} className="p-4 flex gap-4 items-start">
              <div className="text-lg font-bold text-muted-foreground w-8 text-right shrink-0 pt-0.5 tabular-nums">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-start gap-2 flex-wrap">
                  <a
                    href={`https://www.reddit.com${s.post.permalink}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium leading-snug hover:underline"
                  >
                    {s.post.title}
                  </a>
                  {(s.judgment.clickbait ?? 0) > 0.5 && (
                    <Badge variant="destructive" className="shrink-0">clickbait {Math.round((s.judgment.clickbait ?? 0) * 100)}%</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span>{domainOf(s.post.link)}</span>
                  <span className="flex items-center gap-0.5">
                    <ArrowUpRight className="h-3 w-3" />
                    {s.post.score}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <MessageSquare className="h-3 w-3" />
                    {s.post.comments}
                  </span>
                  <span>{formatAge(s.ageHours)} ago</span>
                  {s.judgment.category && (
                    <Badge variant="outline">{CATEGORY_LABELS[s.judgment.category] ?? s.judgment.category}</Badge>
                  )}
                  <Badge variant="secondary">{insightLabel(s.components.insight)}</Badge>
                  <a
                    href={s.post.link.startsWith('/') ? `https://www.reddit.com${s.post.link}` : s.post.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-0.5 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    article
                  </a>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Progress value={Math.round(s.composite * 100)} className="h-1.5 max-w-xs" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(s.composite * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </Card>
          ))}
          {visible.length === 0 && postFile && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No posts match the current filters.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
