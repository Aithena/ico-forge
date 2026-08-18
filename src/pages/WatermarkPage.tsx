import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { Workbench } from '../components/Workbench'
import { usePasteImage } from '../hooks/usePasteImage'
import {
  DEFAULT_WATERMARK,
  FONT_PRESETS,
  downloadBlobFile,
  registerFontFile,
  renderWatermark,
  type WatermarkKind,
  type WatermarkOptions,
} from '../lib/watermark'

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

export default function WatermarkPage() {
  const baseInputId = useId()
  const markInputId = useId()
  const baseInputRef = useRef<HTMLInputElement>(null)
  const markInputRef = useRef<HTMLInputElement>(null)

  const [baseFile, setBaseFile] = useState<File | null>(null)
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [markFile, setMarkFile] = useState<File | null>(null)
  const [markUrl, setMarkUrl] = useState<string | null>(null)
  const [settings, setSettings] = useState<WatermarkOptions>(DEFAULT_WATERMARK)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [customFontName, setCustomFontName] = useState<string | null>(null)
  const [fontBusy, setFontBusy] = useState(false)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const fontInputId = useId()
  const [, startTransition] = useTransition()

  const acceptBase = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择底图图片')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setBaseFile(next)
    })
  }, [])

  usePasteImage(acceptBase)

  useEffect(() => {
    if (!baseFile) {
      setBaseUrl(null)
      return
    }
    const url = URL.createObjectURL(baseFile)
    setBaseUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [baseFile])

  useEffect(() => {
    if (!markFile) {
      setMarkUrl(null)
      return
    }
    const url = URL.createObjectURL(markFile)
    setMarkUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [markFile])

  useEffect(() => {
    if (!baseFile) {
      setPreviewUrl(null)
      return
    }
    if (settings.kind === 'image' && !markFile) {
      setPreviewUrl(null)
      setStatus(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setBusy(true)
      setError(null)
      void renderWatermark({
        base: baseFile,
        markImage: markFile,
        settings,
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
          setStatus(`预览已更新（${result.width}×${result.height}）`)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setError(err instanceof Error ? err.message : '预览失败')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [baseFile, markFile, settings])

  function patch<K extends keyof WatermarkOptions>(
    key: K,
    value: WatermarkOptions[K],
  ) {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  function setKind(kind: WatermarkKind) {
    setSettings((s) => ({ ...s, kind }))
  }

  async function onExport() {
    if (!baseFile) return
    if (settings.kind === 'image' && !markFile) {
      setError('请先上传水印图片')
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await renderWatermark({
        base: baseFile,
        markImage: markFile,
        settings,
      })
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return result.previewUrl
      })
      downloadBlobFile(
        result.blob,
        `${stemFromName(baseFile.name)}-watermark.png`,
      )
      setStatus('已下载加水印图片')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Workbench
      brandMark="加水印"
      brandLine="文字或图片水印"
      brandSub="可自定义位置、是否重复平铺、斜度。支持 Ctrl+V 粘贴底图。"
      resultTitle="水印预览"
      resultEmpty="上传底图后，加水印效果会显示在这里。"
      resultAction={
        previewUrl ? (
          <button
            type="button"
            className="generate"
            disabled={busy || (settings.kind === 'image' && !markFile)}
            onClick={onExport}
          >
            {busy ? '处理中…' : '下载'}
          </button>
        ) : undefined
      }
      result={
        baseUrl ? (
          previewUrl ? (
            <div className="wm-preview-frame">
              <img src={previewUrl} alt="加水印预览" />
            </div>
          ) : (
            <p className="wm-hint">
              {settings.kind === 'image' && !markFile
                ? '请先上传水印图片'
                : busy
                  ? '处理中…'
                  : '预览生成中…'}
            </p>
          )
        ) : null
      }
    >

      {!baseUrl ? (
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
            acceptBase(e.dataTransfer.files[0])
          }}
          onClick={() => baseInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              baseInputRef.current?.click()
            }
          }}
          role="button"
          tabIndex={0}
          aria-controls={baseInputId}
          aria-label="选择底图"
        >
          <input
            id={baseInputId}
            ref={baseInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => acceptBase(e.target.files?.[0])}
          />
          <div className="drop-empty">
            <span className="drop-glyph" aria-hidden />
            <strong>拖入 / 点击 / 粘贴底图</strong>
            <span>先上传要加水印的图片</span>
          </div>
        </section>
      ) : (
        <>
          <div className="wm-base-row">
            <div className="drop-preview wm-base-preview">
              <img src={baseUrl} alt="" />
              <div className="drop-meta">
                <strong>{baseFile?.name}</strong>
                <span>底图</span>
              </div>
            </div>
            <button
              type="button"
              className="preview-btn"
              onClick={() => baseInputRef.current?.click()}
            >
              更换底图
            </button>
            <input
              id={baseInputId}
              ref={baseInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => acceptBase(e.target.files?.[0])}
            />
          </div>

          <section className="wm-panel" aria-label="水印设置">
            <div className="color-formats" role="radiogroup" aria-label="水印类型">
              <button
                type="button"
                role="radio"
                aria-checked={settings.kind === 'text'}
                className={settings.kind === 'text' ? 'is-selected' : undefined}
                onClick={() => setKind('text')}
              >
                文字水印
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={settings.kind === 'image'}
                className={settings.kind === 'image' ? 'is-selected' : undefined}
                onClick={() => setKind('image')}
              >
                图片水印
              </button>
            </div>

            {settings.kind === 'text' ? (
              <div className="wm-fields">
                <label className="wm-field">
                  <span>文字</span>
                  <input
                    type="text"
                    value={settings.text}
                    onChange={(e) => patch('text', e.target.value)}
                    placeholder="输入水印文字"
                  />
                </label>
                <label className="wm-field">
                  <span>字体</span>
                  <select
                    value={
                      customFontName && settings.fontFamily === customFontName
                        ? '__custom__'
                        : (FONT_PRESETS.find((f) => f.family === settings.fontFamily)
                            ?.id ?? 'syne')
                    }
                    onChange={(e) => {
                      const id = e.target.value
                      if (id === '__custom__') {
                        if (customFontName) patch('fontFamily', customFontName)
                        return
                      }
                      const preset = FONT_PRESETS.find((f) => f.id === id)
                      if (preset) patch('fontFamily', preset.family)
                    }}
                    style={{ fontFamily: settings.fontFamily }}
                  >
                    {FONT_PRESETS.map((f) => (
                      <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                        {f.label}
                      </option>
                    ))}
                    {customFontName && (
                      <option value="__custom__">自定义字体</option>
                    )}
                  </select>
                </label>
                <div className="wm-font-actions">
                  <button
                    type="button"
                    className="preview-btn"
                    disabled={fontBusy}
                    onClick={() => fontInputRef.current?.click()}
                  >
                    {fontBusy ? '加载中…' : '上传字体文件'}
                  </button>
                  <input
                    id={fontInputId}
                    ref={fontInputRef}
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      setFontBusy(true)
                      setError(null)
                      try {
                        const family = await registerFontFile(f, f.name)
                        setCustomFontName(family)
                        patch('fontFamily', family)
                        setStatus(`已加载字体：${f.name}`)
                      } catch (err: unknown) {
                        setError(
                          err instanceof Error ? err.message : '字体加载失败',
                        )
                      } finally {
                        setFontBusy(false)
                      }
                    }}
                  />
                  {customFontName && settings.fontFamily === customFontName && (
                    <span className="wm-hint">正在使用上传的自定义字体</span>
                  )}
                </div>
                <label className="wm-field">
                  <span>字号基准 {settings.fontSize}</span>
                  <input
                    type="range"
                    min={16}
                    max={120}
                    value={settings.fontSize}
                    onChange={(e) => patch('fontSize', Number(e.target.value))}
                  />
                </label>
                <label className="wm-field wm-inline">
                  <span>颜色</span>
                  <input
                    type="color"
                    value={settings.color}
                    onChange={(e) => patch('color', e.target.value)}
                  />
                </label>
                <p
                  className="wm-font-sample"
                  style={{ fontFamily: settings.fontFamily }}
                >
                  {settings.text || '字体预览 Aa 水印'}
                </p>
              </div>
            ) : (
              <div className="wm-fields">
                <div className="wm-mark-upload">
                  {markUrl ? (
                    <div className="drop-preview">
                      <img src={markUrl} alt="" />
                      <div className="drop-meta">
                        <strong>{markFile?.name}</strong>
                        <span>水印图</span>
                      </div>
                    </div>
                  ) : (
                    <p className="wm-hint">请上传水印图片（建议透明底 PNG）</p>
                  )}
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => markInputRef.current?.click()}
                  >
                    {markUrl ? '更换水印图' : '选择水印图'}
                  </button>
                  <input
                    id={markInputId}
                    ref={markInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (!f.type.startsWith('image/')) {
                        setError('请选择图片作为水印')
                        return
                      }
                      setMarkFile(f)
                      setStatus(null)
                      setError(null)
                    }}
                  />
                </div>
                <label className="wm-field">
                  <span>水印大小 {Math.round(settings.imageScale * 100)}%</span>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={Math.round(settings.imageScale * 100)}
                    onChange={(e) =>
                      patch('imageScale', Number(e.target.value) / 100)
                    }
                  />
                </label>
              </div>
            )}

            <div className="wm-fields">
              <label className="wm-field">
                <span>水平位置 {Math.round(settings.x * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.x * 100)}
                  onChange={(e) => patch('x', Number(e.target.value) / 100)}
                />
              </label>
              <label className="wm-field">
                <span>垂直位置 {Math.round(settings.y * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.y * 100)}
                  onChange={(e) => patch('y', Number(e.target.value) / 100)}
                />
              </label>
              <label className="wm-field">
                <span>斜度 {settings.angle}°</span>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  value={settings.angle}
                  onChange={(e) => patch('angle', Number(e.target.value))}
                />
              </label>
              <label className="wm-field">
                <span>透明度 {Math.round(settings.opacity * 100)}%</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(settings.opacity * 100)}
                  onChange={(e) =>
                    patch('opacity', Number(e.target.value) / 100)
                  }
                />
              </label>

              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.repeat}
                  onChange={(e) => patch('repeat', e.target.checked)}
                />
                <span>重复平铺</span>
              </label>

              {settings.repeat && (
                <label className="wm-field">
                  <span>间距 {settings.gap}px</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={settings.gap}
                    onChange={(e) => patch('gap', Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          </section>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </Workbench>
  )
}
