import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { Workbench } from '../components/Workbench'
import { usePasteImage } from '../hooks/usePasteImage'
import {
  downloadBlob,
  encodeIco,
  inspectIco,
  makePreviewDataUrls,
} from '../lib/ico'
import { PRESET_ORDER, PRESETS, resolveSizes, type PresetId } from '../lib/presets'

type Preview = { size: number; url: string }

function stemFromName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'icon'
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

export default function IcoPage() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [preset, setPreset] = useState<PresetId>('favicon')
  const [previews, setPreviews] = useState<Preview[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, startTransition] = useTransition()

  const sizes = resolveSizes(preset)
  const renderOptions = { fit: 'cover' as const, trim: false }

  useEffect(() => {
    if (!file) {
      setSourceUrl(null)
      setPreviews([])
      return
    }

    const url = URL.createObjectURL(file)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!file) {
      setPreviews([])
      return
    }

    let cancelled = false
    setError(null)

    makePreviewDataUrls(file, sizes, renderOptions)
      .then((next) => {
        if (!cancelled) setPreviews(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviews([])
          setError(err instanceof Error ? err.message : '预览失败')
        }
      })

    return () => {
      cancelled = true
    }
  }, [file, sizes.join(',')])

  const acceptFile = useCallback((next: File | undefined | null) => {
    if (!next) return
    if (!next.type.startsWith('image/')) {
      setError('请选择图片文件（PNG / JPG / WebP 等）')
      return
    }
    startTransition(() => {
      setError(null)
      setStatus(null)
      setPreviews([])
      setFile(next)
    })
  }, [])

  usePasteImage(acceptFile)

  async function onGenerate() {
    if (!file) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const blob = await encodeIco(file, sizes, renderOptions)
      const entries = await inspectIco(blob)
      await downloadBlob(
        blob,
        preset === 'favicon' ? 'favicon.ico' : `${stemFromName(file.name)}.ico`,
      )
      const sizeList = entries.map((e) => e.size).join(' / ')
      setStatus(
        `已保存 .ico（${formatBytes(blob.size)}，${entries.length} 档：${sizeList} px）。`,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Workbench
      brandMark="ICO Forge"
      brandLine="把图片锻成多尺寸图标"
      brandSub="全程在浏览器本地完成，不上传服务器。"
      resultTitle="尺寸预览"
      resultEmpty="选择图片后，各尺寸预览会显示在这里。"
      resultAction={
        file ? (
          <button
            type="button"
            className="generate"
            disabled={!file || busy}
            onClick={onGenerate}
          >
            {busy ? '生成中…' : '下载'}
          </button>
        ) : undefined
      }
      result={
        file ? (
          <>
            <p className="previews-title">将写入的尺寸（1:1 实际像素）</p>
            {previews.length > 0 ? (
              <ul className="ico-preview-list">
                {previews.map((p, i) => (
                  <li key={p.size} style={{ animationDelay: `${80 + i * 60}ms` }}>
                    <div
                      className="preview-frame"
                      style={{ width: p.size, height: p.size }}
                    >
                      <img
                        src={p.url}
                        alt={`${p.size} 像素预览`}
                        width={p.size}
                        height={p.size}
                      />
                    </div>
                    <span>{p.size}px</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wm-hint">预览生成中…</p>
            )}
          </>
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
        aria-label="选择或拖入图片"
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
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
            <strong>拖入图片到这里</strong>
            <span>或点击选择 · 也可 Ctrl+V 粘贴</span>
          </div>
        )}
      </section>

      <section className="controls" aria-label="导出设置">
        <div className="preset-row" role="radiogroup" aria-label="图标类型">
          {PRESET_ORDER.map((id) => {
            const item = PRESETS[id]
            const selected = preset === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`preset${selected ? ' is-selected' : ''}`}
                onClick={() => setPreset(id)}
              >
                <span className="preset-label">{item.label}</span>
                <span className="preset-hint">{item.hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {status && <p className="status">{status}</p>}
    </Workbench>
  )
}
