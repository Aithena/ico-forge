import Pica from 'pica'
import { Upscaler, type Model } from 'upscalejs'

let shared: Upscaler | null = null
let sharedModel: Model | null = null
let loading: Promise<Upscaler> | null = null
/** Serialize AI jobs — concurrent worker calls often fail. */
let chain: Promise<unknown> = Promise.resolve()

const pica = Pica({ features: ['js', 'wasm', 'ww'] })

function aiBaseUrl() {
  return new URL(`${import.meta.env.BASE_URL}ai/`, window.location.origin).href
}

async function getUpscaler(model: Model = 'Swin2SR'): Promise<Upscaler> {
  if (shared && sharedModel === model) return shared
  if (loading) return loading

  loading = (async () => {
    if (shared) {
      shared.terminate()
      shared = null
      sharedModel = null
    }
    const upscaler = new Upscaler({
      base: aiBaseUrl(),
      model,
      workerCount: 1,
      numThreads: 1,
      forceUpscale: true,
    })
    shared = upscaler
    sharedModel = model
    loading = null
    return upscaler
  })()

  return loading
}

function canvasFromBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('AI 导出失败'))),
      'image/png',
    )
  })
}

/** True if any pixel is not fully opaque. */
function hasTransparency(imageData: ImageData): boolean {
  const d = imageData.data
  for (let i = 3; i < d.length; i += 4) {
    if (d[i]! < 255) return true
  }
  return false
}

/**
 * Swin2SR / ESRGAN ignore alpha and treat empty pixels as black.
 * Split alpha, matte RGB on white for the model, then restore scaled alpha.
 */
function splitAlphaMatte(source: HTMLCanvasElement): {
  rgb: HTMLCanvasElement
  alpha: HTMLCanvasElement
} {
  const w = source.width
  const h = source.height
  const ctx = source.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')
  const src = ctx.getImageData(0, 0, w, h)

  const rgb = document.createElement('canvas')
  rgb.width = w
  rgb.height = h
  const rctx = rgb.getContext('2d', { willReadFrequently: true })
  if (!rctx) throw new Error('无法创建画布')
  const rgbData = rctx.createImageData(w, h)

  const alpha = document.createElement('canvas')
  alpha.width = w
  alpha.height = h
  const actx = alpha.getContext('2d', { willReadFrequently: true })
  if (!actx) throw new Error('无法创建画布')
  const alphaData = actx.createImageData(w, h)

  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3]!
    alphaData.data[i] = a
    alphaData.data[i + 1] = a
    alphaData.data[i + 2] = a
    alphaData.data[i + 3] = 255

    if (a === 0) {
      // Matte transparent pixels white so the model does not invent black BG
      rgbData.data[i] = 255
      rgbData.data[i + 1] = 255
      rgbData.data[i + 2] = 255
      rgbData.data[i + 3] = 255
    } else if (a < 255) {
      const inv = 255 / a
      rgbData.data[i] = Math.min(255, Math.round(src.data[i]! * inv))
      rgbData.data[i + 1] = Math.min(255, Math.round(src.data[i + 1]! * inv))
      rgbData.data[i + 2] = Math.min(255, Math.round(src.data[i + 2]! * inv))
      rgbData.data[i + 3] = 255
    } else {
      rgbData.data[i] = src.data[i]!
      rgbData.data[i + 1] = src.data[i + 1]!
      rgbData.data[i + 2] = src.data[i + 2]!
      rgbData.data[i + 3] = 255
    }
  }

  rctx.putImageData(rgbData, 0, 0)
  actx.putImageData(alphaData, 0, 0)
  return { rgb, alpha }
}

async function resizeCanvas(
  from: HTMLCanvasElement,
  tw: number,
  th: number,
): Promise<HTMLCanvasElement> {
  const to = document.createElement('canvas')
  to.width = tw
  to.height = th
  try {
    await pica.resize(from, to, { quality: 3 })
  } catch {
    const ctx = to.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(from, 0, 0, tw, th)
  }
  return to
}

function mergeRgbAndAlpha(
  rgb: HTMLCanvasElement,
  alpha: HTMLCanvasElement,
): HTMLCanvasElement {
  const w = rgb.width
  const h = rgb.height
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d', { willReadFrequently: true })
  const rctx = rgb.getContext('2d', { willReadFrequently: true })
  const actx = alpha.getContext('2d', { willReadFrequently: true })
  if (!ctx || !rctx || !actx) throw new Error('无法创建画布')

  const rd = rctx.getImageData(0, 0, w, h)
  const ad = actx.getImageData(0, 0, w, h)
  const od = ctx.createImageData(w, h)

  for (let i = 0; i < rd.data.length; i += 4) {
    const a = ad.data[i]! // grayscale alpha map
    od.data[i] = rd.data[i]!
    od.data[i + 1] = rd.data[i + 1]!
    od.data[i + 2] = rd.data[i + 2]!
    od.data[i + 3] = a
  }
  ctx.putImageData(od, 0, 0)
  return out
}

export type AiUpscaleOptions = {
  minEdge?: number
  onProgress?: (percent: number) => void
  model?: Model
  isCancelled?: () => boolean
}

function throwIfCancelled(isCancelled?: () => boolean) {
  if (isCancelled?.()) {
    const err = new Error('AI_CANCELLED')
    err.name = 'AbortError'
    throw err
  }
}

/**
 * Local browser AI super-resolution (Swin2SR, ~2×).
 * Preserves PNG transparency by matting RGB + restoring scaled alpha.
 */
export async function aiUpscale(
  source: Blob,
  options: AiUpscaleOptions = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  const model = options.model ?? 'Swin2SR'
  const isCancelled = options.isCancelled

  const run = async () => {
    throwIfCancelled(isCancelled)
    const upscaler = await getUpscaler(model)
    throwIfCancelled(isCancelled)

    const inputBmp = await createImageBitmap(source)
    const srcCanvas = canvasFromBitmap(inputBmp)
    inputBmp.close()
    const srcW = srcCanvas.width
    const srcH = srcCanvas.height
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
    if (!srcCtx) throw new Error('无法创建画布')
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH)
    const transparent = hasTransparency(srcData)

    options.onProgress?.(5)
    throwIfCancelled(isCancelled)

    let modelInput: HTMLCanvasElement = srcCanvas
    let alphaCanvas: HTMLCanvasElement | null = null

    if (transparent) {
      const split = splitAlphaMatte(srcCanvas)
      modelInput = split.rgb
      alphaCanvas = split.alpha
    }

    const modelBmp = await createImageBitmap(modelInput)
    let outputBmp: ImageBitmap
    try {
      outputBmp = await upscaler.upscale(modelBmp, {
        forceUpscale: true,
        model,
        onProgress: (p) => {
          if (isCancelled?.()) return
          options.onProgress?.(Math.min(90, Math.max(5, Math.round(p))))
        },
      })
    } finally {
      modelBmp.close()
    }

    throwIfCancelled(isCancelled)
    const outRgb = canvasFromBitmap(outputBmp)
    outputBmp.close()

    let finalCanvas = outRgb
    if (alphaCanvas) {
      options.onProgress?.(92)
      const scaledAlpha = await resizeCanvas(
        alphaCanvas,
        outRgb.width,
        outRgb.height,
      )
      finalCanvas = mergeRgbAndAlpha(outRgb, scaledAlpha)
    }

    throwIfCancelled(isCancelled)
    const blob = await canvasToPngBlob(finalCanvas)
    options.onProgress?.(100)

    return {
      blob,
      width: finalCanvas.width,
      height: finalCanvas.height,
    }
  }

  const queued = chain.then(run, run)
  chain = queued.then(
    () => undefined,
    () => undefined,
  )
  return queued
}

export function isAiCancelledError(err: unknown) {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message === 'AI_CANCELLED')
  )
}

export function releaseAiUpscaler() {
  if (shared) {
    shared.terminate()
    shared = null
    sharedModel = null
  }
}
