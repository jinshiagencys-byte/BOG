import Icon from './Icon.jsx'

// État vide commun (Dashboard sans données, Test Runs sans exécution…).
// Les projets réels n'affichent aucune donnée de démonstration : celui de démo
// reste le seul à montrer les jeux d'exemple.
export default function EmptyState({ icon = 'info', title, description, action, compact = false }) {
  return (
    <div className={`td-empty-state${compact ? ' is-compact' : ''}`}>
      <span className="td-empty-state-icon">
        <Icon name={icon} className="td-ic-20" />
      </span>
      {title ? <p className="td-empty-state-title">{title}</p> : null}
      {description ? <p className="td-empty-state-sub">{description}</p> : null}
      {action ? <div className="td-empty-state-action">{action}</div> : null}
    </div>
  )
}
