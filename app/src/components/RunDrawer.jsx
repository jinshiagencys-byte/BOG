import { useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../app/app-context.js'
import { fmtDuration } from '../lib/format.js'
import { statusMeta } from '../lib/meta.js'
import { runs } from '../data/runs.js'
import { testCases } from '../data/suites.js'

// Deux onglets de résultat, comme les statuts du tiroir « Cas de test ».
const TABS = [
  { id: 'passed', label: 'Réussi' },
  { id: 'failed', label: 'Échoué' },
]

function ResultCard({ item, failed, proofOpen, onProof, acked, onAck }) {
  return (
    <article className={'td-run-case' + (failed ? ' is-failed' : ' is-passed')}>
      <div className="td-run-case-box">
        <div className="td-run-case-head">
          <span className="td-run-case-check" aria-hidden="true">
            <Icon name={failed ? 'x' : 'check'} className="td-ic-12" />
          </span>
          <span className="td-run-case-title">
            <span className="td-run-case-id">{item.id}</span> · {item.title}
          </span>
        </div>
        <p className="td-run-case-msg">
          {failed
            ? 'Le test a échoué : le comportement observé ne correspond pas au résultat attendu.'
            : item.postconditions || 'Test validé : tous les critères attendus ont été vérifiés.'}
        </p>

        {proofOpen ? (
          <ol className="td-run-proof">
            {item.steps.map((s) => (
              <li key={s.action}>
                <b>{s.action}</b>
                <span>{s.expected}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {failed ? (
        <div className="td-run-case-actions">
          <button type="button" className="td-btn td-btn-ghost" onClick={onProof}>
            {proofOpen ? 'Masquer la preuve' : 'Voir la preuve'}
          </button>
          <button
            type="button"
            className="td-btn td-btn-ghost"
            onClick={onAck}
            disabled={acked}
          >
            {acked ? 'Relance demandée' : 'Acquitter et relancer'}
          </button>
        </div>
      ) : null}
    </article>
  )
}

function RunDetail({ run, index, total, onPrev, onNext, onClose }) {
  const [tab, setTab] = useState(run.status === 'passed' ? 'passed' : 'failed')
  const [proof, setProof] = useState(null)
  const [acked, setAcked] = useState(() => new Set())

  const s = statusMeta(run.status)
  const started = new Date(run.startTime).toLocaleString('fr-FR')

  // Tests rattachés à la suite exécutée. La démo ne stocke pas le détail
  // cas par cas : les échecs du run sont répartis sur les cas de la suite.
  const linked = testCases.filter((c) => c.suite === run.suite)
  const failedLinked = Math.min(run.results.failed, linked.length)
  const rows = linked.map((c, i) => ({
    item: c,
    failed:
      Math.round(((i + 1) * failedLinked) / linked.length) >
      Math.round((i * failedLinked) / linked.length),
  }))
  const visible = rows.filter((r) => r.failed === (tab === 'failed'))

  const acknowledge = (id) => {
    const next = new Set(acked)
    next.add(id)
    setAcked(next)
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
          <span className="td-tc-drawer-sep" />
          <button type="button" className="td-btn-ghost" title="Imprimer" onClick={() => window.print()}>
            <Icon name="printer" className="td-ic-14" />
          </button>
          <button type="button" className="td-btn-ghost" title="Fermer" onClick={onClose}>
            <Icon name="x" className="td-ic-14" />
          </button>
        </div>
      </div>

      <div className="td-tc-drawer-body">
        <h2 className="td-tc-drawer-title">{run.suite}</h2>

        <div className="mb-6">
          <span className={`td-tc-status-pill is-${run.status}`}>
            <span className="td-tc-status-dot" />
            <span>{s.label.toUpperCase()}</span>
          </span>
          <p className="td-tc-run-meta">
            {started} · {fmtDuration(run.durationMs)} · {run.total} test
            {run.total > 1 ? 's' : ''}
          </p>
        </div>

        <div className="td-tc-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={'td-tc-tab' + (tab === t.id ? ' is-active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="td-tc-linked-note">
          {linked.length} cas de test rattaché{linked.length > 1 ? 's' : ''} à la suite «{' '}
          {run.suite} ».
        </p>

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
                onAck={() => acknowledge(item.id)}
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
      </div>
    </>
  )
}

export default function RunDrawer() {
  const { run, openRun, closeRun } = useApp()
  const index = run ? runs.findIndex((r) => r.id === run.id) : -1

  const go = (delta) => {
    const next = runs[index + delta]
    if (next) openRun(next)
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
          index={index}
          total={runs.length}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onClose={closeRun}
        />
      ) : null}
    </aside>
  )
}
