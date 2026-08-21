type BrandMarkProps = { compact?: boolean; light?: boolean }

export default function BrandMark({ compact = false, light = false }: BrandMarkProps) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''} ${light ? 'brand-light' : ''}`}>
      <span className="brand-orbit"><img src="/kea-brand.png" alt="" /></span>
      {!compact && <strong>KEA ENERGY</strong>}
    </div>
  )
}
