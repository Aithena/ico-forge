import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))
const aiPublic = resolve(root, 'public/ai')
const upscaleJs = resolve(root, 'node_modules/upscalejs/dist/js')
const upscaleModel = resolve(
  root,
  'node_modules/upscalejs/dist/models/Swin2SR',
)

const MIME: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.ort': 'application/octet-stream',
}

function copyUpscaleAssets() {
  if (!existsSync(upscaleJs) || !existsSync(upscaleModel)) {
    console.warn('[ai] upscalejs assets missing; skip copy')
    return
  }
  rmSync(aiPublic, { recursive: true, force: true })
  mkdirSync(resolve(aiPublic, 'js'), { recursive: true })
  mkdirSync(resolve(aiPublic, 'models/Swin2SR'), { recursive: true })
  cpSync(upscaleJs, resolve(aiPublic, 'js'), { recursive: true })
  cpSync(upscaleModel, resolve(aiPublic, 'models/Swin2SR'), {
    recursive: true,
  })
}

function resolveAiFile(urlPath: string): string | null {
  // urlPath like /img-tools/ai/js/foo.mjs or /ai/js/foo.mjs
  const marker = '/ai/'
  const idx = urlPath.indexOf(marker)
  if (idx < 0) return null
  const rel = decodeURIComponent(urlPath.slice(idx + marker.length).split('?')[0]!)
  if (!rel || rel.includes('..')) return null

  const fromPublic = resolve(aiPublic, rel)
  if (existsSync(fromPublic) && statSync(fromPublic).isFile()) return fromPublic

  // Fallback straight from package (dev resilience)
  const fromPkg = resolve(root, 'node_modules/upscalejs/dist', rel)
  if (existsSync(fromPkg) && statSync(fromPkg).isFile()) return fromPkg

  return null
}

function serveAiAssets(): Plugin {
  return {
    name: 'serve-upscalejs-assets',
    configResolved() {
      copyUpscaleAssets()
    },
    buildStart() {
      copyUpscaleAssets()
    },
    configureServer(server) {
      copyUpscaleAssets()
      server.middlewares.use((req, res, next) => {
        const raw = req.url ?? ''
        const file = resolveAiFile(raw)
        if (!file) {
          next()
          return
        }
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
        res.setHeader('Content-Type', type)
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url ?? ''
        const file = resolveAiFile(raw)
        if (!file) {
          next()
          return
        }
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
        res.setHeader('Content-Type', type)
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// GitHub Pages project site: https://<user>.github.io/img-tools/
export default defineConfig({
  base: '/img-tools/',
  plugins: [react(), serveAiAssets()],
  server: {
    port: 18808,
    strictPort: true,
  },
  preview: {
    port: 18808,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['upscalejs'],
  },
  assetsInclude: ['**/*.ort', '**/*.wasm'],
})
