function paragraphNode(text) {
  const value = String(text || '').trim()
  if (!value) {
    return { type: 'paragraph' }
  }

  return {
    type: 'paragraph',
    content: [{ type: 'text', text: value }],
  }
}

function headingNode(level, text) {
  const value = String(text || '').trim()
  if (!value) {
    return null
  }

  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: value }],
  }
}

function codeBlockNode(code, language = 'text') {
  const value = String(code || '').trim()
  if (!value) {
    return null
  }

  return {
    type: 'codeBlock',
    attrs: { language },
    content: [{ type: 'text', text: value }],
  }
}

function bulletListNode(items) {
  const normalized = Array.isArray(items) ? items.map((item) => String(item || '').trim()).filter(Boolean) : []
  if (normalized.length === 0) {
    return null
  }

  return {
    type: 'bulletList',
    content: normalized.map((item) => ({
      type: 'listItem',
      content: [paragraphNode(item)],
    })),
  }
}

function normalizeDoc(value) {
  if (value && typeof value === 'object' && value.type === 'doc' && Array.isArray(value.content)) {
    return {
      type: 'doc',
      content: [...value.content],
    }
  }

  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}

function textNodeFromBlock(block) {
  const kind = String(block?.kind || '').trim()
  if (kind === 'code' || kind === 'sql') {
    return codeBlockNode(block.code, block.language || (kind === 'sql' ? 'sql' : 'python'))
  }

  if (kind === 'bullets' || kind === 'checklist') {
    return bulletListNode(block.items)
  }

  return paragraphNode(block.text)
}

export function blocksToNoteDoc({ title, summary = '', blocks = [] }) {
  const nodes = []
  const titleNode = headingNode(2, title)
  if (titleNode) {
    nodes.push(titleNode)
  }

  if (summary) {
    nodes.push(paragraphNode(summary))
  }

  blocks.forEach((block) => {
    const heading = headingNode(3, block.heading)
    if (heading) {
      nodes.push(heading)
    }

    const node = textNodeFromBlock(block)
    if (node) {
      nodes.push(node)
    }
  })

  return {
    type: 'doc',
    content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }],
  }
}

export function appendBlocksToNoteDoc(currentDoc, payload) {
  const base = normalizeDoc(currentDoc)
  const appendix = blocksToNoteDoc(payload)
  const separator = { type: 'horizontalRule' }

  return {
    type: 'doc',
    content: [
      ...base.content,
      ...(base.content.length > 0 ? [separator] : []),
      ...appendix.content,
    ],
  }
}

export function tableToMarkdown(value) {
  const columns = Array.isArray(value?.columns) ? value.columns : []
  const rows = Array.isArray(value?.rows) ? value.rows : []
  if (columns.length === 0) {
    return ''
  }

  const header = `| ${columns.join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => {
    const cells = columns.map((column, index) => {
      const raw = Array.isArray(row) ? row[index] : row?.[column]
      return String(raw ?? 'NULL').replace(/\|/g, '\\|')
    })
    return `| ${cells.join(' | ')} |`
  })

  return [header, divider, ...body].join('\n')
}
