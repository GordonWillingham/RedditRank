import { Routes, Route } from 'react-router'
import Home from './pages/Home'

export default function App() {
  return (
    <Routes>
      {/* path="*" so the app renders on any base path (e.g. GitHub Pages project sites) */}
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
