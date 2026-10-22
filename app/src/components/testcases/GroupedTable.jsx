import { useEffect, useRef } from 'react'
import Icon from '../Icon.jsx'
import Check from './Check.jsx'

function Row({ c, isSelected, isChecked, isDragging, dropSide, onOpen, onToggleCheck, onEdit, onDelete, dragHandlers }) {
  return (
    <div
      className={
        'td-tc-row' +
        (isChecked ? ' is-checked' : '') +
        (isSelected ? ' is-selected' : '') +
        (isDragging ? ' is-dragging' : '') +
        (dropSide ? ` is-drop-${dropSide}` : '')
      }
      draggable
      role="button"
      tabIndex={0}
      onDragStart={(e) => dragHandlers.onStart(e, c.id)}
      onDragOver={(e) => dragHandlers.onOver(e, c.id)}
      onDrop={(e) => dragHandlers.onDrop(e, c.id)}
      onDragLeave={dragHandlers.onLeave}
      onDragEnd={dragHandlers.onEnd}
      onClick={(e) => {
        // le grip sert au drag et la coche à la sélection : ni l'un ni l'autre n'ouvre le tiroir
        if (e.target.closest('.td-tc-handle, .td-tc-check')) return
        onOpen(c.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(c.id)
      }}
    >
      <span className="td-tc-handle" title="Faire glisser pour réorganiser ou déplacer">
        <Icon name="grip-vertical" className="td-ic-14" />
      </span>
      <Check
        checked={isChecked}
        label={isChecked ? `Désélectionner ${c.id}` : `Sélectionner ${c.id}`}
        onChange={() => onToggleCheck(c.id)}
      />
      <span className="td-tc-id">{c.id}</span>
      <span className="td-tc-title">{c.title}</span>
      <div className="td-tc-row-actions">
        <button
          type="button"
          className="td-btn-ghost"
          title={`Modifier ${c.id}`}
          aria-label={`Modifier ${c.id}`}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(c)
          }}
        >
          <Icon name="pencil" className="td-ic-14" />
        </button>
        <button
          type="button"
          className="td-btn-ghost td-btn-danger"
          title={`Supprimer ${c.id}`}
          aria-label={`Supprimer ${c.id}`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(c.id)
          }}
        >
          <Icon name="trash-2" className="td-ic-14" />
        </button>
      </div>
    </div>
  )
}

/* Ligne de création inline : le numéro du prochain cas s'affiche avant le champ. */
function NewRow({ id, title, onTitle, onSave, onCancel }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div className="td-tc-row td-tc-row-new">
      <span className="td-tc-handle" aria-hidden="true">
        <Icon name="grip-vertical" className="td-ic-14" />
      </span>
      <span className="td-tc-new-spacer" aria-hidden="true" />
      <span className="td-tc-id">{id}</span>
      <input
        ref={ref}
        className="td-control td-tc-new-input"
        placeholder="Titre du cas de test"
        aria-label={`Titre du nouveau cas ${id}`}
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSave()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="td-tc-row-actions td-tc-row-actions-new">
        <button
          type="button"
          className="td-btn td-btn-primary"
          title="Créer le cas de test"
          aria-label="Créer le cas de test"
          disabled={!title.trim()}
          onClick={onSave}
        >
          <Icon name="check" className="td-ic-14" />
        </button>
        <button
          type="button"
          className="td-btn td-btn-ghost"
          title="Annuler la création"
          aria-label="Annuler la création"
          onClick={onCancel}
        >
          <Icon name="x" className="td-ic-14" />
        </button>
      </div>
    </div>
  )
}

/* Ligne d'édition inline : même gabarit que la création, titre pré-rempli. */
function EditRow({ c, title, onTitle, onSave, onCancel }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    // garder le début du titre visible (le select place le curseur à la fin)
    el.scrollLeft = 0
  }, [])

  return (
    <div className="td-tc-row td-tc-row-edit">
      <span className="td-tc-handle" aria-hidden="true">
        <Icon name="grip-vertical" className="td-ic-14" />
      </span>
      <span className="td-tc-new-spacer" aria-hidden="true" />
      <span className="td-tc-id">{c.id}</span>
      <input
        ref={ref}
        className="td-control td-tc-new-input"
        placeholder="Titre du cas de test"
        aria-label={`Titre de ${c.id}`}
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSave()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="td-tc-row-actions td-tc-row-actions-new">
        <button
          type="button"
          className="td-btn td-btn-primary"
          title="Enregistrer"
          aria-label="Enregistrer"
          disabled={!title.trim()}
          onClick={onSave}
        >
          <Icon name="check" className="td-ic-14" />
        </button>
        <button
          type="button"
          className="td-btn td-btn-ghost"
          title="Annuler la modification"
          aria-label="Annuler la modification"
          onClick={onCancel}
        >
          <Icon name="x" className="td-ic-14" />
        </button>
      </div>
    </div>
  )
}

/* Champ de renommage d'une suite : focus + sélection du nom à l'ouverture. */
function GroupRename({ value, label, onChange, onSave, onCancel }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <input
      ref={ref}
      className="td-control td-tc-group-rename"
      aria-label={`Nom de la suite ${label}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onSave()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    />
  )
}

export default function GroupedTable({
  groups,
  openGroups,
  onToggleGroup,
  selectedId,
  checked,
  onOpen,
  onToggleCheck,
  onToggleGroupCheck,
  onEdit,
  onDelete,
  onCreate,
  newCase,
  nextCaseId,
  onNewCaseTitle,
  onNewCaseSave,
  onNewCaseCancel,
  editing,
  onEditTitle,
  onEditSave,
  onEditCancel,
  renaming,
  onRename,
  onRenameName,
  onRenameSave,
  onRenameCancel,
  onDeleteGroup,
  dragId,
  dropHint,
  dragHandlers,
}) {
  if (!groups.length) {
    return (
      <div className="td-tc-empty">
        <Icon name="search-x" className="td-ic-20" />
        <span>Aucun cas de test trouvé</span>
      </div>
    )
  }

  return (
    <div>
      {groups.map((group) => {
        const isOpen = openGroups[group.path] !== false
        const ids = group.cases.map((c) => c.id)
        const allChecked = ids.length > 0 && ids.every((id) => checked.has(id))
        const someChecked = ids.some((id) => checked.has(id))
        const isRenaming = renaming?.path === group.path

        return (
          <div key={group.path}>
            <div className={'td-tc-group-head' + (isRenaming ? ' is-renaming' : '')}>
              {isRenaming ? (
                <GroupRename
                  value={renaming.name}
                  label={group.label}
                  onChange={onRenameName}
                  onSave={onRenameSave}
                  onCancel={onRenameCancel}
                />
              ) : (
                <button
                  type="button"
                  className="td-tc-group-main"
                  aria-expanded={isOpen}
                  onClick={() => onToggleGroup(group.path)}
                >
                  <span className="td-tc-group-title">{group.label}</span>
                  <span className="td-tc-group-count">
                    {group.cases.length} {group.cases.length === 1 ? 'cas' : 'cas'}
                  </span>
                </button>
              )}

              <div className="td-tc-group-right">
                <div className={'td-tc-group-actions' + (isRenaming ? ' is-editing' : '')}>
                  {isRenaming ? (
                    <>
                      <button
                        type="button"
                        className="td-btn td-btn-primary"
                        title="Enregistrer le nom de la suite"
                        aria-label="Enregistrer le nom de la suite"
                        disabled={!renaming.name.trim()}
                        onClick={onRenameSave}
                      >
                        <Icon name="check" className="td-ic-12" />
                      </button>
                      <button
                        type="button"
                        className="td-btn td-btn-ghost"
                        title="Annuler le renommage"
                        aria-label="Annuler le renommage"
                        onClick={onRenameCancel}
                      >
                        <Icon name="x" className="td-ic-12" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="td-btn-ghost"
                        title="Ajouter un cas de test"
                        onClick={() => onCreate(group.path)}
                      >
                        <Icon name="plus" className="td-ic-14" />
                      </button>
                      <button
                        type="button"
                        className="td-btn-ghost"
                        title="Renommer la suite"
                        aria-label={`Renommer la suite ${group.label}`}
                        onClick={() => onRename(group.path)}
                      >
                        <Icon name="pencil" className="td-ic-14" />
                      </button>
                      <button
                        type="button"
                        className="td-btn-ghost td-btn-danger"
                        title="Supprimer la suite"
                        aria-label={`Supprimer la suite ${group.label}`}
                        onClick={() => onDeleteGroup(group.path)}
                      >
                        <Icon name="trash-2" className="td-ic-14" />
                      </button>
                    </>
                  )}
                </div>
                <Icon
                  name="chevron-down"
                  className={'td-tc-group-caret td-ic-16' + (isOpen ? ' is-open' : '')}
                />
              </div>
            </div>

            {isOpen ? (
              <>
                <div className="td-tc-subhead">
                  <Check
                    checked={allChecked}
                    indeterminate={someChecked && !allChecked}
                    label={
                      allChecked
                        ? 'Tout désélectionner dans cette suite'
                        : 'Tout sélectionner dans cette suite'
                    }
                    onChange={() => onToggleGroupCheck(ids)}
                  />
                  <span className="td-tc-subhead-text">Cas de test</span>
                </div>
                {newCase && newCase.path === group.path ? (
                  <NewRow
                    id={nextCaseId}
                    title={newCase.title}
                    onTitle={onNewCaseTitle}
                    onSave={onNewCaseSave}
                    onCancel={onNewCaseCancel}
                  />
                ) : null}
                {group.cases.map((c) =>
                  editing && editing.id === c.id ? (
                    <EditRow
                      key={c.id}
                      c={c}
                      title={editing.title}
                      onTitle={onEditTitle}
                      onSave={onEditSave}
                      onCancel={onEditCancel}
                    />
                  ) : (
                    <Row
                      key={c.id}
                      c={c}
                      isSelected={selectedId === c.id}
                      isChecked={checked.has(c.id)}
                      isDragging={dragId === c.id}
                      dropSide={dropHint && dropHint.id === c.id ? dropHint.side : null}
                      onOpen={onOpen}
                      onToggleCheck={onToggleCheck}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      dragHandlers={dragHandlers}
                    />
                  ),
                )}
                <button type="button" className="td-tc-add" onClick={() => onCreate(group.path)}>
                  <span className="text-base font-semibold leading-none">+</span>
                  <span className="font-medium">Créer un cas de test</span>
                </button>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
