import { useRef, useState } from 'react'
import Icon from '../Icon.jsx'

// Onglets du tiroir : Attachments et History ont été retirés.
const TABS = [
  { id: 'overview', label: 'Aperçu' },
  { id: 'linked', label: 'Liens testés' },
]

function Section({ title, open, onToggle, action, children }) {
  return (
    <div className="td-tc-section">
      <div className="td-tc-section-head">
        <button
          type="button"
          className="td-tc-section-main"
          aria-expanded={open}
          onClick={onToggle}
        >
          <Icon
            name="chevron-down"
            className={'td-tc-section-caret td-ic-16' + (open ? ' is-open' : '')}
          />
          <span className="td-tc-section-title">{title}</span>
        </button>
        {action}
      </div>
      {open ? <div className="td-tc-section-body">{children}</div> : null}
    </div>
  )
}

function toGherkin(item) {
  const given = item.preconditions[0] || 'l’application est prête'
  const body = item.steps.map((s) => `    Quand ${s.action}\n    Alors ${s.expected}`).join('\n')
  return `Fonctionnalité : ${item.title}\n\n  Scénario : Vérification standard\n    Étant donné ${given}\n${body}`
}

export default function CaseDrawer({ item, index, total, onClose, onPrev, onNext, onChange }) {
  const [tab, setTab] = useState('overview')
  const [stepsMode, setStepsMode] = useState('classic')
  const [open, setOpen] = useState({ desc: true, prepost: true, steps: true })
  const [draftState, setDraft] = useState(null)
  const [stepEditState, setStepEdit] = useState(null)
  const actionRef = useRef(null)

  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))
  const isOpen = Boolean(item)

  // un brouillon n'appartient qu'au cas où il a été ouvert : il disparaît
  // automatiquement quand on passe au cas précédent/suivant.
  const draft = draftState && draftState.id === item?.id ? draftState : null
  const stepEdit = stepEditState && stepEditState.id === item?.id ? stepEditState : null

  const startStep = () => {
    setOpen((o) => ({ ...o, steps: true }))
    setStepsMode('classic')
    setStepEdit(null)
    if (draft) actionRef.current?.focus()
    else setDraft({ id: item.id, action: '', expected: '' })
  }

  const saveStep = () => {
    if (!draft || !draft.action.trim() || !item) return
    onChange(
      {
        steps: [
          ...item.steps,
          { action: draft.action.trim(), expected: draft.expected.trim() || '—' },
        ],
      },
      `Étape ${item.steps.length + 1} ajoutée à ${item.id}.`,
    )
    setDraft(null)
  }

  const onDraftKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveStep()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDraft(null)
    }
  }

  /* ---------- édition / suppression d'une étape ---------- */
  const startStepEdit = (i) => {
    const step = item.steps[i]
    setDraft(null)
    setStepEdit({
      id: item.id,
      index: i,
      action: step.action,
      expected: step.expected === '—' ? '' : step.expected,
    })
  }

  const saveStepEdit = () => {
    if (!stepEdit || !stepEdit.action.trim() || !item) return
    onChange(
      {
        steps: item.steps.map((s, idx) =>
          idx === stepEdit.index
            ? { action: stepEdit.action.trim(), expected: stepEdit.expected.trim() || '—' }
            : s,
        ),
      },
      `Étape ${stepEdit.index + 1} mise à jour.`,
    )
    setStepEdit(null)
  }

  const removeStep = (i) => {
    onChange(
      { steps: item.steps.filter((_, idx) => idx !== i) },
      `Étape ${i + 1} supprimée de ${item.id}.`,
    )
    if (stepEdit?.index === i) setStepEdit(null)
  }

  const onStepEditKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveStepEdit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setStepEdit(null)
    }
  }

  return (
    <aside className={'td-tc-drawer' + (isOpen ? ' is-open' : '')} aria-hidden={!isOpen}>
      <div className="td-tc-drawer-top">
        <div className="td-tc-crumb">
          <Icon name="folder" className="td-ic-14 shrink-0 text-muted-foreground" />
          <span className="td-tc-crumb-suite">{item ? item.suite : ''}</span>
          <span className="text-border">/</span>
          <span className="td-tc-crumb-id">{item ? item.id : ''}</span>
          <Icon name="link" className="td-ic-12 shrink-0 text-muted-foreground" />
        </div>

        <div className="td-tc-drawer-nav">
          <button
            type="button"
            className="td-btn-ghost"
            title="Cas de test précédent"
            disabled={!item || index <= 0}
            onClick={onPrev}
          >
            <Icon name="chevron-left" className="td-ic-14" />
          </button>
          <span className="td-tc-pager">
            {item ? `${index + 1} / ${total}` : '0 / 0'}
          </span>
          <button
            type="button"
            className="td-btn-ghost"
            title="Cas de test suivant"
            disabled={!item || index >= total - 1}
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
        <h2 className="td-tc-drawer-title">{item ? item.title : ''}</h2>

        <div className="mb-6">
          <button
            type="button"
            className={`td-tc-status-pill is-${item ? item.status : 'draft'}`}
          >
            <span className="td-tc-status-dot" />
            <span>
              {item
                ? { active: 'ACTIF', draft: 'BROUILLON', deprecated: 'OBSOLÈTE' }[item.status] ||
                  item.status.toUpperCase()
                : ''}
            </span>
            <Icon name="chevron-down" className="td-ic-12" />
          </button>
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

        {tab === 'overview' && item ? (
          <div>
            <Section title="Description" open={open.desc} onToggle={() => toggle('desc')}>
              <p>{item.description}</p>
            </Section>

            <Section title="Préconditions et postconditions" open={open.prepost} onToggle={() => toggle('prepost')}>
              <div className="td-tc-prepost">
                <div>
                  <div className="td-tc-subhead-label">Préconditions</div>
                  <ul>
                    {item.preconditions.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="td-tc-subhead-label">Postconditions</div>
                  <p>{item.postconditions}</p>
                </div>
              </div>
            </Section>

            <Section
              title="Steps"
              open={open.steps}
              onToggle={() => toggle('steps')}
              action={
                <div className="td-seg">
                  <button
                    type="button"
                    className={'td-seg-btn' + (stepsMode === 'classic' ? ' is-active' : '')}
                    onClick={() => setStepsMode('classic')}
                  >
                    <Icon name="list" className="td-ic-14" />
                    Classique
                  </button>
                  <button
                    type="button"
                    className={'td-seg-btn' + (stepsMode === 'gherkin' ? ' is-active' : '')}
                    onClick={() => setStepsMode('gherkin')}
                  >
                    <span className="font-mono text-xs">{'{ }'}</span>
                    Gherkin
                  </button>
                </div>
              }
            >
              {stepsMode === 'classic' ? (
                <table className="td-tc-steps-table">
                  <thead>
                    <tr>
                      <th className="td-tc-step-n">#</th>
                      <th>Action</th>
                      <th>
                        <span className="flex items-center gap-1">
                          <Icon name="check" className="td-ic-12" />
                          Résultat attendu
                        </span>
                      </th>
                      <th className="td-tc-step-act-head">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.steps.map((s, i) =>
                      stepEdit && stepEdit.index === i ? (
                        <tr key={`edit-${i}`} className="td-tc-step-edit">
                          <td className="td-tc-step-n">{i + 1}</td>
                          <td>
                            <input
                              className="td-control"
                              placeholder="Action à effectuer"
                              aria-label={`Action de l’étape ${i + 1}`}
                              autoFocus
                              value={stepEdit.action}
                              onChange={(e) =>
                                setStepEdit({ ...stepEdit, action: e.target.value })
                              }
                              onKeyDown={onStepEditKey}
                            />
                          </td>
                          <td>
                            <input
                              className="td-control"
                              placeholder="Résultat attendu"
                              aria-label={`Résultat attendu de l’étape ${i + 1}`}
                              value={stepEdit.expected}
                              onChange={(e) =>
                                setStepEdit({ ...stepEdit, expected: e.target.value })
                              }
                              onKeyDown={onStepEditKey}
                            />
                          </td>
                          <td className="td-tc-step-act">
                            <button
                              type="button"
                              className="td-btn td-btn-primary"
                              title="Enregistrer l’étape"
                              aria-label="Enregistrer l’étape"
                              disabled={!stepEdit.action.trim()}
                              onClick={saveStepEdit}
                            >
                              <Icon name="check" className="td-ic-14" />
                            </button>
                            <button
                              type="button"
                              className="td-btn td-btn-ghost"
                              title="Annuler la modification"
                              aria-label="Annuler la modification"
                              onClick={() => setStepEdit(null)}
                            >
                              <Icon name="x" className="td-ic-14" />
                            </button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={s.action + i}>
                          <td className="td-tc-step-n">{i + 1}</td>
                          <td>{s.action}</td>
                          <td className="td-tc-step-expected">{s.expected}</td>
                          <td className="td-tc-step-act">
                            <div className="td-tc-step-act-inner">
                              <button
                                type="button"
                                className="td-btn-ghost"
                                title={`Modifier l’étape ${i + 1}`}
                                aria-label={`Modifier l’étape ${i + 1}`}
                                onClick={() => startStepEdit(i)}
                              >
                                <Icon name="pencil" className="td-ic-12" />
                              </button>
                              <button
                                type="button"
                                className="td-btn-ghost td-btn-danger"
                                title={`Supprimer l’étape ${i + 1}`}
                                aria-label={`Supprimer l’étape ${i + 1}`}
                                onClick={() => removeStep(i)}
                              >
                                <Icon name="trash-2" className="td-ic-12" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                    {draft ? (
                      <tr className="td-tc-step-new">
                        <td className="td-tc-step-n">{item.steps.length + 1}</td>
                        <td>
                          <input
                            ref={actionRef}
                            className="td-control"
                            placeholder="Action à effectuer"
                            aria-label={`Action de l’étape ${item.steps.length + 1}`}
                            autoFocus
                            value={draft.action}
                            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                            onKeyDown={onDraftKey}
                          />
                        </td>
                        <td>
                          <input
                            className="td-control"
                            placeholder="Résultat attendu"
                            aria-label={`Résultat attendu de l’étape ${item.steps.length + 1}`}
                            value={draft.expected}
                            onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
                            onKeyDown={onDraftKey}
                          />
                        </td>
                        <td className="td-tc-step-act">
                          <button
                            type="button"
                            className="td-btn td-btn-primary"
                            title="Ajouter l’étape"
                            aria-label="Ajouter l’étape"
                            disabled={!draft.action.trim()}
                            onClick={saveStep}
                          >
                            <Icon name="check" className="td-ic-14" />
                          </button>
                          <button
                            type="button"
                            className="td-btn td-btn-ghost"
                            title="Annuler l’étape"
                            aria-label="Annuler l’étape"
                            onClick={() => setDraft(null)}
                          >
                            <Icon name="x" className="td-ic-14" />
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : (
                <pre className="td-tc-gherkin">{toGherkin(item)}</pre>
              )}

              <button type="button" className="td-tc-add td-tc-add-drawer" onClick={startStep}>
                <span className="text-base font-semibold leading-none">+</span>
                <span className="font-medium">Ajouter une étape</span>
              </button>
            </Section>
          </div>
        ) : null}

        {tab === 'linked' ? (
          <div className="td-tc-empty">
            <Icon name="circle-dashed" className="td-ic-20" />
            <span>Aucune exécution n’est associée à ce cas de test.</span>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
