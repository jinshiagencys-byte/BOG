// Logo coccinelle de BOG.
//
// Dessiné en trait pour suivre la couleur du texte : blanc sur le thème sombre,
// noir sur le thème clair. Le corps, la ligne centrale, les points et la tête
// restent lisibles à 24 px comme à 32 px.
export default function BrandLogo({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        {/* Pattes */}
        <path d="M6.4 15.2 3 13.6M6 20.1 2.4 20.1M6.7 24.7 3.6 26.3" />
        <path d="M25.6 15.2 29 13.6M26 20.1 29.6 20.1M25.3 24.7 28.4 26.3" />
        {/* Antennes */}
        <path d="M13.7 4.4 11.2 1.9M18.3 4.4 20.8 1.9" />
        {/* Corps */}
        <ellipse cx="16" cy="20.2" rx="10" ry="10.4" />
        {/* Ligne des élytres */}
        <path d="M16 10.4v20.2" />
      </g>
      {/* Tête et points */}
      <circle cx="16" cy="6.8" r="3.5" fill="currentColor" />
      <circle cx="11.2" cy="16.5" r="1.55" fill="currentColor" />
      <circle cx="20.8" cy="16.5" r="1.55" fill="currentColor" />
      <circle cx="11.6" cy="23.2" r="1.55" fill="currentColor" />
      <circle cx="20.4" cy="23.2" r="1.55" fill="currentColor" />
    </svg>
  )
}
