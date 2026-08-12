export interface ClarityOptions {
  /** sharpen strength 0–3 */
  amount: number
  /** blur radius for unsharp mask, 0.5–4 */
  radius: number
  /** skip low-contrast noise, 0–40 */
  threshold: number
  /** optional upscale before sharpen: 1 | 1.5 | 2 */
  upscale: number
}

export const DEFAULT_CLARITY: ClarityOptions = {
  amount: 1.2,
  radius: 1.2,
  threshold: 4,
  upscale: 1,
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

function drawToCanvas(
  img: HTMLImageElement,
  scale: number,
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

/** Separable Gaussian blur (approx) into a new ImageData. */
function gaussianBlur(src: ImageData, radius: number): ImageData {
  const { width, height, data } = src
  const sigma = Math.max(0.4, radius)
  const kernelRadius = Math.max(1, Math.ceil(sigma * 2.5))
  const kernelSize = kernelRadius * 2 + 1
  const kernel = new Float32Array(kernelSize)
  let sum = 0
  for (let i = -kernelRadius; i <= kernelRadius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + kernelRadius] = v
    sum += v
  }
  for (let i = 0; i < kernelSize; i++) kernel[i]! /= sum

  const temp = new Float32Array(width * height * 4)
  const out = new ImageData(width, height)

  // Horizontal
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = -kernelRadius; k <= kernelRadius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k))
        const i = (y * width + xx) * 4
        const wgt = kernel[k + kernelRadius]!
        r += data[i]! * wgt
        g += data[i + 1]! * wgt
        b += data[i + 2]! * wgt
        a += data[i + 3]! * wgt
      }
      const o = (y * width + x) * 4
      temp[o] = r
      temp[o + 1] = g
      temp[o + 2] = b
      temp[o + 3] = a
    }
  }

  // Vertical
  const dst = out.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = -kernelRadius; k <= kernelRadius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k))
        const i = (yy * width + x) * 4
        const wgt = kernel[k + kernelRadius]!
        r += temp[i]! * wgt
        g += temp[i + 1]! * wgt
        b += temp[i + 2]! * wgt
        a += temp[i + 3]! * wgt
      }
      const o = (y * width + x) * 4
      dst[o] = r
      dst[o + 1] = g
      dst[o + 2] = b
      dst[o + 3] = a
    }
  }

  return out
}

/** Unsharp mask: original + amount * (original - blurred). */
function unsharpMask(
  src: ImageData,
  amount: number,
  radius: number,
  threshold: number,
): ImageData {
  const blurred = gaussianBlur(src, radius)
  const out = new ImageData(src.width, src.height)
  const a = src.data
  const b = blurred.data
  const d = out.data

  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const orig = a[i + c]!
      const blur = b[i + c]!
      const diff = orig - blur
      if (Math.abs(diff) > threshold) {
        d[i + c] = Math.min(255, Math.max(0, Math.round(orig + diff * amount)))
      } else {
        d[i + c] = orig
      }
    }
    d[i + 3] = a[i + 3]!
  }

  return out
}

export async function enhanceClarity(
  source: Blob,
  options: ClarityOptions,
): Promise<{ blob: Blob; width: number; height: number; previewUrl: string }> {
  const img = await loadImage(source)
  const canvas = drawToCanvas(img, options.upscale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用')

  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const sharpened = unsharpMask(
    src,
    options.amount,
    options.radius,
    options.threshold,
  )
  ctx.putImageData(sharpened, 0, 0)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('导出失败'))),
      'image/png',
    )
  })

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    previewUrl: canvas.toDataURL('image/png'),
  }
}

export function downloadClarityFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
