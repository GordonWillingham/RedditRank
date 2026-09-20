import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// Serves the RedditRank API in the same process as the dev server, so
// `npm run dev` alone gives you frontend + backend. The TypeSafe API key is
// read server-side only (env var or app/server/.env).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// @ts-expect-error plain-JS server module (api.mjs) has no type declarations
const loadApi = (): Promise<any> => import("./server/api.mjs")

function redditRankApi(): Plugin {
  return {
    name: "reddit-rank-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0]
        if (url === "/api/posts") {
          loadApi().then((m) => m.handlePosts(req, res)).catch(next)
        } else if (url === "/api/score" && req.method === "POST") {
          loadApi().then((m) => m.handleScore(req, res)).catch(next)
        } else if (url === "/api/health") {
          loadApi()
            .then((m) => {
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ ok: true, key: !!m.readApiKey() }))
            })
            .catch(next)
        } else {
          next()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), redditRankApi(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
