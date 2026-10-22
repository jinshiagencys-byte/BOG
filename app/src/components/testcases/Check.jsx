import { useEffect, useRef } from 'react'
import Icon from '../Icon.jsx'

/* Case à cocher custom (input natif masqué + carré stylé, état indéterminé géré). */
export default function Check({ checked, indeterminate = false, label, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  return (
    <label
      className="td-tc-check"
      title={label}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="td-tc-check-box" aria-hidden="true">
        <Icon name={indeterminate && !checked ? 'minus' : 'check'} className="td-ic-12" />
      </span>
    </label>
  )
}
