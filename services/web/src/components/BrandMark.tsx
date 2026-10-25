import AnimatedLogo from './AnimatedLogo'

type BrandMarkProps = { compact?: boolean; light?: boolean }

export default function BrandMark({ compact = false, light = false }: BrandMarkProps) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''} ${light ? 'brand-light' : ''}`}>
      <span className="brand-orbit"><AnimatedLogo /></span>
      {!compact && <strong className="brand-name"><span>KEA</span><span>ENERGY</span></strong>}
    </div>
  )
}
