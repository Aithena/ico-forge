import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Workbench } from '../components/Workbench'
import { usePasteImage } from '../hooks/usePasteImage'

type Picked = {
  hex: string
  rgb: string
  rgba: string
  x: number
  y: number
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 16

function toHex(r: number, g: number, b: number) {
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export default function ColorPickPage() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  } | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [picked, setPicked] = useState<Picked | null>(null)
  const [format, setFormat] = useState<'hex' | 'rgb' | 'rgba'>('hex')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const [, startTransition] = useTransition()

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  const centerImage = useCallback((z = 1) => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas || !canvas.width || !canvas.height) return
    const rect = stage.getBoundingClientRect()
    setZoom(z)
    zoomRef.current = z
    const nextPan = {
      x: (rect.width - canvas.width * z) / 2,
      y: (rect.height - canvas.height * z) / 2,
    }
    setPan(nextPan)
    panRef.current = nextPan
  }, [])

  const resetView = useCallback(() => {
    centerImage(1)
  }, [centerImage])

  const acceptFile = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择或粘贴图片文件')
      return
    }
    startTransition(() => {
      setError(null)
      setCopied(null)
      setPicked(null)
      setFile(next)
      setZoom(1)
      setPan({ x: 0, y: 0 })
      zoomRef.current = 1
      panRef.current = { x: 0, y: 0 }
    })
  }, [])

  usePasteImage(acceptFile)

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      setNatural({ w: 0, h: 0 })
      return
    }
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!sourceUrl || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      requestAnimationFrame(() => centerImage(1))
    }
    img.onerror = () => setError('无法读取图片')
    img.src = sourceUrl
  }, [sourceUrl, centerImage])

  const zoomAt = useCallback(
    (factor: number, centerClientX?: number, centerClientY?: number) => {
      const stage = stageRef.current
      if (!stage) return

      const rect = stage.getBoundingClientRect()
      const cx = (centerClientX ?? rect.left + rect.width / 2) - rect.left
      const cy = (centerClientY ?? rect.top + rect.height / 2) - rect.top

      const prevZoom = zoomRef.current
      const nextZoom = clamp(prevZoom * factor, MIN_ZOOM, MAX_ZOOM)
      if (nextZoom === prevZoom) return

      const prevPan = panRef.current
      const ratio = nextZoom / prevZoom
      // Keep the content point under the cursor fixed while scaling.
      const nextPan = {
        x: cx - (cx - prevPan.x) * ratio,
        y: cy - (cy - prevPan.y) * ratio,
      }

      zoomRef.current = nextZoom
      panRef.current = nextPan
      setZoom(nextZoom)
      setPan(nextPan)
    },
    [],
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !sourceUrl) return

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      zoomAt(factor, e.clientX, e.clientY)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [sourceUrl, zoomAt])

  async function copyValue(text: string) {
    try {
      await copyText(text)
      setCopied(text)
      setError(null)
    } catch {
      setError('复制失败，请手动复制')
    }
  }

  async function sampleAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas || !natural.w) return

    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const x = Math.min(
      natural.w - 1,
      Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * natural.w)),
    )
    const y = Math.min(
      natural.h - 1,
      Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * natural.h)),
    )

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
    const alpha = Math.round(((a ?? 255) / 255) * 1000) / 1000
    const next: Picked = {
      hex: toHex(r ?? 0, g ?? 0, b ?? 0),
      rgb: `rgb(${r}, ${g}, ${b})`,
      rgba: `rgba(${r}, ${g}, ${b}, ${alpha})`,
      x,
      y,
    }
    setPicked(next)

    const text =
      format === 'hex' ? next.hex : format === 'rgb' ? next.rgb : next.rgba
    await copyValue(text)
  }

  async function copyAgain() {
    if (!picked) return
    const text =
      format === 'hex' ? picked.hex : format === 'rgb' ? picked.rgb : picked.rgba
    await copyValue(text)
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0) return
    const stage = stageRef.current
    if (!stage) return
    stage.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    }
    setPanning(true)
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && dx * dx + dy * dy > 16) {
      drag.moved = true
    }
    if (drag.moved) {
      const nextPan = { x: drag.originX + dx, y: drag.originY + dy }
      panRef.current = nextPan
      setPan(nextPan)
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const stage = stageRef.current
    stage?.releasePointerCapture(e.pointerId)
    const wasPan = drag.moved
    dragRef.current = null
    setPanning(false)
    if (!wasPan) {
      void sampleAt(e.clientX, e.clientY)
    }
  }

  return (
    <Workbench
      brandMark="点选取色"
      brandLine="点击图片复制颜色"
      brandSub="支持拖入、选择或 Ctrl+V 粘贴。滚轮缩放，拖动平移，单击取色。"
      resultTitle="取色结果"
      resultEmpty="在左侧图片上单击取色，结果会显示在这里。"
      resultAction={
        picked ? (
          <button type="button" className="generate" onClick={copyAgain}>
            复制 {format === 'hex' ? 'HEX' : format === 'rgb' ? 'RGB' : 'RGBA'}
          </button>
        ) : undefined
      }
      result={
        picked ? (
          <aside className="color-result is-inline" aria-label="取色结果">
            <button
              type="button"
              className="color-swatch color-swatch-lg"
              onClick={copyAgain}
              title="复制当前格式"
              aria-label="颜色预览，点击复制"
            >
              <span style={{ background: picked.rgba }} />
            </button>

            <div className="color-formats" role="radiogroup" aria-label="复制格式">
              {(
                [
                  ['hex', 'HEX'],
                  ['rgb', 'RGB'],
                  ['rgba', 'RGBA'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={format === id}
                  className={format === id ? 'is-selected' : undefined}
                  onClick={() => setFormat(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <ul className="color-value-list">
              {(
                [
                  ['HEX', picked.hex],
                  ['RGB', picked.rgb],
                  ['RGBA', picked.rgba],
                ] as const
              ).map(([label, value]) => (
                <li key={label}>
                  <button type="button" onClick={() => copyValue(value)}>
                    <span>{label}</span>
                    <code>{value}</code>
                  </button>
                </li>
              ))}
            </ul>

            <p className="color-pos">
              位置 {picked.x}, {picked.y}
            </p>

            {copied && <p className="status">已复制 {copied}</p>}
          </aside>
        ) : null
      }
    >
      <section
        className={`dropzone${dragOver ? ' is-over' : ''}${sourceUrl ? ' has-file' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          acceptFile(e.dataTransfer.files[0])
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        aria-controls={inputId}
        aria-label="选择、拖入或粘贴图片"
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
        {sourceUrl ? (
          <div className="drop-preview">
            <img src={sourceUrl} alt="" />
            <div className="drop-meta">
              <strong>{file?.name}</strong>
              <span>点击或拖入可更换</span>
            </div>
          </div>
        ) : (
          <div className="drop-empty">
            <span className="drop-glyph" aria-hidden />
            <strong>拖入 / 点击 / 粘贴图片</strong>
            <span>Ctrl+V 即可上传截图</span>
          </div>
        )}
      </section>

      {sourceUrl && (
        <>
          <div className="color-toolbar">
            <button
              type="button"
              className="preview-btn"
              onClick={() => zoomAt(1 / 1.25)}
            >
              缩小
            </button>
            <button
              type="button"
              className="preview-btn"
              onClick={() => zoomAt(1.25)}
            >
              放大
            </button>
            <button type="button" className="preview-btn" onClick={resetView}>
              重置 {Math.round(zoom * 100)}%
            </button>
          </div>

          <div
            ref={stageRef}
            className={`color-stage${panning ? ' is-panning' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="img"
            aria-label="点击取色，滚轮缩放，拖动平移"
            title="单击取色 · 滚轮缩放 · 拖动平移"
          >
            <div
              className="color-viewport"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <canvas ref={canvasRef} className="color-canvas" />
            </div>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </Workbench>
  )
}
