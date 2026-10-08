import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from '../markdown'

/** A PR description rendered from Markdown; links open outside, in the browser. */
export function Markdown({ source, repo }: { source: string; repo: string }) {
  const blocks = useMemo(() => parseMarkdown(source, { repo }), [source, repo])
  return (
    <div className="md">
      <Blocks blocks={blocks} />
    </div>
  )
}

function openLink(e: MouseEvent, href: string): void {
  e.preventDefault()
  e.stopPropagation()
  void window.prRadar.openLink(href)
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <InlineView key={i} node={node} />
      ))}
    </>
  )
}

function InlineView({ node }: { node: Inline }): ReactNode {
  switch (node.type) {
    case 'text':
      return node.text
    case 'strong':
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      )
    case 'em':
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      )
    case 'strike':
      return (
        <del>
          <Inlines nodes={node.children} />
        </del>
      )
    case 'code':
      return <code>{node.text}</code>
    case 'br':
      return <br />
    case 'link':
      return (
        <a href={node.href} title={node.href} onClick={(e) => openLink(e, node.href)}>
          <Inlines nodes={node.children} />
        </a>
      )
    case 'image':
      return (
        <a href={node.src} className="md-image" title={node.src} onClick={(e) => openLink(e, node.src)}>
          {node.alt || node.src}
        </a>
      )
  }
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </>
  )
}

/** A list item with just one paragraph reads as plain text, like GitHub's tight lists. */
function ItemContent({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 1 && blocks[0].type === 'paragraph') return <Inlines nodes={blocks[0].children} />
  return <Blocks blocks={blocks} />
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag>
          <Inlines nodes={block.children} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      )
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className={item.checked === null ? undefined : 'task'}>
          {item.checked !== null && <input type="checkbox" checked={item.checked} disabled readOnly />}
          <ItemContent blocks={item.children} />
        </li>
      ))
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>
    }
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote>
          <Blocks blocks={block.children} />
        </blockquote>
      )
    case 'hr':
      return <hr />
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i}>
                  <Inlines nodes={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Inlines nodes={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}
