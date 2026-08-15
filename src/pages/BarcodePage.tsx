import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { usePasteImage } from '../hooks/usePasteImage'
import {
  BARCODE_FORMATS,
  copyText,
  decodeFromImage,
  DEFAULT_QR_COLORS,
  downloadBlobFile,
  generateBarcodePng,
  generateQrPng,
  looksLikeHttpUrl,
  qrContrastHint,
  QR_GRADIENT_DIRS,
  type BarcodeFormatId,
  type DecodeResult,
  type QrColors,
  type QrEcc,
} from '../lib/barcode'

type Mode = 'qr-gen' | 'barcode-gen' | 'qr-decode' | 'barcode-decode'

const MODES: { id: Mode; label: string }[] = [
  { id: 'qr-gen', label: '生成二维码' },
  { id: 'barcode-gen', label: '生成条形码' },
  { id: 'qr-decode', label: '解二维码' },
  { id: 'barcode-decode', label: '解条形码' },
]

const ECC_OPTIONS: { id: QrEcc; label: string }[] = [
  { id: 'L', label: '低' },
  { id: 'M', label: '中' },
  { id: 'Q', label: '较高' },
  { id: 'H', label: '高' },
]

function isDecode(mode: Mode) {
  return mode === 'qr-decode' || mode === 'barcode-decode'
}

export default function BarcodePage() {
  const inputId = useId()
  const logoInputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('qr-gen')
  const [qrText, setQrText] = useState('')
  const [qrSize, setQrSize] = useState(256)
  const [qrEcc, setQrEcc] = useState<QrEcc>('M')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [qrColors, setQrColors] = useState<QrColors>(DEFAULT_QR_COLORS)
  const [barcodeText, setBarcodeText] = useState('')
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormatId>('CODE128')
  const [displayValue, setDisplayValue] = useState(true)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [decoded, setDecoded] = useState<DecodeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, startTransition] = useTransition()

  const formatMeta =
    BARCODE_FORMATS.find((f) => f.id === barcodeFormat) ?? BARCODE_FORMATS[0]!
  const contrastHint = qrContrastHint(qrColors)

  const acceptFile = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择或粘贴图片文件')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setDecoded(null)
      setFile(next)
    })
  }, [])

  usePasteImage(
    useCallback(
      (next: File) => {
        if (isDecode(mode)) acceptFile(next)
      },
      [mode, acceptFile],
    ),
  )

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
    if (!logoFile) {
      setLogoUrl(null)
      return
    }
    const url = URL.createObjectURL(logoFile)
    setLogoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [logoFile])

  const acceptLogo = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择图片作为中心图')
      return
    }
    setError(null)
    setLogoFile(next)
    setQrEcc('H')
  }, [])

  useEffect(() => {
    if (mode !== 'qr-gen') return
    const text = qrText.trim()
    if (!text) {
      setError(null)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setPreviewBlob(null)
      setBusy(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      void generateQrPng({
        text,
        size: qrSize,
        ecc: qrEcc,
        logo: logoFile,
        colors: qrColors,
      })
        .then((result) => {
          if (cancelled) {
            URL.revokeObjectURL(result.previewUrl)
            return
          }
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return result.previewUrl
          })
          setPreviewBlob(result.blob)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return null
          })
          setPreviewBlob(null)
          setError(err instanceof Error ? err.message : '生成失败')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, qrText, qrSize, qrEcc, logoFile, qrColors])

  useEffect(() => {
    if (mode !== 'barcode-gen') return
    const text = barcodeText.trim()
    if (!text) {
      setError(null)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setPreviewBlob(null)
      setBusy(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      void generateBarcodePng({
        text,
        format: barcodeFormat,
        displayValue,
      })
        .then((result) => {
          if (cancelled) {
            URL.revokeObjectURL(result.previewUrl)
            return
          }
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return result.previewUrl
          })
          setPreviewBlob(result.blob)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return null
          })
          setPreviewBlob(null)
          setError(err instanceof Error ? err.message : '生成失败')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, barcodeText, barcodeFormat, displayValue])

  useEffect(() => {
    if (!isDecode(mode) || !file) {
      if (!isDecode(mode)) setDecoded(null)
      return
    }

    let cancelled = false
    setBusy(true)
    setError(null)
    setStatus(null)
    setDecoded(null)

    void decodeFromImage(file, mode === 'qr-decode' ? 'qr' : 'barcode')
      .then((result) => {
        if (cancelled) return
        setDecoded(result)
        setStatus(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '识别失败')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [mode, file])

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setStatus(null)
    if (!isDecode(next)) {
      setFile(null)
      setDecoded(null)
    }
    if (isDecode(next) || next !== mode) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setPreviewBlob(null)
    }
  }

  function onDownload() {
    if (!previewBlob) return
    const name = mode === 'qr-gen' ? 'qrcode.png' : `barcode-${barcodeFormat}.png`
    downloadBlobFile(previewBlob, name)
    setStatus('已下载')
  }

  async function onCopyDecoded() {
    if (!decoded) return
    try {
      await copyText(decoded.text)
      setStatus('已复制识别结果')
      setError(null)
    } catch {
      setError('复制失败，请手动复制')
    }
  }

  return (
    <>
      <header className="brand">
        <p className="brand-mark">二维码</p>
        <h1 className="brand-line">生成与识别</h1>
        <p className="brand-sub">
          本地生成二维码、条形码，也可从图片识别。解码支持拖入、选择或 Ctrl+V
          粘贴。
        </p>
      </header>

      <div className="color-formats" role="radiogroup" aria-label="功能">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={mode === item.id}
            className={mode === item.id ? 'is-selected' : undefined}
            onClick={() => switchMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'qr-gen' && (
        <section className="wm-panel" aria-label="二维码设置">
          <div className="wm-fields">
            <label className="wm-field">
              <span>内容</span>
              <textarea
                value={qrText}
                onChange={(e) => setQrText(e.target.value)}
                placeholder="输入链接或文本"
                rows={4}
              />
            </label>
            <label className="wm-field">
              <span>尺寸 {qrSize}px</span>
              <input
                type="range"
                min={128}
                max={640}
                step={32}
                value={qrSize}
                onChange={(e) => setQrSize(Number(e.target.value))}
              />
            </label>
            <div className="wm-field">
              <span>颜色</span>
              <div className="color-formats" role="radiogroup" aria-label="着色方式">
                <button
                  type="button"
                  role="radio"
                  aria-checked={qrColors.mode === 'solid'}
                  className={qrColors.mode === 'solid' ? 'is-selected' : undefined}
                  onClick={() => setQrColors((c) => ({ ...c, mode: 'solid' }))}
                >
                  纯色
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={qrColors.mode === 'gradient'}
                  className={qrColors.mode === 'gradient' ? 'is-selected' : undefined}
                  onClick={() => setQrColors((c) => ({ ...c, mode: 'gradient' }))}
                >
                  渐变
                </button>
              </div>
            </div>
            <div className="code-color-row">
              <label className="wm-field wm-inline">
                <span>{qrColors.mode === 'gradient' ? '起点' : '码颜色'}</span>
                <input
                  type="color"
                  value={qrColors.fg}
                  onChange={(e) =>
                    setQrColors((c) => ({ ...c, fg: e.target.value }))
                  }
                />
              </label>
              {qrColors.mode === 'gradient' && (
                <label className="wm-field wm-inline">
                  <span>终点</span>
                  <input
                    type="color"
                    value={qrColors.fg2}
                    onChange={(e) =>
                      setQrColors((c) => ({ ...c, fg2: e.target.value }))
                    }
                  />
                </label>
              )}
              <label className="wm-field wm-inline">
                <span>底色</span>
                <input
                  type="color"
                  value={qrColors.bg}
                  onChange={(e) =>
                    setQrColors((c) => ({ ...c, bg: e.target.value }))
                  }
                />
              </label>
            </div>
            {qrColors.mode === 'gradient' && (
              <div className="wm-field">
                <span>渐变方向</span>
                <div className="color-formats" role="radiogroup" aria-label="渐变方向">
                  {QR_GRADIENT_DIRS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={qrColors.dir === item.id}
                      className={qrColors.dir === item.id ? 'is-selected' : undefined}
                      onClick={() =>
                        setQrColors((c) => ({ ...c, dir: item.id }))
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {contrastHint && <p className="wm-hint">{contrastHint}</p>}
            <div className="wm-field">
              <span>容错{logoFile ? '（中心图需高容错）' : ''}</span>
              <div className="color-formats" role="radiogroup" aria-label="容错级别">
                {ECC_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={qrEcc === item.id}
                    className={qrEcc === item.id ? 'is-selected' : undefined}
                    disabled={!!logoFile && item.id !== 'H'}
                    onClick={() => setQrEcc(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="wm-field">
              <span>中心图片</span>
              <div className="code-logo-row">
                {logoUrl ? (
                  <div className="code-logo-thumb" aria-hidden>
                    <img src={logoUrl} alt="" />
                  </div>
                ) : null}
                <button
                  type="button"
                  className="preview-btn"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {logoUrl ? '更换图片' : '添加图片'}
                </button>
                {logoUrl && (
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => setLogoFile(null)}
                  >
                    移除
                  </button>
                )}
                <input
                  id={logoInputId}
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    acceptLogo(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </div>
              <p className="wm-hint">居中叠加，圆角白底，自动提高容错以免影响识别</p>
            </div>
          </div>
        </section>
      )}

      {mode === 'barcode-gen' && (
        <section className="wm-panel" aria-label="条形码设置">
          <div className="wm-fields">
            <label className="wm-field">
              <span>内容</span>
              <input
                type="text"
                value={barcodeText}
                onChange={(e) => setBarcodeText(e.target.value)}
                placeholder="输入条码内容"
              />
            </label>
            <label className="wm-field">
              <span>格式</span>
              <select
                value={barcodeFormat}
                onChange={(e) =>
                  setBarcodeFormat(e.target.value as BarcodeFormatId)
                }
              >
                {BARCODE_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="wm-hint">{formatMeta.hint}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={displayValue}
                onChange={(e) => setDisplayValue(e.target.checked)}
              />
              <span>显示文字</span>
            </label>
          </div>
        </section>
      )}

      {(mode === 'qr-gen' || mode === 'barcode-gen') && (
        <>
          <div className="code-preview">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={mode === 'qr-gen' ? '二维码预览' : '条形码预览'}
              />
            ) : (
              <p className="wm-hint">
                {busy ? '生成中…' : '输入内容后将在此预览'}
              </p>
            )}
          </div>
          <div className="actions">
            <button
              type="button"
              className="generate"
              disabled={!previewBlob || busy}
              onClick={onDownload}
            >
              {busy ? '生成中…' : '下载 PNG'}
            </button>
          </div>
        </>
      )}

      {isDecode(mode) && !sourceUrl && (
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
          <div className="drop-empty">
            <span className="drop-glyph" aria-hidden />
            <strong>拖入 / 点击 / 粘贴图片</strong>
            <span>
              {mode === 'qr-decode'
                ? '识别图片中的二维码'
                : '识别图片中的条形码'}
            </span>
          </div>
        </section>
      )}

      {isDecode(mode) && sourceUrl && (
        <>
          <div className="wm-base-row">
            <div className="drop-preview wm-base-preview">
              <img src={sourceUrl} alt="" />
              <div className="drop-meta">
                <strong>{file?.name}</strong>
                <span>{busy ? '识别中…' : '已上传'}</span>
              </div>
            </div>
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
          </div>

          {decoded && (
            <section className="code-result" aria-label="识别结果">
              <p className="previews-title">{decoded.format}</p>
              <pre>{decoded.text}</pre>
              <div className="actions">
                <button type="button" className="generate" onClick={onCopyDecoded}>
                  复制内容
                </button>
                {looksLikeHttpUrl(decoded.text) && (
                  <a
                    className="preview-btn code-open-link"
                    href={decoded.text.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开链接
                  </a>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </>
  )
}
