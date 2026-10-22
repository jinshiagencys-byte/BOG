/* ============================================================
   Packs de cas de test pré-générés par type de site.

   À la création d'un projet, l'utilisateur renseigne sa « Catégorie »
   (E-commerce, Site vitrine, Application web…). La vue « Cas de test »
   charge le pack correspondant : une exploration commune à tous les
   sites (navigation, liens, formulaires, responsive, SEO) + les parcours
   propres au type de site.

   Les trois premières suites de l'E-commerce reprennent exactement
   l'exemple fourni (TC-ECOM-001 → TC-ECOM-006).

   Les identifiants suivent le préfixe du type : TC-ECOM-001, TC-APP-001…
   ============================================================ */

export const CATEGORY_CODES = {
  'E-commerce': 'ECOM',
  'Site vitrine (statique)': 'SITE',
  'Application web': 'APP',
  'Blog / Média': 'BLOG',
  Portfolio: 'PORT',
  Autre: 'GEN',
}

// Exploration partagée par la plupart des sites : ajoutée après les parcours
// spécifiques pour que ceux-ci apparaissent en tête de la liste.
const COMMON = [
  {
    name: 'Navigation',
    cases: [
      'Vérifier que le menu principal affiche tous les liens attendus',
      'Vérifier qu’une page interne s’ouvre depuis le menu',
      'Vérifier que le logo ramène à la page d’accueil',
      'Vérifier que le fil d’Ariane reflète la page courante',
    ],
  },
  {
    name: 'Contenu et liens',
    cases: [
      'Vérifier que les liens internes ne renvoient aucune erreur 404',
      'Vérifier que les images se chargent correctement',
      'Vérifier que le pied de page contient les liens légaux',
      'Vérifier que les liens externes s’ouvrent dans un nouvel onglet',
    ],
  },
  {
    name: 'Formulaires',
    cases: [
      'Vérifier l’envoi d’un formulaire avec des données valides',
      'Vérifier les messages d’erreur lorsque les champs sont vides',
      'Vérifier qu’une double soumission ne crée pas de doublon',
    ],
  },
  {
    name: 'Responsive et affichage',
    cases: [
      'Vérifier l’affichage sur un écran mobile',
      'Vérifier l’affichage sur une tablette',
      'Vérifier la lisibilité avec un zoom à 200 %',
    ],
  },
  {
    name: 'Référencement et performance',
    cases: [
      'Vérifier le titre et la meta description de chaque page',
      'Vérifier que les pages principales se chargent en moins de 3 secondes',
    ],
  },
]

// Parcours spécifiques à chaque type de site.
const PACKS = {
  'E-commerce': [
    {
      name: 'Catalogue et recherche',
      cases: [
        'Vérifier que la recherche du header affiche des produits',
        'Vérifier qu’une page catégorie liste des produits',
      ],
    },
    {
      name: 'Fiche produit',
      cases: ['Vérifier l’affichage des informations et du stock d’un produit'],
    },
    {
      name: 'Panier et commande',
      cases: [
        'Vérifier l’ajout d’un produit au panier',
        'Vérifier la modification de la quantité dans le panier',
        'Vérifier le passage de commande jusqu’au paiement',
      ],
    },
    {
      name: 'Paiement et confirmation',
      cases: [
        'Vérifier le paiement avec une carte valide',
        'Vérifier le message d’erreur avec une carte refusée',
        'Vérifier l’envoi de l’e-mail de confirmation de commande',
        'Vérifier la génération de la facture téléchargeable',
      ],
    },
    {
      name: 'Compte client',
      cases: [
        'Vérifier la connexion avec un compte client existant',
        'Vérifier la création d’un compte client',
        'Vérifier l’affichage de l’historique des commandes',
        'Vérifier la gestion des adresses de livraison',
      ],
    },
    {
      name: 'Livraison et retours',
      cases: [
        'Vérifier le choix du mode de livraison',
        'Vérifier le suivi d’une commande expédiée',
        'Vérifier la demande de retour d’un produit',
      ],
    },
    {
      name: 'Promotions et codes',
      cases: [
        'Vérifier l’application d’un code promo valide',
        'Vérifier le refus d’un code promo expiré',
        'Vérifier l’affichage automatique des promotions',
      ],
    },
    {
      name: 'Filtres et tri',
      cases: [
        'Vérifier le filtrage par prix et disponibilité',
        'Vérifier le tri des produits par popularité',
        'Vérifier la pagination d’une liste de produits',
      ],
    },
    {
      name: 'Avis et favoris',
      cases: [
        'Vérifier la publication d’un avis produit',
        'Vérifier l’ajout et le retrait d’un produit des favoris',
      ],
    },
  ],
  'Site vitrine (statique)': [
    {
      name: 'Accueil et sections',
      cases: [
        'Vérifier que le hero et l’appel à l’action sont visibles',
        'Vérifier le fonctionnement du carrousel de présentation',
        'Vérifier l’affichage des témoignages clients',
      ],
    },
    {
      name: 'Pages institutionnelles',
      cases: [
        'Vérifier le contenu de la page « À propos »',
        'Vérifier la présentation des services proposés',
        'Vérifier l’affichage des mentions légales et de la politique de confidentialité',
      ],
    },
    {
      name: 'Services et offres',
      cases: [
        'Vérifier la liste des prestations et leurs tarifs',
        'Vérifier l’accès au détail d’une prestation',
        'Vérifier que les boutons de contact sont visibles sur chaque offre',
      ],
    },
    {
      name: 'Devis et contact',
      cases: [
        'Vérifier l’envoi d’une demande de devis',
        'Vérifier la validation des champs du formulaire de devis',
        'Vérifier que les coordonnées téléphone et e-mail sont cliquables',
      ],
    },
    {
      name: 'Réalisations et références',
      cases: [
        'Vérifier l’affichage de la galerie de réalisations',
        'Vérifier l’ouverture d’une étude de cas',
      ],
    },
    {
      name: 'Actualités',
      cases: [
        'Vérifier la liste des actualités',
        'Vérifier l’ouverture d’un article depuis la page d’accueil',
      ],
    },
    {
      name: 'Réseaux sociaux',
      cases: [
        'Vérifier que les liens vers les réseaux sociaux sont valides',
        'Vérifier l’ouverture des liens dans un nouvel onglet',
      ],
    },
    {
      name: 'Prise de rendez-vous',
      cases: [
        'Vérifier la sélection d’un créneau disponible',
        'Vérifier la confirmation d’un rendez-vous',
      ],
    },
  ],
  'Application web': [
    {
      name: 'Authentification',
      cases: [
        'Vérifier la connexion avec des identifiants valides',
        'Vérifier le message d’erreur avec un mot de passe incorrect',
        'Vérifier le parcours de mot de passe oublié',
        'Vérifier la déconnexion et l’expiration de la session',
      ],
    },
    {
      name: 'Tableau de bord',
      cases: [
        'Vérifier l’affichage des indicateurs principaux',
        'Vérifier le filtrage des données par période',
        'Vérifier la navigation depuis les cartes du tableau de bord',
        'Vérifier l’état vide lorsqu’aucune donnée n’est disponible',
      ],
    },
    {
      name: 'Gestion des données',
      cases: [
        'Vérifier la création d’un nouvel élément',
        'Vérifier la modification d’un élément existant',
        'Vérifier la suppression avec demande de confirmation',
        'Vérifier la sélection multiple et les actions groupées',
        'Vérifier l’import et l’export des données',
      ],
    },
    {
      name: 'Paramètres du compte',
      cases: [
        'Vérifier la mise à jour des informations du profil',
        'Vérifier le changement de mot de passe',
        'Vérifier l’enregistrement des préférences de notification',
        'Vérifier la mise à jour de l’adresse e-mail avec confirmation',
      ],
    },
    {
      name: 'Rôles et permissions',
      cases: [
        'Vérifier l’accès administrateur aux écrans sensibles',
        'Vérifier qu’un utilisateur standard ne voit pas les actions d’administration',
        'Vérifier l’invitation d’un nouveau membre avec un rôle',
      ],
    },
    {
      name: 'Notifications',
      cases: [
        'Vérifier l’affichage des notifications non lues',
        'Vérifier le marquage d’une notification comme lue',
        'Vérifier la réception d’un e-mail de notification',
      ],
    },
    {
      name: 'Recherche et filtres',
      cases: [
        'Vérifier une recherche avec résultats',
        'Vérifier une recherche sans résultat',
        'Vérifier la combinaison de plusieurs filtres',
      ],
    },
    {
      name: 'Gestion des erreurs',
      cases: [
        'Vérifier l’affichage d’une page 404 personnalisée',
        'Vérifier la reprise après une erreur réseau',
      ],
    },
  ],
  'Blog / Média': [
    {
      name: 'Articles',
      cases: [
        'Vérifier l’ouverture d’un article depuis la page d’accueil',
        'Vérifier le sommaire et les ancres de l’article',
        'Vérifier l’affichage des images et légendes',
        'Vérifier le partage d’un article sur les réseaux sociaux',
      ],
    },
    {
      name: 'Catégories et tags',
      cases: [
        'Vérifier qu’une catégorie liste ses articles',
        'Vérifier qu’un tag regroupe les articles associés',
        'Vérifier la navigation dans les archives par date',
      ],
    },
    {
      name: 'Recherche',
      cases: [
        'Vérifier que la recherche retourne des articles pertinents',
        'Vérifier la recherche par auteur',
        'Vérifier l’état vide d’une recherche sans résultat',
      ],
    },
    {
      name: 'Newsletter',
      cases: [
        'Vérifier l’inscription à la newsletter',
        'Vérifier la validation de l’adresse e-mail',
        'Vérifier le lien de désinscription',
      ],
    },
    {
      name: 'Commentaires',
      cases: [
        'Vérifier la publication d’un commentaire',
        'Vérifier la modération d’un commentaire signalé',
        'Vérifier le message d’erreur pour un commentaire vide',
      ],
    },
    {
      name: 'Auteurs',
      cases: [
        'Vérifier la page profil d’un auteur',
        'Vérifier la liste des articles d’un auteur',
      ],
    },
    {
      name: 'Flux et partage',
      cases: [
        'Vérifier le flux RSS',
        'Vérifier les boutons de partage en bas d’article',
      ],
    },
    {
      name: 'SEO et archives',
      cases: [
        'Vérifier les balises Open Graph d’un article',
        'Vérifier la pagination des archives',
      ],
    },
  ],
  Portfolio: [
    {
      name: 'Projets',
      cases: [
        'Vérifier l’affichage de la grille de projets',
        'Vérifier l’ouverture de la fiche d’un projet',
        'Vérifier le filtrage des projets par catégorie',
        'Vérifier l’affichage des miniatures et de leurs légendes',
      ],
    },
    {
      name: 'Fiche projet',
      cases: [
        'Vérifier la galerie d’images du projet',
        'Vérifier la navigation vers le projet suivant',
        'Vérifier le lien vers le site du projet',
      ],
    },
    {
      name: 'À propos et CV',
      cases: [
        'Vérifier le contenu de la page « À propos »',
        'Vérifier le téléchargement du CV',
        'Vérifier la section expérience et compétences',
      ],
    },
    {
      name: 'Contact',
      cases: [
        'Vérifier l’envoi du formulaire de contact',
        'Vérifier la validation des champs obligatoires',
        'Vérifier que l’adresse e-mail est cliquable',
      ],
    },
    {
      name: 'Services',
      cases: [
        'Vérifier la présentation des services proposés',
        'Vérifier l’appel à l’action depuis une page service',
      ],
    },
    {
      name: 'Réseaux sociaux',
      cases: [
        'Vérifier que les liens vers les réseaux sociaux sont valides',
        'Vérifier l’ouverture des liens dans un nouvel onglet',
      ],
    },
    {
      name: 'Actualités',
      cases: [
        'Vérifier la liste des actualités',
        'Vérifier l’ouverture d’une actualité',
      ],
    },
  ],
  Autre: [
    {
      name: 'Pages principales',
      cases: [
        'Vérifier que la page d’accueil présente le contenu attendu',
        'Vérifier l’accès aux pages principales depuis le menu',
        'Vérifier que les appels à l’action sont cliquables',
        'Vérifier l’affichage du pied de page',
      ],
    },
    {
      name: 'Recherche et filtres',
      cases: [
        'Vérifier qu’une recherche retourne des résultats',
        'Vérifier une recherche sans résultat',
        'Vérifier le fonctionnement des filtres disponibles',
      ],
    },
    {
      name: 'Formulaires',
      cases: [
        'Vérifier l’envoi d’un formulaire valide',
        'Vérifier les erreurs de validation',
        'Vérifier la protection contre les doubles soumissions',
      ],
    },
    {
      name: 'Compte et préférences',
      cases: [
        'Vérifier la connexion avec un compte existant',
        'Vérifier la mise à jour des préférences',
        'Vérifier la déconnexion',
      ],
    },
    {
      name: 'Navigation avancée',
      cases: [
        'Vérifier les liens du menu secondaire',
        'Vérifier le retour à l’accueil depuis une page interne',
        'Vérifier le comportement du bouton retour du navigateur',
      ],
    },
    {
      name: 'Contenus dynamiques',
      cases: [
        'Vérifier le chargement des contenus depuis l’API',
        'Vérifier l’état de chargement et les erreurs réseau',
      ],
    },
  ],
}

const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const describe = (title) => `Vérifie ${title.replace(/^Vérifier\s+/i, '')}.`

const stepsFor = (title, suite) => [
  {
    action: `Ouvrir la section « ${suite} »`,
    expected: 'La page se charge et les éléments attendus sont visibles.',
  },
  {
    action: title,
    expected: 'Le comportement attendu est observé, sans message d’erreur.',
  },
  {
    action: 'Recharger la page et répéter le parcours',
    expected: 'Le résultat reste identique et l’état est conservé.',
  },
]

/**
 * Construit le pack de cas de test d'un type de site.
 * @param {string} category valeur du champ « Catégorie » du projet
 * @returns {{ code: string, suites: {id: string, name: string, count: number}[],
 *             cases: object[], total: number }}
 */
export function buildCasePack(category) {
  const code = CATEGORY_CODES[category] || CATEGORY_CODES.Autre
  const blueprints = PACKS[category] || PACKS.Autre
  const groups = [...blueprints, ...COMMON]

  const suites = []
  const cases = []
  let n = 0

  for (const group of groups) {
    suites.push({
      id: `s_${code.toLowerCase()}_${slug(group.name)}`,
      name: group.name,
      count: group.cases.length,
    })

    for (const title of group.cases) {
      n += 1
      cases.push({
        id: `TC-${code}-${String(n).padStart(3, '0')}`,
        title,
        suite: group.name,
        suitePath: [group.name],
        status: 'active',
        priority: ['high', 'medium', 'low'][n % 3],
        tags: ['@e2e', `@${code.toLowerCase()}`],
        updatedAt: '2026-10-21',
        description: describe(title),
        preconditions: [
          'Le site est accessible',
          `La section « ${group.name} » est disponible`,
        ],
        postconditions:
          'Le parcours fonctionne comme attendu, sans erreur ni régression.',
        steps: stepsFor(title, group.name),
      })
    }
  }

  return { code, suites, cases, total: cases.length }
}
