import { useEffect, useId, useRef, useState, useTransition } from 'react'
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
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      setSvgText(null)
      setShowPreview(false)
      return
    }
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function acceptFile(next: File | undefined | null) {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择 PNG 等位图文件')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setSvgText(null)
      setShowPreview(false)
      setFile(next)
    })
  }

  async function ensureSvg(): Promise<string> {
    if (!file) throw new Error('请先选择图片')
    if (svgText) return svgText
    const svg = await pngToSvg(file)
    setSvgText(svg)
    return svg
  }

  async function onPreview() {
    if (!file) return
    if (showPreview) {
      setShowPreview(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await ensureSvg()
      setShowPreview(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '预览失败')
    } finally {
      setBusy(false)
    }
  }

  async function onConvert() {
    if (!file) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const svg = await ensureSvg()
      const name = `${stemFromName(file.name)}.svg`
      downloadTextFile(svg, name)
      setStatus(`已保存 ${name}（${(svg.length / 1024).toFixed(1)} KB）。`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '转换失败')
    } finally {
      setBusy(false)
    }
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
            <span>或点击选择</span>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}

      <div className="actions">
        <button
          type="button"
          className="preview-btn"
          disabled={!file || busy}
          onClick={onPreview}
        >
          {showPreview ? '收起预览' : '预览效果'}
        </button>
        <button
          type="button"
          className="generate"
          disabled={!file || busy}
          onClick={onConvert}
        >
          {busy ? '转换中…' : '生成 SVG'}
        </button>
      </div>

      {showPreview && svgText && (
        <section className="svg-preview" aria-label="SVG 预览">
          <p className="previews-title">矢量预览</p>
          <div
            className="svg-preview-frame"
            dangerouslySetInnerHTML={{ __html: svgText }}
          />
        </section>
      )}
    </>
  )
}
