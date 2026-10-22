import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { avatarColor, initials } from '../lib/format.js'
import { envMeta, RESULT_LABEL, RESULT_STATUSES, statusMeta, PRIORITY_META } from '../lib/meta.js'
import { environments } from '../data/runs.js'

export function StatusDot({ status, lg = false }) {
  const s = statusMeta(status)
  return (
    <span
      className={`td-status ${s.cls} ${s.text}${lg ? ' td-status-lg' : ''}`}
      title={s.label}
      aria-label={s.label}
    />
  )
}

export function EnvBadge({ env }) {
  const e = envMeta(env, environments)
  return (
    <span
      className="td-env"
      style={{ color: e.color, borderColor: e.color + '33', background: e.color + '1a' }}
    >
      <span className="td-env-dot" style={{ background: e.color }} />
      {e.label}
    </span>
  )
}

// Résultats affichés dans la colonne « Test Results » (5 statuts, cf. qa_result.json).
export function ResultBadges({ run }) {
  return (
    <div className="td-badges">
      {RESULT_STATUSES.map((k) => (
        <span
          key={k}
          className={`td-badge bg-${k}-background text-${k} border-${k}-border`}
          title={RESULT_LABEL[k]}
        >
          {run.results[k]}
        </span>
      ))}
    </div>
  )
}

export function AiBadge({ ai }) {
  if (!ai) return <span className="text-muted-foreground">—</span>
  return (
    <span className="td-badge border-ui-border bg-ui-background text-ui-text" title="Analyses par IA">
      <strong className="font-semibold">{ai.count}</strong>
      <span className="ml-1">{ai.category}</span>
    </span>
  )
}

export function AuthorAvatar({ name }) {
  const c = avatarColor(name)
  return (
    <span className={`td-avatar bg-${c}-background text-${c}-foreground`}>{initials(name)}</span>
  )
}

export function PriorityBadge({ priority }) {
  const p = PRIORITY_META[priority] || PRIORITY_META.low
  return <span className={`td-badge ${p.cls}`}>{p.label}</span>
}

export function CaseStatusBadge({ status }) {
  const map = {
    active: 'bg-passed-background text-passed border-passed-border',
    draft: 'bg-muted text-muted-foreground border-border',
    deprecated: 'bg-flaky-background text-flaky border-flaky-border',
  }
  const labels = { active: 'Actif', draft: 'Brouillon', deprecated: 'Obsolète' }
  const label = labels[status] || '—'
  return <span className={`td-badge ${map[status] || map.draft}`}>{label}</span>
}

/* ---------- Popover (filtres) ---------- */
export function Popover({ label, icon, count, wide = false, align = 'left', children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="td-filter-wrap" ref={ref}>
      <button
        className="td-filter"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} className="td-ic-14" />
        <span className="td-filter-label">{label}</span>
        {count ? (
          <span className="td-filter-count" style={{ display: 'inline-flex' }}>
            {count}
          </span>
        ) : null}
        <Icon name="chevron-down" className="td-ic-14" />
      </button>
      <div className={`td-pop ${wide ? 'td-pop-wide' : ''} ${align === 'right' ? 'td-pop-right' : ''} ${open ? 'is-open' : ''}`}>
        {children}
      </div>
    </div>
  )
}

/* ---------- Checkbox option (filtres) ---------- */
export function CheckOption({ kind, value, label, checked, onChange, leading }) {
  return (
    <label className="td-opt">
      <input
        type="checkbox"
        data-kind={kind}
        value={value}
        checked={checked}
        onChange={(e) => onChange(kind, value, e.target.checked)}
      />
      {leading}
      <span className="td-opt-label">{label}</span>
    </label>
  )
}

export function RadioOption({ name, value, label, checked, onChange }) {
  return (
    <label className="td-opt">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className="td-opt-label">{label}</span>
    </label>
  )
}
