import type { ReactNode } from 'react'

export type UsageSummaryCardProps = {
  title: string
  value: string
  detail: string
  icon: ReactNode
  trend?: string
  tone?: 'purple' | 'coral' | 'teal'
}

export default function UsageSummaryCard({ title, value, detail, icon, trend, tone = 'purple' }: UsageSummaryCardProps) {
  return (
    <article className={`usage-summary-card usage-summary-${tone}`}>
      <div className="usage-summary-icon" aria-hidden="true">{icon}</div>
      <div className="usage-summary-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {trend && <em>{trend}</em>}
    </article>
  )
}
