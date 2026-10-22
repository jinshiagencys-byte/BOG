import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { CheckOption, Popover, RadioOption } from '../components/bits.jsx'
import { RunCard, RunRow } from '../components/RunRow.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { useApp } from '../app/app-context.js'
import { environments, filters, runs } from '../data/runs.js'
import { PERIOD_DAYS, PERIOD_LABEL, ciMeta, envMeta, statusMeta } from '../lib/meta.js'
import { DEMO_PROJECT_SLUG } from '../app/projects.js'

// Horodatage de montage : les données sont statiques, on évite Date.now() en rendu.
const NOW = Date.now()
const NO_RUNS = []

export default function TestRunsView() {
  const { openRun } = useApp()
  const { project } = useParams()
  // Les exécutions d'exemple ne sont visibles que dans le projet de démo :
  // un projet réel reste vide tant qu'aucune exécution n'a été envoyée.
  const isDemo = project === DEMO_PROJECT_SLUG
  const source = isDemo ? runs : NO_RUNS
  const [period, setPeriod] = useState('6months')
  const [statuses, setStatuses] = useState([])
  const [envs, setEnvs] = useState([])
  const [cis, setCis] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [spinning, setSpinning] = useState(false)
  // Runs relus (« acquittés ») : un run en échec ou bloqué reste « à acquitter »
  // tant qu'il n'a pas été marqué comme vu.
  const [acked, setAcked] = useState(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem('td-acked-runs') || '[]'))
    } catch {
      return new Set()
    }
  })
  const [toast, setToast] = useState('')

  const needsAck = (r) => r.status === 'failed' && !acked.has(r.id)

  const acknowledge = (r) => {
    const next = new Set(acked)
    next.add(r.id)
    setAcked(next)
    sessionStorage.setItem('td-acked-runs', JSON.stringify([...next]))
    setToast(`Exécution #${r.counter} acquittée.`)
  }

  const filtered = useMemo(() => {
    const days = PERIOD_DAYS[period]
    const cutoff = days === Infinity ? 0 : NOW - days * 86400000
    return source.filter((r) => {
      if (new Date(r.startTime).getTime() < cutoff) return false
      if (statuses.length && !statuses.includes(r.status)) return false
      if (envs.length && !envs.includes(r.env || 'unmapped')) return false
      if (cis.length && !cis.includes(r.ci)) return false
      return true
    })
  }, [source, period, statuses, envs, cis])

  const pages = Math.max(1, Math.ceil(filtered.length / limit))
  const currentPage = Math.min(page, pages)
  const start = (currentPage - 1) * limit
  const pageRows = filtered.slice(start, start + limit)

  const onFilterChange = (kind, value, checked) => {
    const setters = { status: setStatuses, env: setEnvs, ci: setCis }
    const current = { status: statuses, env: envs, ci: cis }[kind]
    setters[kind](checked ? [...current, value] : current.filter((v) => v !== value))
    setPage(1)
  }

  const moreCount = envs.length + cis.length
  const sync = () => {
    setSpinning(true)
    window.setTimeout(() => setSpinning(false), 700)
  }

  return (
    <>
      <div className="td-page-head">
        <h1>Exécutions de tests</h1>
        <p>Consultez et gérez vos exécutions de tests, filtrez-les par statut, environnement et fournisseur d’intégration continue.</p>
      </div>

      <div className="td-toolbar">
        <div className="td-filters">
          <Popover label={PERIOD_LABEL[period]} icon="calendar">
            <div className="td-pop-inner">
              {Object.keys(PERIOD_LABEL).map((k) => (
                <RadioOption
                  key={k}
                  name="period"
                  value={k}
                  label={PERIOD_LABEL[k]}
                  checked={k === period}
                  onChange={(v) => {
                    setPeriod(v)
                    setPage(1)
                  }}
                />
              ))}
            </div>
          </Popover>

          <Popover label="Statut" icon="circle-dot">
            <div className="td-pop-inner">
              {filters.statuses.map((s) => {
                const sm = statusMeta(s)
                return (
                  <CheckOption
                    key={s}
                    kind="status"
                    value={s}
                    label={sm.label}
                    checked={statuses.includes(s)}
                    onChange={onFilterChange}
                    leading={
                      <span
                        className={`td-status ${sm.cls}`}
                        style={{ width: '0.75rem', height: '0.75rem' }}
                      />
                    }
                  />
                )
              })}
            </div>
          </Popover>

          <Popover label="Autres filtres" icon="sliders-horizontal" count={moreCount || undefined} wide>
            <div className="td-pop-inner td-pop-scroll">
              <div className="td-pop-title">Environnement</div>
              {filters.environments.map((e) => (
                <CheckOption
                  key={e}
                  kind="env"
                  value={e}
                  label={envMeta(e, environments).label + ' · ' + e}
                  checked={envs.includes(e)}
                  onChange={onFilterChange}
                />
              ))}
              <div className="td-pop-sep" />
              <div className="td-pop-title">Fournisseur d’intégration continue</div>
              {filters.ci.map((c) => (
                <CheckOption
                  key={c}
                  kind="ci"
                  value={c}
                  label={ciMeta(c).label}
                  checked={cis.includes(c)}
                  onChange={onFilterChange}
                />
              ))}
            </div>
          </Popover>
        </div>

        <div className="td-toolbar-right">
          <span className="td-updated">
            {isDemo ? 'Dernière mise à jour : à l’instant' : 'En attente de la première exécution'}
          </span>
          <button className={'td-refresh' + (spinning ? ' is-spinning' : '')} type="button" onClick={sync}>
            <Icon name="refresh-cw" className="td-ic-14" />
            Synchroniser
          </button>
        </div>
      </div>

      <div className="td-card-surface">
        <div className="td-table-scroll">
          <table className="td-table">
            <thead>
              <tr>
                <th>Exécution</th>
                <th>Suite de tests</th>
                <th>Résultats des tests</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    {isDemo ? (
                      <div className="td-empty">
                        <Icon name="search-x" className="td-ic-20" />
                        <span>Aucune exécution ne correspond à vos filtres.</span>
                      </div>
                    ) : (
                      <EmptyState
                        icon="test-tube"
                        title="Aucune exécution de test"
                        description="Les exécutions de ce projet apparaîtront ici dès qu’elles seront envoyées. Le projet de démonstration conserve son jeu de données d’exemple."
                        action={
                          <Link className="td-btn" to={`/${DEMO_PROJECT_SLUG}/test-runs`}>
                            <Icon name="test-tube" className="td-ic-14" />
                            Voir la démo
                          </Link>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <RunRow
                    key={r.id}
                    run={r}
                    onOpen={openRun}
                    needsAck={needsAck(r)}
                    onAck={acknowledge}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="td-cards">
          {pageRows.length === 0 ? (
            isDemo ? (
              <div className="td-empty">
                <Icon name="search-x" className="td-ic-20" />
                <span>Aucune exécution ne correspond à vos filtres.</span>
              </div>
            ) : (
              <EmptyState
                icon="test-tube"
                title="Aucune exécution de test"
                description="Les exécutions de ce projet apparaîtront ici dès qu’elles seront envoyées."
                action={
                  <Link className="td-btn" to={`/${DEMO_PROJECT_SLUG}/test-runs`}>
                    <Icon name="test-tube" className="td-ic-14" />
                    Voir la démo
                  </Link>
                }
              />
            )
          ) : (
            pageRows.map((r) => (
              <RunCard
                key={r.id}
                run={r}
                onOpen={openRun}
                needsAck={needsAck(r)}
                onAck={acknowledge}
              />
            ))
          )}
        </div>

        {isDemo ? (
          <div className="td-table-foot">
            <div className="td-page-info">
              Page {currentPage} sur {pages} · {filtered.length} au total
            </div>
            <div className="td-pager">
              <select
                aria-label="Lignes par page"
                value={limit}
                onChange={(e) => {
                  setLimit(parseInt(e.target.value, 10))
                  setPage(1)
                }}
              >
                <option value="10">10 / page</option>
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
              </select>
              <button
                type="button"
                aria-label="Page précédente"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <Icon name="chevron-left" className="td-ic-14" />
              </button>
              <button
                type="button"
                aria-label="Page suivante"
                disabled={currentPage >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                <Icon name="chevron-right" className="td-ic-14" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <Toast message={toast} onDone={() => setToast('')} />
    </>
  )
}
