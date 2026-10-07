/**
 * The downloadable invoice: one A4 page drawn directly as PDF operators, with the Kea logo
 * as vector paths and the site's Geist typeface embedded, so it needs no PDF library.
 * If the font files cannot be fetched it falls back to the built-in Helvetica.
 *
 * Every "Label: value" line is written as ONE text run, on purpose, and the page content
 * is left uncompressed. The e2e suite (qa/e2e/tests/billing.spec.ts) reads the raw file
 * back run by run and expects, among others, "KEA ENERGY INVOICE" as the first run and
 * "Invoice: …", "Total: …" and "Customer: …" whole.
 */

export interface InvoicePdfData {
  number: string
  period: string
  due: string
  /** As the page displays it, e.g. "$174.96". */
  amount: string
  status: string
  customerName: string
  customerId: string
  address: string
  paymentMethod: string
  planName: string
  gst?: number | null
  chargeLines?: Array<{label:string; amount?:number|null}>
  estimated?: boolean
}

/** OpenType (CFF) font files: the regular and the semibold weight. */
export interface InvoiceFonts {
  regular: Uint8Array<ArrayBuffer>
  bold: Uint8Array<ArrayBuffer>
}

const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = '#263574'
const MUTED = '#68779F'
const PURPLE = '#4318FF'
const GREY_FILL = '#F4F5F8'
const GREY_EDGE = '#E4E7EE'
const GREY_LABEL = '#8A93A6'
const RULE = '#ECEEF3'

// Standard Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32–126, for the
// fallback when Geist cannot be loaded.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

type Font = 'regular' | 'bold'
type TextStyle = { font?: Font; size?: number; color?: string; spacing?: number; align?: 'left' | 'right' }

/** What the PDF needs from an OpenType font: ASCII widths and the descriptor's numbers. */
interface FontMetrics {
  widths: number[]
  ascent: number
  descent: number
  capHeight: number
  bbox: number[]
}

/** Reads widths from `hmtx` through the `cmap`, and the vertical metrics, all per 1000 em. */
function readOpenType(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables: Record<string, number> = {}
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16
    tables[String.fromCharCode(...bytes.subarray(record, record + 4))] = view.getUint32(record + 8)
  }
  const { head, hhea, hmtx, cmap } = tables as Record<'head' | 'hhea' | 'hmtx' | 'cmap', number>
  const os2 = tables['OS/2']
  const unitsPerEm = view.getUint16(head + 18)
  const em = (units: number) => Math.round((units * 1000) / unitsPerEm)

  // The Windows Unicode BMP subtable, format 4.
  let table = -1
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const record = cmap + 4 + i * 8
    const offset = cmap + view.getUint32(record + 4)
    const platform = view.getUint16(record)
    if (view.getUint16(offset) === 4 && (platform === 0 || (platform === 3 && view.getUint16(record + 2) === 1))) table = offset
  }
  const glyphFor = (code: number) => {
    if (table < 0) return 0
    const segments = view.getUint16(table + 6) / 2
    const ends = table + 14
    const starts = ends + segments * 2 + 2
    const deltas = starts + segments * 2
    const rangeOffsets = deltas + segments * 2
    for (let s = 0; s < segments; s++) {
      if (code > view.getUint16(ends + s * 2)) continue
      const start = view.getUint16(starts + s * 2)
      if (code < start) return 0
      const delta = view.getUint16(deltas + s * 2)
      const rangeOffset = view.getUint16(rangeOffsets + s * 2)
      if (rangeOffset === 0) return (code + delta) & 0xffff
      const glyph = view.getUint16(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2)
      return glyph ? (glyph + delta) & 0xffff : 0
    }
    return 0
  }
  const metricCount = view.getUint16(hhea + 34)
  const advance = (glyph: number) => view.getUint16(hmtx + 4 * Math.min(glyph, metricCount - 1))
  const ascent = em(view.getInt16(hhea + 4))
  return {
    widths: Array.from({ length: 95 }, (_, i) => em(advance(glyphFor(32 + i)))),
    ascent,
    descent: em(view.getInt16(hhea + 6)),
    capHeight: os2 !== undefined && view.getUint16(os2) >= 2 ? em(view.getInt16(os2 + 88)) : ascent,
    bbox: [36, 38, 40, 42].map((offset) => em(view.getInt16(head + offset))),
  }
}

// PDF strings are single-byte and the page sticks to ASCII, so every other character
// becomes '-' (the period's "–" among them), as the e2e suite expects.
const ascii = (value: string) => value.replace(/[^\x20-\x7E]/g, '-')
const escape = (value: string) => value.replace(/[\\()]/g, (c) => `\\${c}`)
const num = (n: number) => String(Math.round(n * 100) / 100)
const rgb = (hex: string) => [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ')
const money = (n: number) => `$${n.toFixed(2)}`

/** A circular arc as cubic Béziers (at most 90° each), in the logo's y-down space. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const at = (deg: number) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))] as const
  const parts = Math.ceil(Math.abs(to - from) / 90)
  const step = (to - from) / parts
  const k = (4 / 3) * Math.tan(rad(step) / 4) * r
  const [sx, sy] = at(from)
  let path = `${num(sx)} ${num(sy)} m`
  for (let i = 0; i < parts; i++) {
    const a0 = from + i * step
    const a1 = a0 + step
    const [x0, y0] = at(a0)
    const [x3, y3] = at(a1)
    const c1 = [x0 - k * Math.sin(rad(a0)), y0 + k * Math.cos(rad(a0))]
    const c2 = [x3 + k * Math.sin(rad(a1)), y3 - k * Math.cos(rad(a1))]
    path += ` ${c1.map(num).join(' ')} ${c2.map(num).join(' ')} ${num(x3)} ${num(y3)} c`
  }
  return path
}

/** An SVG quadratic segment as the equivalent cubic `c` operator. */
function quad(from: [number, number], control: [number, number], to: [number, number]): string {
  const c1 = from.map((v, i) => v + (2 / 3) * (control[i]! - v))
  const c2 = to.map((v, i) => v + (2 / 3) * (control[i]! - v))
  return `${c1.map(num).join(' ')} ${c2.map(num).join(' ')} ${to.map(num).join(' ')} c`
}

/** A linear shading through colour stops, as a PDF axial shading dictionary. */
function shading(coords: number[], stops: [number, string][]): string {
  const fn = (from: string, to: string) => `<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(from)}] /C1 [${rgb(to)}] /N 1 >>`
  const pieces = stops.slice(1).map(([, color], i) => fn(stops[i]![1], color))
  const bounds = stops.slice(1, -1).map(([at]) => num(at)).join(' ')
  const encode = pieces.map(() => '0 1').join(' ')
  const func = pieces.length === 1 ? pieces[0] : `<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.join(' ')}] /Bounds [${bounds}] /Encode [${encode}] >>`
  return `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${coords.map(num).join(' ')}] /Function ${func} /Extend [true true] >>`
}

// The byte arrays here are typed as backed by a plain ArrayBuffer: a Blob will not take a view
// over a SharedArrayBuffer, and TypeScript 5.7+ checks that.
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function buildInvoicePdf(data: InvoicePdfData, fonts?: InvoiceFonts): Promise<Uint8Array<ArrayBuffer>> {
  const metrics = fonts ? { regular: readOpenType(fonts.regular), bold: readOpenType(fonts.bold) } : undefined
  const widthTable = (font: Font) => metrics ? metrics[font].widths : font === 'bold' ? HELVETICA_BOLD : HELVETICA
  const textWidth = (value: string, font: Font, size: number, spacing = 0) =>
    ([...ascii(value)].reduce((sum, c) => sum + (widthTable(font)[c.charCodeAt(0) - 32] ?? 556), 0) / 1000) * size + spacing * value.length

  /** Greedy word wrap against the real glyph widths. */
  const wrap = (value: string, width: number, font: Font, size: number) => {
    const lines: string[] = []
    let line = ''
    for (const word of value.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && textWidth(next, font, size) > width) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
    return lines
  }

  const ops: string[] = []
  // Laid out top-down, like the page; PDF's own origin is the bottom-left corner.
  const y = (top: number) => PAGE_H - top

  const text = (value: string, x: number, top: number, style: TextStyle = {}) => {
    const { font = 'regular', size = 10.5, color = INK, spacing = 0, align = 'left' } = style
    const left = align === 'right' ? x - textWidth(value, font, size, spacing) : x
    const tc = spacing ? `${spacing} Tc ` : ''
    const reset = spacing ? ' 0 Tc' : ''
    ops.push(`BT /${font === 'bold' ? 'F2' : 'F1'} ${size} Tf ${tc}${rgb(color)} rg ${num(left)} ${num(y(top))} Td (${escape(ascii(value))}) Tj${reset} ET`)
  }

  const roundedRect = (x: number, top: number, w: number, h: number, r: number) => {
    const b = y(top + h)
    const k = 0.5523 * r
    return [
      `${num(x + r)} ${num(b)} m ${num(x + w - r)} ${num(b)} l`,
      `${num(x + w - r + k)} ${num(b)} ${num(x + w)} ${num(b + r - k)} ${num(x + w)} ${num(b + r)} c`,
      `${num(x + w)} ${num(b + h - r)} l ${num(x + w)} ${num(b + h - r + k)} ${num(x + w - r + k)} ${num(b + h)} ${num(x + w - r)} ${num(b + h)} c`,
      `${num(x + r)} ${num(b + h)} l ${num(x + r - k)} ${num(b + h)} ${num(x)} ${num(b + h - r + k)} ${num(x)} ${num(b + h - r)} c`,
      `${num(x)} ${num(b + r)} l ${num(x)} ${num(b + r - k)} ${num(x + r - k)} ${num(b)} ${num(x + r)} ${num(b)} c h`,
    ].join(' ')
  }
  const fill = (path: string, color: string) => ops.push(`${rgb(color)} rg ${path} f`)
  const fillAndEdge = (path: string, color: string, edge: string) => ops.push(`${rgb(color)} rg ${rgb(edge)} RG 0.8 w ${path} B`)
  const rule = (top: number) => ops.push(`${rgb(RULE)} RG 0.8 w ${MARGIN} ${num(y(top))} m ${PAGE_W - MARGIN} ${num(y(top))} l S`)

  // The Kea cycle mark, in its own 256-unit, y-down space (kea-brand-blue.svg).
  const logo = (x: number, top: number, size: number) => {
    const s = size / 256
    const bolt = [
      '143 54 m 137 110 l 166.5 119.4 l',
      quad([166.5, 119.4], [178, 123], [170.1, 131.9]),
      '109 201 l 117 149 l 89 139.4 l',
      quad([89, 139.4], [79, 136], [87, 125.8]),
      'h',
    ].join(' ')
    ops.push(
      `q ${num(s)} 0 0 ${num(-s)} ${num(x)} ${num(y(top))} cm`,
      `${rgb('#868CFF')} RG ${rgb('#868CFF')} rg 1 J 1 j`,
      `15 w ${arc(128, 128, 95, 180, 328)} S ${arc(128, 128, 95, 0, 148)} S`,
      '5 w 226 96 m 222 68 l 197 85 l h B 30 160 m 34 188 l 59 171 l h B',
      // The bolt's soft corners come from a thin stroke under the gradient fill.
      `q 1.1 0 0 1.1 -12.8 -12.8 cm ${rgb('#5F45FF')} RG 3.5 w ${bolt} S ${bolt} W n /Sh2 sh Q`,
      'Q',
    )
  }

  const paid = data.status === 'Paid'
  const right = PAGE_W - MARGIN

  // Header: the Billing page's invoice-header wash (lavender, near-white, then light red
  // while due or light green once paid), the logo as it is, title, status and amount.
  const headerH = 140
  ops.push(`q 0 ${num(y(headerH))} ${PAGE_W} ${headerH} re W n /Sh1 sh Q`)
  ops.push(`${rgb('#E9ECF7')} RG 0.8 w 0 ${num(y(headerH))} m ${PAGE_W} ${num(y(headerH))} l S`)
  logo(MARGIN, 40, 60)
  const title = data.estimated ? 'KEA ENERGY USAGE ESTIMATE' : 'KEA ENERGY INVOICE'
  text(title, 124, 70, { font: 'bold', size: 20 })
  const pillX = 124 + textWidth(title, 'bold', 20) + 12
  const pillW = textWidth(data.status, 'bold', 8.5) + 18
  fill(roundedRect(pillX, 56, pillW, 18, 9), paid ? '#E3F6EC' : '#FFE6EB')
  text(data.status, pillX + 9, 68.5, { font: 'bold', size: 8.5, color: paid ? '#1E9E5A' : '#E0445A' })
  text(`Plan: ${data.planName}`, 124, 92, { color: MUTED })
  text(paid ? 'AMOUNT PAID' : 'AMOUNT DUE', right, 60, { font: 'bold', size: 7.5, color: GREY_LABEL, spacing: 1.4, align: 'right' })
  text(data.amount, right, 94, { font: 'bold', size: 28, color: PURPLE, align: 'right' })
  text(paid ? 'Paid - thank you' : `Due ${data.due}`, right, 112, { size: 10, color: MUTED, align: 'right' })

  // Two light grey cards: who the bill is for, and the invoice itself.
  const cardTop = 172
  const cardW = (CONTENT_W - 16) / 2
  const pad = 18
  const leading = 18
  const billTo = [
    `Customer: ${data.customerName}`,
    `Customer ID: ${data.customerId}`,
    ...wrap(`Address: ${data.address}`, cardW - pad * 2, 'regular', 10.5),
  ]
  const details = [
    `Invoice: ${data.number}`,
    `Billing period: ${data.period}`,
    `Due date: ${data.due}`,
    `Status: ${data.status}`,
    `Payment method: ${data.paymentMethod}`,
  ]
  const cardH = 48 + (Math.max(billTo.length, details.length) - 1) * leading + 22
  const card = (x: number, label: string, lines: string[]) => {
    fillAndEdge(roundedRect(x, cardTop, cardW, cardH, 12), GREY_FILL, GREY_EDGE)
    text(label, x + pad, cardTop + 26, { font: 'bold', size: 7.5, color: GREY_LABEL, spacing: 1.4 })
    lines.forEach((line, i) => text(line, x + pad, cardTop + 48 + i * leading, { font: i === 0 ? 'bold' : 'regular' }))
  }
  card(MARGIN, 'BILL TO', billTo)
  card(MARGIN + cardW + 16, 'INVOICE DETAILS', details)

  // Charges: a grey header row, the two lines, then the total on a grey bar.
  const tableTop = cardTop + cardH + 28
  fill(roundedRect(MARGIN, tableTop, CONTENT_W, 30, 8), GREY_FILL)
  text('DESCRIPTION', MARGIN + 16, tableTop + 19, { font: 'bold', size: 7.5, color: GREY_LABEL, spacing: 1.4 })
  text('AMOUNT', right - 16, tableTop + 19, { font: 'bold', size: 7.5, color: GREY_LABEL, spacing: 1.4, align: 'right' })
  const rows: [string, string][] = [
    ...(data.chargeLines ?? []).map(line => [line.label, line.amount == null ? 'Not on file' : money(line.amount)] as [string, string]),
  ]
  rows.forEach(([label, amount], i) => {
    const baseline = tableTop + 30 + 24 + i * 36
    text(label, MARGIN + 16, baseline)
    text(amount, right - 16, baseline, { align: 'right' })
    rule(baseline + 12)
  })
  const totalTop = tableTop + 30 + rows.length * 36 + 12
  fill(roundedRect(MARGIN, totalTop, CONTENT_W, 48, 12), GREY_FILL)
  text(paid ? 'Paid in full' : `Amount due by ${data.due}`, MARGIN + 16, totalTop + 29)
  text(`Total: ${data.amount}`, right - 16, totalTop + 30, { font: 'bold', size: 15, color: PURPLE, align: 'right' })

  // The same orange payment note the invoice card on the page carries.
  const noteTop = totalTop + 48 + 24
  fill(roundedRect(MARGIN, noteTop, CONTENT_W, 40, 8), '#FFF5EC')
  fill(`${MARGIN} ${num(y(noteTop + 40))} 3 40 re`, '#FE6601')
  text('Payment:', MARGIN + 16, noteTop + 25, { font: 'bold', color: '#FE6601' })
  const note = paid ? 'Paid according to account records.' : 'Use the verified payment details on your issued bill.'
  text(note, MARGIN + 16 + textWidth('Payment: ', 'bold', 10.5), noteTop + 25, { color: '#5B6A8F' })

  text(data.estimated ? 'Usage estimate; not an issued tax invoice.' : 'Based on issued account records.', MARGIN, noteTop + 40 + 28, { size: 9.5, color: MUTED })
  text('Thank you for choosing Kea Energy.', MARGIN, noteTop + 40 + 48, { font: 'bold', size: 11, color: PURPLE })

  // Footer.
  rule(790)
  text('Kea Energy', MARGIN, 808, { font: 'bold', size: 9, color: PURPLE })
  text(`Invoice ${data.number}`, right, 808, { size: 9, color: MUTED, align: 'right' })

  // The header wash runs along the CSS gradient's 120° line across the header box.
  const angle = (120 * Math.PI) / 180
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  const half = (Math.abs(PAGE_W * dx) + Math.abs(headerH * dy)) / 2
  const cx = PAGE_W / 2
  const cy = y(headerH / 2)
  const headerWash = shading([cx - dx * half, cy + dy * half, cx + dx * half, cy - dy * half], [
    [0, '#F1EEFF'], [0.58, '#FBFAFF'], [1, paid ? '#E9F8F0' : '#FFEFF2'],
  ])
  const boltGradient = shading([102, 61, 158, 197], [[0, '#4318FF'], [0.54, '#5F45FF'], [1, '#868CFF']])

  // Objects: 1–9 fixed, then a descriptor and a compressed font program per embedded weight.
  type PdfObject = string | { dict: string; stream: Uint8Array<ArrayBuffer> }
  const content = ops.join('\n')
  const objects: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /Shading << /Sh1 7 0 R /Sh2 8 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '', // F1, filled in below
    '', // F2
    headerWash,
    boltGradient,
    `<< /Title (Kea Energy invoice ${escape(ascii(data.number))}) >>`,
  ]
  const fontDict = (slot: number, font: Font, name: string) => {
    if (!metrics || !fonts) {
      objects[slot] = `<< /Type /Font /Subtype /Type1 /BaseFont /${font === 'bold' ? 'Helvetica-Bold' : 'Helvetica'} /Encoding /WinAnsiEncoding >>`
      return
    }
    const m = metrics[font]
    const descriptor = objects.length + 1
    objects[slot] = `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /FirstChar 32 /LastChar 126 /Widths [${m.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${descriptor} 0 R >>`
    objects.push(
      `<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${m.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${m.ascent} /Descent ${m.descent} /CapHeight ${m.capHeight} /StemV ${font === 'bold' ? 120 : 80} /FontFile3 ${descriptor + 1} 0 R >>`,
      { dict: '/Subtype /OpenType /Filter /FlateDecode', stream: fonts[font] },
    )
  }
  fontDict(4, 'regular', 'Geist-Regular')
  fontDict(5, 'bold', 'Geist-SemiBold')

  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  write('%PDF-1.6\n')
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const offsets: number[] = []
  for (const [i, object] of objects.entries()) {
    offsets.push(length)
    write(`${i + 1} 0 obj\n`)
    if (typeof object === 'string') {
      write(`${object}\nendobj\n`)
    } else {
      const packed = await deflate(object.stream)
      write(`<< ${object.dict} /Length ${packed.length} >>\nstream\n`)
      write(packed)
      write('\nendstream\nendobj\n')
    }
  }
  const xref = length
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  write(offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''))
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${xref}\n%%EOF`)

  const pdf = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    pdf.set(chunk, at)
    at += chunk.length
  }
  return pdf
}

async function loadFonts(): Promise<InvoiceFonts | undefined> {
  try {
    const [regular, bold] = await Promise.all(
      ['/assets/energy-home/geist-regular.otf', '/assets/energy-home/geist-semibold.otf'].map(async (path) => {
        const response = await fetch(path)
        if (!response.ok) throw new Error(`${path}: ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      }),
    )
    return { regular: regular!, bold: bold! }
  } catch {
    // Helvetica is built into every PDF reader, so the invoice still downloads.
    return undefined
  }
}

export async function downloadInvoicePdf(data: InvoicePdfData) {
  const pdf = await buildInvoicePdf(data, await loadFonts())
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `kea-invoice-${data.number}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
