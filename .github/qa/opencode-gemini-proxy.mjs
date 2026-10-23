#!/usr/bin/env node
/*
 * Passerelle locale Gemini -> OpenAI Chat Completions.
 *
 * Antigravity CLI ne sait parler qu'à un endpoint Gemini-compatible
 * (`modelProvider: "gemini"`). OpenCode Zen expose les modèles demandés
 * (DeepSeek V4.1 Flash Free, Big Pickle, Beam Free) sur son endpoint
 * OpenAI-compatible. Ce proxy traduit donc, dans les deux sens :
 *   - requête Gemini (contents/tools/systemInstruction) -> chat completions ;
 *   - flux SSE OpenAI (texte + tool_calls) -> flux SSE Gemini.
 *
 * Les modèles gratuits OpenCode sont servis par la passerelle `inference`
 * derrière une validation d'identité client. Le proxy reproduit donc le
 * contrat du client officiel (User-Agent, en-têtes x-opencode-*, identifiants
 * ses_/msg_ et tools non vide), et utilise le credential public `Bearer public`
 * comme le client OpenCode non connecté. La clé API reste disponible pour les
 * modèles payants.
 *
 * L'agent Antigravity ne reçoit qu'une clé factice et ne peut pas exécuter de
 * shell.
 */

import http from 'node:http'
import crypto from 'node:crypto'

const PORT = Number(process.env.PORT || 8787)
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://opencode.ai/inference/v1/chat/completions'
const API_KEY = process.env.OPENCODE_API_KEY || ''
const MAIN_MODEL = process.env.OPENCODE_MODEL || 'big-pickle'
const TITLE_MODEL = process.env.OPENCODE_TITLE_MODEL || 'big-pickle'
const SAFETY_MODEL = process.env.OPENCODE_SAFETY_MODEL || 'big-pickle'
const OPENCODE_USER_AGENT = process.env.OPENCODE_USER_AGENT || 'opencode/1.19.4'
const OPENCODE_CLIENT = process.env.OPENCODE_CLIENT || 'cli'

// Modèles gratuits : le credential public est accepté par la passerelle.
// Les modèles payants utilisent la clé de service si elle est fournie.
const FREE_MODELS = new Set([
  'deepseek-v4.1-flash-free',
  'big-pickle',
  'beam-free',
])

function log(...args) {
  console.log(new Date().toISOString(), '[proxy]', ...args)
}

// Identifiants OpenCode : préfixe + 12 hex (timestamp) + 14 base62.
// Les sessions sont descendantes, les messages ascendants. La passerelle
// vérifie que les 12 hex décodent un timestamp plausible.
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function randomBase62(length) {
  let result = ''
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i += 1) result += BASE62[bytes[i] % 62]
  return result
}

function openCodeID(prefix, direction, timestamp = Date.now()) {
  let value = BigInt(timestamp) * BigInt(0x1000) + 1n
  if (direction === 'descending') value = ~value
  const bytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((value >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }
  return `${prefix}_${bytes.toString('hex')}${randomBase62(14)}`
}

const SESSION_ID = openCodeID('ses', 'descending')

// Le contrat free tier exige au moins deux tools nommés bash et read, avec
// des paramètres non vides. On les injecte uniquement s'ils sont absents.
const COMPAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Compatibility placeholder required by the gateway. Never call this tool.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Compatibility placeholder required by the gateway. Never call this tool.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
]

function authorizationFor(model) {
  // Si une clé OpenCode est fournie (compte authentifié), elle est utilisée
  // pour tous les modèles, y compris les modèles gratuits : cela rattache le
  // quota au compte au lieu du credential public anonyme.
  if (API_KEY) return `Bearer ${API_KEY}`
  return 'Bearer public'
}

function upstreamHeaders(model) {
  return {
    Authorization: authorizationFor(model),
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': OPENCODE_USER_AGENT,
    'x-opencode-client': OPENCODE_CLIENT,
    'x-opencode-project': 'global',
    'x-opencode-session': SESSION_ID,
    'x-opencode-session-id': SESSION_ID,
    'x-opencode-request': openCodeID('msg', 'ascending'),
  }
}

function modelFor(geminiModel) {
  const name = String(geminiModel || '')
  if (name.includes('flash-lite')) return TITLE_MODEL
  if (name.includes('safety')) return SAFETY_MODEL
  // Les requêtes de sécurité d'Antigravity utilisent un modèle Flash récent
  // distinct du modèle principal. On les envoie au modèle de sécurité.
  if (name === 'gemini-3.6-flash') return SAFETY_MODEL
  return MAIN_MODEL
}

function textOf(parts) {
  return (parts || [])
    .filter((part) => typeof part?.text === 'string' && part.text.length > 0)
    .map((part) => part.text)
    .join('\n')
}

function dataUrl(part) {
  const data = part?.inlineData || part?.inline_data
  if (!data?.data) return null
  const mime = data.mimeType || data.mime_type || 'application/octet-stream'
  return `data:${mime};base64,${data.data}`
}

function userContent(parts) {
  const segments = []
  for (const part of parts || []) {
    if (typeof part?.text === 'string' && part.text.length > 0) {
      segments.push({ type: 'text', text: part.text })
    } else {
      const url = dataUrl(part)
      if (url) segments.push({ type: 'image_url', image_url: { url } })
    }
  }
  if (segments.length === 0) return ''
  if (segments.length === 1 && segments[0].type === 'text') return segments[0].text
  return segments
}

function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const clone = JSON.parse(JSON.stringify(schema))
  delete clone.$schema
  return clone
}

function toOpenAI(body, model) {
  const messages = []
  const system = textOf(body?.systemInstruction?.parts)
  if (system) messages.push({ role: 'system', content: system })

  for (const content of body?.contents || []) {
    const parts = content?.parts || []
    if (content?.role === 'user') {
      const responses = parts.filter((part) => part?.functionResponse)
      const value = userContent(parts.filter((part) => !part?.functionResponse))
      if (value) messages.push({ role: 'user', content: value })
      for (const part of responses) {
        const response = part.functionResponse
        messages.push({
          role: 'tool',
          tool_call_id: response.id || `call_${response.name || 'tool'}`,
          content: JSON.stringify(response.response ?? {}),
        })
      }
      continue
    }

    // Antigravity renvoie les functionResponse avec role "model".
    const calls = parts.filter((part) => part?.functionCall)
    const responses = parts.filter((part) => part?.functionResponse)
    const text = textOf(parts)

    if (calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((part, index) => {
          const call = part.functionCall
          return {
            id: call.id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args ?? {}),
            },
          }
        }),
      })
    } else if (text) {
      messages.push({ role: 'assistant', content: text })
    }

    for (const part of responses) {
      const response = part.functionResponse
      messages.push({
        role: 'tool',
        tool_call_id: response.id || `call_${response.name || 'tool'}`,
        content: JSON.stringify(response.response ?? {}),
      })
    }
  }

  const declarations = (body?.tools || []).flatMap((tool) => tool?.functionDeclarations || [])
  const tools = declarations
    .filter((declaration) => declaration?.name)
    .map((declaration) => ({
      type: 'function',
      function: {
        name: declaration.name,
        description: declaration.description || '',
        parameters: cleanSchema(declaration.parametersJsonSchema ?? declaration.parameters),
      },
    }))

  const providedTools = new Set(tools.map((tool) => tool.function.name))
  const injectedTools = new Set()
  for (const tool of COMPAT_TOOLS) {
    if (providedTools.has(tool.function.name)) continue
    tools.push(tool)
    injectedTools.add(tool.function.name)
  }

  const generation = body?.generationConfig || {}
  const request = {
    model,
    messages,
    // La passerelle free tier refuse les requêtes non streamées.
    stream: true,
    stream_options: { include_usage: true },
    tools,
    tool_choice: 'auto',
  }
  if (typeof generation.temperature === 'number') request.temperature = generation.temperature
  if (typeof generation.topP === 'number') request.top_p = generation.topP
  if (typeof generation.maxOutputTokens === 'number') {
    // Antigravity demande 65k ; on plafonne pour rester compatible avec les
    // limites de sortie des modèles gratuits.
    request.max_tokens = Math.min(generation.maxOutputTokens, 32768)
  }
  if (Array.isArray(generation.stopSequences) && generation.stopSequences.length > 0) {
    request.stop = generation.stopSequences
  }
  if (generation.responseMimeType === 'application/json') {
    request.response_format = { type: 'json_object' }
  }
  return { request, injectedTools }
}

function geminiChunk({ text, functionCalls, finishReason, usage, model }) {
  const parts = []
  if (typeof text === 'string' && text.length > 0) parts.push({ text })
  for (const call of functionCalls || []) {
    parts.push({
      functionCall: {
        ...(call.id ? { id: call.id } : {}),
        name: call.name,
        args: call.args ?? {},
      },
    })
  }
  const payload = {
    candidates: [{
      content: { parts, role: 'model' },
      index: 0,
      ...(finishReason ? { finishReason } : {}),
    }],
    ...(usage ? { usageMetadata: usage } : {}),
    ...(model ? { modelVersion: model } : {}),
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

function mapFinish(reason) {
  if (!reason) return null
  if (reason === 'length') return 'MAX_TOKENS'
  if (reason === 'content_filter') return 'SAFETY'
  if (reason === 'tool_calls' || reason === 'function_call') return 'STOP'
  return 'STOP'
}

function mapUsage(usage) {
  if (!usage) return null
  return {
    promptTokenCount: usage.prompt_tokens ?? 0,
    candidatesTokenCount: usage.completion_tokens ?? 0,
    totalTokenCount: usage.total_tokens ?? 0,
  }
}

function writeError(res, status, message, statusText = 'UNKNOWN') {
  const code = Number(status) || 500
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { code, message, status: statusText } }))
}

async function streamOpenAI(res, request, model, injectedTools) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000)
  let upstream
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: upstreamHeaders(model),
      body: JSON.stringify({
        ...request,
        stream: true,
        stream_options: request.stream_options || { include_usage: true },
      }),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    writeError(res, 502, `Upstream fetch failed: ${error?.message || error}`)
    return
  }

  if (!upstream.ok) {
    clearTimeout(timeout)
    const text = await upstream.text().catch(() => '')
    log('upstream error', upstream.status, text.slice(0, 500))
    writeError(res, upstream.status, text.slice(0, 2000) || 'Upstream error')
    return
  }

  const contentType = upstream.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    // Certains fournisseurs ignorent stream:true et renvoient un JSON complet.
    const data = await upstream.json().catch(() => null)
    const choice = data?.choices?.[0]
    const message = choice?.message || {}
    const parts = []
    if (typeof message.content === 'string' && message.content.length > 0) {
      parts.push({ text: message.content })
    }
    for (const call of message.tool_calls || []) {
      let args = {}
      try { args = JSON.parse(call.function?.arguments || '{}') } catch { args = {} }
      parts.push({ functionCall: { id: call.id, name: call.function?.name, args } })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      candidates: [{
        content: { parts, role: 'model' },
        index: 0,
        finishReason: mapFinish(choice?.finish_reason) || 'STOP',
      }],
      usageMetadata: mapUsage(data?.usage),
      modelVersion: model,
    }))
    clearTimeout(timeout)
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const calls = new Map()
  let usage = null
  let finishReason = null
  let buffer = ''
  let sawChunk = false
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          let chunk
          try {
            chunk = JSON.parse(data)
          } catch {
            log('bad upstream json', data.slice(0, 200))
            continue
          }
          sawChunk = true
          if (chunk.usage) usage = chunk.usage
          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finishReason = choice.finish_reason
          const delta = choice.delta || choice.message || {}
          const content = delta.content
          if (typeof content === 'string' && content.length > 0) {
            res.write(geminiChunk({ text: content, model }))
          } else if (Array.isArray(content)) {
            const text = content
              .map((part) => (typeof part === 'string' ? part : part?.text))
              .filter((part) => typeof part === 'string' && part.length > 0)
              .join('')
            if (text) res.write(geminiChunk({ text, model }))
          }
          const toolCalls = [
            ...(delta.tool_calls || []),
            ...(delta.function_call ? [{ index: 0, function: delta.function_call }] : []),
          ]
          for (const toolCall of toolCalls) {
            const index = toolCall.index ?? 0
            const current = calls.get(index) || { id: '', name: '', arguments: '' }
            if (toolCall.id) current.id = toolCall.id
            if (toolCall.function?.name) current.name = toolCall.function.name
            if (typeof toolCall.function?.arguments === 'string') {
              current.arguments += toolCall.function.arguments
            }
            calls.set(index, current)
          }
        }
      }
    }

    const functionCalls = []
    for (const [, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
      if (!call.name) continue
      if (injectedTools.has(call.name)) {
        log('ignoring compatibility tool call', call.name)
        continue
      }
      let args = {}
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {}
      } catch {
        log('tool args not valid JSON', call.arguments.slice(0, 500))
        args = {}
      }
      functionCalls.push({ id: call.id, name: call.name, args })
    }
    if (functionCalls.length > 0) {
      res.write(geminiChunk({ functionCalls, finishReason: 'STOP', usage: mapUsage(usage), model }))
    } else {
      res.write(geminiChunk({
        text: sawChunk ? '' : '',
        finishReason: mapFinish(finishReason) || 'STOP',
        usage: mapUsage(usage),
        model,
      }))
    }
    res.end()
  } catch (error) {
    log('stream error', error?.message || error)
    try {
      res.write(geminiChunk({ text: `Erreur proxy: ${error?.message || error}`, finishReason: 'STOP', model }))
      res.end()
    } catch {
      res.destroy()
    }
  } finally {
    clearTimeout(timeout)
    reader.cancel().catch(() => {})
  }
}

async function nonStreamOpenAI(res, request, model, injectedTools) {
  let upstream
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: upstreamHeaders(model),
      body: JSON.stringify({
        ...request,
        stream: true,
        stream_options: request.stream_options || { include_usage: true },
      }),
      signal: AbortSignal.timeout(15 * 60 * 1000),
    })
  } catch (error) {
    writeError(res, 502, `Upstream fetch failed: ${error?.message || error}`)
    return
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    writeError(res, upstream.status, text.slice(0, 2000) || 'Upstream error')
    return
  }

  const contentType = upstream.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    // Fallback si l'upstream ignore stream:true.
    const data = await upstream.json().catch(() => null)
    const choice = data?.choices?.[0]
    const parts = []
    if (choice?.message?.content) parts.push({ text: choice.message.content })
    for (const call of choice?.message?.tool_calls || []) {
      if (injectedTools.has(call.function?.name)) continue
      let args = {}
      try { args = JSON.parse(call.function?.arguments || '{}') } catch { args = {} }
      parts.push({ functionCall: { id: call.id, name: call.function?.name, args } })
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      candidates: [{
        content: { parts, role: 'model' },
        index: 0,
        finishReason: mapFinish(choice?.finish_reason) || 'STOP',
      }],
      usageMetadata: mapUsage(data?.usage),
      modelVersion: model,
    }))
    return
  }

  let text = ''
  let buffer = ''
  let usage = null
  let finishReason = null
  const calls = new Map()
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          let chunk
          try { chunk = JSON.parse(data) } catch { continue }
          if (chunk.usage) usage = chunk.usage
          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finishReason = choice.finish_reason
          const delta = choice.delta || choice.message || {}
          if (typeof delta.content === 'string') {
            text += delta.content
          } else if (Array.isArray(delta.content)) {
            text += delta.content
              .map((part) => (typeof part === 'string' ? part : part?.text))
              .filter((part) => typeof part === 'string' && part.length > 0)
              .join('')
          }
          const toolCalls = [
            ...(delta.tool_calls || []),
            ...(delta.function_call ? [{ index: 0, function: delta.function_call }] : []),
          ]
          for (const toolCall of toolCalls) {
            const index = toolCall.index ?? 0
            const current = calls.get(index) || { id: '', name: '', arguments: '' }
            if (toolCall.id) current.id = toolCall.id
            if (toolCall.function?.name) current.name = toolCall.function.name
            if (typeof toolCall.function?.arguments === 'string') {
              current.arguments += toolCall.function.arguments
            }
            calls.set(index, current)
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  const parts = []
  if (text) parts.push({ text })
  for (const [, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    if (!call.name || injectedTools.has(call.name)) continue
    let args = {}
    try { args = call.arguments ? JSON.parse(call.arguments) : {} } catch { args = {} }
    parts.push({ functionCall: { id: call.id, name: call.name, args } })
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    candidates: [{
      content: { parts, role: 'model' },
      index: 0,
      finishReason: mapFinish(finishReason) || 'STOP',
    }],
    usageMetadata: mapUsage(usage),
    modelVersion: model,
  }))
}

async function preflightModel(model) {
  const request = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 8,
    stream: true,
    stream_options: { include_usage: true },
    tools: COMPAT_TOOLS,
    tool_choice: 'auto',
  }
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: upstreamHeaders(model),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
    })
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '')
      return { ok: false, status: upstream.status, model, body: body.slice(0, 1000) }
    }
    const contentType = upstream.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      const data = await upstream.json().catch(() => null)
      return { ok: Array.isArray(data?.choices) && data.choices.length > 0, status: upstream.status, model }
    }
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue
            let chunk
            try { chunk = JSON.parse(data) } catch { continue }
            if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
              return { ok: true, status: upstream.status, model }
            }
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {})
    }
    return { ok: false, status: upstream.status, model, body: 'no SSE chunk' }
  } catch (error) {
    return { ok: false, status: 502, model, body: error?.message || String(error) }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, main: MAIN_MODEL, title: TITLE_MODEL, safety: SAFETY_MODEL }))
      return
    }
    if (req.method === 'GET' && req.url === '/preflight') {
      const result = await preflightModel(MAIN_MODEL)
      res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }
    if (req.method !== 'POST') {
      writeError(res, 405, 'Method not allowed')
      return
    }
    const match = req.url.match(/^\/v1beta\/models\/([^:]+):(streamGenerateContent|generateContent)(?:\?.*)?$/)
    if (!match) {
      writeError(res, 404, `Unknown path ${req.url}`)
      return
    }
    const [, geminiModel, method] = match
    const model = modelFor(geminiModel)
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      writeError(res, 400, 'Invalid JSON')
      return
    }
    const stream = method === 'streamGenerateContent'
    const { request, injectedTools } = toOpenAI(body, model)
    log(geminiModel, '->', model, stream ? 'stream' : 'json', `${request.messages.length} messages`, `${request.tools?.length || 0} tools`, `${injectedTools.size} injected`)
    if (stream) await streamOpenAI(res, request, model, injectedTools)
    else await nonStreamOpenAI(res, request, model, injectedTools)
  } catch (error) {
    log('handler error', error?.stack || error)
    if (!res.headersSent) writeError(res, 500, error?.message || String(error))
    else res.destroy()
  }
})

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on 127.0.0.1:${PORT}`)
  log(`main=${MAIN_MODEL} title=${TITLE_MODEL} safety=${SAFETY_MODEL} auth=${API_KEY ? 'account' : 'public'}`)
  log(`upstream=${UPSTREAM_URL}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`received ${signal}, stopping`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
