import type { LucideProps } from 'lucide-react'

// Sparky as a line icon, for everywhere the site points to Sparky AI: the navigation, the
// search results and the "Ask Sparky" buttons. It is the character from the Sparky AI page
// (SparkyPresence) drawn the way the neighbouring lucide icons are: a round face with two
// eyes and a smile, and the two orbit arcs, top left and bottom right, that make it Sparky
// rather than any smiley. One colour, the current text colour, so it follows the nav's
// grey and active violet and the white on a filled button. The face has a radius of 8:
// close to the full-box circles of Billing and Help beside it, while leaving a clear gap
// to the arcs (at 8.6 they ran into the face at 22px). Stroke, caps and joins match lucide,
// and it takes the same props.
export default function SparkyIcon({ size = 24, color = 'currentColor', strokeWidth = 2, ...props }: LucideProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8"/>
      <path d="M1.95 10.23A10.2 10.2 0 0 1 7.69 2.76"/>
      <path d="M22.05 13.77A10.2 10.2 0 0 1 16.31 21.24"/>
      <ellipse cx="9.56" cy="11.22" rx="1.22" ry="1.67" fill={color} stroke="none"/>
      <ellipse cx="14.44" cy="11.22" rx="1.22" ry="1.67" fill={color} stroke="none"/>
      <path d="M9.33 14.89q2.67 2.33 5.33 0"/>
    </svg>
  )
}
