import { useEffect, useState } from 'react'
import ClarityPage from './pages/ClarityPage'
import ColorPickPage from './pages/ColorPickPage'
import IcoPage from './pages/IcoPage'
import PngSvgPage from './pages/PngSvgPage'
import WatermarkPage from './pages/WatermarkPage'
import './App.css'

type Route = 'ico' | 'png-svg' | 'color-pick' | 'watermark' | 'clarity'

function routeFromHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (raw === 'png-svg') return 'png-svg'
  if (raw === 'color-pick') return 'color-pick'
  if (raw === 'watermark') return 'watermark'
  if (raw === 'clarity') return 'clarity'
  return 'ico'
}

const ROUTES: { id: Route; hash: string; label: string }[] = [
  { id: 'ico', hash: '#/ico', label: '图片转 ICO' },
  { id: 'png-svg', hash: '#/png-svg', label: 'PNG 转 SVG' },
  { id: 'color-pick', hash: '#/color-pick', label: '点选取色' },
  { id: 'watermark', hash: '#/watermark', label: '加水印' },
  { id: 'clarity', hash: '#/clarity', label: '图片清晰化' },
]

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash())

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden />

      <header className="site-header">
        <nav className="site-nav" aria-label="功能切换">
          {ROUTES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={route === item.id ? 'is-active' : undefined}
              onClick={() => {
                window.location.hash = item.hash
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="stage">
        {route === 'ico' && <IcoPage />}
        {route === 'png-svg' && <PngSvgPage />}
        {route === 'color-pick' && <ColorPickPage />}
        {route === 'watermark' && <WatermarkPage />}
        {route === 'clarity' && <ClarityPage />}
      </main>
    </div>
  )
}
