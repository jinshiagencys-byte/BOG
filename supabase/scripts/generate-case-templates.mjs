// Génère la migration de seed des modèles de cas de test à partir du pack
// utilisé par l'interface (app/src/data/casePacks.js).
//
// Utilisation :
//   node supabase/scripts/generate-case-templates.mjs
//
// Le fichier produit est volontairement autonome : il crée la table
// `case_templates` puis insère (ou met à jour) tous les cas par catégorie.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORY_CODES, buildCasePack } from '../../app/src/data/casePacks.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outDir = resolve(root, 'supabase/migrations')
const outFile = resolve(outDir, '20261022120100_v2_02_case_templates.sql')

const rows = []

for (const category of Object.keys(CATEGORY_CODES)) {
  const pack = buildCasePack(category)
  pack.cases.forEach((testCase, index) => {
    rows.push({
      category,
      code: testCase.id,
      suite: testCase.suite,
      position: index + 1,
      title: testCase.title,
      priority: testCase.priority,
      tags: testCase.tags,
      description: testCase.description,
      preconditions: testCase.preconditions,
      postconditions: testCase.postconditions,
      steps: testCase.steps.map((step, stepIndex) => ({
        code: `S${stepIndex + 1}`,
        action: step.action,
        expected: step.expected,
      })),
    })
  })
}

const payload = JSON.stringify(rows)

const sql = `-- ============================================================================
-- V2 — 02 — Modèles de cas de test par catégorie de site
--
-- Source : app/src/data/casePacks.js
-- Généré par : node supabase/scripts/generate-case-templates.mjs
--
-- Ne pas éditer à la main. Modifier le pack côté application puis régénérer.
-- ============================================================================

create table if not exists public.case_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  code text not null,
  suite text not null,
  position integer not null default 0,
  title text not null,
  priority text not null default 'medium'
    check (priority in ('critical', 'high', 'medium', 'low')),
  tags text[] not null default '{}'::text[],
  description text,
  preconditions text[] not null default '{}'::text[],
  postconditions text,
  steps jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_templates_category_code_key unique (category, code)
);

create index if not exists case_templates_category_idx
  on public.case_templates (category, position)
  where is_active;

drop trigger if exists trg_case_templates_updated_at on public.case_templates;
create trigger trg_case_templates_updated_at
  before update on public.case_templates
  for each row execute function public.touch_updated_at();

-- Seed idempotent : une ligne par (catégorie, code).
insert into public.case_templates (
  category, code, suite, position, title, priority, tags,
  description, preconditions, postconditions, steps
)
select
  x.category,
  x.code,
  x.suite,
  x.position,
  x.title,
  x.priority,
  coalesce(x.tags, '{}'::text[]),
  x.description,
  coalesce(x.preconditions, '{}'::text[]),
  x.postconditions,
  coalesce(x.steps, '[]'::jsonb)
from (select $json$${payload}$json$::jsonb as payload) d
cross join lateral jsonb_to_recordset(d.payload) as x(
  category text,
  code text,
  suite text,
  position integer,
  title text,
  priority text,
  tags text[],
  description text,
  preconditions text[],
  postconditions text,
  steps jsonb
)
on conflict (category, code) do update set
  suite = excluded.suite,
  position = excluded.position,
  title = excluded.title,
  priority = excluded.priority,
  tags = excluded.tags,
  description = excluded.description,
  preconditions = excluded.preconditions,
  postconditions = excluded.postconditions,
  steps = excluded.steps,
  is_active = true,
  updated_at = now();
`

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, sql, 'utf8')

const byCategory = rows.reduce((acc, row) => {
  acc[row.category] = (acc[row.category] || 0) + 1
  return acc
}, {})

console.log(`Écrit ${outFile}`)
console.log(`${rows.length} cas générés :`)
for (const [category, count] of Object.entries(byCategory)) {
  console.log(`  - ${category} : ${count}`)
}
