import { useId } from 'react'
import './SparkyPresence.css'

export type SparkyPresenceMode = 'idle' | 'thinking' | 'replying' | 'happy' | 'static'

const LABEL: Record<SparkyPresenceMode, string> = {
  idle: 'Sparky is here',
  thinking: 'Sparky is thinking',
  replying: 'Sparky is responding',
  happy: 'Sparky answered',
  static: 'Sparky is here',
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
 * - `idle` and `replying` breathe, glance and blink at the resting pace.
 * - `thinking` does the same faster, with a brighter halo.
 * - `happy` holds still with ^ ^ eyes, a blush and a small smile: an answer that has landed.
 * - `static` holds still with open eyes, for when Sparky is unavailable.
 *
 * Reduced motion holds every mode still.
 */
export default function SparkyPresence({ size = 168, mode = 'idle', label }: { size?: number; mode?: SparkyPresenceMode; label?: string }) {
  // Several of these can be on screen at once (one per answer), so every gradient id is
  // made unique; a shared id would let one instance paint with another's gradient.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const halo = `sparky-halo-${uid}`
  const body = `sparky-body-${uid}`
  const glow = `sparky-glow-${uid}`

  return (
    <div className={`sparky-presence sparky-presence--${mode}`} role="img" aria-label={label ?? LABEL[mode]} style={{ width: size, height: size }}>
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
      <svg className="sparky-presence__body" viewBox="0 0 120 120" aria-hidden="true">
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
      <div className="sparky-presence__gaze" aria-hidden="true">
        {mode === 'happy' ? (
          <svg className="sparky-presence__eyes" viewBox="0 0 120 120">
            <path d="M 42 61 C 44 51 52 51 54 61" fill="none" stroke="#14163F" strokeLinecap="round" strokeWidth="3"/>
            <path d="M 66 61 C 68 51 76 51 78 61" fill="none" stroke="#14163F" strokeLinecap="round" strokeWidth="3"/>
            <circle cx="37" cy="65" r="4.5" fill="#FF7A9A" opacity="0.6"/>
            <circle cx="83" cy="65" r="4.5" fill="#FF7A9A" opacity="0.6"/>
            <path d="M 56 69 Q 60 74 64 69" fill="none" stroke="#14163F" strokeLinecap="round" strokeWidth="2.2"/>
          </svg>
        ) : (
          <>
            <svg className="sparky-presence__eyes" viewBox="0 0 120 120">
              <ellipse cx="48" cy="58" rx="6.5" ry="9" fill="#FFFFFF"/>
              <ellipse cx="72" cy="58" rx="6.5" ry="9" fill="#FFFFFF"/>
              <circle cx="50" cy="59" r="2.2" fill="#14163F"/>
              <circle cx="74" cy="59" r="2.2" fill="#14163F"/>
            </svg>
            {/* A mouth, which the phone's open-eyed face does not have: without one the
                face read as blank. A smile at rest, a small "o" while thinking. Its own
                layer, so it follows the glance but is not squashed by the blink. */}
            <svg className="sparky-presence__mouth" viewBox="0 0 120 120">
              {mode === 'thinking'
                ? <ellipse cx="60" cy="76" rx="2.6" ry="3.1" fill="none" stroke="#14163F" strokeWidth="2.2"/>
                : <path d="M 52 73 Q 60 81 68 73" fill="none" stroke="#14163F" strokeLinecap="round" strokeWidth="2.4"/>}
            </svg>
          </>
        )}
      </div>
    </div>
  )
}
