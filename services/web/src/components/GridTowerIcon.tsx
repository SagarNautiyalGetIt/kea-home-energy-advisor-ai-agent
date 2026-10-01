import type { LucideProps } from 'lucide-react'

// A transmission pylon for "the grid", after the one in the Tesla app: a peak, a long
// cross-arm with an insulator hanging from each end, a shorter arm under it, and two splayed
// legs with a cross-brace. lucide's UtilityPole is a wooden street pole, which reads as a
// local line rather than the grid. It spans the full 2-22 box like lucide's round icons do:
// drawn narrower, its thin lines looked a size smaller than the gauge and alarm clock beside
// it. Stroke, caps and joins match lucide, and it takes the same props, so it drops in
// wherever a lucide icon does.
export default function GridTowerIcon({ size = 24, color = 'currentColor', strokeWidth = 2, ...props }: LucideProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.5 6 12 2l2.5 4"/>
      <path d="M2 6h20"/>
      <path d="M3 6v3M21 6v3"/>
      <path d="M5 11h14"/>
      <path d="M9.5 6l-4 16M14.5 6l4 16"/>
      <path d="m8 12 10 8M16 12 6 20"/>
    </svg>
  )
}
