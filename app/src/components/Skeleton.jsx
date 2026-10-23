export function Skeleton({ width = '100%', height = 12, radius = 6, className = '', style }) {
  return (
    <span
      className={'td-skeleton ' + className}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  )
}

export function FullPageLoader({ label = 'Chargement…' }) {
  return (
    <div className="td-full-loader" role="status" aria-live="polite">
      <span className="td-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function PageSkeleton({ rows = 5 }) {
  return (
    <div className="td-page-skeleton" aria-hidden="true">
      <Skeleton width={220} height={24} />
      <Skeleton width={420} height={14} style={{ marginTop: 10 }} />
      <div className="td-skeleton-toolbar">
        <Skeleton width={180} height={32} />
        <Skeleton width={110} height={32} />
        <Skeleton width={130} height={32} />
      </div>
      <div className="td-skeleton-surface">
        {Array.from({ length: rows }).map((_, index) => (
          <div className="td-skeleton-row" key={index}>
            <Skeleton width="18%" height={12} />
            <Skeleton width="46%" height={12} />
            <Skeleton width="22%" height={12} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CardsSkeleton({ count = 3 }) {
  return (
    <div className="td-projects-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div className="td-card-surface td-skeleton-card" key={index}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="90%" height={12} style={{ marginTop: 12 }} />
          <Skeleton width="70%" height={12} style={{ marginTop: 8 }} />
          <Skeleton width="40%" height={12} style={{ marginTop: 24 }} />
        </div>
      ))}
    </div>
  )
}
