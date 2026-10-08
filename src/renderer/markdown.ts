/**
 * A small GitHub-flavoured Markdown parser for PR descriptions, with no dependencies and no
 * HTML: headings, paragraphs, lists (nested, ordered, tasks), code, quotes, rules, tables,
 * emphasis, links, mentions and issue references. Anything else stays plain text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  /** Rendered as a link: the panel never loads pictures from PR bodies. */
  | { type: 'image'; alt: string; src: string }
  | { type: 'br' }

export interface ListItem {
  /** null for a plain item; true/false for a task. */
  checked: boolean | null
  children: Block[]
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'hr' }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }

export interface MarkdownContext {
  /** "owner/name": where bare `#123` references point. */
  repo: string
}

/** Longer descriptions are cut: the panel is not the place to read them. */
export const MAX_MARKDOWN_LENGTH = 20_000

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +)(.*)$/
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const INDENTED = /^ {4}/
const TASK = /^\[([ xX])\](?:[ \t]+(.*))?$/

export function parseMarkdown(source: string, ctx: MarkdownContext): Block[] {
  const cut = source.length > MAX_MARKDOWN_LENGTH
  const text = (cut ? source.slice(0, MAX_MARKDOWN_LENGTH) : source).replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const blocks = parseBlocks(text.split('\n'), ctx)
  if (cut) blocks.push({ type: 'paragraph', children: [{ type: 'text', text: '…' }] })
  return blocks
}

const leadingSpaces = (line: string) => line.length - line.trimStart().length

const isTableStart = (lines: string[], i: number) =>
  lines[i].includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]) && splitRow(lines[i]).length === splitRow(lines[i + 1]).length

/** Whether a line opens a block that ends the paragraph (or list item) before it. */
const startsBlock = (lines: string[], i: number) => {
  const line = lines[i]
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || ITEM.test(line) || isTableStart(lines, i)
}

function parseBlocks(lines: string[], ctx: MarkdownContext): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !(lines[j].trim().startsWith(marker[0].repeat(marker.length)) && !lines[j].trim().slice(marker.length).trim())) {
        body.push(lines[j])
        j++
      }
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') })
      i = j + 1
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInlines(heading[2] ?? '', ctx) })
      i++
      continue
    }
    if (HR.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && inner.length > 0 && inner[inner.length - 1].trim() && !startsBlock(lines, i)))) {
        inner.push(lines[i].replace(QUOTE, ''))
        i++
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner, ctx) })
      continue
    }
    if (ITEM.test(line)) {
      const list = parseList(lines, i, ctx)
      blocks.push(list.block)
      i = list.next
      continue
    }
    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]).map((cell) => parseInlines(cell, ctx))
      const rows: Inline[][][] = []
      let j = i + 2
      while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
        const cells = splitRow(lines[j])
        rows.push(header.map((_, k) => parseInlines(cells[k] ?? '', ctx)))
        j++
      }
      blocks.push({ type: 'table', header, rows })
      i = j
      continue
    }
    if (INDENTED.test(line)) {
      const body: string[] = []
      while (i < lines.length && (INDENTED.test(lines[i]) || !lines[i].trim())) {
        body.push(lines[i].replace(INDENTED, ''))
        i++
      }
      while (body.length && !body[body.length - 1].trim()) body.pop()
      blocks.push({ type: 'code', lang: '', text: body.join('\n') })
      continue
    }
    // A paragraph: up to a blank line or the start of another block; "Title\n---" is a heading.
    const para = [line]
    i++
    if (i < lines.length && SETEXT.test(lines[i])) {
      blocks.push({ type: 'heading', level: lines[i].trim().startsWith('=') ? 1 : 2, children: parseInlines(line.trim(), ctx) })
      i++
      continue
    }
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
      para.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInlines(para.map((l) => l.trim()).join('\n'), ctx) })
  }
  return blocks
}

function parseList(lines: string[], start: number, ctx: MarkdownContext): { block: Block; next: number } {
  const first = ITEM.exec(lines[start])!
  const indent = first[1].length
  const ordered = /\d/.test(first[2])
  const items: ListItem[] = []
  let i = start
  while (i < lines.length) {
    const m = ITEM.exec(lines[i])
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break
    const contentIndent = m[1].length + m[2].length + m[3].length
    const content = [m[4]]
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (!l.trim()) {
        // A blank line stays in the item only when indented content follows.
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j++
        if (j < lines.length && leadingSpaces(lines[j]) >= contentIndent) {
          content.push('')
          i++
          continue
        }
        break
      }
      if (leadingSpaces(l) >= contentIndent) {
        content.push(l.slice(contentIndent))
        i++
        continue
      }
      // Lazy continuation: plain text right under the item's text.
      if (content[content.length - 1].trim() && !startsBlock(lines, i)) {
        content.push(l.trim())
        i++
        continue
      }
      break
    }
    const task = TASK.exec(content[0])
    if (task) content[0] = task[2] ?? ''
    items.push({ checked: task ? task[1] !== ' ' : null, children: parseBlocks(content, ctx) })
  }
  return { block: { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items }, next: i }
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

// ---- inlines ----

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const WORD = /[A-Za-z0-9_]/
const MENTION = /^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9-])/
const REPO_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)(?!\d)/
const REF = /^#(\d+)(?!\d)/
const AUTOLINK = /^<(https?:\/\/[^\s<>]+)>/
const BARE_URL = /^https?:\/\/[^\s<>]+/
const WEB = /^https?:\/\//i

const text = (t: string): Inline => ({ type: 'text', text: t })

export function parseInlines(src: string, ctx: MarkdownContext): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(text(buf))
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const prev = i > 0 ? src[i - 1] : ''
    if (ch === '\n') {
      if (buf.endsWith('\\')) {
        buf = buf.slice(0, -1)
        flush()
        out.push({ type: 'br' })
      } else if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, '')
        flush()
        out.push({ type: 'br' })
      } else buf += ' '
      i++
      continue
    }
    if (ch === '\\' && i + 1 < src.length && PUNCT.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const run = runLength(src, i, '`')
      const close = findRun(src, i + run, '`', run)
      if (close !== -1) {
        let code = src.slice(i + run, close)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
        flush()
        out.push({ type: 'code', text: code.replace(/\n/g, ' ') })
        i = close + run
        continue
      }
      buf += src.slice(i, i + run)
      i += run
      continue
    }
    if (ch === '!' && src[i + 1] === '[') {
      const link = parseLinkAt(src, i + 1)
      if (link && WEB.test(link.href)) {
        flush()
        out.push({ type: 'image', alt: link.label, src: link.href })
        i = link.end
        continue
      }
    }
    if (ch === '[') {
      const link = parseLinkAt(src, i)
      if (link && WEB.test(link.href)) {
        flush()
        out.push({ type: 'link', href: link.href, children: parseInlines(link.label, ctx) })
        i = link.end
        continue
      }
    }
    if (ch === '<') {
      const m = AUTOLINK.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ type: 'link', href: m[1], children: [text(m[1])] })
        i += m[0].length
        continue
      }
    }
    if (ch === 'h' && (!prev || !WORD.test(prev))) {
      const m = BARE_URL.exec(src.slice(i))
      if (m) {
        let url = m[0].replace(/[.,;:!?]+$/, '')
        if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1)
        flush()
        out.push({ type: 'link', href: url, children: [text(url)] })
        i += url.length
        continue
      }
    }
    if (ch === '@' && (!prev || !WORD.test(prev)) && prev !== '/') {
      const m = MENTION.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ type: 'link', href: `https://github.com/${m[1]}`, children: [text(m[0])] })
        i += m[0].length
        continue
      }
    }
    if (ch === '#' && (!prev || !WORD.test(prev)) && prev !== '/' && prev !== '&') {
      const m = REF.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ type: 'link', href: `https://github.com/${ctx.repo}/issues/${m[1]}`, children: [text(m[0])] })
        i += m[0].length
        continue
      }
    }
    if (WORD.test(ch) && (!prev || (!WORD.test(prev) && prev !== '/' && prev !== '.' && prev !== '-'))) {
      const m = REPO_REF.exec(src.slice(i))
      if (m) {
        flush()
        out.push({ type: 'link', href: `https://github.com/${m[1]}/issues/${m[2]}`, children: [text(m[0])] })
        i += m[0].length
        continue
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const run = runLength(src, i, ch)
      const width = ch === '~' ? 2 : Math.min(run, 2)
      const kind: Inline['type'] | null = ch === '~' ? (run >= 2 ? 'strike' : null) : width === 2 ? 'strong' : 'em'
      const next = src[i + width] ?? ''
      // Left-flanking: the content starts right away; "_" never opens inside a word.
      const opens = kind !== null && next !== '' && !/\s/.test(next) && !(ch === '_' && prev && WORD.test(prev))
      if (opens) {
        const close = findClosing(src, i + width, ch, width)
        if (close !== -1) {
          flush()
          out.push({ type: kind, children: parseInlines(src.slice(i + width, close), ctx) } as Inline)
          i = close + width
          continue
        }
      }
      buf += src.slice(i, i + run)
      i += run
      continue
    }
    buf += ch
    i++
  }
  flush()
  return out
}

function runLength(src: string, i: number, ch: string): number {
  let n = 0
  while (src[i + n] === ch) n++
  return n
}

/** The next run of exactly `width` `ch` characters at or after `from`. */
function findRun(src: string, from: number, ch: string, width: number): number {
  let i = from
  while (i < src.length) {
    if (src[i] === ch) {
      const n = runLength(src, i, ch)
      if (n === width) return i
      i += n
    } else i++
  }
  return -1
}

/** A closing delimiter run: right after non-space content, not inside a word for "_". */
function findClosing(src: string, from: number, ch: string, width: number): number {
  let i = from
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === '`') {
      const run = runLength(src, i, '`')
      const close = findRun(src, i + run, '`', run)
      i = close === -1 ? i + run : close + run
      continue
    }
    if (src[i] === ch) {
      const n = runLength(src, i, ch)
      const before = src[i - 1] ?? ''
      const after = src[i + n] ?? ''
      if (n >= width && before && !/\s/.test(before) && !(ch === '_' && after && WORD.test(after))) return n === width ? i : i + n - width
      i += n
    } else i++
  }
  return -1
}

/** `[label](href "title")` at `src[at] === '['`; the label may nest brackets one level. */
function parseLinkAt(src: string, at: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let i = at
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') i += 2
    else if (c === '[') {
      depth++
      i++
    } else if (c === ']') {
      depth--
      if (depth === 0) break
      i++
    } else i++
  }
  if (depth !== 0 || src[i + 1] !== '(') return null
  const label = src.slice(at + 1, i)
  let j = i + 2
  let parens = 0
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') j += 2
    else if (c === '(') {
      parens++
      j++
    } else if (c === ')') {
      if (parens === 0) break
      parens--
      j++
    } else if (c === '\n') return null
    else j++
  }
  if (src[j] !== ')') return null
  const inside = src.slice(i + 2, j).trim()
  const href = inside.replace(/\s+("[^"]*"|'[^']*')$/, '').replace(/^<(.*)>$/, '$1')
  return { label, href, end: j + 1 }
}
