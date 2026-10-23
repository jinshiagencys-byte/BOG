import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { CheckOption, Popover } from '../components/bits.jsx'
import SuiteTree from '../components/testcases/SuiteTree.jsx'
import GroupedTable from '../components/testcases/GroupedTable.jsx'
import CaseDrawer from '../components/testcases/CaseDrawer.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { PageSkeleton } from '../components/Skeleton.jsx'
import { useProject } from '../app/project-context.js'
import { buildCasePack } from '../data/casePacks.js'
import {
  createCase as createCaseApi,
  deleteCase as deleteCaseApi,
  deleteSuite as deleteSuiteApi,
  getCatalog,
  messageForError,
  moveCase as moveCaseApi,
  renameSuite as renameSuiteApi,
  startRun as startRunApi,
  syncCaseSteps,
  updateCase as updateCaseApi,
} from '../lib/api.js'

// Les cas de démonstration sont générés localement ; les cas réels viennent de
// `test_cases` / `test_steps`. Les identifiants envoyés à `start-run` sont
// toujours les UUID réels, jamais les codes lisibles `TC-…`.
export default function TestCasesView() {
  const { project, isDemo, loading, error } = useProject()

  if (loading) return <PageSkeleton rows={8} />
  if (error) {
    return (
      <>
        <div className="td-page-head">
          <h1>Cas de test</h1>
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

  return <TestCasesViewInner key={project.slug} project={project} isDemo={isDemo} />
}

function TestCasesViewInner({ project, isDemo }) {
  const navigate = useNavigate()
  const pack = useMemo(
    () => (isDemo ? buildCasePack(project.category || 'Autre') : null),
    [isDemo, project.category],
  )

  const [cases, setCases] = useState(() => pack?.cases || [])
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState('all')
  const [expanded, setExpanded] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [openGroups, setOpenGroups] = useState({})
  const [detailId, setDetailId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [newCase, setNewCase] = useState(null)
  const [toast, setToast] = useState({ message: '', tone: 'success' })
  const [dragId, setDragId] = useState(null)
  const [dropHint, setDropHint] = useState(null)
  const [groupBySuite, setGroupBySuite] = useState(true)
  const [showSuites, setShowSuites] = useState(true)
  const [checked, setChecked] = useState(() => new Set())
  const [running, setRunning] = useState(() => new Set())
  const [submittingRun, setSubmittingRun] = useState(false)
  const runningTimers = useRef(new Map())

  const showToast = useCallback(
    (message, tone = 'success') => setToast({ message, tone }),
    [],
  )
  const hideToast = useCallback(
    () => setToast((current) => ({ ...current, message: '' })),
    [],
  )

  useEffect(
    () => () => {
      runningTimers.current.forEach((timer) => clearTimeout(timer))
      runningTimers.current.clear()
    },
    [],
  )

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (isDemo) {
        setCases(pack.cases)
        setPlan(null)
        setLoading(false)
        setError('')
        return
      }
      if (!silent) setLoading(true)
      setError('')
      try {
        const data = await getCatalog(project.id)
        setPlan(data.plan)
        setCases(data.cases)
      } catch (loadError) {
        setError(messageForError(loadError))
        if (!silent) setCases([])
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [isDemo, pack, project.id],
  )

  useEffect(() => {
    load()
  }, [load])

  /* ---------- compteurs de suites ---------- */
  const suiteList = useMemo(() => {
    const map = new Map()
    for (const item of cases) {
      const suite = item.suite || 'Sans suite'
      map.set(suite, (map.get(suite) || 0) + 1)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'fr'))
      .map(([name, count]) => ({ id: name, name, count, children: [] }))
  }, [cases])

  const counts = useMemo(
    () => Object.fromEntries(suiteList.map((suite) => [suite.name, suite.count])),
    [suiteList],
  )
  const total = cases.length
  const activeCount = useMemo(
    () => cases.filter((item) => item.status === 'active').length,
    [cases],
  )

  const idsBySuite = useMemo(() => {
    const map = {}
    for (const item of cases) {
      const suite = item.suite || 'Sans suite'
      ;(map[suite] ||= []).push(item.id)
    }
    return map
  }, [cases])

  /* ---------- regroupement ---------- */
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = cases
    if (query) {
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          String(item.code || item.id).toLowerCase().includes(query),
      )
    }
    if (selected !== 'all') {
      const suite = suiteList.find((item) => item.id === selected)
      if (suite) list = list.filter((item) => item.suite === suite.name)
    }

    if (!groupBySuite) {
      return list.length
        ? [{ path: '__all__', label: 'Tous les cas de test', cases: list }]
        : []
    }

    const map = new Map()
    for (const item of list) {
      if (!map.has(item.suite)) map.set(item.suite, [])
      map.get(item.suite).push(item)
    }
    return [...map.entries()].map(([path, items]) => ({
      path,
      label: path,
      cases: items,
    }))
  }, [cases, q, selected, groupBySuite, suiteList])

  const visible = useMemo(() => groups.flatMap((group) => group.cases), [groups])
  const detailIndex = visible.findIndex((item) => item.id === detailId)
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

  /* ---------- déclenchement ---------- */
  const triggerSelected = useCallback(async () => {
    const ids = [...checked]
    if (!ids.length || submittingRun) return

    if (!isDemo) {
      if (!plan) {
        showToast('Aucun plan de test actif : impossible de déclencher un cas.', 'error')
        return
      }
      setSubmittingRun(true)
      try {
        const result = await startRunApi(project.id, ids, { trigger: 'manual' })
        setChecked(new Set())
        showToast(
          result?.runNumber
            ? `Exécution #${result.runNumber} déclenchée.`
            : 'Exécution déclenchée.',
        )
        navigate(`/${project.slug}/test-runs`)
      } catch (runError) {
        showToast(messageForError(runError), 'error')
      } finally {
        setSubmittingRun(false)
      }
      return
    }

    const alreadyRunning = ids.filter((id) => running.has(id))
    const fresh = ids.filter((id) => !running.has(id))
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

    // Démo uniquement : simulation de 10 s, sans appel Supabase.
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
  }, [checked, isDemo, navigate, plan, project.id, project.slug, running, showToast, submittingRun])

  /* ---------- déplacements ---------- */
  const moveCase = async (sourceId, targetId, placeBefore) => {
    const from = cases.findIndex((item) => item.id === sourceId)
    if (from < 0) return
    const next = cases.slice()
    const [moved] = next.splice(from, 1)
    const targetIndex = next.findIndex((item) => item.id === targetId)
    const target = targetIndex >= 0 ? next[targetIndex] : null
    const targetSuite = target ? target.suite : moved.suite

    if (!isDemo) {
      const positions = cases
        .filter((item) => item.suite === targetSuite && item.id !== sourceId)
        .map((item) => Number(item.position ?? 0))
      const maxPosition = positions.length ? Math.max(...positions) : 0
      try {
        await moveCaseApi(
          sourceId,
          targetSuite,
          target ? Number(target.position ?? maxPosition) : maxPosition + 1,
        )
        await load({ silent: true })
      } catch (moveError) {
        showToast(messageForError(moveError), 'error')
      }
      return
    }

    let placed = moved
    if (targetIndex >= 0) {
      if (target.suite !== moved.suite) {
        placed = { ...moved, suite: target.suite, suitePath: target.suite.split('/') }
      }
      next.splice(placeBefore ? targetIndex : targetIndex + 1, 0, placed)
    } else {
      next.push(moved)
    }
    setCases(next)
    showToast(
      target && target.suite !== moved.suite
        ? `📦 ${moved.code || moved.id} déplacé vers « ${placed.suite} »`
        : `↕ ${moved.code || moved.id} réorganisé`,
    )
  }

  const dropCase = async (id, suitePath) => {
    const target = cases.find((item) => item.id === id)
    if (!target || target.suite === suitePath) return

    if (!isDemo) {
      const positions = cases
        .filter((item) => item.suite === suitePath && item.id !== id)
        .map((item) => Number(item.position ?? 0))
      const maxPosition = positions.length ? Math.max(...positions) : 0
      try {
        await moveCaseApi(id, suitePath, maxPosition + 1)
        await load({ silent: true })
      } catch (moveError) {
        showToast(messageForError(moveError), 'error')
      }
      return
    }

    setCases((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, suite: suitePath, suitePath: suitePath.split('/') }
          : item,
      ),
    )
    showToast(`📦 ${target.code || target.id} déplacé vers « ${suitePath} »`)
  }

  /* ---------- drag & drop ---------- */
  const dragHandlers = {
    onStart: (event, id) => {
      event.dataTransfer.setData('text/plain', id)
      event.dataTransfer.effectAllowed = 'move'
      setDragId(id)
    },
    onOver: (event, id) => {
      if (!dragId || dragId === id) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const side = event.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom'
      setDropHint((hint) =>
        hint && hint.id === id && hint.side === side ? hint : { id, side },
      )
    },
    onLeave: () => setDropHint(null),
    onEnd: () => {
      setDragId(null)
      setDropHint(null)
    },
    onDrop: (event, id) => {
      event.preventDefault()
      const sourceId = event.dataTransfer.getData('text/plain') || dragId
      setDropHint(null)
      if (!sourceId || sourceId === id) return
      const rect = event.currentTarget.getBoundingClientRect()
      moveCase(sourceId, id, event.clientY - rect.top < rect.height / 2)
    },
  }

  /* ---------- création ---------- */
  const nextCaseId = useMemo(() => {
    if (isDemo) {
      const maxId = cases.reduce((max, item) => {
        const number = Number(String(item.code || item.id).split('-').pop()) || 0
        return Math.max(max, number)
      }, 0)
      return `TC-${pack.code}-${String(maxId + 1).padStart(3, '0')}`
    }

    const codes = cases.map((item) => item.code).filter(Boolean)
    if (!codes.length) return 'TC-MAN-001'
    const prefix = String(codes[0]).match(/^(TC-[A-Z0-9]+-)/)?.[1] || 'TC-MAN-'
    let max = 0
    for (const code of codes) {
      if (!String(code).startsWith(prefix)) continue
      const match = String(code).match(/(\d+)$/)
      if (match) max = Math.max(max, Number(match[1]))
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`
  }, [cases, isDemo, pack])

  const startNewCase = (suitePath) => {
    setEditing(null)
    setRenaming(null)
    // La vue « non groupée » utilise le pseudo-groupe `__all__` : il ne doit
    // jamais devenir le nom d'une vraie suite en base.
    const requested = suitePath && suitePath !== '__all__' ? suitePath : null
    const fallback =
      (selected !== 'all' && suiteList.find((suite) => suite.id === selected)?.name) ||
      (groups[0]?.path !== '__all__' ? groups[0]?.path : null) ||
      suiteList[0]?.name ||
      'Suite principale'
    const path = requested || fallback
    setOpenGroups((prev) => ({ ...prev, [path]: true }))
    setNewCase((prev) =>
      prev && prev.path === path ? prev : { path, title: '' },
    )
  }

  const saveNewCase = async () => {
    if (!newCase || !newCase.title.trim()) return
    if (!isDemo && !plan) {
      showToast('Aucun plan de test actif : impossible de créer un cas.', 'error')
      return
    }
    const title = newCase.title.trim()
    try {
      if (isDemo) {
        const created = {
          id: nextCaseId,
          code: nextCaseId,
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
        showToast(`Le cas de test ${created.code} a été créé.`)
        return
      }

      const created = await createCaseApi(plan.id, {
        code: nextCaseId,
        title,
        suite: newCase.path,
      })
      setNewCase(null)
      await load({ silent: true })
      showToast(`Le cas de test ${created.code} a été créé.`)
    } catch (createError) {
      showToast(messageForError(createError), 'error')
    }
  }

  const cancelNewCase = () => setNewCase(null)

  /* ---------- édition / suppression ---------- */
  const openEdit = (item) => {
    setNewCase(null)
    setEditing({ id: item.id, title: item.title })
  }

  const saveEdit = async () => {
    if (!editing || !editing.title.trim()) return
    const title = editing.title.trim()
    const target = cases.find((item) => item.id === editing.id)

    try {
      if (isDemo) {
        setCases((prev) =>
          prev.map((item) =>
            item.id === editing.id
              ? {
                  ...item,
                  title,
                  description: item.description === item.title ? title : item.description,
                  updatedAt: 'À l’instant',
                }
              : item,
          ),
        )
        showToast(`Le cas de test ${editing.id} a été mis à jour.`)
        setEditing(null)
        return
      }

      await updateCaseApi(editing.id, {
        title,
        ...(target && target.description === target.title ? { description: title } : {}),
      })
      setEditing(null)
      await load({ silent: true })
      showToast('Le cas de test a été mis à jour.')
    } catch (editError) {
      showToast(messageForError(editError), 'error')
    }
  }

  const openCase = (id) => {
    setNewCase(null)
    setEditing(null)
    setDetailId(id)
  }

  const removeCase = async (id) => {
    const target = cases.find((item) => item.id === id)
    try {
      if (!isDemo) {
        await deleteCaseApi(id)
      } else {
        setCases((prev) => prev.filter((item) => item.id !== id))
      }
      setChecked((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      if (editing?.id === id) setEditing(null)
      if (detailId === id) setDetailId(null)
      if (!isDemo) await load({ silent: true })
      showToast(
        `Le cas de test ${target?.code || target?.id || ''} a été supprimé.`.trim(),
      )
    } catch (deleteError) {
      showToast(messageForError(deleteError), 'error')
    }
  }

  /* ---------- suites : ajouter / renommer / supprimer ---------- */
  const addSuite = () => {
    const name = window.prompt('Nom de la nouvelle suite')
    if (!name || !name.trim()) return
    const suite = name.trim()
    setOpenGroups((prev) => ({ ...prev, [suite]: true }))
    setSelected('all')
    startNewCase(suite)
  }

  const startRenameGroup = (path) => {
    setEditing(null)
    setNewCase(null)
    setRenaming({ path, name: path })
  }

  const saveRenameGroup = async () => {
    if (!renaming) return
    const oldName = renaming.path
    const name = renaming.name.trim()
    if (!name) return
    if (name === oldName) {
      setRenaming(null)
      return
    }
    if (suiteList.some((suite) => suite.name === name)) {
      showToast(`Une suite s’appelle déjà « ${name} ».`)
      return
    }

    try {
      if (!isDemo) {
        if (!plan) {
          showToast('Aucun plan de test actif.', 'error')
          return
        }
        await renameSuiteApi(plan.id, oldName, name)
        await load({ silent: true })
      } else {
        setCases((prev) =>
          prev.map((item) =>
            item.suite === oldName || item.suite.startsWith(oldName + '/')
              ? {
                  ...item,
                  suite: name + item.suite.slice(oldName.length),
                  suitePath: [name],
                }
              : item,
          ),
        )
      }

      setOpenGroups((prev) => {
        if (!(oldName in prev)) return prev
        const next = { ...prev }
        next[name] = next[oldName]
        delete next[oldName]
        return next
      })
      setNewCase((prev) => (prev && prev.path === oldName ? { ...prev, path: name } : prev))
      if (selected === oldName) setSelected(name)
      setRenaming(null)
      showToast(`Suite renommée en « ${name} ».`)
    } catch (renameError) {
      showToast(messageForError(renameError), 'error')
    }
  }

  const deleteGroup = async (path) => {
    const ids = cases.filter((item) => item.suite === path).map((item) => item.id)
    try {
      if (!isDemo) {
        if (!plan) {
          showToast('Aucun plan de test actif.', 'error')
          return
        }
        await deleteSuiteApi(plan.id, path)
        await load({ silent: true })
      } else {
        setCases((prev) => prev.filter((item) => item.suite !== path))
      }

      setChecked((prev) => {
        if (!ids.some((id) => prev.has(id))) return prev
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
      if (ids.includes(detailId)) setDetailId(null)
      if (editing && ids.includes(editing.id)) setEditing(null)
      if (newCase?.path === path) setNewCase(null)
      if (selected !== 'all' && suiteList.find((suite) => suite.id === selected)?.name === path) {
        setSelected('all')
      }
      setRenaming(null)
      showToast(
        ids.length
          ? `Suite « ${path} » et ses ${ids.length} cas de test supprimés.`
          : `Suite « ${path} » supprimée.`,
      )
    } catch (deleteError) {
      showToast(messageForError(deleteError), 'error')
    }
  }

  /* ---------- édition depuis le tiroir ---------- */
  const updateFromDrawer = async (patch, message) => {
    if (!detailCase) return
    const id = detailCase.id

    if (isDemo) {
      setCases((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, ...patch, updatedAt: 'À l’instant' } : item,
        ),
      )
      if (message) showToast(message)
      return
    }

    try {
      if (patch.steps !== undefined) {
        await syncCaseSteps(id, patch.steps)
      }
      const casePatch = { ...patch }
      delete casePatch.steps
      if (Object.keys(casePatch).length) {
        await updateCaseApi(id, casePatch)
      }
      await load({ silent: true })
      if (message) showToast(message)
    } catch (updateError) {
      showToast(messageForError(updateError), 'error')
    }
  }

  /* ---------- raccourcis ---------- */
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (renaming) setRenaming(null)
      else if (editing) setEditing(null)
      else if (newCase) setNewCase(null)
      else if (detailId) setDetailId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renaming, editing, detailId, newCase])

  const coveragePct = total ? Math.round((activeCount / total) * 100) : 0

  if (loading && !isDemo) return <PageSkeleton rows={8} />

  if (error && !cases.length) {
    return (
      <>
        <div className="td-page-head">
          <h1>Cas de test</h1>
          <p>Impossible de charger le catalogue du projet.</p>
        </div>
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{error}</span>
          <button type="button" className="td-btn td-btn-ghost" onClick={() => load()}>
            Réessayer
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="td-tc-head">
        <div className="td-page-head">
          <h1>Cas de test</h1>
          <p>
            {isDemo ? (
              <>
                {total} cas de test générés pour un site de type <b>{project.category}</b>
              </>
            ) : (
              <>
                {total} cas de test dans le plan actif
                {plan ? ` v${plan.version}` : ''} · <b>{project.name}</b>
              </>
            )}
          </p>
        </div>

        <div className="td-coverage">
          <div className="td-coverage-track">
            <div className="td-coverage-fill" style={{ width: `${coveragePct}%` }} />
          </div>
          <div className="td-coverage-label">
            <b>{coveragePct}% de couverture</b>
            <span>
              {activeCount}/{total}
            </span>
          </div>
        </div>
      </div>

      {!isDemo && !plan ? (
        <div className="td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>
            Aucun plan de test actif pour ce projet. Créez le projet depuis la page Projets pour
            générer son plan et son catalogue de cas.
          </span>
        </div>
      ) : null}

      {error && cases.length ? (
        <div className="td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon
            name="search"
            className="td-ic-14 pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
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
              onChange={(_key, _value, isChecked) => setGroupBySuite(isChecked)}
            />
          </div>
        </Popover>

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
            onClick={async () => {
              await load()
              showToast('Cas de test actualisés')
            }}
          >
            <Icon name="refresh-cw" className="td-ic-16" />
          </button>

          <button
            type="button"
            className="td-btn td-btn-primary"
            disabled={!checked.size || submittingRun}
            title={
              checked.size
                ? `Déclencher ${checked.size} cas de test`
                : 'Sélectionnez au moins un cas de test'
            }
            onClick={triggerSelected}
          >
            <Icon name="circle-play" className="td-ic-14" />
            <span>{submittingRun ? 'Déclenchement…' : 'Déclencher'}</span>
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
                  onClick={addSuite}
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
            onDelete={removeCase}
            onCreate={startNewCase}
            newCase={newCase}
            nextCaseId={nextCaseId}
            onNewCaseTitle={(title) => setNewCase((current) => (current ? { ...current, title } : current))}
            onNewCaseSave={saveNewCase}
            onNewCaseCancel={cancelNewCase}
            editing={editing}
            onEditTitle={(title) => setEditing((current) => (current ? { ...current, title } : current))}
            onEditSave={saveEdit}
            onEditCancel={() => setEditing(null)}
            renaming={renaming}
            onRename={startRenameGroup}
            onRenameName={(name) => setRenaming((current) => (current ? { ...current, name } : current))}
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
