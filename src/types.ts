export interface Post {
  id: string
  title: string
  score: number
  comments: number
  created: string
  permalink: string
  subreddit: string
  link: string
  flair: string
}

export interface PostFile {
  scrapeTime: string
  subreddit: string
  sort: string
  posts: Post[]
}

export interface Judgment {
  insight?: number // 0..1 normalized from 0..3 score
  insightConf?: number
  clickbait?: number // 0..1 noul probability
  category?: string
  categoryConf?: number
  relevance?: number // 0..1 normalized from 0..3 score
  relevanceConf?: number
}

export type Engine = 'jev' | 'heuristic'
