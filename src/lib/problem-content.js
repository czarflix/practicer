const HTML_ENTITY_MAP = {
  amp: '&',
  apos: "'",
  bull: '•',
  copy: '©',
  gt: '>',
  hellip: '...',
  laquo: '<<',
  ldquo: '"',
  lsquo: "'",
  lt: '<',
  mdash: '-',
  middot: '·',
  nbsp: ' ',
  ndash: '-',
  quot: '"',
  raquo: '>>',
  rdquo: '"',
  reg: '®',
  rsaquo: '>',
  rsquo: "'",
  trade: '™',
}

export function looksLikeHtml(value) {
  return /<\s*\/?\s*[a-z][^>]*>/i.test(String(value || ''))
}

function stripInlineMarkers(value) {
  return String(value || '').replace(/[`*]/g, '').trim()
}

function isSectionHeading(line) {
  const normalized = stripInlineMarkers(line).replace(/[:.]$/, '')
  return /^(Examples?|Example \d+|Constraints?|Follow ?Up|Notes?|Hint)$/i.test(normalized)
}

function normalizeMethodParam(param) {
  const source = String(param || '').trim()
  if (!source) {
    return ''
  }

  const identifierMatch = source.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\])?\s*(?:=.*)?$/)
  return identifierMatch ? identifierMatch[1] : source
}

function formatPythonishSignature(signature) {
  const source = String(signature || '').replace(/`/g, '').trim().replace(/\s+/g, ' ')
  if (!source) {
    return ''
  }

  const signatureMatch = source.match(/^(.*?)([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/)
  if (!signatureMatch) {
    return source
  }

  const methodName = signatureMatch[2]
  const paramsSource = signatureMatch[3].trim()
  const params = !paramsSource
    ? []
    : paramsSource
        .split(',')
        .map((part) => normalizeMethodParam(part))
        .filter(Boolean)

  return `${methodName}(${params.join(', ')})`
}

function parseApiItem(line) {
  const source = String(line || '').trim()
  if (!source) {
    return null
  }

  const inlineSignatureMatch = source.match(/`([^`]+)`/)
  const rawSignature = inlineSignatureMatch?.[1]?.trim() || ''
  const withoutSignature = rawSignature ? source.replace(inlineSignatureMatch[0], '').trim() : source
  const normalizedDescription = withoutSignature.replace(/^[-:]\s*/, '').trim()

  if (rawSignature) {
    return {
      signature: formatPythonishSignature(rawSignature),
      description: normalizedDescription,
    }
  }

  const plainMatch = source.match(/^([A-Za-z0-9_<>[\],*&.\s]+?\([^)]*\))\s*(.*)$/)
  if (!plainMatch) {
    return {
      signature: '',
      description: source,
    }
  }

  return {
    signature: formatPythonishSignature(plainMatch[1]),
    description: plainMatch[2].replace(/^[-:]\s*/, '').trim(),
  }
}

function extractNodeShape(lines) {
  const startIndex = lines.findIndex((line) => /^(?:struct|class)\s+Node\b/i.test(stripInlineMarkers(line)))
  if (startIndex < 0) {
    return {
      nodeShape: [],
      lines,
    }
  }

  let endIndex = startIndex
  while (endIndex < lines.length && stripInlineMarkers(lines[endIndex]) !== '}') {
    endIndex += 1
  }
  if (endIndex < lines.length) {
    endIndex += 1
  }

  const block = lines.slice(startIndex, endIndex)
  const nodeShape = block
    .map((line) => stripInlineMarkers(line))
    .map((line) => line.match(/([A-Za-z_][A-Za-z0-9_]*)\s*;$/)?.[1] || '')
    .filter((field) => !['Node', 'struct', 'class'].includes(field))

  return {
    nodeShape,
    lines: [...lines.slice(0, startIndex), ...lines.slice(endIndex)],
  }
}

function extractBlockAfterHeading(lines, headingMatcher) {
  const startIndex = lines.findIndex((line) => headingMatcher.test(stripInlineMarkers(line)))
  if (startIndex < 0) {
    return {
      items: [],
      lines,
    }
  }

  let endIndex = startIndex + 1
  while (endIndex < lines.length) {
    const current = stripInlineMarkers(lines[endIndex])
    if (current && isSectionHeading(current)) {
      break
    }
    endIndex += 1
  }

  const headingLine = stripInlineMarkers(lines[startIndex])
  const inlineHeadingRemainder = headingLine.replace(headingMatcher, '').replace(/^:\s*/, '').trim()

  const items = [
    ...(inlineHeadingRemainder ? [inlineHeadingRemainder] : []),
    ...lines
      .slice(startIndex + 1, endIndex)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean),
  ]

  return {
    items,
    lines: [...lines.slice(0, startIndex), ...lines.slice(endIndex)],
  }
}

function extractInterface(lines) {
  const startIndex = lines.findIndex((line) => /^Implement\b/i.test(stripInlineMarkers(line)))
  if (startIndex < 0) {
    return {
      title: '',
      items: [],
      lines,
    }
  }

  let endIndex = startIndex + 1
  const items = []
  let current = ''

  while (endIndex < lines.length) {
    const currentLine = lines[endIndex]
    const normalized = stripInlineMarkers(currentLine)
    if (normalized && isSectionHeading(normalized)) {
      break
    }

    if (!normalized) {
      if (current) {
        items.push(current)
        current = ''
      }
      endIndex += 1
      continue
    }

    if (/^[-*]\s+/.test(currentLine.trim())) {
      if (current) {
        items.push(current)
      }
      current = currentLine.trim().replace(/^[-*]\s+/, '')
      endIndex += 1
      continue
    }

    if (current) {
      current = `${current} ${normalized}`
    } else {
      current = normalized
    }
    endIndex += 1
  }

  if (current) {
    items.push(current)
  }

  return {
    title: stripInlineMarkers(lines[startIndex]).replace(/:$/, ''),
    items: items.map(parseApiItem).filter(Boolean),
    lines: [...lines.slice(0, startIndex), ...lines.slice(endIndex)],
  }
}

export function buildProblemPresentation({ description, examples = [] }) {
  const source = normalizeWhitespace(description)
  if (!source) {
    return {
      statement: '',
      interfaceTitle: '',
      interfaceItems: [],
      constraints: [],
      followUp: [],
      nodeShape: [],
      examples,
    }
  }

  let workingLines = source.split('\n')
  const nodeShapeResult = extractNodeShape(workingLines)
  workingLines = nodeShapeResult.lines

  const interfaceResult = extractInterface(workingLines)
  workingLines = interfaceResult.lines

  const constraintsResult = extractBlockAfterHeading(workingLines, /^Constraints?:?$/i)
  workingLines = constraintsResult.lines

  const followUpResult = extractBlockAfterHeading(workingLines, /^Follow ?Up:?$/i)
  workingLines = followUpResult.lines

  const statementStopIndex = workingLines.findIndex((line) => /^Example\b/i.test(stripInlineMarkers(line)))
  const statementLines = (statementStopIndex >= 0 ? workingLines.slice(0, statementStopIndex) : workingLines).filter(
    (line, index, collection) => {
      if (line.trim()) {
        return true
      }
      return index > 0 && collection[index - 1].trim()
    },
  )

  return {
    statement: normalizeWhitespace(statementLines.join('\n')),
    interfaceTitle: interfaceResult.title,
    interfaceItems: interfaceResult.items,
    constraints: constraintsResult.items,
    followUp: followUpResult.items,
    nodeShape: nodeShapeResult.nodeShape,
    examples,
  }
}

export function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, digits) => {
      const codePoint = Number(digits)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const codePoint = Number.parseInt(digits, 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (match, entity) => HTML_ENTITY_MAP[entity.toLowerCase()] ?? match)
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
}

function compactExampleValue(value) {
  if (typeof value === 'string') {
    return normalizeWhitespace(value)
  }

  if (value === undefined) {
    return ''
  }

  return JSON.stringify(value)
}

function isDesignExampleInput(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray(value.methods) &&
    Array.isArray(value.arguments)
  )
}

export function normalizeProblemDescription(value) {
  const source = String(value || '')
  if (!source.trim()) {
    return ''
  }

  const decoded = decodeHtmlEntities(source)
  if (!looksLikeHtml(decoded)) {
    return normalizeWhitespace(decoded)
  }

  const withBreaks = decoded
    .replace(/<\s*sup\b[^>]*>([\s\S]*?)<\s*\/sup\s*>/gi, '^$1')
    .replace(/<\s*sub\b[^>]*>([\s\S]*?)<\s*\/sub\s*>/gi, '_$1')
    .replace(/<\/?(?:html|body|section|article|header|footer|main)\b[^>]*>/gi, '\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/?p\b[^>]*>/gi, '\n')
    .replace(/<\/?div\b[^>]*>/gi, '\n')
    .replace(/<\/?pre\b[^>]*>/gi, '\n')
    .replace(/<\/?blockquote\b[^>]*>/gi, '\n')
    .replace(/<\/?h[1-6]\b[^>]*>/gi, '\n')
    .replace(/<\/?ul\b[^>]*>/gi, '\n')
    .replace(/<\/?ol\b[^>]*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<\/?tr\b[^>]*>/gi, '\n')
    .replace(/<\/?t(?:able|head|body|foot|d|h)\b[^>]*>/gi, ' ')
    .replace(/<\s*img\b[^>]*>/gi, '')
    .replace(/<\/?a\b[^>]*>/gi, '')
    .replace(/<\/?span\b[^>]*>/gi, '')
    .replace(/<\/?strong\b[^>]*>/gi, '')
    .replace(/<\/?em\b[^>]*>/gi, '')
    .replace(/<\/?code\b[^>]*>/gi, '`')
    .replace(/<[^>]+>/g, '')

  return normalizeWhitespace(withBreaks)
}

export function normalizeProblemDescriptionForStorage(value) {
  const normalized = normalizeProblemDescription(value)
  if (!normalized) {
    return ''
  }

  const presentation = buildProblemPresentation({
    description: normalized,
    examples: [],
  })

  const sections = []

  if (presentation.statement) {
    sections.push(presentation.statement)
  }

  if (presentation.interfaceItems.length > 0) {
    const title = presentation.interfaceTitle || 'Interface'
    const rows = presentation.interfaceItems
      .map((item) => {
        const signature = item.signature ? `\`${item.signature}\`` : ''
        if (signature && item.description) {
          return `- ${signature} ${item.description}`
        }
        if (signature) {
          return `- ${signature}`
        }
        return `- ${item.description}`
      })
      .filter(Boolean)

    if (rows.length > 0) {
      sections.push(`${title}:\n\n${rows.join('\n')}`)
    }
  }

  if (presentation.nodeShape.length > 0) {
    sections.push(`Node fields: ${presentation.nodeShape.join(', ')}`)
  }

  if (presentation.constraints.length > 0) {
    sections.push(`Constraints:\n\n${presentation.constraints.map((line) => `- ${line}`).join('\n')}`)
  }

  if (presentation.followUp.length > 0) {
    sections.push(`Follow Up:\n\n${presentation.followUp.map((line) => `- ${line}`).join('\n')}`)
  }

  return normalizeWhitespace(sections.join('\n\n'))
}

export function normalizeProblemExamplesForStorage(raw) {
  let value = raw

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }

  if (value == null) {
    return []
  }

  let rows = []

  if (Array.isArray(value)) {
    rows = value.map((item) => ({
      inputValue: item?.inputs ?? item?.input ?? '',
      outputValue: item?.outputs ?? item?.output ?? '',
    }))
  } else if (typeof value === 'object' && Array.isArray(value.inputs) && Array.isArray(value.outputs)) {
    rows = value.inputs.map((inputValue, index) => ({
      inputValue,
      outputValue: value.outputs[index],
    }))
  }

  return rows.map(({ inputValue, outputValue }) => {
    if (isDesignExampleInput(inputValue)) {
      return {
        input: `methods = ${compactExampleValue(inputValue.methods)}\narguments = ${compactExampleValue(inputValue.arguments)}`,
        output: compactExampleValue(outputValue),
      }
    }

    return {
      input: compactExampleValue(inputValue),
      output: compactExampleValue(outputValue),
    }
  })
}

export function deriveProblemEntryPoint(entryPoint, starterCode) {
  const rawEntryPoint = String(entryPoint || '').trim()
  if (!rawEntryPoint) {
    return ''
  }

  if (rawEntryPoint !== 'Solution') {
    return rawEntryPoint
  }

  const starter = String(starterCode || '')
  const methodMatch = starter.match(/class\s+Solution\s*:[\s\S]*?\n\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/)

  if (!methodMatch) {
    return rawEntryPoint
  }

  return `Solution().${methodMatch[1]}`
}
