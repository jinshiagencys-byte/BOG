import { useState } from 'react'
import Icon from '../Icon.jsx'
import Check from './Check.jsx'

function SuiteRow({
  suite,
  path,
  depth,
  selected,
  onSelect,
  expanded,
  onToggle,
  count,
  counts,
  onCreate,
  dropCase,
  dragActive,
  checked,
  idsBySuite,
  onToggleSuiteCheck,
}) {
  const hasChildren = Boolean(suite.children && suite.children.length)
  const isOpen = expanded.has(suite.id)
  const isActive = selected === suite.id
  const [over, setOver] = useState(false)
  const ids = idsBySuite[path] || []
  const allChecked = ids.length > 0 && ids.every((id) => checked.has(id))
  const someChecked = ids.some((id) => checked.has(id))

  const onDragOver = (e) => {
    if (!dragActive) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(true)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData('text/plain')
    if (id) dropCase(id, path)
  }

  return (
    <div>
      <div
        className={`td-suite-row group ${isActive ? 'is-active' : ''} ${over ? 'is-drop' : ''}`}
        style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(suite.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(suite.id)
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {hasChildren ? (
          <button
            type="button"
            className="td-suite-caret"
            aria-label={isOpen ? 'Réduire la suite' : 'Développer la suite'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(suite.id)
            }}
          >
            <Icon name="chevron-right" className={'td-ic-12 ' + (isOpen ? 'is-open' : '')} />
          </button>
        ) : (
          <span className="td-suite-caret" />
        )}

        <Check
          checked={allChecked}
          indeterminate={someChecked && !allChecked}
          label={
            allChecked
              ? `Désélectionner les cas de la suite ${suite.name}`
              : `Sélectionner les cas de la suite ${suite.name}`
          }
          onChange={() => onToggleSuiteCheck(ids)}
        />

        <Icon name="folder" className="td-ic-14 shrink-0 text-muted-foreground" />

        <span className="td-suite-name">{suite.name}</span>

        <button
          type="button"
          className="td-suite-add opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title={`Ajouter un cas de test à ${suite.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onCreate(path)
          }}
        >
          <Icon name="plus" className="td-ic-12" />
        </button>

        <span className="td-suite-count">{count}</span>
      </div>

      {hasChildren && isOpen
        ? suite.children.map((child) => {
            const childPath = `${path}/${child.name}`
            return (
              <SuiteRow
                key={child.id}
                suite={child}
                path={childPath}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
                expanded={expanded}
                onToggle={onToggle}
                count={counts[childPath] ?? child.count}
                counts={counts}
                onCreate={onCreate}
                dropCase={dropCase}
                dragActive={dragActive}
                checked={checked}
                idsBySuite={idsBySuite}
                onToggleSuiteCheck={onToggleSuiteCheck}
              />
            )
          })
        : null}
    </div>
  )
}

export default function SuiteTree({
  suites,
  selected,
  onSelect,
  expanded,
  onToggle,
  counts,
  total,
  onCreate,
  dropCase,
  dragActive,
  checked,
  idsBySuite,
  onToggleSuiteCheck,
}) {
  const allIds = Object.values(idsBySuite).flat()
  const allChecked = allIds.length > 0 && allIds.every((id) => checked.has(id))
  const someChecked = allIds.some((id) => checked.has(id))

  return (
    <div>
      <div
        className={`td-suite-row ${selected === 'all' ? 'is-active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelect('all')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect('all')
        }}
      >
        <span className="td-suite-caret" />
        <Check
          checked={allChecked}
          indeterminate={someChecked && !allChecked}
          label={
            allChecked
              ? 'Désélectionner tous les cas de test'
              : 'Sélectionner tous les cas de test'
          }
          onChange={() => onToggleSuiteCheck(allIds)}
        />
        <Icon name="layers" className="td-ic-14 shrink-0 text-muted-foreground" />
        <span className="td-suite-name">Tous les cas de test</span>
        <span className="td-suite-count">{total}</span>
      </div>

      {suites.map((s) => (
        <SuiteRow
          key={s.id}
          suite={s}
          path={s.name}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
          count={counts[s.name] ?? s.count}
          counts={counts}
          onCreate={onCreate}
          dropCase={dropCase}
          dragActive={dragActive}
          checked={checked}
          idsBySuite={idsBySuite}
          onToggleSuiteCheck={onToggleSuiteCheck}
        />
      ))}
    </div>
  )
}
