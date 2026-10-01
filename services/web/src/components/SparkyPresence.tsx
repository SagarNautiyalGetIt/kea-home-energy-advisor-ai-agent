import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import './SparkyPresence.css'

export type SparkyPresenceMode = 'idle' | 'listening' | 'thinking' | 'searching' | 'replying' | 'happy' | 'sorry' | 'static'

const LABEL: Record<SparkyPresenceMode, string> = {
  idle: 'Sparky is here',
  listening: 'Sparky is listening',
  thinking: 'Sparky is thinking',
  searching: 'Sparky is looking up your account',
  replying: 'Sparky is responding',
  happy: 'Sparky answered',
  sorry: 'Sparky could not answer',
  static: 'Sparky is here',
}

/* Following the cursor and being booped, after the page-mascot package
   (github.com/nilbuild/page-mascot, MIT). That component swaps between the cells of two
   raster sprite sheets, nine head directions and nine expressions. Sparky is vector and
   already animated, so the same rules and timings drive CSS offsets and SVG faces here
   instead, and the breath, blink and halo keep running underneath. */
type Reaction = 'blink' | 'heart' | 'sparkle' | 'delighted' | 'dizzy'

// Eight directions, clockwise from the right as atan2 gives them with y pointing down.
const SECTORS = 8
const SECTOR = (Math.PI * 2) / SECTORS
// A direction is held until the pointer is this far (in radians) past its edge, so Sparky
// does not flick between two when the cursor sits on the line between them.
const HYSTERESIS = 0.12
// Within this many px of Sparky's centre it looks straight out at the reader.
const DEAD_ZONE = 70
// A boop is a quick blink, then one of these in turn, then the resting face again.
const PAYOFFS: Reaction[] = ['heart', 'sparkle', 'delighted']
const BOOP_PAYOFF = 120
const BOOP_END = 560
// Four boops inside 1.6s and Sparky is dizzy for 1.1s.
const DIZZY_AFTER = 4
const DIZZY_WINDOW = 1600
const DIZZY_END = 1100
const SQUASH_MS = 420
// Per-keyframe easing with the animation itself linear: an easing on the whole animation
// would reinterpret every offset and front-load the bounce.
const SQUASH: Keyframe[] = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.10, 0.86)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(0.95, 1.08)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
]

function wrap(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

// cos(π/2) is 6e-17, not 0; three places is plenty for a CSS offset.
function round(value: number) {
  return Math.round(value * 1000) / 1000
}

function useMascot(enabled: boolean) {
  const rootRef = useRef<HTMLButtonElement>(null)
  const squashRef = useRef<HTMLDivElement>(null)
  // One array for the component's life, emptied in place, so the unmount cleanup below
  // clears whatever is pending at the time rather than what was there on mount.
  const timers = useRef<number[]>([])
  const boops = useRef({ count: 0, at: 0 })
  // -1 is looking straight out; 0–7 index the sectors.
  const [sector, setSector] = useState(-1)
  const [reaction, setReaction] = useState<Reaction | null>(null)

  useEffect(() => {
    // Only with a mouse or trackpad. A touch screen has no cursor between taps, so Sparky
    // would stare at wherever the last tap was.
    if (!enabled || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let current = -1
    let pointer: { x: number; y: number } | null = null
    const look = (next: number) => {
      current = next
      setSector(next)
    }
    const aim = () => {
      const root = rootRef.current
      if (!root || !pointer) return
      const box = root.getBoundingClientRect()
      const dx = pointer.x - (box.left + box.width / 2)
      const dy = pointer.y - (box.top + box.height / 2)
      if (Math.hypot(dx, dy) < DEAD_ZONE) return look(-1)
      const angle = Math.atan2(dy, dx)
      if (current !== -1 && Math.abs(wrap(angle - current * SECTOR)) < SECTOR / 2 + HYSTERESIS) return
      look((Math.round(angle / SECTOR) + SECTORS) % SECTORS)
    }
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      aim()
    }
    // Not in page-mascot: when the pointer leaves the window, Sparky looks back out at the
    // reader rather than at the edge it left by.
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget) return
      pointer = null
      look(-1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onOut)
    // Captured, so a scroll inside the chat pane re-aims as well as one of the window.
    window.addEventListener('scroll', aim, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onOut)
      window.removeEventListener('scroll', aim, { capture: true })
    }
  }, [enabled])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(window.clearTimeout)
  }, [])

  const boop = () => {
    const pending = timers.current
    pending.splice(0).forEach(window.clearTimeout)
    const later = (ms: number, next: Reaction | null) => {
      pending.push(window.setTimeout(() => setReaction(next), ms))
    }
    const now = Date.now()
    const run = boops.current
    run.count = now - run.at < DIZZY_WINDOW ? run.count + 1 : 1
    run.at = now
    if (run.count >= DIZZY_AFTER) {
      run.count = 0
      setReaction('dizzy')
      later(DIZZY_END, null)
    } else {
      setReaction('blink')
      later(BOOP_PAYOFF, PAYOFFS[(run.count - 1) % PAYOFFS.length] ?? null)
      later(BOOP_END, null)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    squashRef.current?.animate(SQUASH, { duration: SQUASH_MS, easing: 'linear' })
  }

  // Read through `enabled` rather than reset in the effect's cleanup: when Sparky goes
  // unavailable mid-glance it is back to looking straight out on that same render.
  return {
    rootRef,
    squashRef,
    sector: enabled ? sector : -1,
    reaction: enabled ? reaction : null,
    boop,
  }
}

const NAVY = '#14163F'
const BLUSH = <><circle cx="37" cy="65" r="4.5" fill="#FF7A9A" opacity="0.6"/><circle cx="83" cy="65" r="4.5" fill="#FF7A9A" opacity="0.6"/></>
const GRIN = <path d="M 52 71 Q 60 83 68 71 Z" fill={NAVY} stroke={NAVY} strokeLinejoin="round" strokeWidth="1.6"/>

function heart(cx: number, cy: number) {
  return `M ${cx} ${cy + 6} C ${cx - 9} ${cy - 1} ${cx - 6} ${cy - 9} ${cx} ${cy - 4} C ${cx + 6} ${cy - 9} ${cx + 9} ${cy - 1} ${cx} ${cy + 6} Z`
}

// A four-point twinkle, r from the centre to each tip.
function twinkle(cx: number, cy: number, r: number) {
  const k = r * 0.2
  return `M ${cx} ${cy - r} Q ${cx + k} ${cy - k} ${cx + r} ${cy} Q ${cx + k} ${cy + k} ${cx} ${cy + r} Q ${cx - k} ${cy + k} ${cx - r} ${cy} Q ${cx - k} ${cy - k} ${cx} ${cy - r} Z`
}

// Four half-turns of growing radius, all clockwise, so they join into one spiral whose
// centre is (cx, cy).
function spiral(cx: number, cy: number) {
  return `M ${cx - 0.75} ${cy} a 1.5 1.5 0 0 1 3 0 a 3 3 0 0 1 -6 0 a 4.5 4.5 0 0 1 9 0 a 6 6 0 0 1 -12 0`
}

/** The faces a boop shows, in place of page-mascot's reactions sheet. */
function ReactionFace({ reaction }: { reaction: Reaction }) {
  return (
    <svg className={`sparky-presence__reaction sparky-presence__reaction--${reaction}`} viewBox="0 0 120 120">
      {reaction === 'blink' && (
        <>
          <path d="M 42 58 Q 48 63 54 58" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="3"/>
          <path d="M 66 58 Q 72 63 78 58" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="3"/>
          <path d="M 52 73 Q 60 81 68 73" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.4"/>
        </>
      )}
      {reaction === 'heart' && (
        <>
          <path d={heart(48, 58)} fill="#FF5C8D"/>
          <path d={heart(72, 58)} fill="#FF5C8D"/>
          <circle cx="45" cy="54.5" r="1.4" fill="#FFFFFF" opacity="0.8"/>
          <circle cx="69" cy="54.5" r="1.4" fill="#FFFFFF" opacity="0.8"/>
          {BLUSH}
          {GRIN}
        </>
      )}
      {reaction === 'sparkle' && (
        <>
          <path d={twinkle(48, 58, 8.5)} fill="#FFE27A"/>
          <path d={twinkle(72, 58, 8.5)} fill="#FFE27A"/>
          <path className="sparky-presence__twinkle" d={twinkle(90, 32, 5)} fill="#FFFFFF"/>
          <path className="sparky-presence__twinkle" d={twinkle(31, 86, 3.4)} fill="#FFE27A"/>
          {GRIN}
        </>
      )}
      {reaction === 'delighted' && (
        <>
          <path d="M 41 61 C 43 50 53 50 55 61" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="3.2"/>
          <path d="M 65 61 C 67 50 77 50 79 61" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="3.2"/>
          {BLUSH}
          {GRIN}
        </>
      )}
      {reaction === 'dizzy' && (
        <>
          <circle cx="48" cy="58" r="8.5" fill="#FFFFFF"/>
          <circle cx="72" cy="58" r="8.5" fill="#FFFFFF"/>
          <path className="sparky-presence__spiral" style={{ transformOrigin: '48px 58px' }} d={spiral(48, 58)} fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="1.6"/>
          <path className="sparky-presence__spiral" style={{ transformOrigin: '72px 58px' }} d={spiral(72, 58)} fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="1.6"/>
          <path d="M 51 76 q 2.25 -3 4.5 0 q 2.25 3 4.5 0 q 2.25 -3 4.5 0 q 2.25 3 4.5 0" fill="none" stroke={NAVY} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2"/>
        </>
      )}
    </svg>
  )
}

// A face is a mode's own, or `pondering`, which no mode asks for: it is one of the faces a
// thinking Sparky shuffles through (see `useShuffledFace`).
type FaceName = SparkyPresenceMode | 'pondering'
type OpenFace = Exclude<FaceName, 'happy'>

/* The face for each mode. The phone app (services/mobile/src/components/sparky-presence.tsx
   on mobile-V2) draws two: the open-eyed face for everything else, and ^ ^ for an answer
   that has landed. Both are kept exactly. The rest are drawn from the open-eyed one, with
   the same eye whites, pupils and navy strokes, and differ only in the eyes' size, where
   the pupils sit, and the mouth. */
const EYES: Record<OpenFace, { rx: number; ry: number; pupil: [number, number] }> = {
  // The phone's own: pupils a touch right of and below centre.
  idle: { rx: 6.5, ry: 9, pupil: [2, 1] },
  replying: { rx: 6.5, ry: 9, pupil: [2, 1] },
  static: { rx: 6.5, ry: 9, pupil: [2, 1] },
  // Wide and looking straight out: attending to the person talking.
  listening: { rx: 7, ry: 10, pupil: [0, 0.5] },
  // Up and to one side, the way anyone looks while working something out.
  thinking: { rx: 6.5, ry: 9, pupil: [3, -4] },
  // Up the other way, under one raised brow (drawn with the mouth).
  pondering: { rx: 6.5, ry: 9, pupil: [-3, -4] },
  // Narrowed and looking down, reading. The CSS sweeps the pupils along a line.
  searching: { rx: 6.5, ry: 7.5, pupil: [0, 2.5] },
  // Downcast, under worried brows (drawn with the mouth).
  sorry: { rx: 6.5, ry: 8.5, pupil: [0, 3] },
}

const MOUTH: Record<OpenFace, ReactNode> = {
  idle: <path d="M 52 73 Q 60 81 68 73" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.4"/>,
  listening: <path d="M 55.5 74.5 Q 60 78 64.5 74.5" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>,
  // A small "o".
  thinking: <ellipse cx="60" cy="76" rx="2.6" ry="3.1" fill="none" stroke={NAVY} strokeWidth="2.2"/>,
  searching: <path d="M 56 75.5 Q 60 76.5 64 75.5" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>,
  // "Hmm": a mouth pulled to one side, and one brow that the CSS lifts now and then.
  pondering: (
    <>
      <path className="sparky-presence__brow" d="M 65.5 44.5 Q 71.5 40 78 43" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>
      <path d="M 54.5 73 Q 60 76.5 65.5 75.5" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>
    </>
  ),
  // Talking: open, and the CSS works it open and shut while the answer is written.
  replying: <path className="sparky-presence__talk" d="M 53 72 Q 60 81 67 72 Z" fill={NAVY} stroke={NAVY} strokeLinejoin="round" strokeWidth="1.6"/>,
  sorry: (
    <>
      <path d="M 41 47.5 Q 46 44 53 43.5" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>
      <path d="M 79 47.5 Q 74 44 67 43.5" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>
      <path d="M 54 78 Q 60 72.5 66 78" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.4"/>
    </>
  ),
  // Neither smiling nor sad: Sparky is not answering, and has done nothing wrong.
  static: <path d="M 54.5 75 L 65.5 75" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.4"/>,
}

function Face({ mode }: { mode: FaceName }) {
  if (mode === 'happy') {
    return (
      <svg className="sparky-presence__eyes" viewBox="0 0 120 120">
        <path d="M 42 61 C 44 51 52 51 54 61" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="3"/>
        <path d="M 66 61 C 68 51 76 51 78 61" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="3"/>
        {BLUSH}
        <path d="M 56 69 Q 60 74 64 69" fill="none" stroke={NAVY} strokeLinecap="round" strokeWidth="2.2"/>
      </svg>
    )
  }
  const eyes = EYES[mode]
  return (
    <>
      <svg className="sparky-presence__eyes" viewBox="0 0 120 120">
        <ellipse cx="48" cy="58" rx={eyes.rx} ry={eyes.ry} fill="#FFFFFF"/>
        <ellipse cx="72" cy="58" rx={eyes.rx} ry={eyes.ry} fill="#FFFFFF"/>
        {/* Their own group so they can look a little further than the face turns. */}
        <g className={`sparky-presence__pupils sparky-presence__pupils--${mode}`}>
          <circle cx={48 + eyes.pupil[0]} cy={58 + eyes.pupil[1]} r="2.2" fill={NAVY}/>
          <circle cx={72 + eyes.pupil[0]} cy={58 + eyes.pupil[1]} r="2.2" fill={NAVY}/>
        </g>
      </svg>
      {/* A mouth, which the phone's open-eyed face does not have: without one the face
          read as blank. Its own layer, so it follows the glance but is not squashed by the
          blink, and the sorry face's brows go in it for the same reason. */}
      <svg className="sparky-presence__mouth" viewBox="0 0 120 120">{MOUTH[mode]}</svg>
    </>
  )
}

/* While Sparky prepares an answer (thinking, or looking something up) its face does not
   hold one expression the whole time. It shuffles between three thinking faces instead,
   at random, never the same one twice running, holding each for a moment. Talking is not
   one of them: Sparky only talks once the words of the answer are arriving. */
const THINKING_FACES: FaceName[] = ['thinking', 'searching', 'pondering']
const SHUFFLE_MIN = 1800
const SHUFFLE_MAX = 3000

/**
 * The face to show for `mode`: the mode's own, or while Sparky is preparing an answer, one
 * of the thinking faces in turn. It starts on the mode's own face, and starts there again
 * whenever the mode changes, so a real change (a lookup starting or finishing) shows.
 * Reduced motion keeps the mode's own face.
 */
function useShuffledFace(mode: SparkyPresenceMode): FaceName {
  const preparing = mode === 'thinking' || mode === 'searching'
  // Tagged with the mode it was shuffled for, so a face left over from an earlier mode is
  // never shown for the next one, not even for the render before the effect below resets.
  const [face, setFace] = useState<{ for: SparkyPresenceMode; shown: FaceName }>({ for: mode, shown: mode })

  useEffect(() => {
    setFace({ for: mode, shown: mode })
    if (!preparing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let shown: FaceName = mode
    let timer = 0
    const next = () => {
      timer = window.setTimeout(() => {
        const others = THINKING_FACES.filter((f) => f !== shown)
        shown = others[Math.floor(Math.random() * others.length)] ?? mode
        setFace({ for: mode, shown })
        next()
      }, SHUFFLE_MIN + Math.random() * (SHUFFLE_MAX - SHUFFLE_MIN))
    }
    next()
    return () => window.clearTimeout(timer)
  }, [mode, preparing])

  return preparing && face.for === mode ? face.shown : mode
}

/**
 * Sparky as the phone app draws it: an energy core with two orbit arcs, eyes that glance
 * about and blink, and a slow breath. The web port of the mobile app's `SparkyPresence`
 * (services/mobile/src/components/sparky-presence.tsx, as on the sprint-4 presentation
 * build): same shapes, same modes, same timings, with CSS keyframes in place of Reanimated.
 * See SparkyPresence.css for the motion.
 *
 * Recoloured for the website. The phone's teal and green sit on a near-black screen; on
 * this site's lavender they clashed with the violet theme. Sparky is indigo instead, the
 * site's own violet family: a core from periwinkle through #4F46E5 to a deep indigo, with
 * periwinkle and violet orbit arcs and a matching halo. The eyes and smile are a deep navy
 * and the blush is pink.
 *
 * Each mode is something Sparky is doing, and has its own face (see `Face` above):
 *
 * - `idle` breathes, glances and blinks at the resting pace, with a smile.
 * - `listening` (the microphone is on) holds its gaze on the reader with wide eyes and
 *   its head tilted, and the halo pulses quicker.
 * - `thinking` (waiting on the model) looks up and aside with a small "o" mouth, and moves
 *   faster, with a brighter halo.
 * - `searching` (a lookup is running, or a bill is being read) keeps its head still and
 *   reads: narrowed eyes whose pupils sweep along a line. The same quick pace as thinking.
 * - `replying` (an answer is being written, or read aloud) talks: the resting pace, with
 *   a mouth that opens and shuts.
 * - `happy` holds still with ^ ^ eyes, a blush and a small smile: an answer that has landed.
 * - `sorry` holds still, downcast under worried brows with a small frown: the answer
 *   could not be given.
 * - `static` holds still with open eyes and a level mouth, for when Sparky is unavailable.
 *
 * While it prepares an answer (`thinking` or `searching`) the face shuffles every two or
 * three seconds between thinking's, searching's and a third thinking face, pondering:
 * looking up the other way under one raised brow, with a "hmm" mouth (see
 * `useShuffledFace` above). Once the words arrive (`replying`) it only talks. Only the
 * face shuffles: the halo and breath keep the real mode's pace, and a screen reader hears
 * the real mode: as the picture's name, or for an interactive Sparky, as the button's
 * description.
 *
 * `interactive` makes Sparky a button that turns to follow the cursor and reacts when it
 * is clicked, the way page-mascot's characters do (see `useMascot` above). The face and
 * pupils slide toward the cursor and the core leans after them, while the orbit arcs stay
 * put, so it reads as the head turning. A click blinks, then shows hearts, twinkles or a
 * grin in turn with a squash and bounce; four quick clicks make it dizzy. It has no effect
 * in `static` mode, which stays a still picture.
 *
 * Reduced motion holds every mode still. An interactive Sparky still looks toward the
 * cursor and changes face when clicked, but jumps rather than slides, and does not bounce.
 */
export default function SparkyPresence({ size = 168, mode = 'idle', label, interactive = false }: { size?: number; mode?: SparkyPresenceMode; label?: string; interactive?: boolean }) {
  // Several of these can be on screen at once (one per answer), so every gradient id is
  // made unique; a shared id would let one instance paint with another's gradient.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const halo = `sparky-halo-${uid}`
  const body = `sparky-body-${uid}`
  const glow = `sparky-glow-${uid}`
  const status = `sparky-status-${uid}`

  const live = interactive && mode !== 'static'
  const { rootRef, squashRef, sector, reaction, boop } = useMascot(live)
  const face = useShuffledFace(mode)
  const looking = sector !== -1
  const style = {
    width: size,
    height: size,
    '--look-x': looking ? round(Math.cos(sector * SECTOR)) : 0,
    '--look-y': looking ? round(Math.sin(sector * SECTOR)) : 0,
  } as CSSProperties
  const className = `sparky-presence sparky-presence--${mode}${live ? ' sparky-presence--interactive' : ''}${looking ? ' sparky-presence--looking' : ''}`

  const layers = (
    <>
      <svg className="sparky-presence__halo" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#7C8CFF" stopOpacity="0.42"/>
            <stop offset="0.65" stopColor="#8F9CFF" stopOpacity="0.16"/>
            <stop offset="1" stopColor="#8F9CFF" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="58" fill={`url(#${halo})`}/>
        <path d="M 17 59 A 43 43 0 0 1 51 18" fill="none" stroke="#A5B0FF" strokeLinecap="round" strokeOpacity="0.85" strokeWidth="2"/>
        <path d="M 70 102 A 43 43 0 0 0 104 63" fill="none" stroke="#765FFF" strokeLinecap="round" strokeOpacity="0.85" strokeWidth="2"/>
      </svg>
      {/* The core and face in one layer, so a boop squashes them together and they lean
          toward the cursor together; the halo and orbit arcs stay where they are. */}
      <div className="sparky-presence__squash" ref={squashRef} aria-hidden="true">
        <svg className="sparky-presence__body" viewBox="0 0 120 120">
          <defs>
            <linearGradient id={body} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#9AA6FF"/>
              <stop offset="0.55" stopColor="#4F46E5"/>
              <stop offset="1" stopColor="#241F7A"/>
            </linearGradient>
            <radialGradient id={glow} cx="36%" cy="22%" r="70%">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.4"/>
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="60" cy="60" r="39" fill={`url(#${body})`} stroke="#C7CCFF" strokeOpacity="0.6" strokeWidth="1.4"/>
          <circle cx="60" cy="60" r="38" fill={`url(#${glow})`}/>
          <path d="M 30 47 C 36 34 47 26 62 24" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeOpacity="0.35" strokeWidth="2"/>
        </svg>
        <div className="sparky-presence__gaze">
          {reaction ? <ReactionFace reaction={reaction}/> : <Face mode={face}/>}
        </div>
      </div>
    </>
  )

  return live ? (
    <button ref={rootRef} type="button" className={className} style={style} onClick={boop} aria-label="Boop Sparky" aria-describedby={status}>
      {layers}
      {/* The button is named for what clicking it does, so what Sparky is doing goes in
          its description: "Boop Sparky, button, Sparky is listening". The real mode only;
          the shuffled faces and a boop's reactions are decoration and stay hidden with
          the rest of the drawing. */}
      <span id={status} className="sr-only">{label ?? LABEL[mode]}</span>
    </button>
  ) : (
    <div className={className} role="img" aria-label={label ?? LABEL[mode]} style={style}>
      {layers}
    </div>
  )
}
