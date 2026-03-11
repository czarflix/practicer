function tokenizeInline(text) {
  const source = String(text || '')
  const tokens = []
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g
  let lastIndex = 0
  let match

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: source.slice(lastIndex, match.index) })
    }

    if (match[2] && match[3]) {
      tokens.push({ kind: 'link', label: match[2], href: match[3] })
    } else if (match[4]) {
      tokens.push({ kind: 'code', value: match[4] })
    } else if (match[5]) {
      tokens.push({ kind: 'bold', value: match[5] })
    } else if (match[6]) {
      tokens.push({ kind: 'italic', value: match[6] })
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < source.length) {
    tokens.push({ kind: 'text', value: source.slice(lastIndex) })
  }

  return tokens
}

function renderAssistantRichTextNodes(text, keyPrefix = 'assistant-rich-text') {
  return String(text || '')
    .split('\n')
    .flatMap((line, lineIndex, lines) => {
      const lineKey = `${keyPrefix}-line-${lineIndex}`
      const parts = tokenizeInline(line).map((token, tokenIndex) => {
        const tokenKey = `${lineKey}-token-${tokenIndex}`

        if (token.kind === 'bold') {
          return <strong key={tokenKey}>{token.value}</strong>
        }

        if (token.kind === 'italic') {
          return <em key={tokenKey}>{token.value}</em>
        }

        if (token.kind === 'code') {
          return <code key={tokenKey}>{token.value}</code>
        }

        if (token.kind === 'link') {
          return (
            <a key={tokenKey} href={token.href} target="_blank" rel="noreferrer">
              {token.label}
            </a>
          )
        }

        return <span key={tokenKey}>{token.value}</span>
      })

      if (lineIndex === lines.length - 1) {
        return parts
      }

      return [...parts, <br key={`${lineKey}-break`} />]
    })
}

export function AssistantRichText({ as = 'div', text, className = '' }) {
  if (as === 'span') {
    return <span className={className}>{renderAssistantRichTextNodes(text)}</span>
  }

  if (as === 'p') {
    return <p className={className}>{renderAssistantRichTextNodes(text)}</p>
  }

  return <div className={className}>{renderAssistantRichTextNodes(text)}</div>
}
