import { useEffect, useState } from 'react'
import IcoPage from './pages/IcoPage'
import PngSvgPage from './pages/PngSvgPage'
import './App.css'

type Route = 'ico' | 'png-svg'

function routeFromHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return raw === 'png-svg' ? 'png-svg' : 'ico'
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash())

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function go(next: Route) {
    window.location.hash = next === 'ico' ? '#/ico' : '#/png-svg'
  }

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden />

      <main className="stage">
        <nav className="site-nav" aria-label="功能切换">
          <button
            type="button"
            className={route === 'ico' ? 'is-active' : undefined}
            onClick={() => go('ico')}
          >
            图片转 ICO
          </button>
          <button
            type="button"
            className={route === 'png-svg' ? 'is-active' : undefined}
            onClick={() => go('png-svg')}
          >
            PNG 转 SVG
          </button>
        </nav>

        {route === 'ico' ? <IcoPage /> : <PngSvgPage />}
      </main>
    </div>
  )
}
