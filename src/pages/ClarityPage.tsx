import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { PreviewDrawer } from '../components/PreviewDrawer'
import { usePasteImage } from '../hooks/usePasteImage'
import {
  DEFAULT_CLARITY,
  downloadClarityFile,
  enhanceClarity,
  type ClarityOptions,
} from '../lib/clarity'

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

export default function ClarityPage() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [settings, setSettings] = useState<ClarityOptions>(DEFAULT_CLARITY)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [, startTransition] = useTransition()

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
      setFile(next)
    })
  }, [])

  usePasteImage(acceptFile)

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      setDrawerOpen(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      void enhanceClarity(file, settings)
        .then((result) => {
          if (cancelled) {
            URL.revokeObjectURL(result.previewUrl)
            return
          }
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return result.previewUrl
          })
          setStatus(`预览已更新（${result.width}×${result.height}）`)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : '处理失败')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [file, settings])

  function patch<K extends keyof ClarityOptions>(
    key: K,
    value: ClarityOptions[K],
  ) {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  async function onExport() {
    if (!file) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await enhanceClarity(file, settings)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return result.previewUrl
      })
      downloadClarityFile(
        result.blob,
        `${stemFromName(file.name)}-clear.png`,
      )
      setStatus(
        `已下载（${result.width}×${result.height}）。经典锐化适合轻微发糊；严重模糊效果有限。`,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '处理失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="brand">
        <p className="brand-mark">图片清晰化</p>
        <h1 className="brand-line">本地锐化增强</h1>
        <p className="brand-sub">
          使用反锐化蒙版提升边缘清晰度。适合轻微发糊；不是 AI
          超分。支持 Ctrl+V 粘贴。
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
          <section className="dropzone has-file" onClick={() => inputRef.current?.click()}>
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />
            <div className="drop-preview">
              <img src={sourceUrl} alt="" />
              <div className="drop-meta">
                <strong>{file?.name}</strong>
                <span>点击可更换</span>
              </div>
            </div>
          </section>

          <section className="wm-panel" aria-label="清晰化参数">
            <div className="wm-grid">
              <label className="wm-field">
                <span>
                  强度 <em>{settings.amount.toFixed(1)}</em>
                </span>
                <input
                  type="range"
                  min={0.2}
                  max={3}
                  step={0.1}
                  value={settings.amount}
                  onChange={(e) => patch('amount', Number(e.target.value))}
                />
              </label>
              <label className="wm-field">
                <span>
                  半径 <em>{settings.radius.toFixed(1)}</em>
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={settings.radius}
                  onChange={(e) => patch('radius', Number(e.target.value))}
                />
              </label>
              <label className="wm-field">
                <span>
                  阈值 <em>{settings.threshold}</em>
                </span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={settings.threshold}
                  onChange={(e) => patch('threshold', Number(e.target.value))}
                />
              </label>
              <label className="wm-field">
                <span>放大</span>
                <select
                  value={String(settings.upscale)}
                  onChange={(e) => patch('upscale', Number(e.target.value))}
                >
                  <option value="1">不放大（1×）</option>
                  <option value="1.5">1.5×</option>
                  <option value="2">2×</option>
                </select>
              </label>
            </div>
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
            open={drawerOpen && !!sourceUrl && !!previewUrl}
            title="对比预览"
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
            <div className="clarity-compare-grid">
              <div>
                <p className="clarity-compare-label">原图</p>
                <div className="wm-preview-frame">
                  <img src={sourceUrl ?? ''} alt="原图" />
                </div>
              </div>
              <div>
                <p className="clarity-compare-label">清晰化后</p>
                <div className="wm-preview-frame">
                  <img src={previewUrl ?? ''} alt="清晰化后" />
                </div>
              </div>
            </div>
          </PreviewDrawer>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </>
  )
}
