import { bytesToBlob, optimizeImage } from './pngBase64'

export type FitMode = 'contain' | 'cover'

export interface RenderOptions {
  fit?: FitMode
  /** Crop away transparent margins before scaling. Default true. */
  trim?: boolean
}

export interface IcoEntryInfo {
  size: number
  bytes: number
  format: 'png' | 'bmp' | 'unknown'
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
    return { fit: options ?? 'cover', trim: false }
  }
  return {
    fit: options.fit ?? 'cover',
    trim: options.trim ?? false,
  }
}

function isPng(data: Uint8Array): boolean {
  return (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  )
}

/** Assemble multi-size ICO. PNG payloads use planes/bitcount = 0 (ICO/PNG spec). */
export function buildIco(images: { size: number; data: Uint8Array }[]): Blob {
  const count = images.length
  const headerSize = 6
  const entrySize = 16
  const dataOffset = headerSize + entrySize * count

  let total = dataOffset
  for (const image of images) total += image.data.length

  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, count, true)

  let offset = dataOffset
  for (let i = 0; i < count; i++) {
    const { size, data } = images[i]!
    const entry = headerSize + i * entrySize
    const png = isPng(data)

    view.setUint8(entry, size >= 256 ? 0 : size)
    view.setUint8(entry + 1, size >= 256 ? 0 : size)
    view.setUint8(entry + 2, 0)
    view.setUint8(entry + 3, 0)
    // PNG-in-ICO requires 0/0; BMP uses 1/32
    view.setUint16(entry + 4, png ? 0 : 1, true)
    view.setUint16(entry + 6, png ? 0 : 32, true)
    view.setUint32(entry + 8, data.length, true)
    view.setUint32(entry + 12, offset, true)

    bytes.set(data, offset)
    offset += data.length
  }

  return new Blob([bytes], { type: 'application/octet-stream' })
}

async function renderSizeCanvases(
  source: Blob,
  sizes: number[],
  options?: FitMode | RenderOptions,
): Promise<{
  frames: { size: number; canvas: HTMLCanvasElement }[]
  originalSize: number
  optimizedSize: number
}> {
  const optimized = await optimizeImage(source)
  const preparedBlob = bytesToBlob(optimized.bytes, optimized.mime)
  const { fit, trim } = normalizeOptions(options)
  const uniqueSizes = [...new Set(sizes)].sort((a, b) => b - a) // largest first
  const objectUrl = URL.createObjectURL(preparedBlob)

  try {
    const img = await loadImage(objectUrl)
    const prepared = prepareSourceCanvas(img, trim ?? true)
    const frames: { size: number; canvas: HTMLCanvasElement }[] = []

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
      frames.push({ size, canvas })
    }

    return {
      frames,
      originalSize: optimized.originalSize,
      optimizedSize: optimized.bytes.byteLength,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Build a multi-size ICO using PNG payloads for every size (Vista+). */
export async function encodeIco(
  source: Blob,
  sizes: number[],
  options?: FitMode | RenderOptions,
): Promise<Blob> {
  const { frames } = await renderSizeCanvases(source, sizes, options)
  const images: { size: number; data: Uint8Array }[] = []

  for (const frame of frames) {
    images.push({ size: frame.size, data: await canvasToPng(frame.canvas) })
  }

  return buildIco(images)
}

export async function makePreviewDataUrls(
  source: Blob,
  sizes: number[],
  options?: FitMode | RenderOptions,
): Promise<{
  previews: { size: number; url: string }[]
  originalSize: number
  optimizedSize: number
}> {
  // Keep preview order small → large for UI
  const ordered = [...new Set(sizes)].sort((a, b) => a - b)
  const { frames, originalSize, optimizedSize } = await renderSizeCanvases(
    source,
    ordered,
    options,
  )
  const bySize = new Map(frames.map((f) => [f.size, f.canvas]))

  return {
    previews: ordered.map((size) => {
      const canvas = bySize.get(size)!
      return { size, url: canvas.toDataURL('image/png') }
    }),
    originalSize,
    optimizedSize,
  }
}

export async function inspectIco(blob: Blob): Promise<IcoEntryInfo[]> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  if (buf.length < 6) return []

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) {
    return []
  }

  const count = view.getUint16(4, true)
  const entries: IcoEntryInfo[] = []

  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    if (entry + 16 > buf.length) break

    let size = view.getUint8(entry)
    if (size === 0) size = 256
    const bytes = view.getUint32(entry + 8, true)
    const offset = view.getUint32(entry + 12, true)
    const slice = buf.subarray(offset, offset + Math.min(8, bytes))
    const format = isPng(slice) ? 'png' : slice.length >= 4 ? 'bmp' : 'unknown'

    entries.push({ size, bytes, format })
  }

  return entries
}

export async function countIcoImages(blob: Blob): Promise<number> {
  return (await inspectIco(blob)).length
}

export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<void> {
  const name = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.ico`
  const binary = new Blob([blob], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(binary)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
