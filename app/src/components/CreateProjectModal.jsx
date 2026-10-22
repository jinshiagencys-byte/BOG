// Fenêtre de création et de modification d'un projet de la page /projects.
// Les paramètres de suivi sont enregistrés avec le projet.
import { useState } from 'react'
import { PROJECT_CATEGORIES } from '../app/projects.js'

export default function CreateProjectModal({ project, onClose, onSubmit }) {
  const editing = Boolean(project)
  const [name, setName] = useState(project ? project.name : '')
  const [category, setCategory] = useState(project ? project.category || '' : '')
  const [description, setDescription] = useState(project ? project.description : '')
  const [clientName, setClientName] = useState(project ? project.clientName || '' : '')
  const [url, setUrl] = useState(project ? project.url || '' : '')
  const [assignee, setAssignee] = useState(project ? project.assignee || '' : '')
  const [frequency, setFrequency] = useState(project ? project.frequency || '' : '')
  const [notificationFrequency, setNotificationFrequency] = useState(
    project ? project.notificationFrequency || '' : '',
  )
  const [error, setError] = useState('')

  const submit = () => {
    if (!name.trim()) {
      setError('Veuillez saisir un nom de projet.')
      return
    }
    if (!clientName.trim() || !url.trim() || !assignee.trim()) {
      setError('Veuillez renseigner le nom du client, l’URL et le responsable.')
      return
    }
    if (!category.trim()) {
      setError('Veuillez sélectionner une catégorie de site.')
      return
    }
    try {
      const parsedUrl = new URL(url.trim())
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error()
    } catch {
      setError('Veuillez saisir une URL HTTP ou HTTPS valide.')
      return
    }
    if (
      !Number.isInteger(Number(frequency)) ||
      Number(frequency) < 1 ||
      !Number.isInteger(Number(notificationFrequency)) ||
      Number(notificationFrequency) < 1
    ) {
      setError('Veuillez saisir un nombre entier positif pour chaque fréquence.')
      return
    }
    onSubmit({
      name: name.trim(),
      category,
      description: description.trim(),
      clientName: clientName.trim(),
      url: url.trim(),
      assignee: assignee.trim(),
      frequency: Number(frequency),
      notificationFrequency: Number(notificationFrequency),
    })
  }

  const updateField = (setter) => (event) => {
    setter(event.target.value)
    if (error) setError('')
  }

  return (
    <div
      className="td-modal"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Modifier le projet' : 'Créer un projet'}
    >
      <div className="td-modal-backdrop" onClick={onClose} />

      <div className="td-modal-box is-narrow">
        <div className="td-modal-head">
          <div>
            <h2>{editing ? 'Modifier le projet' : 'Créer un projet'}</h2>
          </div>
        </div>

        <div className="td-modal-body">
          <label className="td-field">
            <span className="td-field-label">
              Nom du projet <span className="td-req">*</span>
            </span>
            <input
              className="td-control"
              autoFocus
              placeholder="Ex. : Application web E2E"
              value={name}
              aria-invalid={!name.trim() && Boolean(error)}
              onChange={updateField(setName)}
            />
          </label>

          <div className="td-field-row">
            <label className="td-field">
              <span className="td-field-label">
                Catégorie <span className="td-req">*</span>
              </span>
              <select
                className="td-control"
                value={category}
                aria-invalid={!category.trim() && Boolean(error)}
                onChange={updateField(setCategory)}
              >
                <option value="">Sélectionner…</option>
                {PROJECT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="td-field">
              <span className="td-field-label">
                Nom du client <span className="td-req">*</span>
              </span>
              <input
                className="td-control"
                placeholder="Ex. : Acme"
                value={clientName}
                onChange={updateField(setClientName)}
              />
            </label>
          </div>

          <label className="td-field">
            <span className="td-field-label">
              URL <span className="td-req">*</span>
            </span>
            <input
              className="td-control"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={updateField(setUrl)}
            />
          </label>

          <label className="td-field">
            <span className="td-field-label">
              Responsable <span className="td-req">*</span>
            </span>
            <input
              className="td-control"
              placeholder="Ex. : Jean Dupont"
              value={assignee}
              onChange={updateField(setAssignee)}
            />
          </label>

          <div className="td-field-row">
            <label className="td-field">
              <span className="td-field-label">
                Fréquence de vérification (heures) <span className="td-req">*</span>
              </span>
              <input
                className="td-control"
                type="number"
                min="1"
                step="1"
                placeholder="Ex. : 24"
                value={frequency}
                onChange={updateField(setFrequency)}
              />
            </label>

            <label className="td-field">
              <span className="td-field-label">
                Fréquence de notification (heures) <span className="td-req">*</span>
              </span>
              <input
                className="td-control"
                type="number"
                min="1"
                step="1"
                placeholder="Ex. : 12"
                value={notificationFrequency}
                onChange={updateField(setNotificationFrequency)}
              />
            </label>
          </div>

          <label className="td-field">
            <span className="td-field-label">Description</span>
            <textarea
              className="td-control"
              rows={2}
              placeholder="Ex. : Tests de bout en bout du parcours de commande"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {error ? (
            <p className="text-[12.5px] text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="td-modal-foot">
          <button type="button" className="td-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="td-btn td-btn-primary" onClick={submit}>
            {editing ? 'Enregistrer les modifications' : 'Créer le projet'}
          </button>
        </div>
      </div>
    </div>
  )
}
