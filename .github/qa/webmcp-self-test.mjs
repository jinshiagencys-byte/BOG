#!/usr/bin/env node
/**
 * Auto-test du serveur MCP WebMCP — sans Playwright, sans LLM, sans secret.
 *
 * Il démarre le serveur `.github/qa/webmcp-mcp-server.mjs` (qui lance son propre
 * Chrome, ou se branche sur `WEBMCP_CDP_URL` s'il est fourni), lui parle en
 * JSON-RPC comme le ferait Antigravity, et vérifie chaque comportement attendu
 * sur la page `.github/qa/fixtures/webmcp-demo.html` servie localement.
 *
 * Le script sort en code 1 dès qu'une assertion échoue : il sert d'étape de
 * validation en CI.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, 'webmcp-mcp-server.mjs')
const FIXTURES = join(HERE, 'fixtures')

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  console.error(`Node ${process.versions.node} : le WebSocket global exige Node >= 22.`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Serveur statique pour la page de démonstration

function serveFixtures(directory) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const relative = pathname === '/' ? 'webmcp-demo.html' : pathname.replace(/^\/+/, '')
      const file = join(directory, relative)
      if (!file.startsWith(directory) || !existsSync(file)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('introuvable')
        return
      }
      response.writeHead(200, {
        'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream',
        'cache-control': 'no-store',
      })
      response.end(readFileSync(file))
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ---------------------------------------------------------------------------
// Client MCP (stdio)

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WEBMCP_HEADLESS: process.env.WEBMCP_HEADLESS ?? 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) console.error(`  [serveur] ${line}`)
  })

  let buffer = ''
  let nextId = 1
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let boundary
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const entry = message.id !== undefined ? pending.get(message.id) : null
      if (entry) {
        pending.delete(message.id)
        clearTimeout(entry.timer)
        entry.resolve(message)
      }
    }
  })

  const request = (method, params, timeoutMs = 90000) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`délai dépassé : ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

  const notify = (method, params) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)

  return { child, request, notify }
}

const textOf = (response) => response?.result?.content?.[0]?.text ?? ''
const parseText = (response) => {
  const text = textOf(response)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ---------------------------------------------------------------------------
// Assertions

const failures = []
let passed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const { server, port } = await serveFixtures(FIXTURES)
  const target = `http://127.0.0.1:${port}/webmcp-demo.html`
  const { child, request, notify } = startServer()

  const shutdown = () => {
    try {
      child.stdin.end()
    } catch {
      // Déjà fermé.
    }
    try {
      child.kill('SIGKILL')
    } catch {
      // Déjà sorti.
    }
    server.close()
  }

  try {
    console.log(`Cible : ${target}`)

    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'webmcp-self-test', version: '1.0' },
    })
    notify('notifications/initialized', {})
    check('initialize répond un serveur webmcp', init?.result?.serverInfo?.name === 'webmcp')

    const toolsList = await request('tools/list', {})
    const toolNames = (toolsList?.result?.tools ?? []).map((tool) => tool.name)
    check(
      'tools/list expose les 4 outils MCP',
      ['webmcp_open', 'webmcp_list_tools', 'webmcp_call_tool', 'webmcp_read_page'].every((name) =>
        toolNames.includes(name),
      ),
      toolNames.join(', '),
    )

    console.log('\n— Ouverture de la page instrumentée —')
    const open = parseText(await request('tools/call', { name: 'webmcp_open', arguments: { url: target } }))
    check('webmcp_open atteint la page', open?.url === target, open?.url)
    check('la page expose WebMCP', open?.webmcpAvailable === true, open?.reason ?? '')
    const pageTools = (open?.tools ?? []).map((tool) => tool.name).sort()
    check(
      'les 3 outils de démonstration sont découverts',
      JSON.stringify(pageTools) === JSON.stringify(['demo_add', 'demo_echo', 'demo_set_status']),
      pageTools.join(', '),
    )

    console.log('\n— Lecture seule —')
    const add = parseText(
      await request('tools/call', { name: 'webmcp_call_tool', arguments: { tool: 'demo_add', arguments: { a: 40, b: 2 } } }),
    )
    let addSum = null
    try {
      addSum = JSON.parse(add?.result)?.sum
    } catch {
      addSum = null
    }
    check('demo_add renvoie la somme (40 + 2 = 42)', add?.ok === true && addSum === 42, `ok=${add?.ok} sum=${addSum}`)

    console.log('\n— Mutation avec confirmation acceptée —')
    const accepted = parseText(
      await request('tools/call', {
        name: 'webmcp_call_tool',
        arguments: { tool: 'demo_set_status', arguments: { status: 'actif' }, confirm: true },
      }),
    )
    check('demo_set_status (confirm=true) réussit', accepted?.ok === true, accepted?.error ?? '')
    check('la confirmation visible a été acceptée', accepted?.dialog?.accepted === true, JSON.stringify(accepted?.dialog))

    console.log('\n— Mutation avec confirmation refusée (défaut) —')
    const refused = parseText(
      await request('tools/call', {
        name: 'webmcp_call_tool',
        arguments: { tool: 'demo_set_status', arguments: { status: 'inactif' } },
      }),
    )
    let refusedCancelled = false
    try {
      refusedCancelled = JSON.parse(refused?.result)?.cancelled === true
    } catch {
      refusedCancelled = false
    }
    check('sans confirm, la mutation est annulée', refusedCancelled, JSON.stringify(refused?.result))
    check('la confirmation visible a été refusée', refused?.dialog?.accepted === false, JSON.stringify(refused?.dialog))

    console.log('\n— Vérification de visibilité après défilement —')
    const read = parseText(
      await request('tools/call', {
        name: 'webmcp_read_page',
        arguments: { expected: ['3 outils WebMCP enregistrés', 'Statut : actif', 'ce-texte-nexiste-pas-xyz'] },
      }),
    )
    const checks = Array.isArray(read?.visible) ? read.visible : []
    const byPattern = Object.fromEntries(checks.map((entry) => [entry.pattern, entry]))
    check('le journal WebMCP est visible', byPattern['3 outils WebMCP enregistrés']?.visible === true, JSON.stringify(byPattern['3 outils WebMCP enregistrés']))
    check('le statut muté « actif » est visible', byPattern['Statut : actif']?.visible === true, JSON.stringify(byPattern['Statut : actif']))
    check(
      'un texte absent n’est pas signalé visible',
      byPattern['ce-texte-nexiste-pas-xyz']?.found === 0 && byPattern['ce-texte-nexiste-pas-xyz']?.visible === false,
      JSON.stringify(byPattern['ce-texte-nexiste-pas-xyz']),
    )

    console.log('\n— Outil inexistant —')
    const missing = await request('tools/call', { name: 'webmcp_call_tool', arguments: { tool: 'demo_absent' } })
    check('un outil absent renvoie une erreur MCP', missing?.result?.isError === true, JSON.stringify(parseText(missing)))

    console.log('\n— Outil MCP inexistant —')
    const unknown = await request('tools/call', { name: 'outil_inconnu', arguments: {} })
    check('un outil MCP inconnu renvoie une erreur', unknown?.result?.isError === true)
  } finally {
    shutdown()
  }
}

await main()

console.log(`\n${passed} vérification(s) réussie(s), ${failures.length} échec(s).`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}
console.log('✅ Auto-test WebMCP réussi.')
process.exit(0)
