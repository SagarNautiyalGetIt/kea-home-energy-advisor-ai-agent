// Builds src/themes/midnight-dark.generated.css: every dark-theme rule in the sheets below,
// re-coloured into the "midnight" palette — the black-and-blue of the slide-deck login skin
// (near-black navy, electric blue, ice-blue light accents) — so the dark theme can change
// palette without editing or deleting the original ("classic") dark rules.
//
//   node scripts/build-midnight-theme.mjs            write the file
//   node scripts/build-midnight-theme.mjs --preview  print the colour map instead
//
// How the override stays exact: each copied rule keeps its original selector and gains only
// a `:where(…)` gate (not the classic palette), which adds no specificity, and the file loads
// after every original sheet (main.tsx imports it last). So each copy beats its original by
// order alone, and the copies beat one another exactly as the originals did. Light-mode rules
// that hard-code the purple accent and still show through in dark get a copy too, gated on
// the dark theme the same zero-specificity way. Re-run this after changing any dark rule.
//
// The sign-in and sign-up pages are dark whatever the theme: every copy also matches while the
// page holds a .login-page, unless <html> carries a data-login-skin (see login-midnight.css).
// `[data-theme=dark]` becomes `:is([data-theme=dark],:has(.login-page))`, which weighs the
// same, so the zero-specificity rule above still holds.
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
// The originals' cascade order: page and feature sheets come in through App before index.css.
const SOURCES = ['solar.css', 'features/energy-home/EnergyHomePanel.css', 'pages/PowerClashPage.css', 'index.css']
const OUT = 'themes/midnight-dark.generated.css'
const DARK_OR_AUTH = ':is([data-theme=dark],:has(.login-page))'
const MIDNIGHT = ':where(:not([data-dark-palette=classic]):is([data-theme=dark],:not([data-login-skin])))'
const DARK_ONLY = `:where(${DARK_OR_AUTH}${MIDNIGHT.slice(':where('.length, -1)})`

/* ---- a small CSS walker: comments, nesting, @media/@supports ---------------------------- */

function splitTop(text, sep) {
  const out = []
  let depth = 0, cur = '', quote = null
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === sep && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

// A block's items: declaration strings and nested { prelude, items } blocks.
function parseBlock(text, i = 0) {
  const items = []
  let buf = '', quote = null, depth = 0
  while (i < text.length) {
    const ch = text[i]
    if (quote) { buf += ch; if (ch === quote) quote = null; i++; continue }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; i++; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && ch === '{') {
      const [children, next] = parseBlock(text, i + 1)
      items.push({ prelude: buf.trim(), items: children })
      buf = ''; i = next; continue
    }
    if (depth === 0 && ch === '}') { if (buf.trim()) items.push(buf); return [items, i + 1] }
    if (depth === 0 && ch === ';') { items.push(buf); buf = ''; i++; continue }
    buf += ch; i++
  }
  if (buf.trim()) items.push(buf)
  return [items, i]
}

const nest = (parent, child) => splitTop(parent, ',').flatMap((p) => splitTop(child, ',').map((c) =>
  c.includes('&') ? c.trim().replaceAll('&', p.trim()) : `${p.trim()} ${c.trim()}`)).join(',')

function* walk(items, context = [], selector = null) {
  const decls = items.filter((it) => typeof it === 'string').map((d) => d.trim()).filter(Boolean)
  if (selector && decls.length) yield { context, selector, decls }
  for (const it of items) {
    if (typeof it === 'string') continue
    if (it.prelude.startsWith('@')) {
      // @keyframes, @font-face and the like carry no themed colours
      if (/^@(media|supports|container)\b/.test(it.prelude)) yield* walk(it.items, [...context, it.prelude], selector)
      continue
    }
    yield* walk(it.items, context, selector ? nest(selector, it.prelude) : it.prelude)
  }
}

/* ---- the palette -------------------------------------------------------------------------- */

const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)/gi
const HAS_COLOR = new RegExp(COLOR.source, 'i')

function parseColor(token) {
  if (token.startsWith('#')) {
    let hex = token.slice(1)
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    return { rgb: [r, g, b], alpha: hex.length === 8 ? String(+(parseInt(hex.slice(6), 16) / 255).toFixed(3)) : null }
  }
  const parts = token.slice(token.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean)
  return { rgb: parts.slice(0, 3).map(Number), alpha: parts[3] ?? null }
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
}

// Lightness of the dark surfaces, pulled down towards the login's near-black navy. Each pair
// is classic → midnight: page (#11162b), card (#1a2039), line (#303953), up to the accents.
const SURFACE_L = [[0, 0], [0.118, 0.062], [0.163, 0.1], [0.257, 0.19], [0.35, 0.33]]
function surfaceLightness(l) {
  for (let i = 1; i < SURFACE_L.length; i++) {
    const [x0, y0] = SURFACE_L[i - 1], [x1, y1] = SURFACE_L[i]
    if (l <= x1) return y0 + (y1 - y0) * (l - x0) / (x1 - x0)
  }
  return l
}

// Only the indigo-violet family moves; greys, and the colours that carry meaning (the energy
// routes' sky-blue battery, bill-shock red, savings green, amber warnings), keep theirs.
function remap(rgb) {
  const [h, s, l] = rgbToHsl(rgb)
  if (s < 0.08 || h < 215 || h > 290) return null
  if (l < 0.35) return hslToRgb(220, Math.min(0.85, s * 1.5 + 0.1), surfaceLightness(l))
  // violet accents become the electric blue; pale lilacs become ice blue
  return hslToRgb(l >= 0.68 ? 205 : 219, s, l)
}

// The light theme's purple accent (#4318ff and its family, down to the pale lilac type on the
// purple bars and the lilac icon bubbles), where it still shows in dark. The near-white lilac
// page tints stay out.
function isAccent(rgb) {
  const [h, s, l] = rgbToHsl(rgb)
  return h >= 235 && h <= 275 && s >= 0.5 && l >= 0.3 && l <= 0.97
}

// Light-theme leftovers the classic dark rules never replaced, because the light rule beat them
// (most often a dark :where() list against a two-class light selector): near-white cool
// surfaces, pale borders and grey-navy type. A copy of the light rule only wins where the classic
// dark rule lost; where that rule won, it is the more specific one and still does. Warm tints
// (the orange notes and pills) are left to the hand-written sheet.
const cool = (h, s) => s < 0.15 || (h >= 190 && h <= 290)
const isNearWhite = (rgb) => { const [h, s, l] = rgbToHsl(rgb); return l >= 0.9 && cool(h, s) }
const isPaleLine = (rgb) => { const [h, s, l] = rgbToHsl(rgb); return l >= 0.8 && cool(h, s) }
const isDarkInk = (rgb) => { const [h, s, l] = rgbToHsl(rgb); return l >= 0.18 && l <= 0.62 && s < 0.6 && h >= 200 && h <= 260 }
// Darker light-theme type (headings) becomes lighter dark-theme type, muted greys a muted grey.
const lightInk = (rgb) => { const [, s, l] = rgbToHsl(rgb); return hslToRgb(215, Math.min(s, 0.3), Math.min(0.88, Math.max(0.62, 1.05 - 0.75 * l))) }
const LIFT = 'rgb(47 123 255 / 14%)' // the menus' hover highlight
const SURFACE = [12, 26, 54] // a navy a shade above the cards
const LINE = [24, 40, 73]

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
const colorMap = new Map() // for --preview
const TEXT_PROP = /^\s*(color|-webkit-text-fill-color|caret-color|text-decoration-color)\s*:/

function recolor(value, shouldMap = () => true) {
  // Blue as type needs to be lighter than blue as a fill: 4.5:1 on the navy wants at least
  // two-thirds lightness, where the same blue under white type wants less than half.
  const asText = TEXT_PROP.test(value)
  // never touch url(...) contents: `url(#id)` looks like a colour
  return value.split(/(url\([^)]*\))/).map((chunk) => chunk.startsWith('url(') ? chunk : chunk.replace(COLOR, (token) => {
    const { rgb, alpha } = parseColor(token)
    let next = shouldMap(rgb) && remap(rgb)
    if (!next) return token
    const [h, s, l] = rgbToHsl(next)
    if (asText && s > 0.5 && l >= 0.35 && l < 0.66) next = hslToRgb(h, s, 0.66)
    colorMap.set(hex(rgb), [hex(next), (colorMap.get(hex(rgb))?.[1] ?? 0) + 1])
    return alpha === null ? hex(next) : `rgb(${next.join(' ')} / ${alpha})`
  })).join('')
}

// Replace the tokens `test` picks out with `to` (an [r,g,b] or a CSS colour), keeping alpha.
function replaceColors(decl, test, to) {
  return decl.split(/(url\([^)]*\))/).map((chunk) => chunk.startsWith('url(') ? chunk : chunk.replace(COLOR, (token) => {
    const { rgb, alpha } = parseColor(token)
    if (!test(rgb)) return token
    const target = typeof to === 'function' ? to(rgb) : to
    if (typeof target === 'string') return target
    return alpha === null ? hex(target) : `rgb(${target.join(' ')} / ${alpha})`
  })).join('')
}

/* ---- selectors and declarations ------------------------------------------------------------ */

// A part is light-only when it says so either way: `:not([data-theme=dark])` or
// `[data-theme=light]`. Neither gets a dark copy, which could never match. Nor does a part
// written for the classic palette, which midnight's gate rules out.
const LIGHT_ONLY = /:not\(\[data-theme=(['"]?)dark\1\]\)/g
const LIGHT_ATTR = /\[data-theme=(['"]?)light\1\]/
const DARK_ATTR = /\[data-theme=(['"]?)dark\1\]/
const isDark = (part) => DARK_ATTR.test(part.replace(LIGHT_ONLY, ''))
const CLASSIC_ATTR = /\[data-dark-palette=(['"]?)classic\1\]/
const isLightOnly = (part) => CLASSIC_ATTR.test(part) || (!isDark(part) && (DARK_ATTR.test(part) || LIGHT_ATTR.test(part)))
// -webkit-background-clip rides along with background: the shorthand resets it, and gradient
// text without it shows as a filled box in Safari.
const COLOR_PROP = /^(--|color|color-scheme|background|-webkit-background-clip|border|outline|box-shadow|text-shadow|fill|stroke|stop-color|caret-color|accent-color|text-decoration|column-rule|filter|backdrop-filter|-webkit-text-fill-color|-webkit-text-stroke|scrollbar-color)/

function gateBase(part) {
  const root = part.match(/^(?:html|:root)[^\s>+~]*/)
  return root ? root[0] + DARK_ONLY + part.slice(root[0].length) : `:where(html${DARK_ONLY}) ${part}`
}

// background-color and background, border-top and border-color… count as one property here.
const propFamily = (decl) => {
  const prop = decl.slice(0, decl.indexOf(':')).trim().replace(/^-webkit-(?!text)/, '')
  return prop.startsWith('--') ? prop : prop.match(/^(background|border|outline|text-decoration)/)?.[1] ?? prop
}

// Filled buttons wear the login button's blue-to-black, var(--midnight-fill) from midnight.css,
// in place of the flat or two-blue accent fill. Buttons only: the same accent also fills
// switches, badges, bars, bubbles and the nav marker, and those keep it. So does the chosen
// option in a group (Daily/Weekly/Monthly, $/kWh, Light/Dark, tabs, chips): its black end
// sank into the dark track and hid which option was on.
function subjectOf(part) {
  let depth = 0, start = 0
  for (let i = 0; i < part.length; i++) {
    const ch = part[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1
  }
  return part.slice(start)
}
const isButton = (part) => {
  const subject = subjectOf(part)
  const chosenOption = /\.active\b|\[aria-(selected|pressed)=true\]/.test(subject)
  return !subject.includes('::') && !chosenOption && (/button\b/.test(subject) || /\.contact-actions a\b/.test(part) ||
    /\.(primary-action|primary-small|compare-action|pay-action|contact-primary|pricing-choose)\b/.test(subject))
}
// A see-through tint (a selected option's 5% wash) is not a fill; it is only re-coloured.
const isAccentFill = (decl) => /^background(-color|-image)?\s*:/.test(decl) && !decl.includes('url(') &&
  (/var\(--purple2?\)/.test(decl) || (decl.match(COLOR) ?? []).some((t) => {
    const { rgb, alpha } = parseColor(t)
    const opacity = alpha === null ? 1 : alpha.endsWith('%') ? parseFloat(alpha) / 100 : Number(alpha)
    return isAccent(rgb) && rgbToHsl(rgb)[2] <= 0.75 && opacity >= 0.5
  }))
// border-box: under a transparent or tinted border the fill would otherwise repeat from the
// opposite end, the sliver of blue and black the login button's edges showed.
const important = (decl) => /!important\s*$/.test(decl) ? ' !important' : ''
const swapFill = (decl) => `background:var(--midnight-fill) border-box${important(decl)}`
// Everything else the accent fills (chosen options, switches, bars, bubbles, badges) takes a
// deeper bright blue, var(--midnight-accent-fill): white type on the lighter one managed 3:1.
const swapAccentFill = (decl) => `background:var(--midnight-accent-fill) border-box${important(decl)}`

const BACKGROUND = /^\s*background(-color|-image)?\s*:/
const BORDER = /^\s*border(-top|-right|-bottom|-left)?(-color)?\s*:/
const has = (decl, test) => (decl.match(COLOR) ?? []).some((t) => test(parseColor(t).rgb))

// A copied light-mode rule lands after every original, so a later original that overrode it
// would now lose. Any later rule with the same selector that sets the same property is
// therefore copied as well, keeping the original order between the two.
const copiedBase = new Map() // selector part → property families copied for it

function themedRule({ selector, decls }) {
  const parts = splitTop(selector, ',').map((p) => p.trim()).filter((p) => !isLightOnly(p))
  const textClip = decls.some((d) => /background-clip\s*:\s*text/.test(d))
  // Selector parts that behave alike are copied together: dark or light, button or not, a
  // hover/focus state or not, a pseudo-element (switch knobs, markers) or not.
  const groups = new Map()
  for (const p of parts) {
    const subject = subjectOf(p)
    const key = [isDark(p), isButton(p), /:(hover|focus|active)/.test(subject), subject.includes('::')].join()
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const out = []
  for (const [key, group] of groups) {
    const [dark, button, state, pseudo] = key.split(',').map((v) => v === 'true')
    const fill = (d) => !textClip && isAccentFill(d)
    const leftoverSurface = (d) => !dark && !pseudo && BACKGROUND.test(d) && !d.includes('url(') && has(d, isNearWhite)
    const leftoverLine = (d) => !dark && BORDER.test(d) && has(d, isPaleLine)
    const leftoverInk = (d) => !dark && TEXT_PROP.test(d) && has(d, isDarkInk)
    const theme = (d) => {
      if (fill(d)) return button ? swapFill(d) : swapAccentFill(d)
      if (dark) return recolor(d)
      if (leftoverSurface(d)) d = replaceColors(d, isNearWhite, state ? LIFT : SURFACE)
      if (leftoverLine(d)) d = replaceColors(d, isPaleLine, LINE)
      if (leftoverInk(d)) d = replaceColors(d, isDarkInk, lightInk)
      return recolor(d, isAccent)
    }
    if (dark) {
      const kept = decls.filter((d) => COLOR_PROP.test(d) || HAS_COLOR.test(d))
      if (kept.length) out.push({ selector: group.map((p) => p.replace(DARK_ATTR, DARK_OR_AUTH + MIDNIGHT)).join(','), decls: kept.map(theme) })
      continue
    }
    const overriding = new Set(group.flatMap((p) => [...(copiedBase.get(p) ?? [])]))
    const picked = decls.filter((d) => has(d, isAccent) || fill(d) || leftoverSurface(d) || leftoverLine(d) ||
      leftoverInk(d) || (COLOR_PROP.test(d) && overriding.has(propFamily(d))))
    // A copied background brings the type colour set on it (the white on the chosen FAQ chip
    // would otherwise lose to a hover rule's copy) and the clip and origin its shorthand would
    // reset. Nothing more: a copy lands after every original, so a border or shadow carried
    // along needlessly beats whichever later rule took it away (the avatar's old yellow ring,
    // which .profile-trigger sets to none).
    const withBackground = picked.some((d) => propFamily(d) === 'background')
    const kept = decls.filter((d) => picked.includes(d) ||
      (withBackground && (propFamily(d) === 'background' || /^\s*color\s*:/.test(d))))
    if (kept.length) {
      out.push({ selector: group.map(gateBase).join(','), decls: kept.map(theme) })
      for (const p of group) copiedBase.set(p, new Set([...(copiedBase.get(p) ?? []), ...kept.map(propFamily)]))
    }
  }
  return out
}

/* ---- output -------------------------------------------------------------------------------- */

const chunks = []
for (const file of SOURCES) {
  const css = readFileSync(new URL(file, SRC), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const rule of walk(parseBlock(css)[0])) {
    // Print is paper whatever the screen theme: dark copies there would put pale type on white.
    if (rule.context.some((at) => /\bprint\b/.test(at))) continue
    for (const themed of themedRule(rule)) chunks.push({ file, context: rule.context, ...themed })
  }
}

if (process.argv.includes('--preview')) {
  for (const [from, [to, uses]] of [...colorMap].sort((a, b) => b[1][1] - a[1][1])) console.log(uses, from, '→', to)
  console.log(`${chunks.length} rules`)
} else {
  let css = `/* GENERATED by scripts/build-midnight-theme.mjs from ${SOURCES.join(', ')} — do not edit by hand.\n` +
    '   The classic dark rules re-coloured into the midnight palette; see that script for how. */\n'
  let file = null, open = []
  const close = () => { while (open.length) { css += '}\n'; open.pop() } }
  for (const chunk of chunks) {
    if (chunk.file !== file) { close(); css += `\n/* ${chunk.file} */\n`; file = chunk.file }
    if (chunk.context.join('|') !== open.join('|')) { close(); for (const at of chunk.context) { css += `${at}{\n`; open.push(at) } }
    css += `${chunk.selector}{${chunk.decls.join(';')}}\n`
  }
  close()
  writeFileSync(new URL(OUT, SRC), css)
  console.log(`wrote src/${OUT}: ${chunks.length} rules`)
}
