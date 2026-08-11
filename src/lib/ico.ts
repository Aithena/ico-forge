export type FitMode = 'contain' | 'cover'

export interface RenderOptions {
  fit?: FitMode
  /** Crop away transparent margins before scaling. Default true. */
  trim?: boolean
}

type Bounds = { x: number; y: number; w: number; h: number }

function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('无法读取图片'))
    if (typeof source === 'string') {
      img.src = source
    } else {
      img.src = URL.createObjectURL(source)
    }
  })
}

/** Find opaque pixel bounding box; returns full frame if fully opaque/empty. */
function findContentBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): Bounds {
  const { data } = ctx.getImageData(0, 0, width, height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w: width, h: height }
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  }
}

function squareSourceRect(bounds: Bounds, imgW: number, imgH: number): Bounds {
  const side = Math.max(bounds.w, bounds.h)
  let x = Math.floor(bounds.x + bounds.w / 2 - side / 2)
  let y = Math.floor(bounds.y + bounds.h / 2 - side / 2)

  x = Math.max(0, Math.min(x, imgW - side))
  y = Math.max(0, Math.min(y, imgH - side))

  // If content is near an edge and side > remaining space, clamp side.
  const w = Math.min(side, imgW - x)
  const h = Math.min(side, imgH - y)
  const sideClamped = Math.min(w, h)

  return { x, y, w: sideClamped, h: sideClamped }
}

function prepareSourceCanvas(
  img: HTMLImageElement,
  trim: boolean,
): { canvas: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number } {
  const width = img.naturalWidth
  const height = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.drawImage(img, 0, 0)

  if (!trim) {
    return { canvas, sx: 0, sy: 0, sw: width, sh: height }
  }

  const bounds = findContentBounds(ctx, width, height)
  const square = squareSourceRect(bounds, width, height)
  return {
    canvas,
    sx: square.x,
    sy: square.y,
    sw: square.w,
    sh: square.h,
  }
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  size: number,
  fit: FitMode,
) {
  ctx.clearRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // After trim, content is usually square — fill the icon directly.
  if (sw === sh) {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, size, size)
    return
  }

  const scale =
    fit === 'cover'
      ? Math.max(size / sw, size / sh)
      : Math.min(size / sw, size / sh)

  const w = sw * scale
  const h = sh * scale
  const x = (size - w) / 2
  const y = (size - h) / 2
  ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h)
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))),
      'image/png',
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

function normalizeOptions(options?: FitMode | RenderOptions): RenderOptions {
  if (typeof options === 'string' || options == null) {
    return { fit: options ?? 'cover', trim: true }
  }
  return {
    fit: options.fit ?? 'cover',
    trim: options.trim ?? true,
  }
}

/** Build a multi-size ICO with PNG payloads (Vista+ / modern browsers). */
export async function encodeIco(
  source: Blob,
  sizes: number[],
  options?: FitMode | RenderOptions,
): Promise<Blob> {
  const { fit, trim } = normalizeOptions(options)
  const uniqueSizes = [...new Set(sizes)].sort((a, b) => a - b)
  const objectUrl = URL.createObjectURL(source)

  try {
    const img = await loadImage(objectUrl)
    const prepared = prepareSourceCanvas(img, trim ?? true)
    const pngs: Uint8Array[] = []

    for (const size of uniqueSizes) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 不可用')
      drawFitted(
        ctx,
        prepared.canvas,
        prepared.sx,
        prepared.sy,
        prepared.sw,
        prepared.sh,
        size,
        fit ?? 'cover',
      )
      pngs.push(await canvasToPng(canvas))
    }

    const count = pngs.length
    const headerSize = 6
    const entrySize = 16
    const dataOffset = headerSize + entrySize * count

    let total = dataOffset
    for (const png of pngs) total += png.length

    const buffer = new ArrayBuffer(total)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    view.setUint16(0, 0, true) // reserved
    view.setUint16(2, 1, true) // ICO
    view.setUint16(4, count, true)

    let offset = dataOffset
    for (let i = 0; i < count; i++) {
      const size = uniqueSizes[i]
      const png = pngs[i]
      const entry = headerSize + i * entrySize

      view.setUint8(entry, size >= 256 ? 0 : size)
      view.setUint8(entry + 1, size >= 256 ? 0 : size)
      view.setUint8(entry + 2, 0)
      view.setUint8(entry + 3, 0)
      view.setUint16(entry + 4, 1, true)
      view.setUint16(entry + 6, 32, true)
      view.setUint32(entry + 8, png.length, true)
      view.setUint32(entry + 12, offset, true)

      bytes.set(png, offset)
      offset += png.length
    }

    return new Blob([buffer], { type: 'image/x-icon' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function makePreviewDataUrls(
  source: Blob,
  sizes: number[],
  options?: FitMode | RenderOptions,
): Promise<{ size: number; url: string }[]> {
  const { fit, trim } = normalizeOptions(options)
  const objectUrl = URL.createObjectURL(source)
  try {
    const img = await loadImage(objectUrl)
    const prepared = prepareSourceCanvas(img, trim ?? true)
    const results: { size: number; url: string }[] = []

    for (const size of sizes) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 不可用')
      drawFitted(
        ctx,
        prepared.canvas,
        prepared.sx,
        prepared.sy,
        prepared.sw,
        prepared.sh,
        size,
        fit ?? 'cover',
      )
      results.push({ size, url: canvas.toDataURL('image/png') })
    }

    return results
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
