// Stepper de l'onboarding, affiché au-dessus des cartes plein page.
//
// Les trois étapes sont fixes : le compte existe déjà quand on arrive ici,
// l'organisation est créée sur `/onboarding`, puis les membres sont invités
// sur `/onboarding/members`.
//
// `current` est l'index (0-based) de l'étape active. Les étapes précédentes
// sont marquées comme terminées, les suivantes comme à venir.
import Icon from './Icon.jsx'

const STEPS = ['Compte', 'Organisation', 'Membre']

export default function OnboardingStepper({ current = 0, wide = false }) {
  return (
    <nav
      className={'td-onb-steps' + (wide ? ' td-onb-steps-wide' : '')}
      aria-label="Progression de la configuration"
    >
      <ol className="td-onb-steplist">
        {STEPS.map((label, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'todo'
          return (
            <li
              key={label}
              className={`td-onb-step is-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
              aria-label={state === 'done' ? `${label}, terminé` : label}
            >
              <span className="td-onb-step-marker" aria-hidden="true">
                {state === 'done' ? <Icon name="check" className="td-ic-14" /> : index + 1}
              </span>
              <span className="td-onb-step-label" aria-hidden="true">
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <span className="td-onb-step-line" aria-hidden="true" />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
