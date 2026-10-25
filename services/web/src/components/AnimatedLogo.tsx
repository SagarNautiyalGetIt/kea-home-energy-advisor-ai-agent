import { useId } from 'react'
import './AnimatedLogo.css'

type AnimatedLogoProps = { tone?: 'blue' | 'white'; className?: string }

// The Kea mark drawn inline rather than as an <img>, so its two parts can move on their own
// the way the phone app's AnimatedLogo (animated-logo.tsx) does: the arrow ring turns
// clockwise and the bolt flips front -> back -> front in place. The paths are the ones in
// /assets/brand/kea-brand-blue.svg. The blue tone keeps that file's colours (lilac ring,
// violet-to-lilac bolt); the white tone is solid white. The phone fades its bolt a little
// towards the tip, but the bolt is painted twice (fill, then a stroke that rounds its
// corners), so any see-through stop doubles up where the two overlap and draws a light rim
// inside the edge, plain to see at the sign-in panel's size.
export default function AnimatedLogo({ tone = 'blue', className = '' }: AnimatedLogoProps) {
  // useId's colons and guillemets aren't safe inside url(#…)
  const gradientId = `kea-bolt-${useId().replace(/[^\w-]/g, '')}`
  const white = tone === 'white'
  const ring = white ? '#FFFFFF' : '#868CFF'
  const stops: [offset: number, color: string][] = white
    ? [[0, '#FFFFFF'], [1, '#FFFFFF']]
    : [[0, '#4318FF'], [0.54, '#5F45FF'], [1, '#868CFF']]
  // The ring draws in currentColor and the bolt's stops are plain attributes, so a theme can
  // re-colour either from CSS (the midnight dark palette does, in the sidebar).
  return (
    <span className={`kea-logo ${className}`.trim()} aria-hidden="true">
      <svg className="kea-logo-ring" viewBox="0 0 256 256" fill="none" color={ring}>
        <path d="M33 128A95 95 0 0 1 208.6 77.6" stroke="currentColor" strokeWidth="15" strokeLinecap="round"/>
        <path d="M226 96L222 68L197 85Z" fill="currentColor" stroke="currentColor" strokeWidth="5" strokeLinejoin="round"/>
        <path d="M223 128A95 95 0 0 1 47.4 178.4" stroke="currentColor" strokeWidth="15" strokeLinecap="round"/>
        <path d="M30 160L34 188L59 171Z" fill="currentColor" stroke="currentColor" strokeWidth="5" strokeLinejoin="round"/>
      </svg>
      <svg className="kea-logo-bolt" viewBox="0 0 256 256" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="102" y1="61" x2="158" y2="197" gradientUnits="userSpaceOnUse">
            {stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color}/>)}
          </linearGradient>
        </defs>
        <path d="M143 54L137 110L166.5 119.4Q178 123 170.1 131.9L109 201L117 149L89 139.4Q79 136 87 125.8Z"
          fill={`url(#${gradientId})`} stroke={`url(#${gradientId})`} strokeWidth="3.5" strokeLinejoin="round"
          transform="translate(-12.8 -12.8) scale(1.1)"/>
      </svg>
    </span>
  )
}
