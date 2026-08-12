import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { PreviewDrawer } from '../components/PreviewDrawer'
import { usePasteImage } from '../hooks/usePasteImage'
import { downloadTextFile, pngToSvg } from '../lib/pngToSvg'

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'icon'
}

export default function PngSvgPage() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [svgText, setSvgText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      setSvgText(null)
      return
    }
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!file) {
      setSvgText(null)
      setDrawerOpen(false)
      return
    }

    let cancelled = false
    setBusy(true)
    setError(null)
    setStatus(null)
    setSvgText(null)
    setDrawerOpen(true)

    void pngToSvg(file)
      .then((svg) => {
        if (cancelled) return
        setSvgText(svg)
        setStatus(`预览已就绪（${(svg.length / 1024).toFixed(1)} KB）`)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '预览失败')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [file])

  const acceptFile = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择 PNG 等位图文件')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setSvgText(null)
      setFile(next)
    })
  }, [])

  usePasteImage(acceptFile)

  async function onConvert() {
    if (!file || !svgText) return
    setError(null)
    const name = `${stemFromName(file.name)}.svg`
    downloadTextFile(svgText, name)
    setStatus(`已保存 ${name}（${(svgText.length / 1024).toFixed(1)} KB）。`)
  }

  return (
    <>
      <header className="brand">
        <p className="brand-mark">PNG → SVG</p>
        <h1 className="brand-line">纯色图标转矢量</h1>
        <p className="brand-sub">
          适合扁平、纯色、透明底的图标 PNG，建议 512px。全程本地处理。
        </p>
      </header>

      <section
        className={`dropzone${dragOver ? ' is-over' : ''}${file ? ' has-file' : ''}`}
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
        aria-label="选择或拖入 PNG"
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/png,image/webp,image/gif"
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
            <strong>拖入纯色图标 PNG</strong>
            <span>点击选择 · 也可 Ctrl+V 粘贴</span>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}

      {svgText && !drawerOpen && (
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
        open={drawerOpen && !!svgText}
        title="矢量预览"
        onClose={() => setDrawerOpen(false)}
        action={
          <button
            type="button"
            className="generate"
            disabled={!file || !svgText || busy}
            onClick={onConvert}
          >
            {busy ? '转换中…' : '下载'}
          </button>
        }
      >
        <div
          className="svg-preview-frame"
          dangerouslySetInnerHTML={{ __html: svgText ?? '' }}
        />
      </PreviewDrawer>
    </>
  )
}
