import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../app/app-context.js'
import { useAuth } from '../app/auth-context.js'
import { fmtDuration } from '../lib/format.js'
import { statusMeta } from '../lib/meta.js'
import { testCases } from '../data/suites.js'
import {
  acknowledgeRun,
  getEvidenceUrl,
  getRunResults,
  messageForError,
} from '../lib/api.js'

// Deux onglets de résultat, comme les statuts du tiroir « Cas de test ».
const TABS = [
  { id: 'passed', label: 'Réussi' },
  { id: 'failed', label: 'Échoué' },
]

function hasEvidence(step) {
  return Boolean(
    step?.evidenceUrl || step?.evidence?.video_path || step?.evidence?.enriched,
  )
}

function EvidenceVideo({ path }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    setUrl('')
    setError('')
    getEvidenceUrl(path)
      .then((signed) => {
        if (mounted) setUrl(signed || '')
      })
      .catch((loadError) => {
        if (mounted) setError(messageForError(loadError))
      })
    return () => {
      mounted = false
    }
  }, [path])

  if (error) {
    return <p className="td-run-video-note">Vidéo indisponible : {error}</p>
  }
  if (!url) {
    return <p className="td-run-video-note">Chargement de la vidéo…</p>
  }
  return (
    <figure className="td-run-video">
      <video controls preload="metadata" src={url} />
      <figcaption>Enregistrement du parcours</figcaption>
    </figure>
  )
}

function ResultCard({ item, failed, proofOpen, onProof, acked, onAck }) {
  const steps = item.steps || []
  const label = item.code || item.id
  const videoPath = steps.find((step) => step.evidence?.video_path)?.evidence?.video_path || null
  const proofable = steps.some(hasEvidence)
  const enriched = steps.map((step) => step.evidence?.enriched).find(Boolean) || null
  const schema = Array.isArray(enriched?.checks) ? enriched.checks : []
  const siteProfile = steps.map((step) => step.evidence?.site_profile).find(Boolean) || null

  return (
    <article className={'td-run-case' + (failed ? ' is-failed' : ' is-passed')}>
      <div className="td-run-case-box">
        <div className="td-run-case-head">
          <span className="td-run-case-check" aria-hidden="true">
            <Icon name={failed ? 'x' : 'check'} className="td-ic-12" />
          </span>
          <span className="td-run-case-title">
            <span className="td-run-case-id">{label}</span> · {item.title}
          </span>
        </div>
        <p className="td-run-case-msg">
          {failed
            ? item.failureMessage ||
              'Le test a échoué : le comportement observé ne correspond pas au résultat attendu.'
            : item.postconditions ||
              'Test validé : tous les critères attendus ont été vérifiés.'}
        </p>

        {proofOpen && siteProfile ? (
          <p className="td-run-video-note">
            Profil du site : {siteProfile.products || 0} donnée
            {siteProfile.products === 1 ? '' : 's'} observée
            {siteProfile.products === 1 ? '' : 's'}
            {siteProfile.captured_at
              ? ` · exploré le ${new Date(siteProfile.captured_at).toLocaleDateString('fr-FR')}`
              : ''}
            {siteProfile.status && siteProfile.status !== 'ready'
              ? ` · exploration ${siteProfile.status}`
              : ''}
          </p>
        ) : null}

        {proofOpen && schema.length ? (
          <div className="td-run-schema">
            <b>Ce qui devait être vérifié</b>
            <ul>
              {schema.map((check, index) => (
                <li key={`${check}-${index}`}>{check}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {proofOpen ? (
          <ol className="td-run-proof">
            {steps.map((step, index) => {
              const enrichedStep = step.evidence?.enriched?.steps?.[index]
              const action = enrichedStep?.action || step.action
              const expected = enrichedStep?.expected || step.expected
              return (
                <li key={step.id || `${action}-${index}`}>
                  <b>{action}</b>
                  <span>{expected}</span>
                  {step.actual ? <em>Observé : {step.actual}</em> : null}
                  {step.evidenceUrl ? (
                    <a href={step.evidenceUrl} target="_blank" rel="noreferrer">
                      Voir la page testée
                    </a>
                  ) : null}
                </li>
              )
            })}
          </ol>
        ) : null}

        {proofOpen && videoPath ? <EvidenceVideo path={videoPath} /> : null}
      </div>

      {proofable || failed ? (
        <div className="td-run-case-actions">
          {proofable ? (
            <button type="button" className="td-btn td-btn-ghost" onClick={onProof}>
              {proofOpen ? 'Masquer la preuve' : 'Voir la preuve'}
            </button>
          ) : null}
          {failed ? (
            <button
              type="button"
              className="td-btn td-btn-ghost"
              onClick={onAck}
              disabled={acked}
            >
              {acked ? 'Acquitté' : 'Acquitter'}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function RunDetail({ run, index, total, onPrev, onNext, onClose }) {
  const { user } = useAuth()
  const { markRunAcknowledged } = useApp()
  const isDemo = Boolean(run.isDemo)
  const [tab, setTab] = useState(run.status === 'passed' ? 'passed' : 'failed')
  const [proof, setProof] = useState(null)
  const [acked, setAcked] = useState(() => new Set())
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isDemo) {
      setLoading(false)
      setResults([])
      setError('')
      return undefined
    }

    let mounted = true
    setLoading(true)
    setError('')
    getRunResults(run.id)
      .then((rows) => {
        if (mounted) setResults(rows)
      })
      .catch((loadError) => {
        if (mounted) {
          setResults([])
          setError(messageForError(loadError))
        }
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [isDemo, run.id])

  const s = statusMeta(run.status)
  const started = run.startTime
    ? new Date(run.startTime).toLocaleString('fr-FR')
    : '—'
  const suiteLabel =
    run.suite && run.suite !== '—'
      ? run.suite
      : results[0]?.suite || run.suite || '—'

  // Démo : le détail cas par cas n'est pas stocké ; on répartit les échecs sur
  // les cas de la suite. Un projet réel utilise les `test_case_results`.
  const linked = isDemo
    ? testCases.filter((item) => item.suite === run.suite)
    : []
  const failedLinked = isDemo
    ? Math.min(run.results.failed, linked.length)
    : 0
  const rows = isDemo
    ? linked.map((item, position) => ({
        item,
        failed:
          Math.round(((position + 1) * failedLinked) / linked.length) >
          Math.round((position * failedLinked) / linked.length),
      }))
    : results.map((item) => ({ item, failed: item.failed }))

  const visible = rows.filter((row) => row.failed === (tab === 'failed'))
  const linkedCount = isDemo ? linked.length : results.length

  const acknowledge = async () => {
    if (isDemo) {
      try {
        const current = new Set(JSON.parse(sessionStorage.getItem('td-acked-runs') || '[]'))
        current.add(run.id)
        sessionStorage.setItem('td-acked-runs', JSON.stringify([...current]))
      } catch {
        /* le stockage local peut être indisponible */
      }
      setAcked(new Set(rows.filter((row) => row.failed).map((row) => row.item.id)))
      markRunAcknowledged()
      return
    }
    if (!user?.id) return
    try {
      await acknowledgeRun(run.id, user.id)
      setAcked(new Set(rows.filter((row) => row.failed).map((row) => row.item.id)))
      markRunAcknowledged()
    } catch (ackError) {
      setError(messageForError(ackError))
    }
  }

  return (
    <>
      <div className="td-tc-drawer-top">
        <div className="td-tc-crumb">
          <Icon name="folder" className="td-ic-14 shrink-0 text-muted-foreground" />
          <span className="td-tc-crumb-suite">Exécutions de tests</span>
          <span className="text-border">/</span>
          <span className="td-tc-crumb-id">#{run.counter}</span>
          <Icon name="link" className="td-ic-12 shrink-0 text-muted-foreground" />
        </div>

        <div className="td-tc-drawer-nav">
          <button
            type="button"
            className="td-btn-ghost"
            title="Exécution précédente"
            disabled={index <= 0}
            onClick={onPrev}
          >
            <Icon name="chevron-left" className="td-ic-14" />
          </button>
          <span className="td-tc-pager">
            {index + 1} / {total}
          </span>
          <button
            type="button"
            className="td-btn-ghost"
            title="Exécution suivante"
            disabled={index >= total - 1}
            onClick={onNext}
          >
            <Icon name="chevron-right" className="td-ic-14" />
          </button>
          {run.githubRunUrl ? (
            <a
              className="td-btn-ghost"
              href={run.githubRunUrl}
              target="_blank"
              rel="noreferrer"
              title="Ouvrir l’exécution GitHub"
            >
              <Icon name="external-link" className="td-ic-14" />
            </a>
          ) : null}
          <span className="td-tc-drawer-sep" />
          <button
            type="button"
            className="td-btn-ghost"
            title="Imprimer"
            onClick={() => window.print()}
          >
            <Icon name="printer" className="td-ic-14" />
          </button>
          <button type="button" className="td-btn-ghost" title="Fermer" onClick={onClose}>
            <Icon name="x" className="td-ic-14" />
          </button>
        </div>
      </div>

      <div className="td-tc-drawer-body">
        <h2 className="td-tc-drawer-title">{suiteLabel}</h2>

        <div className="mb-6">
          <span className={`td-tc-status-pill is-${run.status}`}>
            <span className="td-tc-status-dot" />
            <span>{s.label.toUpperCase()}</span>
          </span>
          <p className="td-tc-run-meta">
            {started} · {fmtDuration(run.durationMs)} · {run.total} test
            {run.total > 1 ? 's' : ''}
          </p>
          {run.branch ? (
            <p className="td-tc-run-meta">
              Branche <b>{run.branch}</b>
              {run.commitHash ? ` · commit ${String(run.commitHash).slice(0, 7)}` : ''}
            </p>
          ) : null}
        </div>

        <div className="td-tc-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={'td-tc-tab' + (tab === item.id ? ' is-active' : '')}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="td-tc-empty">
            <span className="td-spinner" aria-hidden="true" />
            <span>Chargement des résultats…</span>
          </div>
        ) : error ? (
          <div className="td-tc-empty">
            <Icon name="triangle-alert" className="td-ic-20" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <p className="td-tc-linked-note">
              {linkedCount} cas de test rattaché{linkedCount > 1 ? 's' : ''} à la suite «{' '}
              {suiteLabel} ».
            </p>

            {run.errorMessage && !results.length ? (
              <p className="td-settings-note is-error">{run.errorMessage}</p>
            ) : null}

            {visible.length ? (
              <div className="td-run-cases">
                {visible.map(({ item, failed }) => (
                  <ResultCard
                    key={item.id}
                    item={item}
                    failed={failed}
                    proofOpen={proof === item.id}
                    onProof={() => setProof(proof === item.id ? null : item.id)}
                    acked={acked.has(item.id)}
                    onAck={acknowledge}
                  />
                ))}
              </div>
            ) : (
              <div className="td-tc-empty">
                <Icon name="circle-dashed" className="td-ic-20" />
                <span>
                  {tab === 'passed'
                    ? 'Aucun test réussi pour cette exécution.'
                    : 'Aucun test échoué pour cette exécution.'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

export default function RunDrawer() {
  const { run, runList, openRun, closeRun } = useApp()
  const list = runList.length ? runList : run ? [run] : []
  const index = run ? list.findIndex((item) => item.id === run.id) : -1

  const go = (delta) => {
    const next = list[index + delta]
    if (next) openRun(next, list)
  }

  return (
    <aside
      className={'td-tc-drawer' + (run ? ' is-open' : '')}
      aria-hidden={!run}
      aria-label="Détail de l’exécution"
    >
      {run ? (
        <RunDetail
          key={run.id}
          run={run}
          index={index >= 0 ? index : 0}
          total={Math.max(1, list.length)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onClose={closeRun}
        />
      ) : null}
    </aside>
  )
}
