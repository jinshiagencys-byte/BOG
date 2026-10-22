// Rendu Markdown minimal du changelog. Reproduit la sortie du vrai site
// (`react-markdown` + composants personnalisés) : mêmes balises, mêmes classes.
//
// Sous-ensemble couvert (tout ce que contient le flux réel) : titres `#`…`######`,
// paragraphes, listes à puces (imbriquées), gras, italique, code en ligne,
// blocs de code ```lang, liens, images et images-liens.
import { Fragment } from 'react'

// Conteneur « prose » du vrai site (chaîne copiée depuis le DOM de prod).
export const PROSE_CLASS =
  'text-sm leading-normal text-foreground overflow-x-auto [&_hr]:my-3 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square] [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_li>p]:my-0 [&_li_ul]:my-1 [&_li_ol]:my-1 [&_h1]:mt-5 [&_h1]:mb-2 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h4]:mt-3 [&_h4]:mb-1 [&_h5]:mt-3 [&_h5]:mb-1 [&_h6]:mt-3 [&_h6]:mb-1 [&_blockquote]:my-2 [&_pre]:my-2 [&>*:first-child]:mt-0 [&_p]:text-muted-foreground [&_ul]:text-muted-foreground [&_ol]:text-muted-foreground'

const LINK_CLASS = 'text-primary underline hover:opacity-80'
const CODE_CLASS =
  'px-1 py-0.5 rounded bg-muted text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
const IMG_STYLE = { maxWidth: '100%', height: 'auto' }

// Titres : mêmes classes que les composants personnalisés du site de prod.
const HEADING_CLASS = {
  1: 'border-b border-border pb-2 text-xl font-semibold first:mt-0',
  2: 'border-b border-border pb-2 text-lg font-semibold first:mt-0',
  3: 'border-b border-border/70 pb-1.5 text-base font-semibold first:mt-0',
}

const Paragraph = ({ children }) => (
  <p className="whitespace-pre-wrap break-words my-0 mb-2">{children}</p>
)

const Image = ({ alt, src }) => (
  <img alt={alt} loading="lazy" className="my-2 block" style={IMG_STYLE} src={src} />
)

// --- rendu inline (gras, italique, code, liens, images) ---
// Le motif est instancié à chaque appel : `renderInline` est récursif et un
// objet `RegExp` global partagé verrait son `lastIndex` réinitialisé par les
// appels imbriqués (boucle infinie).
const INLINE_SOURCE =
  /(\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)|!\[([^\]]*)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/.source

function renderInline(text, keyPrefix) {
  const nodes = []
  const re = new RegExp(INLINE_SOURCE, 'g')
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const key = `${keyPrefix}-${nodes.length}`
    if (m[2] !== undefined) {
      // image cliquable : [![alt](img)](url)
      nodes.push(
        <a key={key} href={m[4]} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          <Image alt={m[2]} src={m[3]} />
        </a>,
      )
    } else if (m[5] !== undefined) {
      nodes.push(<Image key={key} alt={m[5]} src={m[6]} />)
    } else if (m[7] !== undefined) {
      nodes.push(
        <code key={key} className={CODE_CLASS}>
          {m[7]}
        </code>,
      )
    } else if (m[8] !== undefined) {
      nodes.push(<strong key={key}>{renderInline(m[8], key)}</strong>)
    } else if (m[9] !== undefined) {
      nodes.push(<em key={key}>{renderInline(m[9], key)}</em>)
    } else if (m[10] !== undefined) {
      nodes.push(
        <a key={key} href={m[11]} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          {renderInline(m[10], key)}
        </a>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.map((n, i) => (typeof n === 'string' ? <Fragment key={i}>{n}</Fragment> : n))
}

// --- rendu bloc ---
const FENCE_RE = /^\s*```(\w*)\s*$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/

const indentOf = (line) => line.length - line.trimStart().length

function parseList(lines, start, indent) {
  const items = []
  let i = start
  while (i < lines.length) {
    const m = BULLET_RE.exec(lines[i])
    if (!m || indentOf(lines[i]) !== indent) break
    const item = { text: [m[2]], children: [] }
    i += 1
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) {
        // ligne vide : la liste continue si un nouvel item suit à la même indentation
        let j = i
        while (j < lines.length && !lines[j].trim()) j += 1
        if (j < lines.length && BULLET_RE.test(lines[j]) && indentOf(lines[j]) >= indent) {
          i = j
          break
        }
        break
      }
      const nested = BULLET_RE.exec(line)
      const ind = indentOf(line)
      if (nested && ind > indent) {
        const [kids, next] = parseList(lines, i, ind)
        item.children = item.children.concat(kids)
        i = next
        continue
      }
      if (nested) break
      if (ind > indent) {
        item.text.push(line.trim())
        i += 1
        continue
      }
      break
    }
    items.push(item)
  }
  return [items, i]
}

function parseBlocks(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const code = []
      i += 1
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ type: 'code', lang: fence[1], text: code.join('\n') })
      continue
    }
    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }
    if (BULLET_RE.test(line)) {
      const [items, next] = parseList(lines, i, indentOf(line))
      blocks.push({ type: 'list', items })
      i = next
      continue
    }
    const paragraph = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !BULLET_RE.test(lines[i])
    ) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    blocks.push({ type: 'p', text: paragraph.join('\n') })
  }
  return blocks
}

function List({ items, keyPrefix }) {
  return (
    <ul className="list-disc pl-6">
      {items.map((item, i) => (
        <li key={`${keyPrefix}-${i}`}>
          {renderInline(item.text.join('\n'), `${keyPrefix}-${i}`)}
          {item.children.length ? (
            <List items={item.children} keyPrefix={`${keyPrefix}-${i}`} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export default function Markdown({ children, className = '' }) {
  const blocks = parseBlocks(children || '')
  return (
    <div className={`${PROSE_CLASS} ${className}`.trim()}>
      {blocks.map((block, i) => {
        const key = `b${i}`
        if (block.type === 'heading') {
          const Tag = `h${block.level}`
          return (
            <Tag key={key} className={HEADING_CLASS[block.level] || undefined}>
              {renderInline(block.text, key)}
            </Tag>
          )
        }
        if (block.type === 'list') return <List key={key} items={block.items} keyPrefix={key} />
        if (block.type === 'code') {
          return (
            <pre key={key}>
              <code
                className={
                  'block p-3 rounded bg-muted text-foreground overflow-x-auto' +
                  (block.lang ? ` language-${block.lang}` : '')
                }
              >
                {block.text}
              </code>
            </pre>
          )
        }
        return <Paragraph key={key}>{renderInline(block.text, key)}</Paragraph>
      })}
    </div>
  )
}
