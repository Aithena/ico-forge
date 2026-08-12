import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PreviewDrawer } from '../components/PreviewDrawer'
import { usePasteImage } from '../hooks/usePasteImage'
import {
  ASPECT_PRESETS,
  aspectRatioOf,
  clamp,
  clampCrop,
  downloadCropFile,
  initialCrop,
  loadImageFile,
  MIN_CROP_EDGE,
  refitCrop,
  renderCrop,
  type AspectId,
  type CropRect,
} from '../lib/crop'

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

const MIN_ZOOM = 0.4
const MAX_ZOOM = 8

type DragMode =
  | { kind: 'move'; ox: number; oy: number }
  | {
      kind: 'resize'
      handle: 'nw' | 'ne' | 'sw' | 'se'
      anchorX: number
      anchorY: number
    }

export default function CropPage() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [aspect, setAspect] = useState<AspectId>('1:1')
  const [circle, setCircle] = useState(false)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [layout, setLayout] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  })
  const dragRef = useRef<DragMode | null>(null)
  const cropRef = useRef<CropRect | null>(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(
    null,
  )
  const [, startTransition] = useTransition()

  const ratio = aspectRatioOf(aspect)
  const circleMode = aspect === '1:1' && circle

  useEffect(() => {
    cropRef.current = crop
  }, [crop])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  const acceptFile = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setDrawerOpen(true)
      setCrop(null)
      setZoom(1)
      setPan({ x: 0, y: 0 })
      zoomRef.current = 1
      panRef.current = { x: 0, y: 0 }
      setFile(next)
    })
  }, [])

  usePasteImage(acceptFile)

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      setNatural({ w: 0, h: 0 })
      setCrop(null)
      setDrawerOpen(false)
      return
    }
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!file || !sourceUrl) return
    let cancelled = false
    void loadImageFile(file).then((img) => {
      if (cancelled) return
      setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      setCrop(initialCrop(img.naturalWidth, img.naturalHeight, ratio))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, sourceUrl])

  function fitAndCenter() {
    const stage = stageRef.current
    const img = imgRef.current
    if (!stage || !img || !natural.w) return

    const sw = stage.clientWidth
    const sh = stage.clientHeight
    const fit = Math.min(sw / natural.w, sh / natural.h, 1)
    const dw = Math.max(1, natural.w * fit)
    const dh = Math.max(1, natural.h * fit)
    img.style.width = `${dw}px`
    img.style.height = `${dh}px`

    const nextPan = {
      x: (sw - dw) / 2,
      y: (sh - dh) / 2,
    }
    panRef.current = nextPan
    zoomRef.current = 1
    setPan(nextPan)
    setZoom(1)
    setLayout({ left: 0, top: 0, width: dw, height: dh })
  }

  useEffect(() => {
    if (!sourceUrl || !natural.w) return
    const id = requestAnimationFrame(() => fitAndCenter())
    return () => cancelAnimationFrame(id)
  }, [sourceUrl, natural.w, natural.h])

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
      const scale = nextZoom / prevZoom
      const nextPan = {
        x: cx - (cx - prevPan.x) * scale,
        y: cy - (cy - prevPan.y) * scale,
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

  function selectAspect(id: AspectId) {
    setAspect(id)
    if (id !== '1:1') setCircle(false)
    setCrop((prev) => {
      if (!prev || !natural.w) return prev
      return refitCrop(prev, natural.w, natural.h, aspectRatioOf(id))
    })
  }

  function toggleCircle() {
    if (aspect !== '1:1') {
      setAspect('1:1')
      setCrop((prev) => {
        if (!prev || !natural.w) return prev
        return refitCrop(prev, natural.w, natural.h, 1)
      })
    }
    setCircle((v) => !v)
  }

  useEffect(() => {
    if (!file || !crop || !natural.w) {
      setPreviewUrl(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      void loadImageFile(file)
        .then((image) =>
          renderCrop({
            image,
            crop,
            circle: circleMode,
          }),
        )
        .then((result) => {
          if (cancelled) {
            URL.revokeObjectURL(result.previewUrl)
            return
          }
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return result.previewUrl
          })
          const tip = result.upscaled
            ? `，已放大并清晰化至 ${result.width}×${result.height}`
            : `（${result.width}×${result.height}）`
          setStatus(
            circleMode ? `圆形头像预览${tip}` : `裁剪预览${tip}`,
          )
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : '预览失败')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [file, crop, circleMode, natural.w])

  function toImagePoint(clientX: number, clientY: number) {
    const stage = stageRef.current
    if (!stage || !layout.width || !natural.w) return { x: 0, y: 0 }
    const sr = stage.getBoundingClientRect()
    const sx = clientX - sr.left
    const sy = clientY - sr.top
    const z = zoomRef.current
    const p = panRef.current
    const vx = (sx - p.x) / z
    const vy = (sy - p.y) / z
    return {
      x: ((vx - layout.left) / layout.width) * natural.w,
      y: ((vy - layout.top) / layout.height) * natural.h,
    }
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current
      const current = cropRef.current
      if (!drag || !current || !natural.w) return
      if (clickRef.current) {
        const dx = e.clientX - clickRef.current.x
        const dy = e.clientY - clickRef.current.y
        if (dx * dx + dy * dy > 16) clickRef.current.moved = true
      }

      const pt = toImagePoint(e.clientX, e.clientY)
      const r = aspectRatioOf(aspect)

      if (drag.kind === 'move') {
        setCrop(
          clampCrop(
            {
              x: pt.x - drag.ox,
              y: pt.y - drag.oy,
              w: current.w,
              h: current.h,
            },
            natural.w,
            natural.h,
            r,
          ),
        )
        return
      }

      const { handle, anchorX, anchorY } = drag
      let w = Math.abs(pt.x - anchorX)
      let h = Math.abs(pt.y - anchorY)

      if (r) {
        if (w / h > r) h = w / r
        else w = h * r
      }

      let x = handle.includes('w') ? anchorX - w : anchorX
      let y = handle.includes('n') ? anchorY - h : anchorY
      if (handle.includes('e')) x = anchorX
      if (handle.includes('s')) y = anchorY
      if (handle.includes('w')) x = anchorX - w
      if (handle.includes('n')) y = anchorY - h

      setCrop(clampCrop({ x, y, w, h }, natural.w, natural.h, r))
    }

    function onUp() {
      const click = clickRef.current
      const wasDrag = dragRef.current
      dragRef.current = null
      if (
        wasDrag?.kind === 'move' &&
        click &&
        !click.moved &&
        aspect === '1:1'
      ) {
        toggleCircle()
      }
      clickRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [aspect, natural.w, natural.h, layout])

  function beginMove(e: ReactPointerEvent) {
    if (!crop) return
    e.preventDefault()
    const p = toImagePoint(e.clientX, e.clientY)
    clickRef.current = { x: e.clientX, y: e.clientY, moved: false }
    dragRef.current = { kind: 'move', ox: p.x - crop.x, oy: p.y - crop.y }
  }

  function beginResize(
    handle: 'nw' | 'ne' | 'sw' | 'se',
    e: ReactPointerEvent,
  ) {
    if (!crop) return
    e.preventDefault()
    e.stopPropagation()
    clickRef.current = { x: e.clientX, y: e.clientY, moved: true }
    const anchorX = handle.includes('w') ? crop.x + crop.w : crop.x
    const anchorY = handle.includes('n') ? crop.y + crop.h : crop.y
    dragRef.current = { kind: 'resize', handle, anchorX, anchorY }
  }

  async function onExport() {
    if (!file || !crop) return
    setBusy(true)
    setError(null)
    try {
      const image = await loadImageFile(file)
      const result = await renderCrop({
        image,
        crop,
        circle: circleMode,
      })
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return result.previewUrl
      })
      downloadCropFile(
        result.blob,
        `${stemFromName(file.name)}${circleMode ? '-avatar' : '-crop'}.png`,
      )
      setStatus(
        result.upscaled
          ? `已下载（小图已放大清晰化至 ${result.width}×${result.height}）`
          : `已下载（${result.width}×${result.height}）`,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  const scaleX = layout.width && natural.w ? layout.width / natural.w : 0
  const scaleY = layout.height && natural.h ? layout.height / natural.h : 0
  const frameStyle =
    crop && scaleX
      ? {
          left: layout.left + crop.x * scaleX,
          top: layout.top + crop.y * scaleY,
          width: crop.w * scaleX,
          height: crop.h * scaleY,
        }
      : undefined

  return (
    <>
      <header className="brand">
        <p className="brand-mark">图片裁剪</p>
        <h1 className="brand-line">常用比例与圆形头像</h1>
        <p className="brand-sub">
          小图自动放大到至少 {MIN_CROP_EDGE}px 并清晰化；滚轮按鼠标位置缩放。支持
          Ctrl+V。
        </p>
      </header>

      {!sourceUrl ? (
        <section
          className={`dropzone${dragOver ? ' is-over' : ''}`}
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
          aria-label="选择或拖入图片"
        >
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => acceptFile(e.target.files?.[0])}
          />
          <div className="drop-empty">
            <span className="drop-glyph" aria-hidden />
            <strong>拖入图片</strong>
            <span>点击选择 · 也可 Ctrl+V 粘贴</span>
          </div>
        </section>
      ) : (
        <>
          <div className="crop-toolbar">
            <button
              type="button"
              className="preview-btn"
              onClick={() => inputRef.current?.click()}
            >
              更换图片
            </button>
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
            <button
              type="button"
              className={`crop-circle-toggle${circleMode ? ' is-on' : ''}`}
              onClick={toggleCircle}
              aria-pressed={circleMode}
            >
              {circleMode ? '圆形头像 · 开' : '圆形头像'}
            </button>
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
            <button
              type="button"
              className="preview-btn"
              onClick={() => fitAndCenter()}
            >
              重置 {Math.round(zoom * 100)}%
            </button>
          </div>

          <section ref={stageRef} className="crop-stage" aria-label="裁剪区域">
            <div
              className="crop-viewport"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <img
                ref={imgRef}
                src={sourceUrl}
                alt=""
                className="crop-stage-img"
                draggable={false}
                onLoad={() => fitAndCenter()}
              />

              {frameStyle && (
                <div
                  className={`crop-frame${circleMode ? ' is-circle' : ''}`}
                  style={frameStyle}
                  onPointerDown={beginMove}
                  title={
                    aspect === '1:1'
                      ? '拖动调整；点击切换圆形头像'
                      : '拖动调整裁剪框'
                  }
                >
                  <span
                    className="crop-handle nw"
                    onPointerDown={(e) => beginResize('nw', e)}
                  />
                  <span
                    className="crop-handle ne"
                    onPointerDown={(e) => beginResize('ne', e)}
                  />
                  <span
                    className="crop-handle sw"
                    onPointerDown={(e) => beginResize('sw', e)}
                  />
                  <span
                    className="crop-handle se"
                    onPointerDown={(e) => beginResize('se', e)}
                  />
                </div>
              )}
            </div>
          </section>

          <section className="wm-panel" aria-label="裁剪比例">
            <div className="crop-aspect-row" role="radiogroup" aria-label="比例">
              {ASPECT_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={aspect === item.id}
                  className={aspect === item.id ? 'is-selected' : undefined}
                  onClick={() => selectAspect(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="wm-hint">
              滚轮按鼠标位置缩放。裁剪结果任一边不足 {MIN_CROP_EDGE}
              px 时，会放大并清晰化。
              {aspect === '1:1' ? ' 点击裁剪框可切换圆形头像。' : ''}
            </p>
          </section>

          {previewUrl && !drawerOpen && (
            <div className="actions">
              <button
                type="button"
                className="preview-btn"
                onClick={() => setDrawerOpen(true)}
              >
                查看预览
              </button>
            </div>
          )}

          <PreviewDrawer
            open={drawerOpen && !!previewUrl}
            title={circleMode ? '圆形头像预览' : '裁剪预览'}
            onClose={() => setDrawerOpen(false)}
            wide
            action={
              <button
                type="button"
                className="generate"
                disabled={busy || !previewUrl}
                onClick={onExport}
              >
                {busy ? '处理中…' : '下载'}
              </button>
            }
          >
            <div className="wm-preview-frame">
              <img
                src={previewUrl ?? ''}
                alt={circleMode ? '圆形头像预览' : '裁剪预览'}
              />
            </div>
          </PreviewDrawer>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </>
  )
}
