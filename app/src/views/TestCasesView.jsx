import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { CheckOption, Popover } from '../components/bits.jsx'
import SuiteTree from '../components/testcases/SuiteTree.jsx'
import GroupedTable from '../components/testcases/GroupedTable.jsx'
import CaseDrawer from '../components/testcases/CaseDrawer.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { useApp } from '../app/app-context.js'
import { DEMO_PROJECT, DEMO_PROJECT_SLUG } from '../app/projects.js'
import { buildCasePack } from '../data/casePacks.js'

// Les cas de test sont générés à l'avance selon la « Catégorie » du projet.
// Le composant est re-monté (via `key`) quand on change de projet.
export default function TestCasesView() {
  const { project } = useParams()
  const { projects } = useApp()
  const current =
    project === DEMO_PROJECT_SLUG
      ? DEMO_PROJECT
      : projects.find((p) => p.slug === project)

  return (
    <TestCasesViewInner
      key={project}
      category={current?.category || 'Autre'}
    />
  )
}

function TestCasesViewInner({ category }) {
  const pack = useMemo(() => buildCasePack(category), [category])
  const [cases, setCases] = useState(pack.cases)
  // Suites générées pour ce type de site (nom + nombre de cas).
  const [suiteList, setSuiteList] = useState(() => pack.suites)
  const [selected, setSelected] = useState('all')
  const [expanded, setExpanded] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [openGroups, setOpenGroups] = useState({})
  const [detailId, setDetailId] = useState(null)
  const [editing, setEditing] = useState(null)
  // Renommage d'une suite directement dans l'en-tête du groupe.
  const [renaming, setRenaming] = useState(null)
  // Création en ligne : une ligne « TC-xxx + champ titre » s'insère dans la suite.
  const [newCase, setNewCase] = useState(null)
  const [toast, setToast] = useState({ message: '', tone: 'success' })
  const [dragId, setDragId] = useState(null)
  const [dropHint, setDropHint] = useState(null)
  const [groupBySuite, setGroupBySuite] = useState(true)
  const [showSuites, setShowSuites] = useState(true)
  /* cases cochés (sélection multiple, indépendante du tiroir ouvert) */
  const [checked, setChecked] = useState(() => new Set())
  /* Déclenchements simulés en cours, par identifiant de cas. En attendant la
     base : on garde l'état localement pour empêcher un double déclenchement. */
  const [running, setRunning] = useState(() => new Set())
  const runningTimers = useRef(new Map())

  const showToast = useCallback((message, tone = 'success') => setToast({ message, tone }), [])
  const hideToast = useCallback(() => setToast((t) => ({ ...t, message: '' })), [])

  // Nettoyage des minuteurs de simulation au démontage.
  useEffect(
    () => () => {
      runningTimers.current.forEach((timer) => clearTimeout(timer))
      runningTimers.current.clear()
    },
    [],
  )

  const triggerSelected = useCallback(() => {
    const ids = [...checked]
    if (!ids.length) return

    const alreadyRunning = ids.filter((id) => running.has(id))
    const fresh = ids.filter((id) => !running.has(id))

    // Deuxième clic sur la même sélection : l'action est déjà en cours.
    if (!fresh.length) {
      showToast('Une action est déjà en cours pour les éléments sélectionnés.', 'error')
      return
    }

    setRunning((prev) => new Set([...prev, ...fresh]))
    showToast(
      alreadyRunning.length
        ? `Déclenchement de ${fresh.length} cas de test… ${alreadyRunning.length} déjà en cours.`
        : `Déclenchement de ${fresh.length} cas de test sélectionné${
            fresh.length > 1 ? 's' : ''
          }…`,
    )

    // Simulation locale : l'action se termine au bout de 10 s (sera remplacée
    // par l'état réel des runs quand la base sera branchée).
    fresh.forEach((id) => {
      const timer = window.setTimeout(() => {
        setRunning((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        runningTimers.current.delete(id)
      }, 10000)
      runningTimers.current.set(id, timer)
    })
  }, [checked, running, showToast])

  /* ---------- compteurs de suites (création, suppression, déplacement) ---------- */
  const counts = useMemo(
    () => Object.fromEntries(suiteList.map((s) => [s.name, s.count])),
    [suiteList],
  )

  const total = useMemo(() => suiteList.reduce((n, s) => n + s.count, 0), [suiteList])

  // Identifiants des cas par suite, pour les cases à cocher du panneau « Suites ».
  const idsBySuite = useMemo(() => {
    const map = {}
    for (const c of cases) (map[c.suite] ||= []).push(c.id)
    return map
  }, [cases])

  const bumpSuite = useCallback((name, delta) => {
    setSuiteList((prev) =>
      prev.map((s) =>
        s.name === name ? { ...s, count: Math.max(0, s.count + delta) } : s,
      ),
    )
  }, [])

  /* ---------- regroupement ---------- */
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = cases
    if (query)
      list = list.filter(
        (c) => c.title.toLowerCase().includes(query) || c.id.toLowerCase().includes(query),
      )
    if (selected !== 'all') {
      const suite = suiteList.find((s) => s.id === selected)
      if (suite) list = list.filter((c) => c.suite === suite.name)
    }

    if (!groupBySuite) {
      return list.length       ? [{ path: '__all__', label: 'Tous les cas de test', cases: list }] : []
    }

    const map = new Map()
    for (const c of list) {
      if (!map.has(c.suite)) map.set(c.suite, [])
      map.get(c.suite).push(c)
    }
    return [...map.entries()].map(([path, cs]) => ({ path, label: path, cases: cs }))
  }, [cases, q, selected, groupBySuite, suiteList])

  const visible = useMemo(() => groups.flatMap((g) => g.cases), [groups])
  const detailIndex = visible.findIndex((c) => c.id === detailId)
  const detailCase = detailIndex >= 0 ? visible[detailIndex] : null

  /* ---------- sélection / expansion ---------- */
  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectSuite = (id) => setSelected(id)

  const toggleGroup = (path) =>
    setOpenGroups((prev) => ({ ...prev, [path]: prev[path] === false }))

  /* ---------- sélection par case à cocher ---------- */
  const toggleCheck = (id) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleGroupCheck = (ids) =>
    setChecked((prev) => {
      const next = new Set(prev)
      const allChecked = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allChecked) next.delete(id)
        else next.add(id)
      }
      return next
    })

  /* ---------- déplacements ---------- */
  const moveCase = (sourceId, targetId, placeBefore) => {
    const from = cases.findIndex((c) => c.id === sourceId)
    if (from < 0) return
    const next = cases.slice()
    const [moved] = next.splice(from, 1)
    const targetIndex = next.findIndex((c) => c.id === targetId)

    let placed = moved
    let changedSuite = false
    if (targetIndex >= 0) {
      const target = next[targetIndex]
      if (target.suite !== moved.suite) {
        placed = { ...moved, suite: target.suite, suitePath: target.suite.split('/') }
        changedSuite = true
      }
      next.splice(placeBefore ? targetIndex : targetIndex + 1, 0, placed)
    } else {
      next.push(moved)
    }

    setCases(next)
    if (changedSuite) {
      bumpSuite(moved.suite, -1)
      bumpSuite(target.suite, 1)
    }
    showToast(
      changedSuite
        ? `📦 ${sourceId} déplacé vers « ${placed.suite} »`
        : `↕ ${sourceId} réorganisé`,
    )
  }

  const dropCase = (id, suitePath) => {
    const target = cases.find((c) => c.id === id)
    if (!target || target.suite === suitePath) return
    setCases((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, suite: suitePath, suitePath: suitePath.split('/') } : c,
      ),
    )
    bumpSuite(target.suite, -1)
    bumpSuite(suitePath, 1)
    showToast(`📦 ${id} déplacé vers « ${suitePath} »`)
  }

  /* ---------- drag & drop ---------- */
  const dragHandlers = {
    onStart: (e, id) => {
      e.dataTransfer.setData('text/plain', id)
      e.dataTransfer.effectAllowed = 'move'
      setDragId(id)
    },
    onOver: (e, id) => {
      if (!dragId || dragId === id) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const side = e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom'
      setDropHint((h) => (h && h.id === id && h.side === side ? h : { id, side }))
    },
    onLeave: () => setDropHint(null),
    onEnd: () => {
      setDragId(null)
      setDropHint(null)
    },
    onDrop: (e, id) => {
      e.preventDefault()
      const sourceId = e.dataTransfer.getData('text/plain') || dragId
      setDropHint(null)
      if (!sourceId || sourceId === id) return
      const rect = e.currentTarget.getBoundingClientRect()
      moveCase(sourceId, id, e.clientY - rect.top < rect.height / 2)
    },
  }

  /* ---------- création ---------- */
  const nextCaseId = useMemo(() => {
    const maxId = cases.reduce((m, c) => {
      const n = Number(String(c.id).split('-').pop()) || 0
      return Math.max(m, n)
    }, 0)
    return `TC-${pack.code}-${String(maxId + 1).padStart(3, '0')}`
  }, [cases, pack.code])

  // Ouvre la ligne de création inline dans la suite demandée (ou la suite courante).
  const startNewCase = (suitePath) => {
    setEditing(null)
    setRenaming(null)
    const fallback =
      (selected !== 'all' && suiteList.find((s) => s.id === selected)?.name) ||
      groups[0]?.path ||
      suiteList[0].name
    const path = suitePath || fallback
    setOpenGroups((prev) => ({ ...prev, [path]: true }))
    // un brouillon déjà ouvert dans la même suite n'est pas réinitialisé
    setNewCase((prev) => (prev && prev.path === path ? prev : { path, title: '' }))
  }

  const saveNewCase = () => {
    if (!newCase || !newCase.title.trim()) return
    const title = newCase.title.trim()
    const created = {
      id: nextCaseId,
      title,
      status: 'active',
      priority: 'medium',
      suite: newCase.path,
      suitePath: [newCase.path],
      description: title,
      preconditions: ['L’utilisateur est connecté au projet'],
      postconditions: 'Le parcours se déroule comme prévu.',
      steps: [],
      tags: [],
      updatedAt: 'À l’instant',
    }
    setCases((prev) => [created, ...prev])
    setNewCase(null)
    bumpSuite(created.suite, 1)

    const current = selected !== 'all' ? suiteList.find((s) => s.id === selected) : null
    if (current && created.suite !== current.name) setSelected('all')

    showToast(`Le cas de test ${created.id} a été créé.`)
  }

  const cancelNewCase = () => setNewCase(null)

  /* ---------- édition / suppression ---------- */
  const openEdit = (c) => {
    setNewCase(null)
    setEditing({ id: c.id, title: c.title })
  }

  const saveEdit = () => {
    if (!editing || !editing.title.trim()) return
    const title = editing.title.trim()
    setCases((prev) =>
      prev.map((c) =>
        c.id === editing.id
          ? {
              ...c,
              title,
              // la description générée à la création suit le titre
              description: c.description === c.title ? title : c.description,
              updatedAt: 'À l’instant',
            }
          : c,
      ),
    )
    showToast(`Le cas de test ${editing.id} a été mis à jour.`)
    setEditing(null)
  }

  // ouvrir un cas ferme la ligne de création en cours
  const openCase = (id) => {
    setNewCase(null)
    setEditing(null)
    setDetailId(id)
  }

  const deleteCase = (id) => {
    const target = cases.find((c) => c.id === id)
    setCases((prev) => prev.filter((c) => c.id !== id))
    setChecked((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (target) bumpSuite(target.suite, -1)
    if (editing?.id === id) setEditing(null)
    if (detailId === id) setDetailId(null)
    showToast(`Le cas de test ${id} a été supprimé.`)
  }

  /* ---------- suites : renommer / supprimer ---------- */
  const startRenameGroup = (path) => {
    setEditing(null)
    setNewCase(null)
    setRenaming({ path, name: path })
  }

  const saveRenameGroup = () => {
    if (!renaming) return
    const oldName = renaming.path
    const name = renaming.name.trim()
    if (!name) return
    if (name === oldName) {
      setRenaming(null)
      return
    }
    if (suiteList.some((s) => s.name === name)) {
      showToast(`Une suite s’appelle déjà « ${name} ».`)
      return
    }
    setSuiteList((prev) => prev.map((s) => (s.name === oldName ? { ...s, name } : s)))
    setCases((prev) =>
      prev.map((c) =>
        c.suite === oldName || c.suite.startsWith(oldName + '/')
          ? { ...c, suite: name + c.suite.slice(oldName.length), suitePath: [name] }
          : c,
      ),
    )
    setOpenGroups((prev) => {
      if (!(oldName in prev)) return prev
      const next = { ...prev }
      next[name] = next[oldName]
      delete next[oldName]
      return next
    })
    setNewCase((prev) => (prev && prev.path === oldName ? { ...prev, path: name } : prev))
    setRenaming(null)
    showToast(`Suite renommée en « ${name} ».`)
  }

  const deleteGroup = (path) => {
    const ids = cases.filter((c) => c.suite === path).map((c) => c.id)
    setCases((prev) => prev.filter((c) => c.suite !== path))
    setSuiteList((prev) => prev.filter((s) => s.name !== path))
    setChecked((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
    if (ids.includes(detailId)) setDetailId(null)
    if (editing && ids.includes(editing.id)) setEditing(null)
    if (newCase?.path === path) setNewCase(null)
    if (selected !== 'all' && suiteList.find((s) => s.id === selected)?.name === path)
      setSelected('all')
    setRenaming(null)
    showToast(
      ids.length
        ? `Suite « ${path} » et ses ${ids.length} cas de test supprimés.`
        : `Suite « ${path} » supprimée.`,
    )
  }

  /* ---------- édition depuis le tiroir ---------- */
  const updateFromDrawer = (patch, message) => {
    if (!detailCase) return
    const id = detailCase.id
    setCases((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: 'À l’instant' } : c)),
    )
    if (message) showToast(message)
  }

  /* ---------- raccourcis ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (renaming) setRenaming(null)
      else if (editing) setEditing(null)
      else if (newCase) setNewCase(null)
      else if (detailId) setDetailId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renaming, editing, detailId, newCase])

  const coveragePct = total ? Math.round((cases.length / total) * 100) : 0

  return (
    <>
      <div className="td-tc-head">
        <div className="td-page-head">
          <h1>Cas de test</h1>
          <p>
            {total} cas de test générés pour un site de type <b>{category}</b>
          </p>
        </div>

        <div className="td-coverage">
          <div className="td-coverage-track">
            <div className="td-coverage-fill" style={{ width: `${coveragePct}%` }} />
          </div>
          <div className="td-coverage-label">
            <b>{coveragePct}% de couverture</b>
            <span>
              {cases.length}/{total}
            </span>
          </div>
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon
            name="search"
            className="td-ic-14 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Rechercher parmi ${total} cas de test...`}
            className="h-8 w-56 rounded-md border border-border bg-card pl-8 pr-3 text-[12.5px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </div>

        <Popover label="Options" icon="sliders-horizontal">
          <div className="td-pop-inner">
            <CheckOption
              kind="opt"
              value="group"
              label="Regrouper par suite"
              checked={groupBySuite}
              onChange={(k, v, c) => setGroupBySuite(c)}
            />
          </div>
        </Popover>

        {/* Panneau Suites replié : on ne propose la bascule que dans cet état,
            pour ne pas encombrer la barre d'outils (le repli se fait depuis
            l'en-tête du panneau). */}
        {!showSuites ? (
          <button type="button" className="td-btn" onClick={() => setShowSuites(true)}>
            <Icon name="list-tree" className="td-ic-14" />
            Suites
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {checked.size ? (
            <div className="td-tc-selection">
              <span>
                {checked.size} sélectionné{checked.size > 1 ? 's' : ''}
              </span>
              <button type="button" onClick={() => setChecked(new Set())}>
                Tout désélectionner
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="td-btn td-btn-icon"
            title="Actualiser"
            onClick={() => showToast('Cas de test actualisés')}
          >
            <Icon name="refresh-cw" className="td-ic-16" />
          </button>

          <button
            type="button"
            className="td-btn td-btn-primary"
            disabled={!checked.size}
            title={
              checked.size
                ? `Déclencher ${checked.size} cas de test`
                : 'Sélectionnez au moins un cas de test'
            }
            onClick={triggerSelected}
          >
            <Icon name="circle-play" className="td-ic-14" />
            <span>Déclenché</span>
          </button>

          <button
            type="button"
            className="td-btn"
            title="Exporter"
            onClick={() =>
              showToast(
                checked.size
                  ? `Export de ${checked.size} cas de test sélectionnés…`
                  : `Export de ${cases.length} cas de test…`,
              )
            }
          >
            <Icon name="download" className="td-ic-14" />
            <span>Exporter</span>
            <Icon name="chevron-down" className="td-ic-12 opacity-70" />
          </button>

          <button type="button" className="td-btn td-btn-icon" title="Paramètres des suites">
            <Icon name="settings" className="td-ic-16" />
          </button>
        </div>
      </div>

      <div className="td-tc-split mt-4">
        {showSuites ? (
          <div className="td-tc-suites">
            <div className="td-tc-suites-head">
              <span>Suites</span>
              <div className="td-tc-suites-actions">
                <button
                  type="button"
                  className="td-btn-ghost"
                  title="Ajouter une suite"
                  onClick={() => showToast('La création de suite n’est pas disponible dans la démo.')}
                >
                  <Icon name="plus" className="td-ic-14" />
                </button>
                <button
                  type="button"
                  className="td-btn-ghost"
                  title="Réduire le panneau"
                  onClick={() => setShowSuites(false)}
                >
                  <Icon name="panel-left" className="td-ic-14" />
                </button>
              </div>
            </div>
            <div className="td-tc-suites-scroll">
              <SuiteTree
                suites={suiteList}
                selected={selected}
                onSelect={selectSuite}
                expanded={expanded}
                onToggle={toggleExpand}
                counts={counts}
                total={total}
                onCreate={startNewCase}
                dropCase={dropCase}
                dragActive={Boolean(dragId)}
                checked={checked}
                idsBySuite={idsBySuite}
                onToggleSuiteCheck={toggleGroupCheck}
              />
            </div>
          </div>
        ) : null}

        <div className="td-tc-panel">
          <GroupedTable
            groups={groups}
            openGroups={openGroups}
            onToggleGroup={toggleGroup}
            selectedId={detailId}
            checked={checked}
            onOpen={openCase}
            onToggleCheck={toggleCheck}
            onToggleGroupCheck={toggleGroupCheck}
            onEdit={openEdit}
            onDelete={deleteCase}
            onCreate={startNewCase}
            newCase={newCase}
            nextCaseId={nextCaseId}
            onNewCaseTitle={(title) => setNewCase((n) => (n ? { ...n, title } : n))}
            onNewCaseSave={saveNewCase}
            onNewCaseCancel={cancelNewCase}
            editing={editing}
            onEditTitle={(title) => setEditing((e) => (e ? { ...e, title } : e))}
            onEditSave={saveEdit}
            onEditCancel={() => setEditing(null)}
            renaming={renaming}
            onRename={startRenameGroup}
            onRenameName={(name) => setRenaming((r) => (r ? { ...r, name } : r))}
            onRenameSave={saveRenameGroup}
            onRenameCancel={() => setRenaming(null)}
            onDeleteGroup={deleteGroup}
            dragId={dragId}
            dropHint={dropHint}
            dragHandlers={dragHandlers}
          />
        </div>
      </div>

      <CaseDrawer
        item={detailCase}
        index={detailIndex}
        total={visible.length}
        onClose={() => setDetailId(null)}
        onPrev={() => detailIndex > 0 && setDetailId(visible[detailIndex - 1].id)}
        onNext={() =>
          detailIndex >= 0 && detailIndex < visible.length - 1
            ? setDetailId(visible[detailIndex + 1].id)
            : undefined
        }
        onChange={updateFromDrawer}
      />

      <Toast message={toast.message} tone={toast.tone} onDone={hideToast} />
    </>
  )
}
