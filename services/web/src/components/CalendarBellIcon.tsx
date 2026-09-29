import type { SVGProps } from 'react'

// lucide has no calendar-with-bell icon. This keeps lucide's calendar-clock outline, with its
// bottom-right corner cut away, and puts lucide's bell there at 60% instead of the clock.
// Stroke, caps and joins match lucide, so it sits beside the other icons unchanged.
export default function CalendarBellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/>
      <path d="M16 2v4"/>
      <path d="M8 2v4"/>
      <path d="M3 10h5"/>
      <path d="M10.757 17.996A.6.6 0 0 0 11.2 19h9.6a.6.6 0 0 0 .444-1.004C20.446 17.174 19.6 16.299 19.6 13.6a3.6 3.6 0 0 0-7.2 0c0 2.699-.847 3.574-1.643 4.396"/>
      <path d="M14.961 21.4a1.2 1.2 0 0 0 2.078 0"/>
    </svg>
  )
}
