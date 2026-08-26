import type { ReactNode } from 'react'

export type UsageSummaryCardProps = {
  title: string
  value: string
  detail: string
  icon: ReactNode
  trend?: string
  share?: string
  tone?: 'purple' | 'coral' | 'amber' | 'indigo' | 'teal'
}

export default function UsageSummaryCard({ title, value, detail, icon, trend, share, tone = 'purple' }: UsageSummaryCardProps) {
  return (
    <article className={`usage-summary-card usage-summary-${tone}`}>
      <div className="usage-summary-icon" aria-hidden="true">{icon}</div>
      <div className="usage-summary-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {trend && <em>{trend}</em>}
      {share && <em className="usage-summary-share">{share}</em>}
    </article>
  )
}
