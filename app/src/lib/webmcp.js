// WebMCP — pont expérimental entre BOG et les agents du navigateur.
//
// WebMCP permet à une page de déclarer des outils typés (nom, description,
// JSON Schema) qu’un agent peut découvrir et exécuter, au lieu de deviner
// l’interface à partir du DOM. L’API n’existe que dans les navigateurs qui
// l’implémentent (`document.modelContext`) : tout le reste de l’app continue
// de fonctionner normalement, sans aucun changement d’UI.
//
// Référence : https://developer.chrome.com/docs/ai/webmcp
export function webMcpSupported() {
  return (
    typeof document !== 'undefined' &&
    Boolean(document.modelContext) &&
    typeof document.modelContext.registerTool === 'function'
  )
}

// Enregistre une liste d’outils et renvoie la fonction de nettoyage.
// `AbortController` désenregistre les outils au démontage du composant, ce qui
// évite de laisser des outils obsolètes après un changement de page.
export function registerWebMcpTools(tools) {
  if (!webMcpSupported() || !tools.length) return () => {}

  const context = document.modelContext
  const controller = new AbortController()

  for (const tool of tools) {
    Promise.resolve()
      .then(() => context.registerTool(tool, { signal: controller.signal }))
      .catch((error) => {
        // Un doublon (StrictMode, remontage rapide) ne doit pas casser la page.
        console.warn(`[webmcp] outil « ${tool.name} » non enregistré`, error)
      })
  }

  return () => controller.abort()
}
