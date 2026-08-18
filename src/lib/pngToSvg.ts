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

function quantKey(r: number, g: number, b: number) {
  const q = (v: number) => Math.round(v / 16) * 16
  return `${q(r)},${q(g)},${q(b)}`
}

function dist2(a: Rgb, b: Rgb) {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
}

/** Collect dominant flat colors; snap anti-aliased fringe to nearest. */
function extractLayers(
  data: ImageData,
  alphaCut = 100,
): { width: number; height: number; layers: { color: Rgb; mask: Uint8Array }[] } {
  const { width, height } = data
  const src = data.data
  const buckets = new Map<string, { color: Rgb; n: number }>()

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3]! < alphaCut) continue
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

  const palette = [...buckets.values()]
    .map((v) => ({
      r: Math.round(v.color.r / v.n),
      g: Math.round(v.color.g / v.n),
      b: Math.round(v.color.b / v.n),
      n: v.n,
    }))
    .sort((a, b) => b.n - a.n)

  if (palette.length === 0) {
    throw new Error('图片几乎全透明，无法转换')
  }

  const keep = palette.slice(0, Math.min(6, palette.length))
  const masks = keep.map(() => new Uint8Array(width * height))

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (src[o + 3]! < alphaCut) continue
    const pixel = { r: src[o]!, g: src[o + 1]!, b: src[o + 2]! }
    let best = 0
    let bestD = Infinity
    for (let c = 0; c < keep.length; c++) {
      const d = dist2(pixel, keep[c]!)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    masks[best]![i] = 1
  }

  return {
    width,
    height,
    layers: keep.map((color, idx) => ({ color, mask: masks[idx]! })),
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

function curveToPathD(curve: Path['curve'], scale: number): string {
  const n = curve.n
  let p =
    'M' +
    (curve.c[(n - 1) * 3 + 2]!.x * scale).toFixed(3) +
    ' ' +
    (curve.c[(n - 1) * 3 + 2]!.y * scale).toFixed(3) +
    ' '
  for (let i = 0; i < n; i++) {
    if (curve.tag[i] === 'CURVE') {
      p +=
        'C ' +
        (curve.c[i * 3]!.x * scale).toFixed(3) +
        ' ' +
        (curve.c[i * 3]!.y * scale).toFixed(3) +
        ', ' +
        (curve.c[i * 3 + 1]!.x * scale).toFixed(3) +
        ' ' +
        (curve.c[i * 3 + 1]!.y * scale).toFixed(3) +
        ', ' +
        (curve.c[i * 3 + 2]!.x * scale).toFixed(3) +
        ' ' +
        (curve.c[i * 3 + 2]!.y * scale).toFixed(3) +
        ' '
    } else if (curve.tag[i] === 'CORNER') {
      p +=
        'L ' +
        (curve.c[i * 3 + 1]!.x * scale).toFixed(3) +
        ' ' +
        (curve.c[i * 3 + 1]!.y * scale).toFixed(3) +
        ' ' +
        (curve.c[i * 3 + 2]!.x * scale).toFixed(3) +
        ' ' +
        (curve.c[i * 3 + 2]!.y * scale).toFixed(3) +
        ' '
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
      opttolerance: 0.2,
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

function compactNumericToken(raw: string) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const rounded = Math.round(n * 1000) / 1000
  if (Object.is(rounded, -0) || rounded === 0) return '0'
  return String(rounded)
}

function compactNumericString(value: string) {
  let next = value.replace(
    /-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi,
    compactNumericToken,
  )
  next = next.replace(/\s+/g, ' ').trim()
  next = next
    .replace(/\s*([MmLlHhVvCcSsQqTtAaZz,])\s*/g, '$1')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return next
}

function isEditorAttribute(name: string) {
  return /^(inkscape|sodipodi|serif|sketch):/i.test(name)
}

function compactSvgTree(el: Element) {
  for (const attr of [...el.attributes]) {
    if (isEditorAttribute(attr.name)) {
      el.removeAttribute(attr.name)
      continue
    }
    if (/^(id|class|href|xlink:href|xmlns(:.*)?|xml:space)$/i.test(attr.name)) {
      continue
    }
    const compacted = compactNumericString(attr.value)
    if (compacted !== attr.value) el.setAttribute(attr.name, compacted)
  }
  for (const child of [...el.children]) compactSvgTree(child)
}

function escapeXml(value: string, attr = false) {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  if (attr) return out.replace(/"/g, '&quot;')
  return out.replace(/>/g, '&gt;')
}

function serializeAttrs(el: Element) {
  return [...el.attributes]
    .map((attr) => ` ${attr.name}="${escapeXml(attr.value, true)}"`)
    .join('')
}

function serializeNode(node: Node, pretty: boolean, depth: number): string {
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
  const attrs = serializeAttrs(el)
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
    return `<${name}${attrs}>${kids.map((child) => serializeNode(child, false, 0)).join('')}</${name}>`
  }

  const inner = kids
    .map((child) => serializeNode(child, true, depth + 1))
    .filter(Boolean)
    .join('\n')
  return `${pad}<${name}${attrs}>\n${inner}\n${pad}</${name}>`
}

/** Minify SVG: drop comments, editor attrs, extra whitespace, and extra decimals. */
export function compressSvg(text: string) {
  const root = parseSvgRoot(text)
  pruneLayoutWhitespace(root)
  compactSvgTree(root)
  return serializeNode(root, false, 0)
}

/** Pretty-print SVG with 2-space indent. */
export function formatSvg(text: string) {
  const root = parseSvgRoot(text)
  pruneLayoutWhitespace(root)
  return serializeNode(root, true, 0)
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
