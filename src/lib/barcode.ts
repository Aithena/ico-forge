export type QrEcc = 'L' | 'M' | 'Q' | 'H'

export type BarcodeFormatId =
  | 'CODE128'
  | 'CODE39'
  | 'EAN13'
  | 'EAN8'
  | 'UPC'
  | 'ITF14'
  | 'codabar'

export const BARCODE_FORMATS: { id: BarcodeFormatId; label: string; hint: string }[] =
  [
    { id: 'CODE128', label: 'Code 128', hint: '数字、字母与常见符号' },
    { id: 'CODE39', label: 'Code 39', hint: '大写字母、数字与 -.$/+% 空格' },
    { id: 'EAN13', label: 'EAN-13', hint: '12 或 13 位数字（商品条码）' },
    { id: 'EAN8', label: 'EAN-8', hint: '7 或 8 位数字' },
    { id: 'UPC', label: 'UPC-A', hint: '11 或 12 位数字' },
    { id: 'ITF14', label: 'ITF-14', hint: '13 或 14 位数字' },
    { id: 'codabar', label: 'Codabar', hint: '数字与 -$:/.+' },
  ]

export type DecodeKind = 'qr' | 'barcode'

export type DecodeResult = {
  text: string
  format: string
}

type JsBarcodeFn = (
  element: HTMLCanvasElement,
  text: string,
  options?: {
    format: string
    displayValue?: boolean
    background?: string
    lineColor?: string
    margin?: number
    width?: number
    height?: number
    fontSize?: number
    valid?: (valid: boolean) => void
  },
) => void

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('导出图片失败'))
    }, 'image/png')
  })
}

/** White badge corner radius for the center logo. */
export const QR_LOGO_RADIUS = 6

/** Center badge size relative to the QR canvas. Stays under H-level ECC (~30%). */
const QR_LOGO_RATIO = 0.2

async function loadImage(blob: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
    return { img, url }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('无法读取中心图片')
  }
}

function drawCenterLogo(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasSize: number,
  badgeRatio = QR_LOGO_RATIO,
) {
  const badge = Math.max(24, Math.round(canvasSize * badgeRatio))
  const pad = Math.max(4, Math.round(badge * 0.12))
  const radius = Math.min(QR_LOGO_RADIUS, Math.floor(badge / 2))
  const x = (canvasSize - badge) / 2
  const y = (canvasSize - badge) / 2
  const inner = Math.max(8, badge - pad * 2)
  const ix = x + (badge - inner) / 2
  const iy = y + (badge - inner) / 2
  const innerRadius = Math.min(radius, Math.floor(inner / 2))

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, badge, badge, radius)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(ix, iy, inner, inner, innerRadius)
  ctx.clip()

  const nw = img.naturalWidth || img.width
  const nh = img.naturalHeight || img.height
  const scale = Math.max(inner / nw, inner / nh)
  const dw = nw * scale
  const dh = nh * scale
  ctx.drawImage(img, ix + (inner - dw) / 2, iy + (inner - dh) / 2, dw, dh)
  ctx.restore()
}

export type QrColorMode = 'solid' | 'gradient'
export type QrGradientDir = 'tb' | 'lr' | 'tlbr' | 'trbl'

export type QrColors = {
  mode: QrColorMode
  fg: string
  fg2: string
  bg: string
  dir: QrGradientDir
}

export const DEFAULT_QR_COLORS: QrColors = {
  mode: 'solid',
  fg: '#18212b',
  fg2: '#1f6f6a',
  bg: '#ffffff',
  dir: 'tlbr',
}

export const QR_GRADIENT_DIRS: { id: QrGradientDir; label: string }[] = [
  { id: 'tb', label: '上下' },
  { id: 'lr', label: '左右' },
  { id: 'tlbr', label: '斜向 ↘' },
  { id: 'trbl', label: '斜向 ↙' },
]

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const n = parseInt(raw.length === 3 ? raw.replace(/./g, '$&$&') : raw, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relativeLuminance(hex: string) {
  const toLin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
}

function contrastRatio(a: string, b: string) {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

export function qrContrastHint(colors: QrColors): string | null {
  const fgs = colors.mode === 'gradient' ? [colors.fg, colors.fg2] : [colors.fg]
  const worst = Math.min(...fgs.map((fg) => contrastRatio(fg, colors.bg)))
  if (worst < 3) return '前景与底色对比偏弱，部分设备可能扫不出'
  return null
}

function gradientPoints(dir: QrGradientDir, w: number, h: number) {
  switch (dir) {
    case 'tb':
      return { x0: w / 2, y0: 0, x1: w / 2, y1: h }
    case 'lr':
      return { x0: 0, y0: h / 2, x1: w, y1: h / 2 }
    case 'trbl':
      return { x0: w, y0: 0, x1: 0, y1: h }
    default:
      return { x0: 0, y0: 0, x1: w, y1: h }
  }
}

function makeQrFill(
  ctx: CanvasRenderingContext2D,
  colors: QrColors,
  w: number,
  h: number,
) {
  if (colors.mode !== 'gradient') return colors.fg
  const { x0, y0, x1, y1 } = gradientPoints(colors.dir, w, h)
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, colors.fg)
  g.addColorStop(1, colors.fg2)
  return g
}

export type QrShape = 'square' | 'rounded' | 'dots' | 'circle' | 'sun'

export const QR_SHAPES: { id: QrShape; label: string }[] = [
  { id: 'square', label: '方形' },
  { id: 'rounded', label: '圆角' },
  { id: 'dots', label: '圆点' },
  { id: 'circle', label: '圆形' },
  { id: 'sun', label: '太阳码风' },
]

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  if (r <= 0) ctx.rect(x, y, w, h)
  else ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
  ctx.fill()
}

function inFinder(row: number, col: number, n: number) {
  const hit = (r: number, c: number) => r >= 0 && r < 7 && c >= 0 && c < 7
  return hit(row, col) || hit(row, col - (n - 7)) || hit(row - (n - 7), col)
}

function drawFinder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  rounded: boolean,
  fg: string | CanvasGradient,
  bg: string,
) {
  const r = rounded ? cell * 0.4 : 0
  ctx.fillStyle = fg
  fillRoundRect(ctx, x, y, cell * 7, cell * 7, r)
  ctx.fillStyle = bg
  fillRoundRect(
    ctx,
    x + cell,
    y + cell,
    cell * 5,
    cell * 5,
    Math.max(0, r - cell * 0.15),
  )
  ctx.fillStyle = fg
  fillRoundRect(
    ctx,
    x + cell * 2,
    y + cell * 2,
    cell * 3,
    cell * 3,
    Math.max(0, r - cell * 0.35),
  )
}

function drawSunburst(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
) {
  const cx = size / 2
  const cy = size / 2
  const outer = size / 2 - 1
  const inner = outer * 0.9
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.25, size * 0.01)
  ctx.lineCap = 'round'
  const rays = 40
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, inner - ctx.lineWidth, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawQrModules(
  ctx: CanvasRenderingContext2D,
  modules: { size: number; get: (row: number, col: number) => number },
  box: { x: number; y: number; size: number },
  shape: QrShape,
  colors: QrColors,
  fg: string | CanvasGradient,
) {
  const n = modules.size
  const margin = 2
  const total = n + margin * 2
  const cell = box.size / total
  const rounded = shape !== 'square'
  const dotted = shape === 'dots' || shape === 'circle' || shape === 'sun'

  const finderOrigins: [number, number][] = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]
  for (const [row, col] of finderOrigins) {
    drawFinder(
      ctx,
      box.x + (col + margin) * cell,
      box.y + (row + margin) * cell,
      cell,
      rounded,
      fg,
      colors.bg,
    )
  }

  ctx.fillStyle = fg
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (inFinder(row, col, n)) continue
      if (!modules.get(row, col)) continue
      const x = box.x + (col + margin) * cell
      const y = box.y + (row + margin) * cell
      if (dotted) {
        ctx.beginPath()
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.4, 0, Math.PI * 2)
        ctx.fill()
      } else if (rounded) {
        const pad = cell * 0.08
        fillRoundRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.28)
      } else {
        ctx.fillRect(x, y, cell + 0.4, cell + 0.4)
      }
    }
  }
}

export async function generateQrPng(options: {
  text: string
  size: number
  ecc: QrEcc
  logo?: Blob | null
  colors?: QrColors
  shape?: QrShape
}): Promise<{ blob: Blob; previewUrl: string; width: number; height: number }> {
  const text = options.text.trim()
  if (!text) throw new Error('请输入要编码的内容')

  const shape = options.shape ?? 'square'
  const colors = options.colors ?? DEFAULT_QR_COLORS
  const circular = shape === 'circle' || shape === 'sun'
  const ecc: QrEcc = options.logo || circular ? 'H' : options.ecc

  const { create } = await import('qrcode')
  const qr = create(text, { errorCorrectionLevel: ecc })
  const size = options.size
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法绘制二维码')

  const fg = makeQrFill(ctx, colors, size, size)

  if (circular) {
    ctx.clearRect(0, 0, size, size)
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2)
    ctx.fillStyle = colors.bg
    ctx.fill()
    if (shape === 'sun') drawSunburst(ctx, size, colors.fg)
    const inner = Math.floor(size * (shape === 'sun' ? 0.62 : 0.7))
    const origin = (size - inner) / 2
    drawQrModules(
      ctx,
      qr.modules,
      { x: origin, y: origin, size: inner },
      shape,
      colors,
      fg,
    )
  } else {
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, size, size)
    drawQrModules(ctx, qr.modules, { x: 0, y: 0, size }, shape, colors, fg)
  }

  if (options.logo) {
    const { img, url } = await loadImage(options.logo)
    try {
      drawCenterLogo(ctx, img, size, circular ? 0.16 : QR_LOGO_RATIO)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const blob = await canvasToBlob(canvas)
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  }
}

export async function generateBarcodePng(options: {
  text: string
  format: BarcodeFormatId
  displayValue: boolean
}): Promise<{ blob: Blob; previewUrl: string; width: number; height: number }> {
  const text = options.text.trim()
  if (!text) throw new Error('请输入要编码的内容')

  const mod = await import('jsbarcode')
  const JsBarcode = ((mod as { default?: JsBarcodeFn }).default ??
    (mod as unknown as JsBarcodeFn))

  const canvas = document.createElement('canvas')
  let formatError: Error | null = null

  try {
    JsBarcode(canvas, text, {
      format: options.format,
      displayValue: options.displayValue,
      background: '#ffffff',
      lineColor: '#000000',
      margin: 12,
      width: 2,
      height: 88,
      fontSize: 16,
      valid: (ok) => {
        if (!ok) formatError = new Error('内容不符合当前条码格式')
      },
    })
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : '条码生成失败')
  }

  if (formatError) throw formatError
  if (!canvas.width || !canvas.height) throw new Error('条码生成失败')

  const blob = await canvasToBlob(canvas)
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  }
}

async function fileToCanvas(file: File, maxEdge = 1800): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(
      1,
      maxEdge / Math.max(img.naturalWidth, img.naturalHeight),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } catch {
    throw new Error('无法读取图片')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String(err.name) : ''
  return (
    name === 'NotFoundException' ||
    name === 'ChecksumException' ||
    name === 'FormatException'
  )
}

export async function decodeFromImage(
  file: File,
  kind: DecodeKind,
): Promise<DecodeResult> {
  const [
    { BarcodeFormat, BrowserMultiFormatReader, HTMLCanvasElementLuminanceSource },
    { DecodeHintType, BinaryBitmap, HybridBinarizer },
  ] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])

  const formats =
    kind === 'qr'
      ? [BarcodeFormat.QR_CODE, BarcodeFormat.MICRO_QR_CODE]
      : [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.CODE_93,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
          BarcodeFormat.RSS_14,
          BarcodeFormat.RSS_EXPANDED,
        ]

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats)
  hints.set(DecodeHintType.TRY_HARDER, true)
  hints.set(DecodeHintType.CHARACTER_SET, 'UTF-8')

  const reader = new BrowserMultiFormatReader(hints)
  const canvas = await fileToCanvas(file)

  const labels: Partial<Record<number, string>> = {
    [BarcodeFormat.CODABAR]: 'Codabar',
    [BarcodeFormat.CODE_39]: 'Code 39',
    [BarcodeFormat.CODE_93]: 'Code 93',
    [BarcodeFormat.CODE_128]: 'Code 128',
    [BarcodeFormat.EAN_8]: 'EAN-8',
    [BarcodeFormat.EAN_13]: 'EAN-13',
    [BarcodeFormat.ITF]: 'ITF',
    [BarcodeFormat.QR_CODE]: 'QR Code',
    [BarcodeFormat.RSS_14]: 'RSS-14',
    [BarcodeFormat.RSS_EXPANDED]: 'RSS Expanded',
    [BarcodeFormat.UPC_A]: 'UPC-A',
    [BarcodeFormat.UPC_E]: 'UPC-E',
    [BarcodeFormat.MICRO_QR_CODE]: 'Micro QR',
  }

  const toResult = (result: {
    getText: () => string
    getBarcodeFormat: () => number
  }): DecodeResult => {
    const format = result.getBarcodeFormat()
    return {
      text: result.getText(),
      format: labels[format] ?? BarcodeFormat[format] ?? String(format),
    }
  }

  try {
    return toResult(reader.decodeFromCanvas(canvas))
  } catch (err: unknown) {
    if (!isNotFound(err)) {
      throw err instanceof Error ? err : new Error('识别失败')
    }
  }

  try {
    const inverted = new BinaryBitmap(
      new HybridBinarizer(
        new HTMLCanvasElementLuminanceSource(canvas).invert(),
      ),
    )
    return toResult(reader.decodeBitmap(inverted))
  } catch (err: unknown) {
    if (!isNotFound(err)) {
      throw err instanceof Error ? err : new Error('识别失败')
    }
  }

  throw new Error(kind === 'qr' ? '未识别到二维码' : '未识别到条形码')
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

export function looksLikeHttpUrl(text: string) {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
