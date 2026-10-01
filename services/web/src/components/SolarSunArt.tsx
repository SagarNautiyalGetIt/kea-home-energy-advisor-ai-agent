// A four-point sparkle, like ✨: each side curves in towards the centre.
const sparkle = (x: number, y: number, r: number) => {
  const k = r * 0.18
  return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`
}

// A sun rising from the bottom edge of a box, in lines: the disc, its rays and two faint
// orbit arcs, with filled sparkles just outside the outer arc. A background pattern for the
// warm solar surfaces: the solar card on Plans and the results on Explore solar savings.
// Its colours come from CSS (.solar-sun-art in solar.css); the caller positions it.
export default function SolarSunArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`solar-sun-art ${className}`} viewBox="4 0 332 140" preserveAspectRatio="xMidYMax meet" aria-hidden="true" fill="none" strokeLinecap="round">
      <circle cx="170" cy="140" r="146" strokeWidth="1.5" strokeOpacity=".22"/>
      <circle cx="170" cy="140" r="112" strokeWidth="1.5" strokeOpacity=".3" strokeDasharray="2 9"/>
      <circle cx="170" cy="140" r="44" strokeWidth="2.5" strokeOpacity=".55" fill="#fff" fillOpacity=".4"/>
      <path d="M141 122a31 31 0 0 1 18-20" strokeWidth="2.5" strokeOpacity=".45"/>
      {[198, 216, 234, 252, 270, 288, 306, 324, 342].map((angle) => {
        const a = angle * Math.PI / 180
        return <line key={angle} x1={170 + 58 * Math.cos(a)} y1={140 + 58 * Math.sin(a)} x2={170 + 82 * Math.cos(a)} y2={140 + 82 * Math.sin(a)} strokeWidth="2.5" strokeOpacity=".5"/>
      })}
      <g className="solar-sun-sparkles" stroke="none">
        <path d={sparkle(18, 30, 9)} fillOpacity=".6"/>
        <path d={sparkle(35, 13, 4.5)} fillOpacity=".45"/>
        <path d={sparkle(30, 77, 5)} fillOpacity=".45"/>
        <path d={sparkle(322, 42, 7)} fillOpacity=".55"/>
      </g>
    </svg>
  )
}
