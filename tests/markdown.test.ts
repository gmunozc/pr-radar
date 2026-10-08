import { describe, expect, it } from 'vitest'
import { MAX_MARKDOWN_LENGTH, parseInlines, parseMarkdown, type Block, type Inline } from '../src/renderer/markdown'

const ctx = { repo: 'acme/app' }
const md = (src: string) => parseMarkdown(src, ctx)
const text = (t: string): Inline => ({ type: 'text', text: t })
const para = (...children: Inline[]): Block => ({ type: 'paragraph', children })

describe('parseMarkdown blocks', () => {
  it('reads ATX and setext headings, paragraphs and rules', () => {
    expect(md('# Title\n\nSome text\nsame paragraph\n\n## Sub ##\n---\nUnder\n===')).toEqual([
      { type: 'heading', level: 1, children: [text('Title')] },
      para(text('Some text same paragraph')),
      { type: 'heading', level: 2, children: [text('Sub')] },
      { type: 'hr' },
      { type: 'heading', level: 1, children: [text('Under')] }
    ])
  })

  it('reads nested, ordered and task lists, with lazy continuation lines', () => {
    const src = '- one\n  continued\n  - nested\n- [x] done\n- [ ] todo\n\n3. three\n4. four'
    expect(md(src)).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          { checked: null, children: [para(text('one continued')), { type: 'list', ordered: false, start: 1, items: [{ checked: null, children: [para(text('nested'))] }] }] },
          { checked: true, children: [para(text('done'))] },
          { checked: false, children: [para(text('todo'))] }
        ]
      },
      { type: 'list', ordered: true, start: 3, items: [{ checked: null, children: [para(text('three'))] }, { checked: null, children: [para(text('four'))] }] }
    ])
  })

  it('reads fenced and indented code, quotes and tables', () => {
    expect(md('```ts\nconst a = 1\n```\n\n    indented\n\n> quoted\n> *text*')).toEqual([
      { type: 'code', lang: 'ts', text: 'const a = 1' },
      { type: 'code', lang: '', text: 'indented' },
      { type: 'quote', children: [para(text('quoted '), { type: 'em', children: [text('text')] })] }
    ])
    expect(md('| A | B |\n| --- | :-: |\n| 1 | **2** |\n| only a |')).toEqual([
      {
        type: 'table',
        header: [[text('A')], [text('B')]],
        rows: [
          [[text('1')], [{ type: 'strong', children: [text('2')] }]],
          [[text('only a')], []]
        ]
      }
    ])
  })

  it('shows raw HTML as text and cuts very long descriptions', () => {
    expect(md('<details><summary>More</summary>')).toEqual([para(text('<details><summary>More</summary>'))])
    const blocks = md('a'.repeat(MAX_MARKDOWN_LENGTH + 10))
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toEqual(para(text('…')))
  })
})

describe('parseInlines', () => {
  const inl = (src: string) => parseInlines(src, ctx)

  it('reads emphasis, code and escapes, but not stray asterisks', () => {
    expect(inl('**bold** and *em*, __also__, _em_ and ~~gone~~, `co*de`')).toEqual([
      { type: 'strong', children: [text('bold')] },
      text(' and '),
      { type: 'em', children: [text('em')] },
      text(', '),
      { type: 'strong', children: [text('also')] },
      text(', '),
      { type: 'em', children: [text('em')] },
      text(' and '),
      { type: 'strike', children: [text('gone')] },
      text(', '),
      { type: 'code', text: 'co*de' }
    ])
    expect(inl('2 * 3 * 4 and snake_case_name and \\*literal\\*')).toEqual([text('2 * 3 * 4 and snake_case_name and *literal*')])
  })

  it('reads links, autolinks, bare URLs and images', () => {
    expect(inl('[spec](https://example.com/spec "Spec") and <https://a.io> and https://b.io/x. end')).toEqual([
      { type: 'link', href: 'https://example.com/spec', children: [text('spec')] },
      text(' and '),
      { type: 'link', href: 'https://a.io', children: [text('https://a.io')] },
      text(' and '),
      { type: 'link', href: 'https://b.io/x', children: [text('https://b.io/x')] },
      text('. end')
    ])
    expect(inl('![shot](https://i.io/a.png) [bad](javascript:alert(1))')).toEqual([
      { type: 'image', alt: 'shot', src: 'https://i.io/a.png' },
      text(' [bad](javascript:alert(1))')
    ])
  })

  it('links mentions and issue references, in this repository or another', () => {
    expect(inl('cc @ana, fixes #12 and acme/core#5; mail a@b.com; v1.2#3')).toEqual([
      text('cc '),
      { type: 'link', href: 'https://github.com/ana', children: [text('@ana')] },
      text(', fixes '),
      { type: 'link', href: 'https://github.com/acme/app/issues/12', children: [text('#12')] },
      text(' and '),
      { type: 'link', href: 'https://github.com/acme/core/issues/5', children: [text('acme/core#5')] },
      text('; mail a@b.com; v1.2#3')
    ])
  })

  it('turns two trailing spaces or a backslash into a line break and a plain newline into a space', () => {
    expect(inl('one  \ntwo\\\nthree\nfour')).toEqual([text('one'), { type: 'br' }, text('two'), { type: 'br' }, text('three four')])
  })
})
