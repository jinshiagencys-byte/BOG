import Icon from '../components/Icon.jsx'

export default function PlaceholderView({ title }) {
  return (
    <>
      <div className="td-page-head">
        <h1>{title}</h1>
        <p>Cette vue n'est pas encore clonée. Les vues Test Runs, Test Cases et Dashboard sont disponibles.</p>
      </div>
      <div className="td-card-surface mt-4">
        <div className="td-empty">
          <Icon name="flask-conical" className="td-ic-20" />
          <span>À venir</span>
        </div>
      </div>
    </>
  )
}
