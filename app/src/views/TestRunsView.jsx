import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { CheckOption, Popover, RadioOption } from '../components/bits.jsx'
import { RunCard, RunRow } from '../components/RunRow.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { PageSkeleton } from '../components/Skeleton.jsx'
import { useProject } from '../app/project-context.js'
import { useAuth } from '../app/auth-context.js'
import { useApp } from '../app/app-context.js'
import { environments, filters, runs } from '../data/runs.js'
import { PERIOD_DAYS, PERIOD_LABEL, ciMeta, envMeta, statusMeta } from '../lib/meta.js'
import { timeAgo } from '../lib/format.js'
import {
  acknowledgeRun,
  listAcknowledgedRunIds,
  listRuns,
  messageForError,
} from '../lib/api.js'

export default function TestRunsView() {
  const { project, isDemo, loading, error } = useProject()

  if (loading) return <PageSkeleton rows={8} />
  if (error) {
    return (
      <>
        <div className="td-page-head">
          <h1>Exécutions de tests</h1>
          <p>Impossible de charger ce projet.</p>
        </div>
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{error}</span>
        </div>
      </>
    )
  }
  if (!project) return null

  return <TestRunsViewInner key={project.slug} project={project} isDemo={isDemo} />
}

function TestRunsViewInner({ project, isDemo }) {
  const { openRun, setRunList, runAckVersion } = useApp()
  const { user } = useAuth()
  const userId = user?.id || null
  const ackVersionRef = useRef(runAckVersion)

  const [source, setSource] = useState(isDemo ? runs : [])
  const [dataLoading, setDataLoading] = useState(!isDemo)
  const [dataError, setDataError] = useState('')
  const [period, setPeriod] = useState('6months')
  const [statuses, setStatuses] = useState([])
  const [envs, setEnvs] = useState([])
  const [cis, setCis] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [spinning, setSpinning] = useState(false)
  const [acked, setAcked] = useState(() => new Set())
  const [toast, setToast] = useState('')
  const [toastTone, setToastTone] = useState('success')

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (isDemo) {
        setSource(runs.map((run) => ({ ...run, isDemo: true })))
        setDataLoading(false)
        setDataError('')
        try {
          setAcked(new Set(JSON.parse(sessionStorage.getItem('td-acked-runs') || '[]')))
        } catch {
          setAcked(new Set())
        }
        return
      }

      if (!silent) setDataLoading(true)
      setDataError('')
      try {
        const [rows, acknowledged] = await Promise.all([
          listRuns(project.id),
          userId ? listAcknowledgedRunIds(userId) : Promise.resolve([]),
        ])
        setSource(rows)
        setAcked(new Set(acknowledged))
      } catch (loadError) {
        setDataError(messageForError(loadError))
        if (!silent) setSource([])
      } finally {
        if (!silent) setDataLoading(false)
      }
    },
    [isDemo, project.id, userId],
  )

  useEffect(() => {
    load()
  }, [load])

  // Un acquittement depuis le tiroir doit aussi mettre à jour la ligne du run.
  useEffect(() => {
    if (runAckVersion === ackVersionRef.current) return
    ackVersionRef.current = runAckVersion
    load({ silent: true })
  }, [runAckVersion, load])

  useEffect(() => {
    setRunList(source)
  }, [setRunList, source])

  const [now] = useState(() => Date.now())

  const filtered = useMemo(() => {
    const days = PERIOD_DAYS[period]
    const cutoff = days === Infinity ? 0 : now - days * 86400000
    return source.filter((run) => {
      if (new Date(run.startTime).getTime() < cutoff) return false
      if (statuses.length && !statuses.includes(run.status)) return false
      if (envs.length && !envs.includes(run.env || 'unmapped')) return false
      if (cis.length && !cis.includes(run.ci)) return false
      return true
    })
  }, [source, period, statuses, envs, cis, now])

  const pages = Math.max(1, Math.ceil(filtered.length / limit))
  const currentPage = Math.min(page, pages)
  const start = (currentPage - 1) * limit
  const pageRows = filtered.slice(start, start + limit)

  const onFilterChange = (kind, value, checked) => {
    const setters = { status: setStatuses, env: setEnvs, ci: setCis }
    const current = { status: statuses, env: envs, ci: cis }[kind]
    setters[kind](checked ? [...current, value] : current.filter((item) => item !== value))
    setPage(1)
  }

  const moreCount = envs.length + cis.length

  const notify = (message, tone = 'success') => {
    setToastTone(tone)
    setToast(message)
  }

  const needsAck = (run) => run.status === 'failed' && !acked.has(run.id)

  const acknowledge = async (run) => {
    try {
      if (isDemo) {
        const next = new Set(acked)
        next.add(run.id)
        setAcked(next)
        sessionStorage.setItem('td-acked-runs', JSON.stringify([...next]))
      } else {
        if (!userId) return
        await acknowledgeRun(run.id, userId)
        setAcked((prev) => new Set(prev).add(run.id))
      }
      notify(`Exécution #${run.counter} acquittée.`)
    } catch (error) {
      notify(messageForError(error), 'error')
    }
  }

  const sync = async () => {
    setSpinning(true)
    await load({ silent: true })
    setSpinning(false)
    notify('Exécutions synchronisées.')
  }

  const updatedLabel = dataLoading
    ? 'Chargement des exécutions…'
    : dataError
      ? 'Erreur de chargement'
      : source.length
        ? `Dernière exécution : ${timeAgo(source[0].startTime)}`
        : 'Aucune exécution pour le moment'

  const open = (run) => openRun(run, source)

  return (
    <>
      <div className="td-page-head">
        <h1>Exécutions de tests</h1>
        <p>
          Consultez et gérez vos exécutions de tests, filtrez-les par statut,
          environnement et fournisseur d’intégration continue.
        </p>
      </div>

      <div className="td-toolbar">
        <div className="td-filters">
          <Popover label={PERIOD_LABEL[period]} icon="calendar">
            <div className="td-pop-inner">
              {Object.keys(PERIOD_LABEL).map((key) => (
                <RadioOption
                  key={key}
                  name="period"
                  value={key}
                  label={PERIOD_LABEL[key]}
                  checked={key === period}
                  onChange={(value) => {
                    setPeriod(value)
                    setPage(1)
                  }}
                />
              ))}
            </div>
          </Popover>

          <Popover label="Statut" icon="circle-dot">
            <div className="td-pop-inner">
              {filters.statuses.map((status) => {
                const meta = statusMeta(status)
                return (
                  <CheckOption
                    key={status}
                    kind="status"
                    value={status}
                    label={meta.label}
                    checked={statuses.includes(status)}
                    onChange={onFilterChange}
                    leading={
                      <span
                        className={`td-status ${meta.cls}`}
                        style={{ width: '0.75rem', height: '0.75rem' }}
                      />
                    }
                  />
                )
              })}
            </div>
          </Popover>

          <Popover
            label="Autres filtres"
            icon="sliders-horizontal"
            count={moreCount || undefined}
            wide
          >
            <div className="td-pop-inner td-pop-scroll">
              <div className="td-pop-title">Environnement</div>
              {filters.environments.map((env) => (
                <CheckOption
                  key={env}
                  kind="env"
                  value={env}
                  label={envMeta(env, environments).label + ' · ' + env}
                  checked={envs.includes(env)}
                  onChange={onFilterChange}
                />
              ))}
              <div className="td-pop-sep" />
              <div className="td-pop-title">Fournisseur d’intégration continue</div>
              {filters.ci.map((ci) => (
                <CheckOption
                  key={ci}
                  kind="ci"
                  value={ci}
                  label={ciMeta(ci).label}
                  checked={cis.includes(ci)}
                  onChange={onFilterChange}
                />
              ))}
            </div>
          </Popover>
        </div>

        <div className="td-toolbar-right">
          <span className="td-updated">{updatedLabel}</span>
          <button
            className={'td-refresh' + (spinning ? ' is-spinning' : '')}
            type="button"
            onClick={sync}
          >
            <Icon name="refresh-cw" className="td-ic-14" />
            Synchroniser
          </button>
        </div>
      </div>

      {dataError ? (
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{dataError}</span>
          <button type="button" className="td-btn td-btn-ghost" onClick={() => load()}>
            Réessayer
          </button>
        </div>
      ) : null}

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
              {dataLoading ? (
                <tr>
                  <td colSpan={3}>
                    <div className="td-empty">
                      <span className="td-spinner" aria-hidden="true" />
                      <span>Chargement des exécutions…</span>
                    </div>
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    {source.length ? (
                      <div className="td-empty">
                        <Icon name="search-x" className="td-ic-20" />
                        <span>Aucune exécution ne correspond à vos filtres.</span>
                      </div>
                    ) : (
                      <EmptyState
                        icon="test-tube"
                        title="Aucune exécution de test"
                        description={
                          isDemo
                            ? 'Le projet de démonstration conserve son jeu de données d’exemple.'
                            : 'Sélectionnez des cas de test puis déclenchez une exécution. Les résultats apparaîtront ici.'
                        }
                        action={
                          isDemo ? (
                            <Link className="td-btn" to="/auth">
                              <Icon name="log-in" className="td-ic-14" />
                              Créer un projet
                            </Link>
                          ) : (
                            <Link
                              className="td-btn td-btn-primary"
                              to={`/${project.slug}/test-cases`}
                            >
                              <Icon name="clipboard-list" className="td-ic-14" />
                              Choisir des cas de test
                            </Link>
                          )
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                pageRows.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    onOpen={open}
                    needsAck={needsAck(run)}
                    onAck={acknowledge}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="td-cards">
          {dataLoading ? (
            <div className="td-empty">
              <span className="td-spinner" aria-hidden="true" />
              <span>Chargement des exécutions…</span>
            </div>
          ) : pageRows.length === 0 ? (
            source.length ? (
              <div className="td-empty">
                <Icon name="search-x" className="td-ic-20" />
                <span>Aucune exécution ne correspond à vos filtres.</span>
              </div>
            ) : (
              <EmptyState
                icon="test-tube"
                title="Aucune exécution de test"
                description={
                  isDemo
                    ? 'Le projet de démonstration conserve son jeu de données d’exemple.'
                    : 'Sélectionnez des cas de test puis déclenchez une exécution.'
                }
                action={
                  isDemo ? null : (
                    <Link className="td-btn td-btn-primary" to={`/${project.slug}/test-cases`}>
                      <Icon name="clipboard-list" className="td-ic-14" />
                      Choisir des cas de test
                    </Link>
                  )
                }
              />
            )
          ) : (
            pageRows.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                onOpen={open}
                needsAck={needsAck(run)}
                onAck={acknowledge}
              />
            ))
          )}
        </div>

        {filtered.length ? (
          <div className="td-table-foot">
            <div className="td-page-info">
              Page {currentPage} sur {pages} · {filtered.length} au total
            </div>
            <div className="td-pager">
              <select
                aria-label="Lignes par page"
                value={limit}
                onChange={(event) => {
                  setLimit(parseInt(event.target.value, 10))
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
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <Icon name="chevron-left" className="td-ic-14" />
              </button>
              <button
                type="button"
                aria-label="Page suivante"
                disabled={currentPage >= pages}
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
              >
                <Icon name="chevron-right" className="td-ic-14" />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <Toast message={toast} tone={toastTone} onDone={() => setToast('')} />
    </>
  )
}
