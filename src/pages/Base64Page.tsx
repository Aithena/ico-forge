import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { Workbench } from '../components/Workbench'
import { usePasteImage } from '../hooks/usePasteImage'
import {
  bytesToBlob,
  copyText,
  downloadBytes,
  formatBase64,
  formatBytes,
  optimizeImage,
  type Base64Format,
  type OptimizedImage,
} from '../lib/pngBase64'

const FORMATS: { id: Base64Format; label: string }[] = [
  { id: 'data-url', label: 'Data URI' },
  { id: 'raw', label: 'Base64' },
  { id: 'css', label: 'CSS' },
]

const LOCK_WIDTH = 100

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'icon'
}

function extForMime(mime: string) {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'bin'
}

export default function Base64Page() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [result, setResult] = useState<OptimizedImage | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [format, setFormat] = useState<Base64Format>('data-url')
  const [lockWidth, setLockWidth] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, startTransition] = useTransition()

  const output = result ? formatBase64(result.bytes, result.mime, format) : null

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
    if (!result) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(bytesToBlob(result.bytes, result.mime))
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])

  useEffect(() => {
    if (!file) {
      setResult(null)
      return
    }

    let cancelled = false
    setBusy(true)
    setError(null)
    setStatus(null)
    setResult(null)

    void optimizeImage(file, {
      lockWidth: lockWidth ? LOCK_WIDTH : undefined,
    })
      .then((next) => {
        if (cancelled) return
        setResult(next)
        const saved = next.originalSize - next.bytes.byteLength
        const resized =
          next.width !== next.sourceWidth || next.height !== next.sourceHeight
        if (resized) {
          setStatus(
            `已输出 ${next.width}×${next.height}（原 ${next.sourceWidth}×${next.sourceHeight}），${formatBytes(next.originalSize)} → ${formatBytes(next.bytes.byteLength)}。`,
          )
        } else if (saved > 0) {
          const pct = Math.round((saved / next.originalSize) * 100)
          setStatus(
            `已压紧 ${formatBytes(next.originalSize)} → ${formatBytes(next.bytes.byteLength)}（-${pct}%），尺寸 ${next.width}×${next.height} 未改。`,
          )
        } else {
          setStatus(
            `原图已较精简。${next.width}×${next.height}，${formatBytes(next.bytes.byteLength)}。`,
          )
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '处理失败')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [file, lockWidth])

  const acceptFile = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择 PNG 等图片文件')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setResult(null)
      setFile(next)
    })
  }, [])

  usePasteImage(acceptFile)

  async function onCopy() {
    if (!output) return
    try {
      await copyText(output)
      setStatus(`已复制（${formatBytes(output.length)} 文本）`)
      setError(null)
    } catch {
      setError('复制失败，请手动全选文本')
    }
  }

  function onDownload() {
    if (!file || !result) return
    const name = `${stemFromName(file.name)}.${extForMime(result.mime)}`
    downloadBytes(result.bytes, name, result.mime)
    setStatus(`已保存 ${name}（${formatBytes(result.bytes.byteLength)}）。`)
  }

  const saved = result
    ? Math.max(0, result.originalSize - result.bytes.byteLength)
    : 0
  const savedPct =
    result && result.originalSize > 0
      ? Math.round((saved / result.originalSize) * 100)
      : 0

  return (
    <Workbench
      brandMark="PNG → Base64"
      brandLine="图标转嵌入代码"
      brandSub="去掉元数据、无损压紧。默认宽度锁定 100px。全程本地处理。"
      resultTitle="Base64"
      resultEmpty="选择 PNG 图标后，优化结果和 Base64 会显示在这里。"
      resultAction={
        result ? (
          <>
            <button
              type="button"
              className="preview-btn"
              disabled={busy}
              onClick={onDownload}
            >
              下载
            </button>
            <button
              type="button"
              className="generate"
              disabled={!output || busy}
              onClick={() => void onCopy()}
            >
              复制
            </button>
          </>
        ) : undefined
      }
      result={
        file ? (
          result && previewUrl && output ? (
            <>
              <div className="b64-preview-frame">
                <img
                  src={previewUrl}
                  alt="优化后预览"
                  width={result.width}
                  height={result.height}
                  className={result.width <= 128 ? 'is-icon' : undefined}
                />
              </div>
              <p className="b64-stats">
                <span>
                  {result.width !== result.sourceWidth ||
                  result.height !== result.sourceHeight
                    ? `${result.sourceWidth} × ${result.sourceHeight} → ${result.width} × ${result.height}`
                    : `${result.width} × ${result.height}`}
                </span>
                <span>
                  {formatBytes(result.originalSize)}
                  {saved > 0 ? (
                    <>
                      {' → '}
                      <strong>{formatBytes(result.bytes.byteLength)}</strong>
                      {savedPct > 0 ? `（-${savedPct}%）` : ''}
                    </>
                  ) : (
                    <> · {formatBytes(result.bytes.byteLength)}</>
                  )}
                </span>
              </p>
              <section className="code-result" aria-label="Base64 结果">
                <pre className="b64-output">{output}</pre>
              </section>
            </>
          ) : (
            <p className="wm-hint">{busy ? '优化中…' : '处理中…'}</p>
          )
        ) : null
      }
    >
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
          accept="image/png,image/webp,image/gif,image/jpeg"
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
            <strong>拖入 PNG 图标</strong>
            <span>点击选择 · 也可 Ctrl+V 粘贴</span>
          </div>
        )}
      </section>

      <section className="controls" aria-label="输出设置">
        <div className="wm-field">
          <span>输出尺寸</span>
          <label className="check">
            <input
              type="checkbox"
              checked={lockWidth}
              onChange={(e) => setLockWidth(e.target.checked)}
            />
            <span>宽度锁定 100px</span>
          </label>
        </div>
        <div className="color-formats" role="radiogroup" aria-label="Base64 格式">
          {FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={format === item.id}
              className={format === item.id ? 'is-selected' : undefined}
              onClick={() => setFormat(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="wm-hint">
          {lockWidth
            ? '输出宽度固定 100px，高度按比例。同时去掉元数据、无损压紧。'
            : '只剥 EXIF / ICC / 文本等元数据，并做无损重打包。不缩放。'}
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </Workbench>
  )
}
