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

export async function generateQrPng(options: {
  text: string
  size: number
  ecc: QrEcc
  dark?: string
  light?: string
}): Promise<{ blob: Blob; previewUrl: string; width: number; height: number }> {
  const text = options.text.trim()
  if (!text) throw new Error('请输入要编码的内容')

  const { toCanvas } = await import('qrcode')
  const canvas = document.createElement('canvas')
  await toCanvas(canvas, text, {
    width: options.size,
    margin: 2,
    errorCorrectionLevel: options.ecc,
    color: {
      dark: options.dark ?? '#000000',
      light: options.light ?? '#ffffff',
    },
  })

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
