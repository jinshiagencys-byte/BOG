// Configure le SMTP personnalisé de Supabase Auth et les emails d'invitation.
//
// Supabase refuse de modifier `rate_limit_email_sent` et les modèles d'email
// tant que le projet utilise son fournisseur gratuit par défaut. Ce script
// envoie donc le SMTP et les modèles dans le même PATCH.
//
// Variables lues dans `supabase/.env.local` (ou l'environnement) :
//   SUPABASE_ACCESS_TOKEN   (obligatoire, déjà présent)
//   SUPABASE_PROJECT_REF    (obligatoire, déjà présent)
//   SMTP_HOST               ex. smtp-relay.brevo.com
//   SMTP_PORT               ex. 587
//   SMTP_USER               identifiant SMTP du fournisseur
//   SMTP_PASS               clé SMTP / mot de passe du fournisseur
//   SMTP_ADMIN_EMAIL        adresse expéditrice vérifiée
//   SMTP_SENDER_NAME        ex. BOG
//   EMAIL_RATE_LIMIT        ex. 30 (facultatif, défaut 30)
//
// Utilisation :
//   node supabase/scripts/configure-smtp.mjs
//
// Le script n'affiche jamais SMTP_PASS.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      }),
  )
}

const env = {
  ...readEnvFile(resolve(ROOT, 'supabase', '.env.local')),
  ...process.env,
}

function required(name) {
  const value = env[name]
  if (!value) {
    console.error(`Variable manquante : ${name}`)
    process.exit(1)
  }
  return value
}

const token = required('SUPABASE_ACCESS_TOKEN')
const projectRef = required('SUPABASE_PROJECT_REF')
const smtpHost = required('SMTP_HOST')
const smtpPort = Number(required('SMTP_PORT'))
const smtpUser = required('SMTP_USER')
const smtpPass = required('SMTP_PASS')
const adminEmail = required('SMTP_ADMIN_EMAIL')
const senderName = env.SMTP_SENDER_NAME || 'BOG'
const rateLimit = Number(env.EMAIL_RATE_LIMIT || 30)

if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
  console.error('SMTP_PORT doit être un entier positif.')
  process.exit(1)
}

const inviteContent = [
  '<h2>Join your team on BOG</h2>',
  '',
  '<p>You’ve been invited to join <strong>{{ .Data.org_name }}</strong> on BOG.</p>',
  '<p><a href="{{ .ConfirmationURL }}">Accept invitation</a></p>',
  '',
  '<p>Your invitation is confirmed the first time you sign in to BOG.</p>',
].join('\n')

const magicLinkContent = [
  '<h2>Your BOG invitation</h2>',
  '',
  '<p>You’ve been invited to join <strong>{{ .Data.org_name }}</strong> on BOG.</p>',
  '<p><a href="{{ .ConfirmationURL }}">Accept invitation and sign in</a></p>',
  '',
  '<p>Your invitation is confirmed the first time you sign in to BOG.</p>',
].join('\n')

const body = {
  smtp_host: smtpHost,
  smtp_port: smtpPort,
  smtp_user: smtpUser,
  smtp_pass: smtpPass,
  smtp_admin_email: adminEmail,
  smtp_sender_name: senderName,
  rate_limit_email_sent: rateLimit,
  mailer_subjects_invite: 'You’ve been invited to BOG',
  mailer_templates_invite_content: inviteContent,
  mailer_subjects_magic_link: 'Your BOG invitation',
  mailer_templates_magic_link_content: magicLinkContent,
}

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  },
)

const text = await response.text()
if (!response.ok) {
  console.error(`Échec (${response.status}) : ${text.slice(0, 800)}`)
  process.exit(1)
}

console.log('SMTP configuré.')
console.log(`- hôte : ${smtpHost}:${smtpPort}`)
console.log(`- expéditeur : ${senderName} <${adminEmail}>`)
console.log(`- limite d'emails : ${rateLimit}/heure`)
console.log('Les modèles d’invitation BOG ont été appliqués.')
