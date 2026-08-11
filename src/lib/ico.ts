export type FitMode = 'contain' | 'cover'

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

function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: number,
  fit: FitMode,
) {
  ctx.clearRect(0, 0, size, size)

  const scale =
    fit === 'cover'
      ? Math.max(size / img.naturalWidth, size / img.naturalHeight)
      : Math.min(size / img.naturalWidth, size / img.naturalHeight)

  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const x = (size - w) / 2
  const y = (size - h) / 2

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, x, y, w, h)
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

/** Build a multi-size ICO with PNG payloads (Vista+ / modern browsers). */
export async function encodeIco(
  source: Blob,
  sizes: number[],
  fit: FitMode = 'contain',
): Promise<Blob> {
  const uniqueSizes = [...new Set(sizes)].sort((a, b) => a - b)
  const objectUrl = URL.createObjectURL(source)

  try {
    const img = await loadImage(objectUrl)
    const pngs: Uint8Array[] = []

    for (const size of uniqueSizes) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 不可用')
      drawFitted(ctx, img, size, fit)
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
  fit: FitMode = 'contain',
): Promise<{ size: number; url: string }[]> {
  const objectUrl = URL.createObjectURL(source)
  try {
    const img = await loadImage(objectUrl)
    const results: { size: number; url: string }[] = []

    for (const size of sizes) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 不可用')
      drawFitted(ctx, img, size, fit)
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
