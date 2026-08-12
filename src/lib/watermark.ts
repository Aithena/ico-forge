export type WatermarkKind = 'text' | 'image'

export interface WatermarkOptions {
  kind: WatermarkKind
  /** 0–1 relative position of watermark anchor on the base image */
  x: number
  y: number
  /** degrees, clockwise */
  angle: number
  repeat: boolean
  /** tile gap in px when repeating */
  gap: number
  opacity: number
  /** text options */
  text: string
  fontSize: number
  color: string
  /** CSS font-family stack or custom family name */
  fontFamily: string
  /** image watermark scale relative to base width (0.05–0.8) */
  imageScale: number
}

export const FONT_PRESETS: { id: string; label: string; family: string }[] = [
  {
    id: 'syne',
    label: 'Syne',
    family: '"Syne", "Segoe UI", sans-serif',
  },
  {
    id: 'manrope',
    label: 'Manrope',
    family: '"Manrope", "Segoe UI", sans-serif',
  },
  {
    id: 'system',
    label: '系统默认',
    family: 'system-ui, "Segoe UI", sans-serif',
  },
  {
    id: 'serif',
    label: '衬线',
    family: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'mono',
    label: '等宽',
    family: 'ui-monospace, Consolas, monospace',
  },
  {
    id: 'hei',
    label: '黑体',
    family: '"Microsoft YaHei", "PingFang SC", sans-serif',
  },
  {
    id: 'song',
    label: '宋体',
    family: 'SimSun, "Songti SC", serif',
  },
  {
    id: 'kai',
    label: '楷体',
    family: 'KaiTi, "Kaiti SC", serif',
  },
]

export const DEFAULT_WATERMARK: WatermarkOptions = {
  kind: 'text',
  x: 0.5,
  y: 0.5,
  angle: -30,
  repeat: true,
  gap: 48,
  opacity: 0.28,
  text: '水印',
  fontSize: 36,
  color: '#ffffff',
  fontFamily: FONT_PRESETS[0]!.family,
  imageScale: 0.18,
}

let customFontSeq = 0

/** Register an uploaded font file and return a usable CSS family name. */
export async function registerFontFile(file: Blob, fileName?: string): Promise<string> {
  customFontSeq += 1
  const family = `WmCustomFont${customFontSeq}`
  const url = URL.createObjectURL(file)
  try {
    const face = new FontFace(family, `url(${url})`, {
      weight: '400',
      style: 'normal',
    })
    const loaded = await face.load()
    document.fonts.add(loaded)
    await document.fonts.load(`700 48px "${family}"`)
    return `"${family}"`
  } finally {
    // Keep URL alive while font may still resolve from cache; revoke later quietly.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    void fileName
  }
}

function loadImage(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取图片'))
    }
    img.src = url
  })
}

async function makeTextStamp(
  text: string,
  fontSize: number,
  color: string,
  opacity: number,
  fontFamily: string,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')

  const font = `700 ${fontSize}px ${fontFamily}`
  try {
    await document.fonts.load(font)
  } catch {
    // Fall through with whatever is available.
  }

  ctx.font = font
  const metrics = ctx.measureText(text || ' ')
  const padX = Math.ceil(fontSize * 0.35)
  const padY = Math.ceil(fontSize * 0.35)
  const w = Math.ceil(metrics.width) + padX * 2
  const h = Math.ceil(fontSize * 1.35) + padY * 2
  canvas.width = Math.max(1, w)
  canvas.height = Math.max(1, h)

  const draw = canvas.getContext('2d')
  if (!draw) throw new Error('Canvas 不可用')
  draw.clearRect(0, 0, w, h)
  draw.font = font
  draw.fillStyle = color
  draw.globalAlpha = opacity
  draw.textBaseline = 'middle'
  draw.textAlign = 'left'
  draw.fillText(text || ' ', padX, h / 2)
  return canvas
}

async function makeImageStamp(
  mark: HTMLImageElement,
  targetWidth: number,
  opacity: number,
): Promise<HTMLCanvasElement> {
  const scale = targetWidth / Math.max(1, mark.naturalWidth)
  const w = Math.max(1, Math.round(mark.naturalWidth * scale))
  const h = Math.max(1, Math.round(mark.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.clearRect(0, 0, w, h)
  ctx.globalAlpha = opacity
  ctx.drawImage(mark, 0, 0, w, h)
  return canvas
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  stamp: HTMLCanvasElement,
  x: number,
  y: number,
  angleDeg: number,
) {
  const rad = (angleDeg * Math.PI) / 180
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rad)
  ctx.drawImage(stamp, -stamp.width / 2, -stamp.height / 2)
  ctx.restore()
}

/**
 * Composite base image + watermark onto a canvas and return a PNG blob.
 */
export async function renderWatermark(options: {
  base: Blob
  markImage?: Blob | null
  settings: WatermarkOptions
}): Promise<{ blob: Blob; width: number; height: number; previewUrl: string }> {
  const baseImg = await loadImage(options.base)
  const width = baseImg.naturalWidth
  const height = baseImg.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')

  ctx.drawImage(baseImg, 0, 0)

  let stamp: HTMLCanvasElement
  if (options.settings.kind === 'text') {
    const size = Math.max(
      12,
      Math.round(options.settings.fontSize * (width / 800)),
    )
    stamp = await makeTextStamp(
      options.settings.text,
      size,
      options.settings.color,
      options.settings.opacity,
      options.settings.fontFamily,
    )
  } else {
    if (!options.markImage) throw new Error('请先上传水印图片')
    const markImg = await loadImage(options.markImage)
    const targetW = Math.max(
      8,
      Math.round(width * options.settings.imageScale),
    )
    stamp = await makeImageStamp(markImg, targetW, options.settings.opacity)
  }

  const angle = options.settings.angle
  const cx = options.settings.x * width
  const cy = options.settings.y * height

  if (!options.settings.repeat) {
    drawStamp(ctx, stamp, cx, cy, angle)
  } else {
    const gap = Math.max(0, options.settings.gap)
    const stepX = stamp.width + gap
    const stepY = stamp.height + gap
    const diag = Math.ceil(Math.hypot(width, height))
    const startX = cx - diag
    const startY = cy - diag
    const endX = cx + diag
    const endY = cy + diag

    const offsetX = ((cx - startX) % stepX + stepX) % stepX
    const offsetY = ((cy - startY) % stepY + stepY) % stepY

    for (let y = startY + offsetY; y <= endY; y += stepY) {
      for (let x = startX + offsetX; x <= endX; x += stepX) {
        drawStamp(ctx, stamp, x, y, angle)
      }
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('导出失败'))),
      'image/png',
    )
  })

  return {
    blob,
    width,
    height,
    previewUrl: canvas.toDataURL('image/png'),
  }
}

export function downloadBlobFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
