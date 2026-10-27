# BOG — application React

Application QA BOG, branchée sur Supabase pour l’authentification,
les organisations, les projets, les cas de test et les exécutions. L’interface produit est
en français ; les écrans d’authentification sont en anglais.

## Routes

| Route | Écran |
| --- | --- |
| `/auth`, `/auth/signup`, `/auth/reset`, `/auth/callback` | Connexion, création de compte, mot de passe oublié, retour OAuth |
| `/onboarding` | Création de l’organisation (plein page, hors shell) |
| `/onboarding/members` | Rôle du créateur et invitation des premiers membres après la création de l’organisation |
| `/projects` | Espace organisation : projets, plan, état de l’intégration GitHub |
| `/org-settings` | Intégration GitHub de l’organisation (dépôt, workflow, branche, installation) |
| `/:project/dashboard` | Tableau de bord réel du projet |
| `/:project/test-runs` | Exécutions de tests et tiroir de résultats |
| `/:project/test-cases` | Catalogue de cas, suites, étapes, sélection et déclenchement |
| `/:project/settings` | Informations du projet et état de la liaison GitHub |
| `/DemoProject/...` | Jeu de démonstration statique, consultable sans compte |

Les anciennes URLs à plat (`/dashboard`, `/test-runs`, …) redirigent vers `/projects`.
Un projet réel exige une session ; `DemoProject` court-circuite toutes les requêtes
Supabase et ne montre que les données statiques de `src/data/`.

## Lancer

```bash
cd app
npm install
npm run dev      # http://localhost:5173
```

Créer `app/.env.local` :

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Autres scripts : `npm run build`, `npm run preview`, `npm run lint`.

## Authentification

- **Email + mot de passe** : inscription, connexion, confirmation d’email et mot de passe
  oublié. La confirmation d’email est activée côté Supabase.
- **Google** : le bouton « Continue with Google » utilise le provider Google de Supabase et
  revient sur `/auth/callback`. Un refus Google est réaffiché sur l’écran de connexion.
- Le client OAuth Google doit autoriser
  `https://<project-ref>.supabase.co/auth/v1/callback`. Les origines de l’app
  (`http://localhost:5173`, URL de production) doivent figurer dans les redirect URLs
  Supabase.
- Aucun secret OAuth n’est stocké dans le dépôt : le Client ID et le Client Secret vivent
  dans la configuration Auth Supabase.

## Stack

- **React 19** + **Vite 8**
- **Tailwind CSS v4** + composants CSS du clone dans `src/styles/components.css`
- **react-router-dom 7**
- **@supabase/supabase-js 2** (auth, PostgREST, Edge Functions)
- **lucide-react** pour les icônes
- **recharts 3.5.1** pour la courbe Pass / Fail du dashboard

## Structure

```text
app/src/
├── app/
│   ├── auth-context.jsx      # session, organisations, signIn/signUp/signOut
│   ├── context.jsx           # AppProvider : org active, projets, GitHub, runs, thème
│   ├── project-context.jsx   # projet courant (réel ou DemoProject)
│   ├── guards.jsx            # RequireAuth, RequireOrg, ProjectGate, AuthCallback
│   ├── nav.js                # navigation projet et organisation
│   └── projects.js           # constantes de démonstration et catégories
├── lib/
│   ├── supabase.js           # client anon (la clé privée GitHub n’est jamais ici)
│   ├── api.js                # requêtes PostgREST, RPC, Edge Functions
│   └── mappers.js            # snake_case Supabase → formes UI
├── views/
│   ├── DashboardView.jsx     # KPI et courbe réels, ou données de démo
│   ├── TestRunsView.jsx      # liste, filtres, pagination, acquittement
│   ├── TestCasesView.jsx     # catalogue, CRUD, drag & drop, start-run
│   ├── ProjectsView.jsx      # cartes projet, création, édition, suppression
│   ├── GithubSettingsView.jsx
│   ├── ProjectSettingsView.jsx
│   ├── AuthView.jsx
│   ├── OnboardingView.jsx
│   ├── OnboardingMembersView.jsx
│   └── ResetPasswordView.jsx
├── components/
│   ├── OnboardingStepper.jsx # progression Compte → Organisation → Membre
│   ├── RunDrawer.jsx         # résultats réels, preuves, étapes, GitHub
│   ├── CommandPalette.jsx    # recherche de runs réels (Ctrl+K)
│   ├── Skeleton.jsx          # états de chargement
│   ├── UserMenu.jsx          # identité Supabase + déconnexion
│   └── testcases/            # arbre de suites, table groupée, tiroir de cas
└── data/                     # jeu de démonstration et référentiels statiques
```

## Branchement Supabase

- **Authentification** : `supabase.auth` avec persistance de session. Les erreurs Supabase
  sont traduites en messages anglais sur les écrans d’auth. Un utilisateur sans organisation
  est envoyé vers `/onboarding`.
- **Organisations** : `organizations` + `organization_members`. L’organisation active est
  mémorisée dans `localStorage` (`td-active-org`) ; l’id `demo` désigne la démonstration.
  Rôles `owner`, `admin`, `member`. L’onboarding affiche un stepper
  `Compte → Organisation → Membre` : l’étape Organisation correspond à `/onboarding`,
  l’étape Membre à `/onboarding/members`.
- **Projets** : lignes `sites` filtrées par `org_id` et RLS, enrichies du plan actif et du
  nombre de cas (`listProjectsWithStats`). La création passe par la RPC atomique
  `create_project_with_cases` : le serveur crée le projet, son plan v1 et copie les cas et
  étapes du pack correspondant à la catégorie. Le client n’envoie jamais de cas à GitHub.
- **Cas de test** : `test_plans` + `test_cases` + `test_steps`. Les identifiants d’API sont
  les UUID ; les codes `TC-*` ne servent qu’à l’affichage. Les étapes sont réconciliées par
  `syncCaseSteps` pour préserver les résultats historiques.
- **Exécutions** : `test_runs`, `test_case_results`, `test_step_results`. L’UI lit toujours
  Supabase, jamais l’API GitHub. Les statuts `blocked` / `skipped` restent en base mais les
  runs n’affichent que Réussi / Échoué. Les runs `queued` / `in_progress` sont affichés
  « En cours ».
- **GitHub** : l’intégration est au niveau de l’organisation (`github_integrations`). Le
  bouton « Déclencher » appelle l’Edge Function `start-run`, qui crée le manifeste, obtient
  un token d’installation GitHub App et lance le workflow. La clé privée reste dans les
  secrets Supabase.
- **Démo** : `DemoProject` et les données de `src/data/` sont totalement isolés. Aucun run,
  cas ou KPI d’exemple n’est injecté dans un projet réel.

## Démonstration

- Les 50 runs, les KPI et le graphe d’exemple viennent de `src/data/`.
- Le catalogue de démonstration est généré localement par `buildCasePack(category)`.
- La sélection + « Déclencher » simule 10 s de traitement, sans appel Supabase.
- L’acquittement de démo est conservé dans `sessionStorage` (`td-acked-runs`).

## Vérifications

```bash
npm run lint
npm run build
```

Le build produit un avertissement de taille de bundle (recharts + supabase-js). Il ne bloque
pas le déploiement ; un `React.lazy` sur le dashboard et les vues lourdes est la prochaine
optimisation naturelle.

## Limites connues

- **Authentification** : Google OAuth est configuré côté Supabase ; le bouton SSO a été
  retiré. La confirmation d’email reste obligatoire.
- **Rôles** : le rôle du créateur (`owner`, `admin` ou `member`) est choisi sur
  `/onboarding/members`, avec les invitations, puis enregistré dans
  `organization_members` via `set_my_organization_role`.
- **Équipe** : `/users` (« Utilisateurs et rôles ») liste les membres actifs et les
  invitations en attente, permet d’inviter, de changer un rôle, de retirer un membre
  et de révoquer une invitation. Les mutations passent par
  `update_organization_member_role`, `remove_organization_member` et
  `revoke_organization_invitation` : un admin gère les membres, seul un owner peut
  nommer un owner, et le dernier propriétaire ne peut pas être retiré.
- **Invitations** : après la création de l’organisation, `/onboarding/members` permet
  d’ajouter plusieurs membres en une fois (bouton « Ajouter une ligne »), avec un
  rôle par ligne. Chaque adresse reçoit un email d’invitation ; l’adhésion n’est
  créée qu’à la première authentification de la personne dans l’app, qui vaut
  acceptation. L’envoi passe par un SMTP Brevo configuré côté Supabase (limite
  applicative : 30 emails/heure ; offre Brevo gratuite : 300 emails/jour).
- La taille d’équipe choisie à l’onboarding n’est pas persistée (choix produit).
- Les pages « Analyses » et « Facturation » restent des écrans d’attente.
- L’export des cas de test affiche une confirmation mais ne génère pas encore de fichier.
- L’intégration GitHub est unique par organisation : tous ses projets partagent le même
  dépôt, workflow et branche.
