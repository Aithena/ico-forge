import { Bitmap, traceBitmap, type Path } from '@cadit-app/potrace-ts'
import { bytesToBlob, optimizeImage } from './pngBase64'

export type PngToSvgResult = {
  svg: string
  originalSize: number
  optimizedSize: number
}

type Rgb = { r: number; g: number; b: number }

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

type PaletteColor = Rgb & { n: number }

function quantKey(r: number, g: number, b: number) {
  const q = (v: number) => Math.round(v / 16) * 16
  return `${q(r)},${q(g)},${q(b)}`
}

function dist2(a: Rgb, b: Rgb) {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
}

/** Merge buckets split by the 16-step grid, e.g. rgb(18,150,219) vs rgb(18,152,220). */
function mergePalette(palette: PaletteColor[], maxColors: number, mergeDist = 28) {
  const limit = mergeDist * mergeDist
  const merged: PaletteColor[] = []
  for (const c of palette) {
    const hit = merged.find((m) => dist2(m, c) <= limit)
    if (hit) {
      const tot = hit.n + c.n
      hit.r = Math.round((hit.r * hit.n + c.r * c.n) / tot)
      hit.g = Math.round((hit.g * hit.n + c.g * c.n) / tot)
      hit.b = Math.round((hit.b * hit.n + c.b * c.n) / tot)
      hit.n = tot
    } else {
      merged.push({ ...c })
    }
  }
  merged.sort((a, b) => b.n - a.n)
  return merged.slice(0, maxColors)
}

function isCornerBackground(data: ImageData, color: Rgb, alphaCut: number) {
  const { width, height, data: src } = data
  const corners = [0, width - 1, (height - 1) * width, height * width - 1]
  let hits = 0
  for (const i of corners) {
    const o = i * 4
    if (src[o + 3]! < alphaCut) continue
    if (dist2(color, { r: src[o]!, g: src[o + 1]!, b: src[o + 2]! }) <= 28 * 28) {
      hits += 1
    }
  }
  return hits >= 3
}

/** Collect dominant flat colors; snap anti-aliased fringe to nearest. */
function extractLayers(
  data: ImageData,
  alphaCut = 100,
): { width: number; height: number; layers: { color: Rgb; mask: Uint8Array }[] } {
  const { width, height } = data
  const src = data.data
  const buckets = new Map<string, { color: Rgb; n: number }>()
  let opaque = 0

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3]! < alphaCut) continue
    opaque += 1
    const color = { r: src[i]!, g: src[i + 1]!, b: src[i + 2]! }
    const key = quantKey(color.r, color.g, color.b)
    const row = buckets.get(key)
    if (row) {
      row.color.r += color.r
      row.color.g += color.g
      row.color.b += color.b
      row.n += 1
    } else {
      buckets.set(key, { color: { ...color }, n: 1 })
    }
  }

  const palette = mergePalette(
    [...buckets.values()].map((v) => ({
      r: Math.round(v.color.r / v.n),
      g: Math.round(v.color.g / v.n),
      b: Math.round(v.color.b / v.n),
      n: v.n,
    })),
    6,
  )

  if (palette.length === 0) {
    throw new Error('图片几乎全透明，无法转换')
  }

  const minPixels = Math.max(16, Math.round(opaque * 0.002))
  const skipBg =
    palette[0]!.n > opaque * 0.35 && isCornerBackground(data, palette[0]!, alphaCut)
  const masks = palette.map(() => new Uint8Array(width * height))

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (src[o + 3]! < alphaCut) continue
    const pixel = { r: src[o]!, g: src[o + 1]!, b: src[o + 2]! }
    let best = 0
    let bestD = Infinity
    for (let c = 0; c < palette.length; c++) {
      const d = dist2(pixel, palette[c]!)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    masks[best]![i] = 1
  }

  const layers = palette.flatMap((color, idx) => {
    if (idx === 0 && skipBg) return []
    if (color.n < minPixels) return []
    return [{ color, mask: masks[idx]! }]
  })

  return {
    width,
    height,
    layers: layers.length > 0 ? layers : [{ color: palette[0]!, mask: masks[0]! }],
  }
}

function upscaleMask(mask: Uint8Array, w: number, h: number, factor: number) {
  if (factor <= 1) return { mask, width: w, height: h }
  const nw = w * factor
  const nh = h * factor
  const out = new Uint8Array(nw * nh)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          out[(y * factor + dy) * nw + (x * factor + dx)] = 1
        }
      }
    }
  }
  return { mask: out, width: nw, height: nh }
}

function maskToBitmap(mask: Uint8Array, width: number, height: number) {
  const bitmap = new Bitmap(width, height)
  for (let i = 0; i < width * height; i++) {
    bitmap.data[i] = mask[i] ? 1 : 0
  }
  return bitmap
}

function fmtCoord(n: number) {
  const v = Math.round(n * 100) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')
}

function curveToPathD(curve: Path['curve'], scale: number): string {
  const n = curve.n
  let p =
    'M' +
    fmtCoord(curve.c[(n - 1) * 3 + 2]!.x * scale) +
    ' ' +
    fmtCoord(curve.c[(n - 1) * 3 + 2]!.y * scale)
  for (let i = 0; i < n; i++) {
    if (curve.tag[i] === 'CURVE') {
      p +=
        'C' +
        fmtCoord(curve.c[i * 3]!.x * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3]!.y * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 1]!.x * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 1]!.y * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 2]!.x * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 2]!.y * scale)
    } else if (curve.tag[i] === 'CORNER') {
      p +=
        'L' +
        fmtCoord(curve.c[i * 3 + 1]!.x * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 1]!.y * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 2]!.x * scale) +
        ' ' +
        fmtCoord(curve.c[i * 3 + 2]!.y * scale)
    }
  }
  return p
}

function pathsToElement(paths: Path[], fill: string, scale: number): string {
  if (paths.length === 0) return ''
  let d = ''
  for (const path of paths) {
    d += curveToPathD(path.curve, scale)
  }
  return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`
}

function rgbCss(c: Rgb) {
  return `rgb(${c.r},${c.g},${c.b})`
}

/**
 * Trace a solid / flat-color PNG into SVG with Potrace smooth curves.
 * Best for icons with few flat fills and transparent background.
 * Strips metadata and losslessly re-encodes first, same as Base64.
 */
export async function pngToSvg(source: Blob): Promise<PngToSvgResult> {
  const optimized = await optimizeImage(source)
  const img = await loadImage(bytesToBlob(optimized.bytes, optimized.mime))
  const ow = img.naturalWidth
  const oh = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = ow
  canvas.height = oh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.clearRect(0, 0, ow, oh)
  ctx.drawImage(img, 0, 0)
  const raw = ctx.getImageData(0, 0, ow, oh)

  const { layers } = extractLayers(raw)
  const factor = ow <= 64 ? 8 : ow <= 128 ? 4 : ow <= 256 ? 2 : 1
  const scaleBack = 1 / factor
  const parts: string[] = []
  for (const layer of layers) {
    const scaled = upscaleMask(layer.mask, ow, oh, factor)
    const bitmap = maskToBitmap(scaled.mask, scaled.width, scaled.height)
    const paths = traceBitmap(bitmap, {
      turnpolicy: 'majority',
      turdsize: Math.max(2, factor),
      optcurve: true,
      alphamax: 0.9,
      opttolerance: 0.4,
    })
    const el = pathsToElement(paths, rgbCss(layer.color), scaleBack)
    if (el) parts.push(el)
  }

  if (parts.length === 0) {
    throw new Error('未能描摹出有效路径')
  }

  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${ow} ${oh}">
${parts.join('\n')}
</svg>`,
    originalSize: optimized.originalSize,
    optimizedSize: optimized.bytes.byteLength,
  }
}

export function isSvgFile(file: File) {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
}

/** Pull a complete <svg>…</svg> document out of pasted text or markdown fences. */
export function extractSvgMarkup(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let body = trimmed
  const fenced = body.match(/^```(?:svg|xml)?\s*\r?\n?([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) body = fenced[1].trim()

  const start = body.search(/<svg(\s|>)/i)
  if (start < 0) return null
  const end = body.toLowerCase().lastIndexOf('</svg>')
  if (end < start) return null

  let svg = body.slice(start, end + '</svg>'.length)
  const gt = svg.indexOf('>')
  const openTag = gt >= 0 ? svg.slice(0, gt) : svg
  if (!/\sxmlns\s*=/i.test(openTag)) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return svg
}

const SVG_TEXT_TAGS = new Set([
  'text',
  'tspan',
  'textpath',
  'title',
  'desc',
  'style',
  'script',
  'a',
])

function parseSvgRoot(text: string): Element {
  const markup = extractSvgMarkup(text)
  if (!markup) throw new Error('没有找到可用的 SVG 代码')
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('SVG 无法解析')
  const root = doc.documentElement
  if (root.localName.toLowerCase() !== 'svg') throw new Error('根节点不是 svg')
  return root
}

function pruneLayoutWhitespace(node: Node) {
  const parentName =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element).localName.toLowerCase()
      : ''
  const keepText = SVG_TEXT_TAGS.has(parentName)

  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      node.removeChild(child)
      continue
    }
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      if (!keepText && !child.textContent?.trim()) {
        node.removeChild(child)
      }
      continue
    }
    if (child.nodeType === Node.ELEMENT_NODE) pruneLayoutWhitespace(child)
  }
}

const NUMBER_RE = /-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/
const EXACT_NUMBER_RE = new RegExp(`^${NUMBER_RE.source}$`)
const PATH_CMD_RE = /^[MmLlHhVvCcSsQqTtAaZz]$/
const SKIP_ATTR_RE =
  /^(id|class|href|xlink:href|xmlns(:.*)?|xml:space|role|aria-.*|fill|stroke|stop-color|flood-color|lighting-color|color|style|clip-path|mask|filter|marker-start|marker-mid|marker-end|cursor|overflow)$/i

function compactNumericToken(raw: string) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const rounded = Math.round(n * 1000) / 1000
  if (Object.is(rounded, -0) || rounded === 0) return '0'
  return String(rounded)
}

function formatPathNumber(raw: string) {
  const compact = compactNumericToken(raw)
  if (compact.startsWith('0.')) return compact.slice(1)
  if (compact.startsWith('-0.')) return `-.${compact.slice(3)}`
  return compact
}

/** Join path tokens so `10 0.5` never becomes `100.5`, and `93.2 .8` can be `93.2.8`. */
function compactPathD(d: string) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return d.trim()

  let out = ''
  let prevKind: 'cmd' | 'num' | null = null
  let prevHadDot = false

  for (const raw of tokens) {
    if (PATH_CMD_RE.test(raw)) {
      out += raw
      prevKind = 'cmd'
      prevHadDot = false
      continue
    }

    const s = formatPathNumber(raw)
    const startsWithDot = s.startsWith('.') || s.startsWith('-.')
    const startsWithMinus = s.startsWith('-')
    if (prevKind === 'num') {
      const canAbut = startsWithMinus || (startsWithDot && prevHadDot)
      if (!canAbut) out += ' '
    }
    out += s
    prevKind = 'num'
    prevHadDot = s.includes('.')
  }

  return out
}

function compactNumberList(value: string) {
  return value
    .trim()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (EXACT_NUMBER_RE.test(token) ? compactNumericToken(token) : token))
    .join(' ')
}

function compactAttrValue(name: string, value: string) {
  if (SKIP_ATTR_RE.test(name) || isEditorAttribute(name)) return value
  if (/^#|^rgb|^hsl|^url\(/i.test(value.trim())) return value

  const local = name.toLowerCase()
  if (local === 'd') return compactPathD(value)
  if (local === 'points' || local === 'viewbox') return compactNumberList(value)
  if (local.endsWith('transform')) {
    return value.replace(new RegExp(NUMBER_RE, 'g'), compactNumericToken)
  }
  if (EXACT_NUMBER_RE.test(value.trim())) {
    return compactNumericToken(value.trim())
  }
  return value
}

function isEditorAttribute(name: string) {
  return /^(inkscape|sodipodi|serif|sketch):/i.test(name)
}

function escapeXml(value: string, attr = false) {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  if (attr) return out.replace(/"/g, '&quot;')
  return out.replace(/>/g, '&gt;')
}

function serializeAttrs(el: Element, compact: boolean) {
  return [...el.attributes]
    .filter((attr) => !(compact && isEditorAttribute(attr.name)))
    .map((attr) => {
      const value = compact ? compactAttrValue(attr.name, attr.value) : attr.value
      return ` ${attr.name}="${escapeXml(value, true)}"`
    })
    .join('')
}

function serializeNode(
  node: Node,
  pretty: boolean,
  depth: number,
  compact: boolean,
): string {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    const text = node.textContent ?? ''
    if (!pretty) return escapeXml(text)
    const pad = '  '.repeat(depth)
    const trimmed = text.trim()
    return trimmed ? `${pad}${escapeXml(trimmed)}` : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as Element
  const name = el.tagName
  const attrs = serializeAttrs(el, compact)
  const kids = [...el.childNodes].filter((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) return true
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      return Boolean(child.textContent)
    }
    return false
  })
  const pad = pretty ? '  '.repeat(depth) : ''

  if (kids.length === 0) {
    if (name.toLowerCase() === 'svg') {
      return `${pad}<${name}${attrs}></${name}>`
    }
    return `${pad}<${name}${attrs}/>`
  }

  const onlyText =
    kids.length === 1 &&
    (kids[0]!.nodeType === Node.TEXT_NODE ||
      kids[0]!.nodeType === Node.CDATA_SECTION_NODE)

  if (onlyText) {
    const body = escapeXml(kids[0]!.textContent ?? '')
    return `${pad}<${name}${attrs}>${pretty ? body.trim() : body}</${name}>`
  }

  if (!pretty) {
    return `<${name}${attrs}>${kids.map((child) => serializeNode(child, false, 0, compact)).join('')}</${name}>`
  }

  const inner = kids
    .map((child) => serializeNode(child, true, depth + 1, compact))
    .filter(Boolean)
    .join('\n')
  return `${pad}<${name}${attrs}>\n${inner}\n${pad}</${name}>`
}

/** Minify SVG: drop comments, editor attrs, extra whitespace, and extra decimals. */
export function compressSvg(text: string) {
  const root = parseSvgRoot(text)
  pruneLayoutWhitespace(root)
  return serializeNode(root, false, 0, true)
}

/** Pretty-print SVG with 2-space indent. */
export function formatSvg(text: string) {
  const root = parseSvgRoot(text)
  pruneLayoutWhitespace(root)
  return serializeNode(root, true, 0, false)
}

export function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' })
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
