import Pica from 'pica'
import pako from 'pako'
import * as UPNGModule from 'upng-js'

const pica = Pica({ features: ['js', 'wasm', 'ww'] })

const UPNG = (() => {
  const ns = UPNGModule as typeof UPNGModule & {
    default?: typeof UPNGModule
  }
  if (typeof ns.decode === 'function') return ns
  const fallback = ns.default
  if (fallback && typeof fallback.decode === 'function') return fallback
  throw new Error('upng-js 不可用')
})()

export type Base64Format = 'data-url' | 'raw' | 'css'

export type OptimizeOptions = {
  /** When set, scale output to this width; height follows aspect ratio. */
  lockWidth?: number
}

export type OptimizedImage = {
  bytes: Uint8Array
  mime: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  originalSize: number
  method: 'png-reencode' | 'png-strip' | 'jpeg-strip' | 'original'
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const PNG_KEEP_EXTRA = new Set(['tRNS', 'acTL', 'fcTL', 'fdAT'])

type Candidate = {
  bytes: Uint8Array
  mime: string
  method: OptimizedImage['method']
}

type PaletteColor = { r: number; g: number; b: number; a: number }

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function bytesToBase64(bytes: Uint8Array) {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function formatBase64(
  bytes: Uint8Array,
  mime: string,
  format: Base64Format,
) {
  const b64 = bytesToBase64(bytes)
  if (format === 'raw') return b64
  const url = `data:${mime};base64,${b64}`
  if (format === 'css') return `url("${url}")`
  return url
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function bytesToBlob(bytes: Uint8Array, mime: string) {
  return new Blob([toArrayBuffer(bytes)], { type: mime })
}

export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
) {
  const blob = bytesToBlob(bytes, mime)
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

export async function optimizeImage(
  file: Blob,
  options?: OptimizeOptions,
): Promise<OptimizedImage> {
  const original = new Uint8Array(await file.arrayBuffer())
  if (original.byteLength === 0) throw new Error('文件是空的')

  const fallbackMime = file.type || 'application/octet-stream'
  const { width, height } = await readDimensions(file, original)
  const lockWidth = options?.lockWidth

  if (lockWidth && width > 0 && width !== lockWidth) {
    const targetW = lockWidth
    const targetH = Math.max(1, Math.round((height * lockWidth) / width))
    const decoded = await decodeToRgba(file, original)
    const resized = await resizeRgba(
      decoded.data,
      decoded.width,
      decoded.height,
      targetW,
      targetH,
    )
    return {
      bytes: encodePngLossless(resized, targetW, targetH),
      mime: 'image/png',
      width: targetW,
      height: targetH,
      sourceWidth: width,
      sourceHeight: height,
      originalSize: original.byteLength,
      method: 'png-reencode',
    }
  }

  const candidates: Candidate[] = [
    {
      bytes: original,
      mime: sniffMime(original, fallbackMime),
      method: 'original',
    },
  ]

  if (isPng(original)) {
    const apng = pngHasChunk(original, 'acTL')
    const stripped = stripPngChunks(original)
    if (stripped.byteLength !== original.byteLength) {
      candidates.push({
        bytes: stripped,
        mime: 'image/png',
        method: 'png-strip',
      })
    }

    const depth = pngBitDepth(original)
    if (!apng && depth !== null && depth <= 8) {
      try {
        candidates.push({
          bytes: reencodePngLossless(original),
          mime: 'image/png',
          method: 'png-reencode',
        })
      } catch {
        // keep strip / original
      }
    }
  } else if (isJpeg(original)) {
    const stripped = stripJpegMetadata(original)
    if (stripped.byteLength !== original.byteLength) {
      candidates.push({
        bytes: stripped,
        mime: 'image/jpeg',
        method: 'jpeg-strip',
      })
    }
  } else {
    try {
      const rgba = await rasterizeToRgba(file)
      candidates.push({
        bytes: encodePngLossless(
          new Uint8Array(rgba.data),
          rgba.width,
          rgba.height,
        ),
        mime: 'image/png',
        method: 'png-reencode',
      })
    } catch {
      // keep original bytes
    }
  }

  candidates.sort((a, b) => a.bytes.byteLength - b.bytes.byteLength)
  const best = candidates[0]!
  return {
    ...best,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    originalSize: original.byteLength,
  }
}

function reencodePngLossless(bytes: Uint8Array): Uint8Array {
  const img = UPNG.decode(toArrayBuffer(bytes))
  const rgbaBuf = UPNG.toRGBA8(img)[0]
  if (!rgbaBuf) throw new Error('无法解码 PNG')
  return encodeAndVerifyPng(new Uint8Array(rgbaBuf), img.width, img.height)
}

function encodeAndVerifyPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const encoded = encodePngLossless(rgba, width, height)
  const check = UPNG.decode(toArrayBuffer(encoded))
  const round = UPNG.toRGBA8(check)[0]
  if (!round || !bytesEqual(rgba, new Uint8Array(round))) {
    throw new Error('PNG 重编码校验失败')
  }
  return encoded
}

async function decodeToRgba(file: Blob, bytes: Uint8Array) {
  if (isPng(bytes)) {
    try {
      const img = UPNG.decode(toArrayBuffer(bytes))
      const rgbaBuf = UPNG.toRGBA8(img)[0]
      if (rgbaBuf) {
        return {
          data: new Uint8Array(rgbaBuf),
          width: img.width,
          height: img.height,
        }
      }
    } catch {
      // fall through to bitmap decode
    }
  }
  const imageData = await rasterizeToRgba(file)
  return {
    data: new Uint8Array(imageData.data),
    width: imageData.width,
    height: imageData.height,
  }
}

async function resizeRgba(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Promise<Uint8Array> {
  const src = new Uint8Array(rgba)
  try {
    const dest = new Uint8Array(dstW * dstH * 4)
    const out = await pica.resizeBuffer({
      src,
      width: srcW,
      height: srcH,
      toWidth: dstW,
      toHeight: dstH,
      dest,
      quality: 3,
    })
    return out instanceof Uint8Array ? out : dest
  } catch {
    const from = document.createElement('canvas')
    from.width = srcW
    from.height = srcH
    const fctx = from.getContext('2d', { willReadFrequently: true })
    if (!fctx) throw new Error('Canvas 不可用')
    fctx.putImageData(
      new ImageData(new Uint8ClampedArray(src), srcW, srcH),
      0,
      0,
    )
    const to = document.createElement('canvas')
    to.width = dstW
    to.height = dstH
    const tctx = to.getContext('2d', { willReadFrequently: true })
    if (!tctx) throw new Error('Canvas 不可用')
    tctx.imageSmoothingEnabled = true
    tctx.imageSmoothingQuality = 'high'
    tctx.drawImage(from, 0, 0, dstW, dstH)
    return new Uint8Array(tctx.getImageData(0, 0, dstW, dstH).data)
  }
}

function encodePngLossless(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const packed = packPixels(rgba, width, height)
  const filtered = filterScanlines(packed.raw, height, packed.stride, packed.bpp)
  const idat = pako.deflate(filtered, { level: 9 })
  return assemblePng(width, height, packed, idat)
}

function packPixels(rgba: Uint8Array, width: number, height: number) {
  const area = width * height
  if (width <= 0 || height <= 0 || rgba.byteLength < area * 4) {
    throw new Error('像素数据不完整')
  }

  let anyAlpha = false
  let allGray = true
  const indexByColor = new Map<number, number>()
  let paletteOk = true

  for (let i = 0; i < area; i++) {
    const o = i * 4
    const r = rgba[o]!
    const g = rgba[o + 1]!
    const b = rgba[o + 2]!
    const a = rgba[o + 3]!
    if (a < 255) anyAlpha = true
    if (r !== g || g !== b) allGray = false
    if (!paletteOk) continue
    const key = colorKey(r, g, b, a)
    if (indexByColor.has(key)) continue
    if (indexByColor.size >= 256) {
      paletteOk = false
    } else {
      indexByColor.set(key, indexByColor.size)
    }
  }

  if (paletteOk) {
    const palette: PaletteColor[] = []
    for (const [key, index] of indexByColor) {
      palette[index] = {
        r: (key >>> 24) & 255,
        g: (key >>> 16) & 255,
        b: (key >>> 8) & 255,
        a: key & 255,
      }
    }
    const raw = new Uint8Array(area)
    for (let i = 0; i < area; i++) {
      const o = i * 4
      raw[i] = indexByColor.get(
        colorKey(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!),
      )!
    }
    return {
      colorType: 3 as const,
      raw,
      stride: width,
      bpp: 1,
      palette,
    }
  }

  if (allGray && !anyAlpha) {
    const raw = new Uint8Array(area)
    for (let i = 0; i < area; i++) raw[i] = rgba[i * 4]!
    return { colorType: 0 as const, raw, stride: width, bpp: 1 }
  }

  if (allGray) {
    const raw = new Uint8Array(area * 2)
    for (let i = 0; i < area; i++) {
      raw[i * 2] = rgba[i * 4]!
      raw[i * 2 + 1] = rgba[i * 4 + 3]!
    }
    return { colorType: 4 as const, raw, stride: width * 2, bpp: 2 }
  }

  if (!anyAlpha) {
    const raw = new Uint8Array(area * 3)
    for (let i = 0; i < area; i++) {
      const s = i * 4
      const t = i * 3
      raw[t] = rgba[s]!
      raw[t + 1] = rgba[s + 1]!
      raw[t + 2] = rgba[s + 2]!
    }
    return { colorType: 2 as const, raw, stride: width * 3, bpp: 3 }
  }

  return {
    colorType: 6 as const,
    raw: rgba.slice(0, area * 4),
    stride: width * 4,
    bpp: 4,
  }
}

function filterScanlines(
  raw: Uint8Array,
  height: number,
  stride: number,
  bpp: number,
) {
  const out = new Uint8Array(height * (stride + 1))
  const prev = new Uint8Array(stride)
  const trial = new Uint8Array(stride)
  const best = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride)
    let bestType = 0
    let bestScore = Infinity
    for (let type = 0; type <= 4; type++) {
      applyFilter(type, row, prev, trial, bpp)
      const score = filterScore(trial)
      if (score < bestScore) {
        bestScore = score
        bestType = type
        best.set(trial)
      }
    }
    const o = y * (stride + 1)
    out[o] = bestType
    out.set(best, o + 1)
    prev.set(row)
  }
  return out
}

function applyFilter(
  type: number,
  row: Uint8Array,
  prev: Uint8Array,
  out: Uint8Array,
  bpp: number,
) {
  for (let i = 0; i < row.length; i++) {
    const x = row[i]!
    const a = i >= bpp ? row[i - bpp]! : 0
    const b = prev[i]!
    const c = i >= bpp ? prev[i - bpp]! : 0
    let pred = 0
    if (type === 1) pred = a
    else if (type === 2) pred = b
    else if (type === 3) pred = (a + b) >> 1
    else if (type === 4) pred = paeth(a, b, c)
    out[i] = (x - pred) & 255
  }
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function filterScore(row: Uint8Array) {
  let sum = 0
  for (let i = 0; i < row.length; i++) {
    const v = row[i]!
    sum += v < 128 ? v : 256 - v
  }
  return sum
}

function assemblePng(
  width: number,
  height: number,
  packed: ReturnType<typeof packPixels>,
  idat: Uint8Array,
) {
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = packed.colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const parts: Uint8Array[] = [
    new Uint8Array(PNG_SIG),
    pngChunk('IHDR', ihdr),
  ]

  if (packed.palette) {
    const plte = new Uint8Array(packed.palette.length * 3)
    for (let i = 0; i < packed.palette.length; i++) {
      const c = packed.palette[i]!
      plte[i * 3] = c.r
      plte[i * 3 + 1] = c.g
      plte[i * 3 + 2] = c.b
    }
    parts.push(pngChunk('PLTE', plte))
    const trns = paletteTrns(packed.palette)
    if (trns) parts.push(pngChunk('tRNS', trns))
  }

  parts.push(pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0)))
  return concatBytes(parts)
}

function paletteTrns(palette: PaletteColor[]) {
  let last = palette.length
  while (last > 0 && palette[last - 1]!.a === 255) last--
  if (last === 0) return null
  const out = new Uint8Array(last)
  for (let i = 0; i < last; i++) out[i] = palette[i]!.a
  return out
}

function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk[4] = type.charCodeAt(0)
  chunk[5] = type.charCodeAt(1)
  chunk[6] = type.charCodeAt(2)
  chunk[7] = type.charCodeAt(3)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function colorKey(r: number, g: number, b: number, a: number) {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}

function bytesEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isPng(bytes: Uint8Array) {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) return false
  }
  return true
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
}

function isGif(bytes: Uint8Array) {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
}

function isWebp(bytes: Uint8Array) {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
}

function sniffMime(bytes: Uint8Array, fallback: string) {
  if (isPng(bytes)) return 'image/png'
  if (isJpeg(bytes)) return 'image/jpeg'
  if (isGif(bytes)) return 'image/gif'
  if (isWebp(bytes)) return 'image/webp'
  return fallback || 'application/octet-stream'
}

function pngBitDepth(bytes: Uint8Array): number | null {
  if (bytes.length < 25) return null
  return bytes[24] ?? null
}

function pngHasChunk(bytes: Uint8Array, name: string) {
  for (const chunk of iteratePngChunks(bytes)) {
    if (chunk.type === name) return true
  }
  return false
}

function stripPngChunks(bytes: Uint8Array): Uint8Array {
  if (!isPng(bytes)) return bytes
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  let dropped = false
  for (const chunk of iteratePngChunks(bytes)) {
    if (keepPngChunk(chunk.type)) {
      parts.push(bytes.subarray(chunk.start, chunk.end))
    } else {
      dropped = true
    }
  }
  if (!dropped) return bytes
  return concatBytes(parts)
}

function keepPngChunk(type: string) {
  if (PNG_KEEP_EXTRA.has(type)) return true
  const code = type.charCodeAt(0)
  return code >= 65 && code <= 90
}

function* iteratePngChunks(bytes: Uint8Array) {
  let i = 8
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i)
    const type = String.fromCharCode(
      bytes[i + 4]!,
      bytes[i + 5]!,
      bytes[i + 6]!,
      bytes[i + 7]!,
    )
    const end = i + 12 + length
    if (end > bytes.length) break
    yield { type, start: i, end }
    i = end
    if (type === 'IEND') break
  }
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (!isJpeg(bytes)) return bytes
  const out = new Uint8Array(bytes.length)
  out[0] = 0xff
  out[1] = 0xd8
  let o = 2
  let i = 2
  let dropped = false

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      out.set(bytes.subarray(i), o)
      o += bytes.length - i
      break
    }
    while (i < bytes.length && bytes[i] === 0xff) i++
    if (i >= bytes.length) break
    const marker = bytes[i]!
    i++

    if (marker === 0xd9) {
      out[o++] = 0xff
      out[o++] = 0xd9
      break
    }
    if (marker === 0xd8) continue
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out[o++] = 0xff
      out[o++] = marker
      continue
    }
    if (i + 1 >= bytes.length) break
    const len = (bytes[i]! << 8) | bytes[i + 1]!
    if (len < 2 || i + len > bytes.length) {
      out.set(bytes.subarray(i - 1), o)
      o += bytes.length - (i - 1)
      break
    }

    if (marker === 0xda) {
      out[o++] = 0xff
      out[o++] = 0xda
      out.set(bytes.subarray(i, i + len), o)
      o += len
      i += len
      out.set(bytes.subarray(i), o)
      o += bytes.length - i
      break
    }

    const drop = shouldDropJpegSegment(marker, bytes, i, len)
    if (drop) {
      dropped = true
    } else {
      out[o++] = 0xff
      out[o++] = marker
      out.set(bytes.subarray(i, i + len), o)
      o += len
    }
    i += len
  }

  if (!dropped && o === bytes.length) return bytes
  return out.subarray(0, o)
}

function shouldDropJpegSegment(
  marker: number,
  bytes: Uint8Array,
  lengthOffset: number,
  len: number,
) {
  if (marker === 0xfe) return true
  if (marker === 0xe0) return !isJfifApp0(bytes, lengthOffset, len)
  return marker >= 0xe1 && marker <= 0xef
}

function isJfifApp0(bytes: Uint8Array, lengthOffset: number, len: number) {
  if (len < 7) return false
  return (
    bytes[lengthOffset + 2] === 0x4a &&
    bytes[lengthOffset + 3] === 0x46 &&
    bytes[lengthOffset + 4] === 0x49 &&
    bytes[lengthOffset + 5] === 0x46
  )
}

async function readDimensions(blob: Blob, bytes: Uint8Array) {
  if (isPng(bytes) && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  const bmp = await createImageBitmap(blob)
  const size = { width: bmp.width, height: bmp.height }
  bmp.close()
  return size
}

async function rasterizeToRgba(blob: Blob) {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(blob, {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    })
  } catch {
    bmp = await createImageBitmap(blob)
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 不可用')
    ctx.drawImage(bmp, 0, 0)
    return ctx.getImageData(0, 0, bmp.width, bmp.height)
  } finally {
    bmp.close()
  }
}

function concatBytes(parts: Uint8Array[]) {
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
