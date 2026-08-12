import { enhanceClarity } from './clarity'

export type AspectId =
  | 'free'
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16'
  | '3:2'
  | '2:3'

export type CropRect = {
  x: number
  y: number
  w: number
  h: number
}

/** Output shorter than this is upscaled and sharpened. */
export const MIN_CROP_EDGE = 500

export const ASPECT_PRESETS: {
  id: AspectId
  label: string
  ratio: number | null
}[] = [
  { id: 'free', label: '自由', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
]

export function aspectRatioOf(id: AspectId): number | null {
  return ASPECT_PRESETS.find((p) => p.id === id)?.ratio ?? null
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Largest centered crop of given aspect inside the image. */
export function initialCrop(
  imgW: number,
  imgH: number,
  ratio: number | null,
): CropRect {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    return { x: 0, y: 0, w: imgW, h: imgH }
  }
  let w = imgW
  let h = w / ratio
  if (h > imgH) {
    h = imgH
    w = h * ratio
  }
  return {
    x: (imgW - w) / 2,
    y: (imgH - h) / 2,
    w,
    h,
  }
}

/** Re-fit crop to a new aspect while staying inside the image. */
export function refitCrop(
  crop: CropRect,
  imgW: number,
  imgH: number,
  ratio: number | null,
): CropRect {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    return clampCrop(crop, imgW, imgH, null)
  }

  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  const area = crop.w * crop.h
  let w = Math.sqrt(area * ratio)
  let h = w / ratio

  if (w > imgW) {
    w = imgW
    h = w / ratio
  }
  if (h > imgH) {
    h = imgH
    w = h * ratio
  }

  return clampCrop(
    { x: cx - w / 2, y: cy - h / 2, w, h },
    imgW,
    imgH,
    ratio,
  )
}

export function clampCrop(
  crop: CropRect,
  imgW: number,
  imgH: number,
  ratio: number | null,
): CropRect {
  let { x, y, w, h } = crop
  const minSide = 16

  w = clamp(w, minSide, imgW)
  h = clamp(h, minSide, imgH)

  if (ratio && ratio > 0) {
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
    w = clamp(w, minSide, imgW)
    h = clamp(h, minSide, imgH)
    if (w / h > ratio) w = h * ratio
    else h = w / ratio
  }

  x = clamp(x, 0, imgW - w)
  y = clamp(y, 0, imgH - h)
  return { x, y, w, h }
}

export function loadImageFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}

function drawRegion(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  crop: CropRect,
  outW: number,
  outH: number,
) {
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    0,
    0,
    outW,
    outH,
  )
}

export type RenderCropOptions = {
  image: HTMLImageElement
  crop: CropRect
  circle: boolean
  /** Cap the longer edge of the export. */
  maxEdge?: number
  /** Upscale + sharpen when either edge is below this (default 500). */
  minEdge?: number
}

export async function renderCrop(
  options: RenderCropOptions,
): Promise<{
  blob: Blob
  previewUrl: string
  width: number
  height: number
  upscaled: boolean
}> {
  const { image, crop, circle } = options
  const maxEdge = options.maxEdge ?? 2048
  const minEdge = options.minEdge ?? MIN_CROP_EDGE

  let outW = Math.max(1, Math.round(crop.w))
  let outH = Math.max(1, Math.round(crop.h))
  const long = Math.max(outW, outH)
  if (long > maxEdge) {
    const s = maxEdge / long
    outW = Math.max(1, Math.round(outW * s))
    outH = Math.max(1, Math.round(outH * s))
  }

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  if (!circle) {
    drawRegion(ctx, image, crop, outW, outH)
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.save()
    ctx.beginPath()
    ctx.arc(outW / 2, outH / 2, Math.min(outW, outH) / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    drawRegion(ctx, image, crop, outW, outH)
    ctx.restore()
  }

  let blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('导出失败'))),
      'image/png',
    )
  })

  let width = outW
  let height = outH
  let upscaled = false

  if (outW < minEdge || outH < minEdge) {
    const scale = Math.max(minEdge / outW, minEdge / outH)
    const enhanced = await enhanceClarity(blob, {
      amount: 1.45,
      radius: 1.25,
      threshold: 3,
      upscale: scale,
    })
    blob = enhanced.blob
    width = enhanced.width
    height = enhanced.height
    upscaled = true
  }

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
    upscaled,
  }
}

export function downloadCropFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
