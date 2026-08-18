import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { Workbench } from '../components/Workbench'
import { usePasteImage } from '../hooks/usePasteImage'
import { formatBytes } from '../lib/pngBase64'
import {
  compressSvg,
  downloadTextFile,
  extractSvgMarkup,
  formatSvg,
  isSvgFile,
  pngToSvg,
} from '../lib/pngToSvg'

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'icon'
}

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export default function PngSvgPage() {
  const inputId = useId()
  const svgInputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [svgDraft, setSvgDraft] = useState('')
  const [svgText, setSvgText] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, startTransition] = useTransition()

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
    if (!svgText) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(
      new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }),
    )
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [svgText])

  useEffect(() => {
    if (!file) return

    let cancelled = false
    setBusy(true)
    setError(null)
    setStatus(null)
    setSvgText(null)

    void pngToSvg(file)
      .then((result) => {
        if (cancelled) return
        setSvgDraft(result.svg)
        setSvgText(result.svg)
        const svgSize = formatBytes(result.svg.length)
        if (result.optimizedSize < result.originalSize) {
          setStatus(
            `已丢掉多余字节 ${formatBytes(result.originalSize)} → ${formatBytes(result.optimizedSize)}，矢量 ${svgSize}`,
          )
        } else {
          setStatus(`预览已就绪（${svgSize}）`)
        }
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

  const acceptSvg = useCallback((text: string, sourceName?: string) => {
    const svg = extractSvgMarkup(text)
    if (!svg) {
      setError('没有找到可用的 SVG 代码')
      return false
    }
    startTransition(() => {
      setFile(null)
      setError(null)
      setSvgDraft(text.trim())
      setSvgText(svg)
      setStatus(
        sourceName
          ? `已载入 ${sourceName}（${(svg.length / 1024).toFixed(1)} KB）`
          : `预览已就绪（${(svg.length / 1024).toFixed(1)} KB）`,
      )
    })
    return true
  }, [])

  const acceptFile = useCallback(
    (next: File | undefined | null) => {
      if (!next) return
      if (isSvgFile(next)) {
        void next
          .text()
          .then((text) => {
            if (!acceptSvg(text, next.name)) {
              setError('这个 SVG 文件里没有可用的标记')
            }
          })
          .catch(() => setError('无法读取 SVG 文件'))
        return
      }
      if (!next.type.startsWith('image/')) {
        setError('请选择 PNG 等位图，或粘贴 SVG 代码')
        return
      }
      startTransition(() => {
        setError(null)
        setStatus(null)
        setSvgDraft('')
        setSvgText(null)
        setFile(next)
      })
    },
    [acceptSvg],
  )

  usePasteImage(acceptFile)

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target)) return
      const items = e.clipboardData?.items
      if (items) {
        for (const item of items) {
          if (item.type.startsWith('image/')) return
        }
      }
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!extractSvgMarkup(text)) return
      e.preventDefault()
      acceptSvg(text)
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [acceptSvg])

  function onSvgDraftChange(value: string) {
    setSvgDraft(value)
    const svg = extractSvgMarkup(value)
    if (!svg) {
      if (!value.trim()) {
        setSvgText(null)
        setStatus(null)
        setError(null)
      }
      return
    }
    if (file) setFile(null)
    setSvgText(svg)
    setError(null)
    setStatus(`预览已就绪（${(svg.length / 1024).toFixed(1)} KB）`)
  }

  function applyRewrittenSvg(next: string, label: string) {
    const svg = extractSvgMarkup(next)
    if (!svg) {
      setError('没有找到可用的 SVG 代码')
      return
    }
    const before = svgDraft.length
    setSvgDraft(next)
    setSvgText(svg)
    setError(null)
    setStatus(
      `${label} ${formatBytes(before)} → ${formatBytes(next.length)}`,
    )
  }

  function onCompressSvg() {
    try {
      applyRewrittenSvg(compressSvg(svgDraft || svgText || ''), '已压缩')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '压缩失败')
    }
  }

  function onFormatSvg() {
    try {
      applyRewrittenSvg(formatSvg(svgDraft || svgText || ''), '已格式化')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '格式化失败')
    }
  }

  async function onConvert() {
    if (!svgText) return
    setError(null)
    const name = `${stemFromName(file?.name ?? 'icon')}.svg`
    downloadTextFile(svgText, name)
    setStatus(`已保存 ${name}（${formatBytes(svgText.length)}）。`)
  }

  const canRewrite = Boolean(extractSvgMarkup(svgDraft))

  return (
    <Workbench
      brandMark="PNG → SVG"
      brandLine="纯色图标转矢量"
      brandSub="可上传纯色 PNG 转矢量，也可粘贴 SVG 代码预览。全程本地处理。"
      resultTitle="矢量预览"
      resultEmpty="选择 PNG 或粘贴 SVG 代码后，预览会显示在这里。"
      resultAction={
        svgText ? (
          <button
            type="button"
            className="generate"
            disabled={!svgText || busy}
            onClick={onConvert}
          >
            {busy ? '转换中…' : '下载'}
          </button>
        ) : undefined
      }
      result={
        svgText && previewUrl ? (
          <div className="svg-preview-frame">
            <img
              src={previewUrl}
              alt="SVG 预览"
              onError={() => setError('无法渲染这段 SVG 代码')}
            />
          </div>
        ) : file ? (
          <p className="wm-hint">{busy ? '转换中…' : '预览生成中…'}</p>
        ) : svgDraft.trim() ? (
          <p className="wm-hint">等待完整的 SVG 代码…</p>
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
          const dropped = e.dataTransfer.files[0]
          if (dropped) {
            acceptFile(dropped)
            return
          }
          const text = e.dataTransfer.getData('text/plain')
          if (text) acceptSvg(text)
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
        aria-label="选择或拖入 PNG / SVG"
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/png,image/webp,image/gif,image/svg+xml,.svg"
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
            <span>点击选择 · Ctrl+V 粘贴图片或 SVG 代码</span>
          </div>
        )}
      </section>

      <div className="wm-field svg-code-field">
        <label htmlFor={svgInputId}>SVG 代码</label>
        <textarea
          id={svgInputId}
          value={svgDraft}
          onChange={(e) => onSvgDraftChange(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text/plain')
            const svg = extractSvgMarkup(text)
            if (!svg) return
            e.preventDefault()
            acceptSvg(text)
          }}
          placeholder="在此粘贴 <svg>…</svg> 代码，右侧会显示预览"
          rows={8}
          spellCheck={false}
        />
        <div className="svg-code-actions">
          <button
            type="button"
            className="preview-btn"
            disabled={!canRewrite}
            onClick={onCompressSvg}
          >
            压缩
          </button>
          <button
            type="button"
            className="preview-btn"
            disabled={!canRewrite}
            onClick={onFormatSvg}
          >
            格式化
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </Workbench>
  )
}
