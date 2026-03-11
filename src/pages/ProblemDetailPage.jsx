import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion as Motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownRight,
  Copy,
  Edit3,
  Eye,
  ExternalLink,
  FileCode2,
  GripHorizontal,
  GripVertical,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MessageSquareReply,
  MoreHorizontal,
  RotateCcw,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CodeEditor } from '../components/editors/CodeEditor'
import { NoteEditor } from '../components/editors/NoteEditor'
import { ProblemAssistantDrawer } from '../components/assistant/ProblemAssistantDrawer'
import { ProblemVisualGallery } from '../components/problems/ProblemVisualGallery'
import { Modal } from '../components/ui/Modal'
import { CompanySymbols } from '../components/ui/CompanySymbols'
import { PlatformSymbol } from '../components/ui/PlatformSymbol'
import { CustomSelect } from '../components/ui/CustomSelect'
import { useCurrentUser } from '../context/user-store'
import { useComments } from '../hooks/useComments'
import { useProblemBundle } from '../hooks/useProblemBundle'
import { useProblemNavigator } from '../hooks/useProblemNavigator'
import { useSharedNotes } from '../hooks/useSharedNotes'
import { useSharedSolutions } from '../hooks/useSharedSolutions'
import { useUserSettings } from '../hooks/useUserSettings'
import {
  formatDate,
  getYoutubeEmbedUrl,
  lcFromSlug,
  problemIdentifierFromSlug,
  problemUrl,
  sourcePlatformForProblem,
  toNumber,
} from '../lib/problem-utils'
import { extractProblemVisuals } from '../lib/problem-visuals'
import { appendBlocksToNoteDoc, blocksToNoteDoc, tableToMarkdown } from '../lib/assistant-notes'
import { buttonTap, outputSwap, panelSwap } from '../lib/motion'
import { missingSupabaseMessage, supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['unsolved', 'attempted', 'review', 'solved']
const FINAL_RUN_STATUSES = new Set(['passed', 'failed', 'error', 'timeout'])
const HARNESS_RESULT_MARKER = '__DSA_RUNNER_RESULT__'
const LEFT_PANE_MIN = 34
const LEFT_PANE_MAX = 58
const LEFT_PANE_DEFAULT = 34
const STORAGE_KEYS = {
  leftPaneWidth: 'problem:left-pane-width',
  leftPaneCollapsed: 'problem:left-pane-collapsed',
  bottomPaneHeight: 'problem:bottom-pane-height',
  bottomPaneCollapsed: 'problem:bottom-pane-collapsed-v2',
}
const STATUS_LABELS = {
  unsolved: 'Unsolved',
  attempted: 'Attempted',
  review: 'Review',
  solved: 'Solved',
}

function getRunMode(run) {
  return String(run?.runner_meta?.mode || '').trim().toLowerCase()
}

function getRunSolutionId(run) {
  return toNumber(run?.solution_id ?? run?.runner_meta?.solution_id)
}

function isPassedSubmitRun(run) {
  return String(run?.status || '').toLowerCase() === 'passed' && getRunMode(run) === 'submit'
}

function truncateRunText(value, maxLength = 520) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}...`
}

function extractUserStdout(value) {
  const raw = String(value || '')
  if (!raw.trim()) {
    return ''
  }

  const markerIndex = raw.lastIndexOf(HARNESS_RESULT_MARKER)
  if (markerIndex < 0) {
    return raw.trim()
  }

  return raw.slice(0, markerIndex).trim()
}

function collapseStdoutLines(stdoutText) {
  const source = String(stdoutText || '')
  if (!source.trim()) {
    return {
      lines: [],
      collapsed: [],
    }
  }

  const lines = source
    .split('\n')
    .map((line) => line.replace(/\r/g, ''))
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return {
      lines: [],
      collapsed: [],
    }
  }

  const collapsed = []
  let current = { text: lines[0], count: 1 }

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === current.text) {
      current.count += 1
      continue
    }

    collapsed.push(current)
    current = { text: line, count: 1 }
  }

  collapsed.push(current)
  return {
    lines,
    collapsed,
  }
}

function getCodePreview(code, maxLines = 3, maxChars = 220) {
  const lines = String(code || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())

  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift()
  }

  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop()
  }

  if (lines.length === 0) {
    return ''
  }

  const previewLines = lines.slice(0, maxLines)
  let preview = previewLines.join('\n')
  const truncated = lines.length > maxLines || preview.length > maxChars

  if (preview.length > maxChars) {
    preview = preview.slice(0, maxChars).trimEnd()
  }

  return truncated ? `${preview}\n…` : preview
}

function flattenRichText(value) {
  if (!value) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenRichText(item)).filter(Boolean).join(' ')
  }

  if (typeof value === 'object') {
    const ownText = typeof value.text === 'string' ? value.text : ''
    const childText = Array.isArray(value.content) ? flattenRichText(value.content) : ''
    return [ownText, childText].filter(Boolean).join(' ')
  }

  return ''
}

function getNotePreview(content, maxChars = 220) {
  const text = flattenRichText(content).replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }

  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text
}

function initialsFromKey(value) {
  const source = String(value || '').trim()
  if (!source) {
    return '??'
  }

  const compact = source.replace(/[^A-Za-z0-9]+/g, ' ').trim()
  if (!compact) {
    return source.slice(0, 2).toUpperCase()
  }

  const parts = compact.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return parts[0].slice(0, 2).toUpperCase()
}

function defaultNoteContent() {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}

function buildNotePayload(title, summary, blocks) {
  return {
    title,
    summary,
    blocks,
  }
}

function buildCodeBlock(code, language, heading = '') {
  return {
    kind: language === 'sql' ? 'sql' : 'code',
    heading,
    code: String(code || '').trim(),
    language,
  }
}

function solutionSortOrderValue(solution) {
  const numeric = Number(solution?.sort_order)
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER
}

function solutionUpdatedAtValue(solution) {
  const timestamp = Date.parse(solution?.updated_at || solution?.created_at || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function dedupeSolutionsBySortOrder(solutions) {
  const entries = Array.isArray(solutions) ? solutions : []
  const byOrder = new Map()

  for (const solution of entries) {
    const key = solutionSortOrderValue(solution)
    const existing = byOrder.get(key)
    if (!existing || solutionUpdatedAtValue(solution) > solutionUpdatedAtValue(existing)) {
      byOrder.set(key, solution)
    }
  }

  return Array.from(byOrder.values()).sort((left, right) => {
    const orderDelta = solutionSortOrderValue(left) - solutionSortOrderValue(right)
    if (orderDelta !== 0) {
      return orderDelta
    }
    return (left?.id ?? 0) - (right?.id ?? 0)
  })
}

function nextSolutionSortOrder(solutions) {
  return (Array.isArray(solutions) ? solutions : []).reduce((maxValue, solution) => {
    const numeric = Number(solution?.sort_order)
    return Number.isFinite(numeric) ? Math.max(maxValue, numeric) : maxValue
  }, -1) + 1
}

async function copyValueToClipboard(value) {
  await navigator.clipboard.writeText(String(value || ''))
}

function emptyResourceForm() {
  return { url: '', title: '', type: 'other' }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function clampNumber(value, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return min
  }
  return Math.min(max, Math.max(min, numeric))
}

function readStoredNumber(key, fallback, min, max) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const rawValue = window.localStorage.getItem(key)
  if (!rawValue) {
    return fallback
  }

  return clampNumber(Number(rawValue), min, max)
}

function readStoredBoolean(key, fallback = false) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const rawValue = window.localStorage.getItem(key)
  if (rawValue === '1') {
    return true
  }

  if (rawValue === '0') {
    return false
  }

  return fallback
}

function toPlainText(value) {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function toCompactPreview(value, maxLength = 84) {
  const source = toPlainText(value).replace(/\s+/g, ' ').trim()
  if (!source) {
    return ''
  }

  if (source.length <= maxLength) {
    return source
  }

  return `${source.slice(0, maxLength - 1)}…`
}

function renderInlineText(text, keyPrefix) {
  const source = String(text ?? '')
  if (!source) {
    return null
  }

  const tokens = source.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean)
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded-[2px] border border-border-subtle bg-surface px-1 font-mono text-[12px] text-text-primary"
        >
          {token.slice(1, -1)}
        </code>
      )
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-strong-${index}`} className="font-medium text-text-primary">
          {token.slice(2, -2)}
        </strong>
      )
    }

    return <span key={`${keyPrefix}-text-${index}`}>{token}</span>
  })
}

function splitKeyValueLine(line) {
  const match = String(line ?? '').match(/^([A-Za-z][A-Za-z0-9 ()/_-]{1,40}):\s*(.+)$/)
  if (!match) {
    return null
  }

  return {
    key: match[1],
    value: match[2],
  }
}

function parseDescription(text) {
  const source = String(text || '')
  if (!source.trim()) {
    return []
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let index = 0
  let paragraphLines = []

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n').trim() })
    paragraphLines = []
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      flushParagraph()
      index += 1
      const codeLines = []
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', text: codeLines.join('\n') })
      if (index < lines.length) {
        index += 1
      }
      continue
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph()
      blocks.push({
        type: 'heading',
        level: Math.min(3, (trimmed.match(/^#+/)?.[0]?.length ?? 1)),
        text: trimmed.replace(/^#{1,3}\s+/, ''),
      })
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph()
      const items = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph()
      const items = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    paragraphLines.push(line)
    index += 1
  }

  flushParagraph()
  return blocks
}

function FormattedDescription({ text }) {
  const blocks = useMemo(() => parseDescription(text), [text])

  if (blocks.length === 0) {
    return <p className="reading-copy text-[15px] text-text-muted">No dataset statement available for this problem yet.</p>
  }

  return (
    <div className="reading-copy space-y-3.5 text-[15px] leading-7 text-text-primary">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h2 key={`desc-${index}`} className="text-[17px] font-semibold tracking-[-0.01em] text-text-primary">
                {block.text}
              </h2>
            )
          }

          return (
            <h3 key={`desc-${index}`} className="text-[15px] font-semibold text-text-primary">
              {block.text}
            </h3>
          )
        }

        if (block.type === 'code') {
          return (
            <pre
              key={`desc-${index}`}
              className="overflow-x-auto border border-border-subtle bg-surface p-2.5 font-mono text-[12px] leading-6 text-text-primary"
            >
              {block.text}
            </pre>
          )
        }

        if (block.type === 'ul') {
          return (
            <ul key={`desc-${index}`} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={`desc-${index}-li-${itemIndex}`}>{renderInlineText(item, `desc-${index}-li-${itemIndex}`)}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'ol') {
          return (
            <ol key={`desc-${index}`} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={`desc-${index}-li-${itemIndex}`}>{renderInlineText(item, `desc-${index}-li-${itemIndex}`)}</li>
              ))}
            </ol>
          )
        }

        const lines = String(block.text || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)

        const keyedLines = lines.map((line) => ({
          raw: line,
          pair: splitKeyValueLine(line),
        }))
        const keyValueCount = keyedLines.filter((line) => Boolean(line.pair)).length
        const hasKeyValues = keyValueCount > 0
        const isExampleHeading = lines.length === 1 && /^example\s+\d+[:.]?$/i.test(lines[0])
        const isSectionHeading = lines.length === 1 && /^[A-Za-z][A-Za-z0-9 ()/_-]{1,40}:$/.test(lines[0])

        if (isExampleHeading || isSectionHeading) {
          return (
            <h3 key={`desc-${index}`} className="font-mono text-sm text-text-primary">
              {lines[0].replace(/[:.]$/, '')}
            </h3>
          )
        }

        if (hasKeyValues) {
          return (
            <div key={`desc-${index}`} className="space-y-2 border border-border-subtle bg-base p-3">
              {keyedLines.map((line, itemIndex) => {
                if (line.pair) {
                  return (
                    <div key={`desc-${index}-kv-${itemIndex}`} className="grid grid-cols-[124px_minmax(0,1fr)] gap-2.5 text-[13px] leading-6">
                      <span className="font-mono text-[12px] text-text-muted">{line.pair.key}</span>
                      <span className="text-text-primary">
                        {renderInlineText(line.pair.value, `desc-${index}-kv-${itemIndex}`)}
                      </span>
                    </div>
                  )
                }

                return (
                  <p key={`desc-${index}-text-${itemIndex}`} className="text-[14px] leading-6 text-text-primary">
                    {renderInlineText(line.raw, `desc-${index}-line-${itemIndex}`)}
                  </p>
                )
              })}
            </div>
          )
        }

        return (
          <p key={`desc-${index}`} className="whitespace-pre-wrap">
            {renderInlineText(block.text, `desc-${index}`)}
          </p>
        )
      })}
    </div>
  )
}

function formatMonospaceValue(value) {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return String(value)
  }

  return JSON.stringify(value)
}

function formatTableCell(value) {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

function DataTable({ columns, rows, compact = false }) {
  const safeColumns = Array.isArray(columns) ? columns : []
  const safeRows = Array.isArray(rows) ? rows : []
  if (safeColumns.length === 0) {
    return null
  }

  return (
    <div className="overflow-x-auto border border-border-subtle bg-base">
      <table className="data-table-readable min-w-full border-collapse">
        <thead>
          <tr className="bg-surface">
            {safeColumns.map((column) => (
              <th
                key={`col-${column}`}
                className={[
                  'border-b border-border-subtle px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted',
                  compact ? 'whitespace-nowrap' : '',
                ].join(' ')}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="align-top">
              {safeColumns.map((_, columnIndex) => (
                <td
                  key={`row-${rowIndex}-col-${columnIndex}`}
                  className="border-t border-border-subtle px-3 py-2.5 font-mono text-[12px] leading-6 text-text-primary"
                >
                  {formatTableCell(Array.isArray(row) ? row[columnIndex] : undefined)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SqlSchemaSection({ schema }) {
  const [activeIndex, setActiveIndex] = useState(0)

  if (!Array.isArray(schema) || schema.length === 0) {
    return null
  }

  const multiTable = schema.length > 1
  const visibleIndex = Math.min(activeIndex, schema.length - 1)
  const table = schema[visibleIndex] || schema[0]

  return (
    <div className="space-y-2 border border-border-subtle bg-base p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">Schema</p>
        {multiTable ? <span className="font-mono text-[11px] text-text-muted">{visibleIndex + 1} / {schema.length}</span> : null}
      </div>
      <article className="border border-border-subtle bg-surface p-2.5">
        <div className="flex items-center gap-2">
          {multiTable ? (
            <button
              type="button"
              onClick={() => setActiveIndex((current) => (current - 1 + schema.length) % schema.length)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-border-subtle bg-base text-text-muted hover:border-accent hover:text-accent"
              aria-label="Previous schema table"
            >
              <ChevronLeft size={13} />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-text-muted">{table?.name}</p>
            <div className="mt-2">
              <DataTable
                columns={['Column', 'Type']}
                rows={(table?.columns || []).map((column) => [column.name, column.type])}
                compact
              />
            </div>
          </div>
          {multiTable ? (
            <button
              type="button"
              onClick={() => setActiveIndex((current) => (current + 1) % schema.length)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-border-subtle bg-base text-text-muted hover:border-accent hover:text-accent"
              aria-label="Next schema table"
            >
              <ChevronRight size={13} />
            </button>
          ) : null}
        </div>
      </article>
    </div>
  )
}

function SqlExamplesSection({ examples }) {
  if (!Array.isArray(examples) || examples.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 border border-border-subtle bg-base p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">Examples</p>
      <div className="space-y-2">
        {examples.map((example, index) => (
          <article key={`sql-example-${index + 1}`} className="border border-border-subtle bg-surface p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {example?.label || `Example ${index + 1}`}
            </p>
            <div className="mt-2 space-y-3">
              {(example?.tables || []).map((table, tableIndex) => (
                <div key={`sql-example-${index + 1}-table-${table.name || tableIndex}`} className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{table.name}</p>
                  <DataTable columns={table.columns || []} rows={table.rows || []} />
                </div>
              ))}
              {example?.output ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Output</p>
                  <DataTable columns={example.output.columns || []} rows={example.output.rows || []} />
                </div>
              ) : null}
              {example?.explanation ? (
                <p className="text-[14px] leading-6 text-text-primary">{example.explanation}</p>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function SqlRequirementsSection({ requirements }) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 border border-border-subtle bg-base p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">Requirements</p>
      <div className="border border-border-subtle bg-surface p-2.5">
        <ul className="list-disc space-y-1.5 pl-5">
        {requirements.map((item, index) => (
          <li key={`sql-requirement-${index}`} className="text-[14px] leading-6 text-text-primary">
            {item}
          </li>
        ))}
        </ul>
      </div>
    </div>
  )
}

function ProblemExamplesSection({ examples }) {
  if (!examples.length) {
    return null
  }

  return (
    <div className="border border-border-subtle bg-base p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Examples</p>
      <div className="mt-2 space-y-2">
        {examples.map((example, index) => {
          const rows = [
            { label: 'Input', value: formatMonospaceValue(example?.input) },
            { label: 'Output', value: formatMonospaceValue(example?.output) },
          ]
          return (
            <article key={`example-${index + 1}`} className="border border-border-subtle bg-surface p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Example {index + 1}</p>
              <div className="mt-2 space-y-2">
                {rows.map((row) => (
                  <div key={`example-${index + 1}-${row.label}`} className="space-y-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{row.label}</p>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-border-subtle bg-base p-2 font-mono text-[11px] leading-5 text-text-primary">
                      {row.value}
                    </pre>
                  </div>
                ))}
                {example?.explanation ? (
                  <div className="space-y-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Explanation</p>
                    <p className="text-[12px] leading-6 text-text-primary">{example.explanation}</p>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function ProblemInterfaceSection({ presentation }) {
  const interfaceItems = presentation?.interfaceItems ?? []
  const nodeShape = presentation?.nodeShape ?? []

  if (interfaceItems.length === 0 && nodeShape.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 border border-border-subtle bg-base p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Interface</p>

      {nodeShape.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border border-border-subtle bg-surface p-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Node fields</span>
          {nodeShape.map((field) => (
            <span
              key={`node-field-${field}`}
              className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 font-mono text-[10px] text-text-primary"
            >
              {field}
            </span>
          ))}
        </div>
      ) : null}

      {interfaceItems.length > 0 ? (
        <div className="divide-y divide-border-subtle border border-border-subtle bg-surface">
          {interfaceItems.map((item, index) => (
            <div key={`api-item-${index}`} className="grid gap-1 px-3 py-2 md:grid-cols-[200px_minmax(0,1fr)] md:gap-3">
              <code className="font-mono text-[11px] text-text-primary">{item.signature || item.description}</code>
              {item.signature && item.description ? (
                <p className="text-[12px] leading-6 text-text-primary">{item.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ProblemConstraintsSection({ presentation }) {
  const constraints = presentation?.constraints ?? []
  const followUp = presentation?.followUp ?? []

  if (constraints.length === 0 && followUp.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 border border-border-subtle bg-base p-3">
      {constraints.length > 0 ? (
        <>
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Constraints</p>
          <div className="space-y-1 border border-border-subtle bg-surface p-2">
            {constraints.map((line, index) => (
              <p key={`constraint-${index}`} className="font-mono text-[11px] leading-5 text-text-primary">
                {line}
              </p>
            ))}
          </div>
        </>
      ) : null}

      {followUp.length > 0 ? (
        <>
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Follow Up</p>
          <div className="space-y-1 border border-border-subtle bg-surface p-2">
            {followUp.map((line, index) => (
              <p key={`follow-up-${index}`} className="text-[12px] leading-6 text-text-primary">
                {renderInlineText(line, `follow-up-${index}`)}
              </p>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function relativeTime(dateString) {
  if (!dateString) return ''
  const now = Date.now()
  const then = new Date(dateString).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(dateString))
}

function SourceHeaderButton({ href, platform }) {
  const label = String(platform || '').trim()
  if (!href || !label) {
    return null
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 items-center gap-1.5 border border-border-subtle px-2.5 text-[11px] text-text-muted hover:border-accent hover:text-accent"
    >
      <PlatformSymbol platform={label} size="sm" bare className="h-4 w-4 shrink-0" />
      <span>{label}</span>
      <ArrowUpRight size={12} />
    </a>
  )
}

function splitSqlStatements(sql) {
  const source = String(sql || '')
  const statements = []
  let current = ''
  let inQuote = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    current += char

    if (char === "'" && next === "'") {
      current += next
      index += 1
      continue
    }

    if (char === "'") {
      inQuote = !inQuote
      continue
    }

    if (char === ';' && !inQuote) {
      const statement = current.slice(0, -1).trim()
      if (statement) {
        statements.push(statement)
      }
      current = ''
    }
  }

  const trailing = current.trim()
  if (trailing) {
    statements.push(trailing)
  }

  return statements
}

function splitSqlTopLevel(input) {
  const source = String(input || '')
  const tokens = []
  let current = ''
  let depth = 0
  let inQuote = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    current += char

    if (char === "'" && next === "'") {
      current += next
      index += 1
      continue
    }

    if (char === "'") {
      inQuote = !inQuote
      continue
    }

    if (!inQuote) {
      if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth = Math.max(0, depth - 1)
      } else if (char === ',' && depth === 0) {
        tokens.push(current.slice(0, -1).trim())
        current = ''
      }
    }
  }

  const trailing = current.trim()
  if (trailing) {
    tokens.push(trailing)
  }

  return tokens
}

function parseSqlLiteral(token) {
  const source = String(token || '').trim()
  if (!source) {
    return null
  }

  if (/^null$/i.test(source)) {
    return null
  }

  if (/^(true|false)$/i.test(source)) {
    return /^true$/i.test(source)
  }

  if (/^-?\d+(\.\d+)?$/.test(source)) {
    return Number(source)
  }

  if (source.startsWith("'") && source.endsWith("'")) {
    return source.slice(1, -1).replace(/''/g, "'")
  }

  return source
}

function parseSqlTupleRows(valuesSource) {
  const source = String(valuesSource || '').trim()
  const rows = []
  let tuple = ''
  let depth = 0
  let inQuote = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (char === "'" && next === "'") {
      tuple += char + next
      index += 1
      continue
    }

    if (char === "'") {
      inQuote = !inQuote
      tuple += char
      continue
    }

    if (!inQuote && char === '(') {
      depth += 1
      if (depth === 1) {
        tuple = ''
        continue
      }
    }

    if (!inQuote && char === ')') {
      depth -= 1
      if (depth === 0) {
        rows.push(splitSqlTopLevel(tuple).map(parseSqlLiteral))
        tuple = ''
        continue
      }
    }

    if (depth >= 1) {
      tuple += char
    }
  }

  return rows
}

function parseSqlSetupTables(setupSql) {
  const tableMap = new Map()
  const tableOrder = []

  const ensureTable = (tableName) => {
    const normalized = String(tableName || '').replace(/^"|"$/g, '').trim()
    if (!normalized) {
      return null
    }
    if (!tableMap.has(normalized)) {
      tableMap.set(normalized, {
        name: normalized,
        columns: [],
        rows: [],
      })
      tableOrder.push(normalized)
    }
    return tableMap.get(normalized)
  }

  for (const statement of splitSqlStatements(setupSql)) {
    const createMatch = statement.match(/^CREATE\s+TABLE\s+("?[\w]+"?)\s*\(([\s\S]+)\)$/i)
    if (createMatch) {
      const table = ensureTable(createMatch[1])
      if (!table) {
        continue
      }
      const columnDefs = splitSqlTopLevel(createMatch[2])
      table.columns = columnDefs
        .map((definition) => definition.trim())
        .filter(Boolean)
        .map((definition) => {
          const parts = definition.split(/\s+/)
          return {
            name: String(parts.shift() || '').replace(/^"|"$/g, ''),
            type: parts.join(' '),
          }
        })
        .filter((column) => column.name)
      continue
    }

    const insertMatch = statement.match(/^INSERT\s+INTO\s+("?[\w]+"?)\s+VALUES\s+([\s\S]+)$/i)
    if (insertMatch) {
      const table = ensureTable(insertMatch[1])
      if (!table) {
        continue
      }
      table.rows.push(...parseSqlTupleRows(insertMatch[2]))
    }
  }

  return tableOrder.map((tableName) => tableMap.get(tableName)).filter(Boolean)
}

function SqlDataPanel({ fixtures, selectedFixtureId, onSelectFixtureId, selectedRunCase }) {
  const publicFixtures = useMemo(() => fixtures.filter((fixture) => fixture.is_public), [fixtures])
  const visibleFixtures = publicFixtures.length > 0 ? publicFixtures : fixtures
  const fixtureLabelMap = useMemo(
    () => new Map(visibleFixtures.map((fixture, index) => [String(fixture.fixture_key || fixture.id), `Sample ${index + 1}`])),
    [visibleFixtures],
  )
  const activeFixture =
    visibleFixtures.find((fixture) => String(fixture.fixture_key || fixture.id) === String(selectedFixtureId)) ?? visibleFixtures[0] ?? null
  const activeFixtureId = activeFixture ? String(activeFixture.fixture_key || activeFixture.id) : ''
  const [tableIndex, setTableIndex] = useState(0)
  const tables = useMemo(() => parseSqlSetupTables(activeFixture?.setup_sql), [activeFixture?.setup_sql])

  if (!activeFixture) {
    return <p className="text-[15px] leading-7 text-text-muted">No sample data available.</p>
  }

  const currentTable = tables[tableIndex] ?? tables[0] ?? null
  const multipleSamples = visibleFixtures.length > 1
  const multipleTables = tables.length > 1

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">Data</p>
        {selectedRunCase ? <CaseStatusBadge status={selectedRunCase.passed ? 'pass' : selectedRunCase.error ? 'error' : 'fail'} /> : null}
      </div>

      {multipleSamples ? (
        <div className="scrollbar-none overflow-x-auto">
          <div className="flex min-w-max items-center gap-1">
            {visibleFixtures.map((fixture) => {
              const fixtureId = String(fixture.fixture_key || fixture.id)
              const isActive = fixtureId === activeFixtureId
              return (
                <button
                  key={`sql-sample-${fixtureId}`}
                  type="button"
                  onClick={() => onSelectFixtureId(fixtureId)}
                  className={[
                    'inline-flex h-7 items-center border px-2 text-[11px]',
                    isActive
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                  ].join(' ')}
                >
                  {fixtureLabelMap.get(fixtureId) || 'Sample'}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {currentTable ? (
        <div className="space-y-2 border border-border-subtle bg-base p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {multipleTables ? (
                <button
                  type="button"
                  onClick={() => setTableIndex((current) => (current - 1 + tables.length) % tables.length)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-border-subtle bg-surface text-text-muted hover:border-accent hover:text-accent"
                  aria-label="Previous sample table"
                >
                  <ChevronLeft size={13} />
                </button>
              ) : null}
              <p className="truncate text-sm text-text-primary">{currentTable.name}</p>
            </div>
            {multipleTables ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-text-muted">
                  {tableIndex + 1} / {tables.length}
                </span>
                <button
                  type="button"
                  onClick={() => setTableIndex((current) => (current + 1) % tables.length)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-border-subtle bg-surface text-text-muted hover:border-accent hover:text-accent"
                  aria-label="Next sample table"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            ) : null}
          </div>

          <DataTable
            columns={currentTable.columns.map((column) => column.name)}
            rows={currentTable.rows}
          />
        </div>
      ) : (
        <div className="border border-border-subtle bg-base p-3 text-[15px] leading-7 text-text-muted">No sample data available.</div>
      )}
    </div>
  )
}

function StatusSelector({ value, onChange, busy }) {
  return (
    <label className="inline-flex items-center gap-2 text-[11px] text-text-muted">
      <span>Status</span>
      <CustomSelect
        value={value}
        disabled={busy}
        onChange={onChange}
        options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        className="min-w-[140px]"
      />
    </label>
  )
}

function LeftTabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'h-7 shrink-0 border-r border-border-subtle px-2.5 text-[11px] tracking-[0.02em] last:border-r-0',
        active ? 'bg-base text-accent' : 'text-text-muted hover:text-text-primary',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function RightTabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'h-7 shrink-0 border-r border-border-subtle px-2.5 text-[11px] tracking-[0.02em] last:border-r-0',
        active ? 'bg-base text-accent' : 'text-text-muted hover:text-text-primary',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function InlineSectionMessage({ message }) {
  if (!message) {
    return null
  }

  return (
    <div className="border border-border-subtle bg-base px-3 py-2 text-[11px] leading-5 text-text-primary">
      {message}
    </div>
  )
}

function CaseStatusBadge({ status }) {
  const label = status === 'pass' ? 'pass' : status === 'error' ? 'error' : 'fail'
  const markerClass =
    status === 'pass' ? 'bg-accent' : status === 'error' ? 'bg-text-muted' : 'border border-accent bg-base'

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
      <span className={['h-1.5 w-1.5 shrink-0 rounded-full', markerClass].join(' ')} />
      {label}
    </span>
  )
}

function isSqlResultTable(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray(value.columns) &&
      Array.isArray(value.rows),
  )
}

function SqlResultPreview({ value, tone = 'primary' }) {
  const columns = Array.isArray(value?.columns) ? value.columns : []
  const rows = Array.isArray(value?.rows) ? value.rows : []

  if (columns.length === 0) {
    return <p className={tone === 'muted' ? 'text-text-muted' : 'text-text-primary'}>No columns returned.</p>
  }

  return (
    <div className="overflow-x-auto border border-border-subtle bg-base">
      <table className="min-w-full border-collapse font-mono text-[11px]">
        <thead className="bg-surface text-text-muted">
          <tr>
            {columns.map((column) => (
              <th key={`sql-col-${column}`} className="border-b border-border-subtle px-2 py-1 text-left font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tone === 'muted' ? 'text-text-muted' : 'text-text-primary'}>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="px-2 py-2">
                No rows returned.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={`sql-row-${rowIndex}`} className="border-t border-border-subtle">
                {columns.map((column, columnIndex) => {
                  const cellValue = Array.isArray(row) ? row[columnIndex] : row?.[column]
                  const isNullish = cellValue === null || cellValue === undefined

                  return (
                    <td key={`sql-row-${rowIndex}-${column}-${columnIndex}`} className="max-w-[220px] px-2 py-1 align-top">
                      <span className={isNullish ? 'break-words text-text-muted' : 'break-words'}>
                        {isNullish ? 'NULL' : toPlainText(cellValue)}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function CaseDetailBlock({ label, value, tone = 'primary' }) {
  return (
    <div className="min-w-0 bg-surface px-2 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</p>
      <div className="mt-1">
        {isSqlResultTable(value) ? (
          <SqlResultPreview value={value} tone={tone} />
        ) : (
          <pre
            className={[
              'overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5',
              tone === 'muted' ? 'text-text-muted' : 'text-text-primary',
            ].join(' ')}
          >
            {toPlainText(value)}
          </pre>
        )}
      </div>
    </div>
  )
}

function CaseResultsSection({
  run,
  activeTests,
  focusedTestIds,
  onToggleFocusedTest,
  onClearFocusedTests,
  onUseFailedCases,
}) {
  const [filter, setFilter] = useState('all')
  const cases = useMemo(() => (Array.isArray(run?.verdict?.cases) ? run.verdict.cases : []), [run])
  const [expandedCaseIds, setExpandedCaseIds] = useState(
    () => new Set(cases.filter((caseResult) => !caseResult?.passed).map((caseResult) => caseResult.id)),
  )
  const [expandedFallbackIds, setExpandedFallbackIds] = useState(() => new Set())
  const activeTestsById = useMemo(() => new Map(activeTests.map((test) => [test.id, test])), [activeTests])
  const visibleCases = useMemo(() => {
    if (filter === 'failed') {
      return cases.filter((caseResult) => !caseResult?.passed)
    }
    return cases
  }, [cases, filter])
  const focusSet = useMemo(() => new Set(focusedTestIds), [focusedTestIds])
  const failedCount = cases.filter((caseResult) => !caseResult?.passed).length
  const selectedCount = focusSet.size
  const harnessType = String(run?.runner_meta?.harness_type || '').toLowerCase()
  const supportsFocusedRun = new Set(['generic', 'sql']).has(harnessType) && cases.length > 0

  if (!run) {
    return <p className="text-sm text-text-muted">Run or submit your code to inspect per-case results.</p>
  }

  if (cases.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border border-border-subtle bg-base px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-muted">
            <span>{activeTests.length} cases</span>
            <span className="text-[10px] uppercase tracking-[0.08em]">Custom evaluator</span>
          </div>
          <span className="text-[11px] text-text-muted">Inputs and expectations only for this run.</span>
        </div>
        <div className="divide-y divide-border-subtle border border-border-subtle bg-base">
          {activeTests.map((test) => {
            const isExpanded = expandedFallbackIds.has(test.id)
            return (
              <article key={`case-fallback-${test.id}`}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFallbackIds((current) => {
                      const next = new Set(current)
                      if (next.has(test.id)) {
                        next.delete(test.id)
                      } else {
                        next.add(test.id)
                      }
                      return next
                    })
                  }
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="font-mono text-[11px] text-text-primary">Case #{test.sort_order || test.id}</span>
                    <span className="min-w-0 truncate font-mono text-[10px] text-text-muted">
                      {toCompactPreview(test.input_text)}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">aggregate</span>
                  {isExpanded ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
                </button>
                {isExpanded ? (
                  <div className="grid gap-px border-t border-border-subtle bg-border-subtle md:grid-cols-2">
                    <CaseDetailBlock label="Input" value={toPlainText(test.input_text)} />
                    <CaseDetailBlock label="Expected" value={toPlainText(test.expected_output)} />
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-border-subtle bg-base px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-muted">
          <span>{cases.length} cases</span>
          <span>{failedCount} failed</span>
          {selectedCount > 0 ? <span className="text-accent">{selectedCount} selected</span> : null}
          <div className="flex items-center overflow-hidden border border-border-subtle">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={[
                'inline-flex h-6 items-center px-2 text-[10px]',
                filter === 'all' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary',
              ].join(' ')}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter('failed')}
              className={[
                'inline-flex h-6 items-center border-l border-border-subtle px-2 text-[10px]',
                filter === 'failed' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary',
              ].join(' ')}
            >
              Failed
            </button>
          </div>
        </div>

        {supportsFocusedRun ? (
          <div className="flex flex-wrap items-center gap-1">
            {failedCount > 0 ? (
              <button
                type="button"
                onClick={onUseFailedCases}
                className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
              >
                Select failed
              </button>
            ) : null}
            {selectedCount > 0 ? (
              <button
                type="button"
                onClick={onClearFocusedTests}
                className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="divide-y divide-border-subtle border border-border-subtle bg-base">
        {visibleCases.map((caseResult) => {
          const status = caseResult?.passed ? 'pass' : caseResult?.error ? 'error' : 'fail'
          const isExpanded = expandedCaseIds.has(caseResult.id)
          const isFocused = focusSet.has(caseResult.id)
          const linkedTest = activeTestsById.get(caseResult.id)
          return (
            <article key={`case-result-${caseResult.id}`} className={isFocused ? 'bg-accent/5' : ''}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                {supportsFocusedRun ? (
                  <button
                    type="button"
                    onClick={() => onToggleFocusedTest(caseResult.id)}
                    className={[
                      'inline-flex h-5 w-5 items-center justify-center border',
                      isFocused
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                    ].join(' ')}
                    title={isFocused ? 'Deselect case' : 'Select case'}
                  >
                    {isFocused ? <Check size={11} /> : null}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() =>
                    setExpandedCaseIds((current) => {
                      const next = new Set(current)
                      if (next.has(caseResult.id)) {
                        next.delete(caseResult.id)
                      } else {
                        next.add(caseResult.id)
                      }
                      return next
                    })
                  }
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left hover:text-text-primary"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="font-mono text-[11px] text-text-primary">
                      Case #{caseResult.sort_order || linkedTest?.sort_order || caseResult.id}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[10px] text-text-muted">
                      {toCompactPreview(caseResult.input ?? linkedTest?.input_text)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <CaseStatusBadge status={status} />
                    {isExpanded ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
                  </div>
                </button>
              </div>

              {isExpanded ? (
                <div className="grid gap-px border-t border-border-subtle bg-border-subtle md:grid-cols-3">
                  <CaseDetailBlock label="Input" value={toPlainText(caseResult.input ?? linkedTest?.input_text)} />
                  <CaseDetailBlock label="Expected" value={toPlainText(caseResult.expected ?? linkedTest?.expected_output)} />
                  <CaseDetailBlock
                    label={caseResult.error ? 'Status' : 'Output'}
                    value={
                      caseResult.error
                        ? 'Execution failed before producing a comparable output.'
                        : toPlainText(caseResult.output)
                    }
                    tone={caseResult.error ? 'muted' : 'primary'}
                  />
                  {caseResult.error ? (
                    <div className="bg-surface px-2 py-2 md:col-span-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Trace</p>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-muted">
                        {truncateRunText(caseResult.error, 1200)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}

// ─── Comments section ─────────────────────────────────────────────────────────
function CommentsSection({ commentsState, userKey, focusedCommentId }) {
  const { comments, loading, error, addComment, updateComment, deleteComment } = commentsState
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [replyingToId, setReplyingToId] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [menuCommentId, setMenuCommentId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [collapsedCommentIds, setCollapsedCommentIds] = useState(() => new Set())

  const commentsByParent = useMemo(() => {
    const map = new Map()
    for (const comment of comments) {
      const key = comment.parent_comment_id ?? 'root'
      const bucket = map.get(key) ?? []
      bucket.push(comment)
      map.set(key, bucket)
    }

    for (const bucket of map.values()) {
      bucket.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }

    return map
  }, [comments])

  const rootComments = commentsByParent.get('root') ?? []

  useEffect(() => {
    if (!focusedCommentId) {
      return
    }

    setCollapsedCommentIds((current) => {
      const byId = new Map(comments.map((comment) => [comment.id, comment]))
      const next = new Set(current)
      let active = byId.get(focusedCommentId)
      let changed = false

      while (active?.parent_comment_id) {
        if (next.delete(active.parent_comment_id)) {
          changed = true
        }
        active = byId.get(active.parent_comment_id)
      }

      return changed ? next : current
    })

    const node = document.getElementById(`comment-${focusedCommentId}`)
    if (!node) {
      return
    }

    window.setTimeout(() => {
      node.scrollIntoView({ block: 'nearest' })
    }, 0)
  }, [comments, focusedCommentId])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!draft.trim()) return
    setBusy(true)
    setLocalError('')
    try {
      await addComment(draft, null)
      setDraft('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to post comment.')
    } finally {
      setBusy(false)
    }
  }

  const handleUpdate = async (id) => {
    if (!editText.trim()) return
    setBusy(true)
    setLocalError('')
    try {
      await updateComment(id, editText)
      setEditingId(null)
      setEditText('')
      setMenuCommentId(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update comment.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id) => {
    setBusy(true)
    setLocalError('')
    try {
      await deleteComment(id)
      setMenuCommentId((current) => (current === id ? null : current))
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to delete comment.')
    } finally {
      setBusy(false)
    }
  }

  const handleReply = async (parentId) => {
    if (!replyText.trim()) return
    setBusy(true)
    setLocalError('')
    try {
      await addComment(replyText, parentId)
      setReplyingToId(null)
      setReplyText('')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to post reply.')
    } finally {
      setBusy(false)
    }
  }

  const resetInteractionState = () => {
    setMenuCommentId(null)
    setEditingId(null)
    setEditText('')
    setReplyingToId(null)
    setReplyText('')
  }

  const toggleReplies = (commentId) => {
    setCollapsedCommentIds((current) => {
      const next = new Set(current)
      if (next.has(commentId)) {
        next.delete(commentId)
      } else {
        next.add(commentId)
      }
      return next
    })
  }

  const renderComment = (comment, depth = 0) => {
    const isOwn = comment.author_user_key === userKey
    const menuOpen = menuCommentId === comment.id
    const children = commentsByParent.get(comment.id) ?? []
    const isFocused = comment.id === focusedCommentId
    const authorLabel = String(comment.author_user_key || 'User').trim() || 'User'
    const avatarLabel = authorLabel.slice(0, 2).toUpperCase()
    const isReply = depth > 0
    const repliesCollapsed = collapsedCommentIds.has(comment.id)

    return (
      <article
        id={`comment-${comment.id}`}
        key={`comment-${comment.id}`}
        className={[
          'group/comment min-w-0 transition-colors',
          isReply ? 'mt-2 ml-3 border-l-2 border-border-subtle pl-3' : 'border-b border-border-subtle last:border-b-0',
          isFocused ? 'bg-accent/5' : '',
          isOwn && !isReply ? 'border-l-2 border-l-accent/40 pl-3' : '',
        ].join(' ')}
      >
        <div className="flex items-start gap-2.5 py-2.5 pr-2">
          <div
            className={[
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm font-mono text-[10px]',
              isOwn ? 'bg-accent/15 text-accent' : 'bg-surface text-text-muted',
            ].join(' ')}
          >
            {avatarLabel}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {isReply ? <CornerDownRight size={10} className="shrink-0 text-text-muted/50" /> : null}
                <span className={isOwn ? 'font-mono text-[11px] font-medium text-accent' : 'font-mono text-[11px] font-medium text-text-primary'}>
                  {authorLabel}
                </span>
                <span className="font-mono text-[10px] text-text-muted" title={formatDate(comment.created_at, 'Unknown')}>
                  {relativeTime(comment.created_at)}
                </span>
                {comment.updated_at && comment.updated_at !== comment.created_at ? (
                  <span className="text-[9px] italic text-text-muted/50">edited</span>
                ) : null}
              </div>

              {isOwn ? (
              <div className="relative shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    setMenuCommentId((current) => (current === comment.id ? null : comment.id))
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-accent"
                  title="Comment actions"
                >
                  <MoreHorizontal size={14} />
                </button>

                {isOwn && menuOpen ? (
                  <div className="absolute right-0 top-7 z-10 min-w-[100px] overflow-hidden rounded-sm border border-border-subtle bg-base shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(comment.id)
                        setEditText(comment.content)
                        setMenuCommentId(null)
                        setReplyingToId(null)
                        setReplyText('')
                      }}
                      className="flex h-7 w-full items-center gap-1.5 px-2 text-[11px] text-text-muted hover:bg-surface hover:text-text-primary"
                    >
                      <Edit3 size={11} /> Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(comment.id)}
                      className="flex h-7 w-full items-center gap-1.5 px-2 text-[11px] text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-60"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                ) : null}
              </div>
              ) : null}
            </div>

            {editingId === comment.id ? (
              <div className="mt-2 rounded-sm border border-border-subtle bg-surface p-2">
                <textarea
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  rows={3}
                  disabled={busy}
                  className="w-full resize-none bg-transparent text-sm leading-6 text-text-primary outline-none"
                />
                <div className="mt-1.5 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={resetInteractionState}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-elevated hover:text-accent"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={busy || !editText.trim()}
                    onClick={() => void handleUpdate(comment.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-accent hover:bg-accent/10 disabled:opacity-60"
                    title="Save"
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-primary">{comment.content}</p>
            )}

            {editingId !== comment.id ? (
              <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100" style={replyingToId === comment.id || (children.length > 0) ? { opacity: 1 } : undefined}>
                <button
                  type="button"
                  onClick={() => {
                    setReplyingToId((current) => (current === comment.id ? null : comment.id))
                    setReplyText('')
                    setMenuCommentId(null)
                    setEditingId(null)
                    setEditText('')
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-accent"
                  title="Reply"
                >
                  <MessageSquareReply size={14} />
                </button>
                {children.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => toggleReplies(comment.id)}
                    className="inline-flex h-6 items-center gap-0.5 rounded-sm px-1 text-text-muted hover:bg-surface hover:text-accent"
                    title={repliesCollapsed ? `Show ${children.length} replies` : `Hide ${children.length} replies`}
                  >
                    {repliesCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <span className="font-mono text-[10px]">{children.length}</span>
                  </button>
                ) : null}
              </div>
            ) : null}

            {replyingToId === comment.id ? (
              <div className="mt-2 rounded-sm border border-border-subtle bg-surface p-2">
                <textarea
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  rows={2}
                  disabled={busy}
                  placeholder={`Reply to ${authorLabel}`}
                  className="w-full resize-none bg-transparent text-sm leading-6 text-text-primary outline-none"
                />
                <div className="mt-1.5 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingToId(null)
                      setReplyText('')
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-elevated hover:text-accent"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={busy || !replyText.trim()}
                    onClick={() => void handleReply(comment.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-accent hover:bg-accent/10 disabled:opacity-60"
                    title="Send reply"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            ) : null}

            {children.length > 0 && !repliesCollapsed ? (
              <div className="mt-1">{children.map((child) => renderComment(child, depth + 1))}</div>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="space-y-3">
      <section className="border border-border-subtle bg-base">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">Discussion</p>
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-sm bg-surface px-1 font-mono text-[9px] text-text-muted">{comments.length}</span>
            {rootComments.some((c) => (commentsByParent.get(c.id) ?? []).length > 0) ? (
              <button
                type="button"
                onClick={() => {
                  const hasCollapsed = rootComments.some((c) => collapsedCommentIds.has(c.id))
                  if (hasCollapsed) {
                    setCollapsedCommentIds(new Set())
                  } else {
                    setCollapsedCommentIds(new Set(rootComments.filter((c) => (commentsByParent.get(c.id) ?? []).length > 0).map((c) => c.id)))
                  }
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-muted hover:bg-surface hover:text-accent"
                title={rootComments.some((c) => collapsedCommentIds.has(c.id)) ? 'Expand all threads' : 'Collapse all threads'}
              >
                {rootComments.some((c) => collapsedCommentIds.has(c.id)) ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            ) : null}
          </div>
          <span className="inline-flex h-5 items-center rounded-sm bg-accent/10 px-1.5 font-mono text-[9px] text-accent">
            {userKey}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-border-subtle px-3 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => { if (e.target.rows < 3) e.target.rows = 3 }}
            onBlur={(e) => { if (!draft.trim()) e.target.rows = 1 }}
            placeholder="Write a comment…"
            rows={1}
            disabled={busy}
            className="min-h-[28px] flex-1 resize-none border-none bg-transparent py-0.5 text-[13px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
            title="Post comment"
          >
            <Send size={16} />
          </button>
        </form>
      </section>

      {loading ? <p className="text-[11px] text-text-muted">Loading discussion…</p> : null}

      {error || localError ? (
        <div className="border border-border-subtle bg-base px-3 py-2 text-[11px] text-text-primary">
          {error || localError}
        </div>
      ) : null}

      {comments.length === 0 && !loading ? (
        <div className="border border-border-subtle bg-base px-3 py-6 text-sm text-text-muted">
          No comments yet.
        </div>
      ) : null}

      {rootComments.length > 0 ? (
        <div className="border border-border-subtle bg-base">
          {rootComments.map((comment, index) => (
            <div key={`comment-thread-${comment.id}`} className={index === 0 ? '' : 'border-t border-border-subtle'}>
              {renderComment(comment)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SharedNoteToggleButton({ note, userKey, sharedNotesState, sharedNoteRecord }) {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    setBusy(false)
    setLocalError('')
  }, [note?.id])

  const handleToggle = async () => {
    setBusy(true)
    setLocalError('')

    try {
      if (sharedNoteRecord?.id) {
        await sharedNotesState.deleteSharedNote(sharedNoteRecord.id)
      } else {
        await sharedNotesState.shareNote({
          title: note.label?.trim() || `${userKey} note`,
          content: note.content || defaultNoteContent(),
          sourceNoteId: note.id,
        })
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update share.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {sharedNoteRecord?.id ? <span className="text-[10px] text-text-muted">Shared</span> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleToggle()}
        className="inline-flex h-7 items-center border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {busy ? 'Working…' : sharedNoteRecord?.id ? 'Unshare' : 'Share'}
      </button>
      {localError ? <span className="text-[10px] text-red-500">{localError}</span> : null}
    </div>
  )
}

function SharedNotesSection({ sharedNotesState, userKey, selectedSharedNoteId, onSelectSharedNote, onCopyNote }) {
  const { sharedNotes, loading, error } = sharedNotesState
  const [localError] = useState('')
  const visibleNotes = useMemo(
    () => sharedNotes.filter((sharedNote) => sharedNote.author_user_key !== userKey),
    [sharedNotes, userKey],
  )
  const activeSharedNote = useMemo(
    () => visibleNotes.find((sharedNote) => sharedNote.id === selectedSharedNoteId) ?? visibleNotes[0] ?? null,
    [selectedSharedNoteId, visibleNotes],
  )

  useEffect(() => {
    if (!activeSharedNote?.id) {
      return
    }

    const node = document.getElementById(`shared-note-${activeSharedNote.id}`)
    if (!node) {
      return
    }

    window.setTimeout(() => {
      node.scrollIntoView({ block: 'nearest' })
    }, 0)
  }, [activeSharedNote?.id])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 border border-border-subtle bg-base px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">Shared Notes</p>
          <p className="mt-0.5 text-[13px] text-text-muted">Browse notes shared with you.</p>
        </div>
        <div className="inline-flex h-7 min-w-7 items-center justify-center border border-border-subtle px-2 font-mono text-[11px] text-text-muted">
          {visibleNotes.length}
        </div>
      </div>
      {loading ? <p className="mt-2 text-[11px] text-text-muted">Loading…</p> : null}
      {(error || localError) ? <p className="mt-2 text-[11px] text-red-500">{error || localError}</p> : null}
      {visibleNotes.length === 0 && !loading ? <p className="px-1 text-[11px] text-text-muted">Nothing shared with you yet.</p> : null}
      {visibleNotes.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-[250px_minmax(0,1fr)]">
          <div className="overflow-hidden border border-border-subtle bg-base">
            {visibleNotes.map((sharedNote, index) => {
              const preview = getNotePreview(sharedNote.content)
              const active = activeSharedNote?.id === sharedNote.id
              const initials = initialsFromKey(sharedNote.author_user_key)
              return (
                <button
                  key={`shared-note-${sharedNote.id}`}
                  id={`shared-note-${sharedNote.id}`}
                  type="button"
                  onClick={() => onSelectSharedNote(sharedNote.id)}
                  className={[
                    'block w-full px-3 py-3 text-left transition-colors',
                    index === 0 ? '' : 'border-t border-border-subtle',
                    active ? 'bg-accent/10' : 'hover:bg-surface',
                  ].join(' ')}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-border-subtle bg-surface font-mono text-[11px] text-text-primary">
                      {initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-medium text-text-primary" title={sharedNote.title}>
                          {sharedNote.title}
                        </p>
                        {active ? (
                          <span className="inline-flex h-5 items-center border border-accent/30 bg-accent/10 px-1.5 text-[10px] text-accent">
                            Open
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {sharedNote.author_user_key} · {formatDate(sharedNote.created_at, 'Unknown')}
                      </p>
                      {preview ? (
                        <p
                          className="mt-1.5 overflow-hidden text-[12px] leading-5 text-text-muted"
                          style={{
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 3,
                          }}
                        >
                          {preview}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {activeSharedNote ? (
            <div className="overflow-hidden border border-border-subtle bg-base">
              <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-text-primary">{activeSharedNote.title}</p>
                  <p className="mt-1 text-[12px] text-text-muted">
                    {activeSharedNote.author_user_key} · {formatDate(activeSharedNote.created_at, 'Unknown')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onCopyNote(activeSharedNote)
                  }}
                  className="inline-flex h-8 items-center gap-1 border border-border-subtle px-2.5 text-[12px] text-text-muted hover:border-accent hover:text-accent"
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
              <div className="p-4">
                <NoteEditor
                  value={activeSharedNote.content || defaultNoteContent()}
                  editable={false}
                  showToolbar={false}
                  allowPdfExport={false}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ─── Share button on a run row ────────────────────────────────────────────────
function SharedSolutionShareButton({ run, userKey, sharedSolutionsState }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [localError, setLocalError] = useState('')

  const alreadyShared = sharedSolutionsState.sharedSolutions.some(
    (s) => s.source_run_id === run.id && s.author_user_key === userKey,
  )

  if (alreadyShared) {
    return <span className="text-[10px] text-text-muted">Shared</span>
  }

  const handleShare = async () => {
    if (!run.submitted_code?.trim()) {
      setLocalError('No code to share for this run.')
      return
    }
    setBusy(true)
    setLocalError('')
    try {
      await sharedSolutionsState.shareSolution({
        title: `${userKey} — Run #${run.id}`,
        code: run.submitted_code,
        sourceRunId: run.id,
        runtimeMs: run.runtime_ms,
        testsPassed: run.tests_passed,
        testsTotal: run.tests_total,
      })
      setDone(true)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to share.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {done ? (
        <span className="inline-flex h-6 items-center border border-border-subtle px-2 font-mono text-[10px] text-text-muted">
          Shared
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleShare()}
          className="inline-flex h-6 items-center gap-1 border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-60"
        >
          <Share2 size={10} />
          {busy ? 'Sharing…' : 'Share'}
        </button>
      )}
      {localError ? <span className="text-[10px] text-red-500">{localError}</span> : null}
    </div>
  )
}

// ─── Shared Solutions section ──────────────────────────────────────────────────
function SharedSolutionsSection({ sharedSolutionsState, userKey, onLoadCode, selectedSharedSolutionId, onSelectSharedSolution }) {
  const { sharedSolutions, loading, error, deleteSharedSolution } = sharedSolutionsState
  const [deletingId, setDeletingId] = useState(null)
  const [localError, setLocalError] = useState('')

  const handleLoad = async (code) => {
    await onLoadCode(code)
  }

  const handleDelete = async (id) => {
    setDeletingId(id)
    setLocalError('')
    try {
      await deleteSharedSolution(id)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to delete.')
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    if (!selectedSharedSolutionId) {
      return
    }

    const node = document.getElementById(`shared-solution-${selectedSharedSolutionId}`)
    if (!node) {
      return
    }

    window.setTimeout(() => {
      node.scrollIntoView({ block: 'nearest' })
    }, 0)
  }, [selectedSharedSolutionId, sharedSolutions.length])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 border border-border-subtle bg-base px-2 py-1.5">
        <div className="flex items-center gap-2">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Shared Solutions</p>
          <span className="font-mono text-[11px] text-text-muted">{sharedSolutions.length}</span>
        </div>
      </div>
      {loading ? <p className="mt-2 text-[11px] text-text-muted">Loading…</p> : null}
      {(error || localError) ? <p className="mt-2 text-[11px] text-red-500">{error || localError}</p> : null}
      {sharedSolutions.length === 0 && !loading ? <p className="px-1 text-[11px] text-text-muted">No shared solutions.</p> : null}
      {sharedSolutions.length > 0 ? (
        <div className="border border-border-subtle bg-base">
          {sharedSolutions.map((ss) => {
          const isOwn = ss.author_user_key === userKey
          const preview = getCodePreview(ss.code)
          const isActive = selectedSharedSolutionId === ss.id
          return (
            <article
              id={`shared-solution-${ss.id}`}
              key={`shared-${ss.id}`}
              className={[
                'px-3 py-2.5 transition-colors',
                isActive ? 'bg-surface' : '',
                sharedSolutions[0]?.id === ss.id ? '' : 'border-t border-border-subtle',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onSelectSharedSolution(ss.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={[
                        'inline-flex h-5 items-center border px-2 font-mono text-[10px]',
                        isOwn ? 'border-accent bg-accent/10 text-accent' : 'border-border-subtle text-text-muted',
                      ].join(' ')}
                    >
                      {ss.author_user_key}
                    </span>
                    <span className="font-mono text-[10px] text-text-muted">{formatDate(ss.created_at, 'Unknown')}</span>
                    {ss.tests_passed !== null ? (
                      <span className="font-mono text-[10px] text-text-muted">
                        {ss.tests_passed}/{ss.tests_total} · {ss.runtime_ms ?? '-'}ms
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[13px] leading-6 text-text-primary" title={ss.title}>
                    {ss.title}
                  </p>
                  {preview ? (
                    <pre className="mt-2 max-h-24 overflow-auto border border-border-subtle bg-surface p-2 font-mono text-[11px] leading-5 text-text-muted">
                      {preview}
                    </pre>
                  ) : null}
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleLoad(ss.code)}
                    className="inline-flex h-6 items-center border border-accent bg-accent/10 px-2 text-[10px] text-accent hover:bg-accent/20"
                  >
                    Load
                  </button>
                  {isOwn ? (
                    <button
                      type="button"
                      disabled={deletingId === ss.id}
                      onClick={() => void handleDelete(ss.id)}
                      className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-60"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
        </div>
      ) : null}
    </div>
  )
}

export function ProblemDetailPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const problemIdentifier = problemIdentifierFromSlug(slug)
  const problemState = useProblemBundle(problemIdentifier)
  const queryClient = useQueryClient()
  const { userKey } = useCurrentUser()
  const userSettingsState = useUserSettings(userKey)
  const navigate = useNavigate()
  const problemKey = problemState.data?.problemKey || ''
  const problemLc = problemState.data?.lc ?? lcFromSlug(slug)
  const problemRef = problemKey ? { problemKey, problemLc } : { problemLc }
  const navigator = useProblemNavigator(problemKey || problemLc)
  const commentsState = useComments(problemRef, userKey)
  const sharedNotesState = useSharedNotes(problemRef, userKey)
  const sharedSolutionsState = useSharedSolutions(problemRef, userKey)

  const [leftTab, setLeftTab] = useState('problem')
  const [rightTab, setRightTab] = useState('tests')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantLaunch, setAssistantLaunch] = useState(null)
  const [focusedTestIds, setFocusedTestIds] = useState([])
  const [selectedSqlSampleId, setSelectedSqlSampleId] = useState(null)
  const [notesView, setNotesView] = useState('mine')
  const [solutionsView, setSolutionsView] = useState('mine')
  const [notes, setNotes] = useState([])
  const [solutions, setSolutions] = useState([])
  const [resources, setResources] = useState([])
  const [progress, setProgress] = useState(null)
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [selectedSharedNoteId, setSelectedSharedNoteId] = useState(null)
  const [selectedSolutionId, setSelectedSolutionId] = useState(null)
  const [selectedSharedSolutionId, setSelectedSharedSolutionId] = useState(null)
  const [focusedCommentId, setFocusedCommentId] = useState(null)
  const [resourceForm, setResourceForm] = useState(emptyResourceForm())
  const [sectionMessages, setSectionMessages] = useState(() => ({
    progress: '',
    notes: '',
    solutions: '',
    resources: '',
    runs: '',
  }))
  const [saving, setSaving] = useState(false)
  const [dirtyNoteIds, setDirtyNoteIds] = useState(() => new Set())
  const [savingNoteIds, setSavingNoteIds] = useState(() => new Set())
  const [runOutput, setRunOutput] = useState({
    mode: '',
    status: '',
    message: '',
    startedAt: null,
    finishedAt: null,
    runId: null,
  })
  const [latestRunDetails, setLatestRunDetails] = useState(null)
  const [deletingRunId, setDeletingRunId] = useState(null)
  const [leftPaneWidth, setLeftPaneWidth] = useState(() =>
    readStoredNumber(STORAGE_KEYS.leftPaneWidth, LEFT_PANE_DEFAULT, LEFT_PANE_MIN, LEFT_PANE_MAX),
  )
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.leftPaneCollapsed, false),
  )
  const [bottomPaneHeight, setBottomPaneHeight] = useState(() =>
    readStoredNumber(STORAGE_KEYS.bottomPaneHeight, 220, 160, 520),
  )
  const [bottomPaneCollapsed, setBottomPaneCollapsed] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.bottomPaneCollapsed, true),
  )
  const [isWideLayout, setIsWideLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
  )
  const [isRenamingSolution, setIsRenamingSolution] = useState(false)
  const [showRawStdout, setShowRawStdout] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resettingSolution, setResettingSolution] = useState(false)

  const setSectionMessage = useCallback((scope, message) => {
    setSectionMessages((current) => {
      if (current[scope] === message) {
        return current
      }

      return {
        ...current,
        [scope]: message,
      }
    })
  }, [])

  const _clearSectionMessages = useCallback((...scopes) => {
    setSectionMessages((current) => {
      const keys = scopes.length > 0 ? scopes : Object.keys(current)
      let changed = false
      const next = { ...current }

      for (const key of keys) {
        if (next[key]) {
          next[key] = ''
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [])

  const noteTimersRef = useRef(new Map())
  const solutionTimersRef = useRef(new Map())
  const pendingNotePatchesRef = useRef(new Map())
  const pendingSolutionPatchesRef = useRef(new Map())
  const defaultSolutionSeededRef = useRef(new Set())
  const defaultSolutionSeedingRef = useRef(new Set())
  const solutionsRef = useRef([])
  const workspaceSplitRef = useRef(null)
  const rightPaneRef = useRef(null)
  const lastExpandedLeftPaneWidthRef = useRef(leftPaneWidth)
  const runnerApiUrl = (import.meta.env.VITE_RUNNER_API_URL || '').replace(/\/$/, '')
  const trackKey = problemState.data?.trackKey || 'dsa'
  const isSqlTrack = trackKey === 'sql'
  const editorLanguage = problemState.data?.content?.editorLanguage || (isSqlTrack ? 'sql' : 'python')
  const preferredAiProviderMode = userSettingsState.settings?.preferred_ai_provider_mode || 'platform'
  const rightPaneDefaultTab = isSqlTrack ? 'output' : 'tests'
  const effectiveRightTab = isSqlTrack && ['tests', 'cases', 'fixtures', 'stdout', 'result'].includes(rightTab) ? 'results' : rightTab

  useEffect(() => {
    const noteTimers = noteTimersRef.current
    const solutionTimers = solutionTimersRef.current
    const pendingNotePatches = pendingNotePatchesRef.current
    const pendingSolutionPatches = pendingSolutionPatchesRef.current
    return () => {
      noteTimers.forEach((timeoutId) => clearTimeout(timeoutId))
      solutionTimers.forEach((timeoutId) => clearTimeout(timeoutId))
      pendingNotePatches.clear()
      pendingSolutionPatches.clear()
    }
  }, [problemKey, problemLc])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const onResize = () => {
      setIsWideLayout(window.innerWidth >= 1280)
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEYS.leftPaneWidth, String(leftPaneWidth))
  }, [leftPaneWidth])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEYS.leftPaneCollapsed, leftPaneCollapsed ? '1' : '0')
  }, [leftPaneCollapsed])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEYS.bottomPaneHeight, String(bottomPaneHeight))
  }, [bottomPaneHeight])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(STORAGE_KEYS.bottomPaneCollapsed, bottomPaneCollapsed ? '1' : '0')
  }, [bottomPaneCollapsed])

  useEffect(() => {
    if (!problemState.data) {
      return
    }

    const nextProblemSolutions = dedupeSolutionsBySortOrder(problemState.data.solutions ?? [])

    pendingNotePatchesRef.current.clear()
    pendingSolutionPatchesRef.current.clear()
    setDirtyNoteIds(new Set())
    setSavingNoteIds(new Set())
    setNotes(problemState.data.notes ?? [])
    setSolutions(nextProblemSolutions)
    setResources(problemState.data.resources ?? [])
    setProgress(problemState.data.progress ?? null)

    setSelectedNoteId((current) => {
      const exists = (problemState.data.notes ?? []).some((note) => note.id === current)
      if (exists) {
        return current
      }
      return problemState.data.notes?.[0]?.id ?? null
    })

    setSelectedSolutionId((current) => {
      const exists = nextProblemSolutions.some((solution) => solution.id === current)
      if (exists) {
        return current
      }
      return nextProblemSolutions[0]?.id ?? null
    })
  }, [problemState.data])

  useEffect(() => {
    setAssistantOpen(false)
    setAssistantLaunch(null)
  }, [problemKey, problemLc])

  useEffect(() => {
    const activeTestIds = new Set(
      (problemState.data?.trackKey === 'sql'
        ? (problemState.data?.sqlFixtures ?? []).map((fixture) => fixture.fixture_key || fixture.id)
        : (problemState.data?.tests ?? []).map((test) => test.id)),
    )
    setFocusedTestIds((current) => current.filter((id) => activeTestIds.has(id)))
  }, [problemState.data?.sqlFixtures, problemState.data?.tests, problemState.data?.trackKey])

  useEffect(() => {
    if (!isSqlTrack) {
      setSelectedSqlSampleId(null)
      return
    }

    const publicFixtures = (problemState.data?.sqlFixtures ?? []).filter((fixture) => fixture.is_public)
    const visibleFixtures = publicFixtures.length > 0 ? publicFixtures : problemState.data?.sqlFixtures ?? []
    setSelectedSqlSampleId((current) => {
      if (current && visibleFixtures.some((fixture) => String(fixture.fixture_key || fixture.id) === String(current))) {
        return current
      }
      return visibleFixtures[0] ? String(visibleFixtures[0].fixture_key || visibleFixtures[0].id) : null
    })
  }, [isSqlTrack, problemState.data?.sqlFixtures])

  useEffect(() => {
    solutionsRef.current = solutions
  }, [solutions])

  useEffect(() => {
    if (!leftPaneCollapsed) {
      lastExpandedLeftPaneWidthRef.current = clampNumber(leftPaneWidth, LEFT_PANE_MIN, LEFT_PANE_MAX)
    }
  }, [leftPaneCollapsed, leftPaneWidth])

  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? notes[0] ?? null,
    [notes, selectedNoteId],
  )
  const activeNoteIsDirty = Boolean(activeNote?.id && dirtyNoteIds.has(activeNote.id))
  const activeNoteIsSaving = Boolean(activeNote?.id && savingNoteIds.has(activeNote.id))
  const ownSharedNotesBySourceId = useMemo(
    () =>
      new Map(
        (sharedNotesState.sharedNotes ?? [])
          .filter((sharedNote) => sharedNote.author_user_key === userKey && sharedNote.source_note_id)
          .map((sharedNote) => [sharedNote.source_note_id, sharedNote]),
      ),
    [sharedNotesState.sharedNotes, userKey],
  )
  const activeNoteSharedRecord = activeNote ? ownSharedNotesBySourceId.get(activeNote.id) ?? null : null

  const visibleSolutions = useMemo(() => dedupeSolutionsBySortOrder(solutions), [solutions])
  const activeSolution = useMemo(
    () => visibleSolutions.find((solution) => solution.id === selectedSolutionId) ?? visibleSolutions[0] ?? null,
    [selectedSolutionId, visibleSolutions],
  )

  useEffect(() => {
    const visibleSharedNotes = (sharedNotesState.sharedNotes ?? []).filter((sharedNote) => sharedNote.author_user_key !== userKey)
    setSelectedSharedNoteId((current) => {
      if (visibleSharedNotes.some((sharedNote) => sharedNote.id === current)) {
        return current
      }
      return visibleSharedNotes[0]?.id ?? null
    })
  }, [sharedNotesState.sharedNotes, userKey])

  useEffect(() => {
    const sharedSolutions = sharedSolutionsState.sharedSolutions ?? []
    setSelectedSharedSolutionId((current) => {
      if (sharedSolutions.some((solution) => solution.id === current)) {
        return current
      }
      return sharedSolutions[0]?.id ?? null
    })
  }, [sharedSolutionsState.sharedSolutions])

  useEffect(() => {
    setIsRenamingSolution(false)
  }, [selectedSolutionId])

  useEffect(() => {
    if (visibleSolutions.length === 0) {
      if (selectedSolutionId !== null) {
        setSelectedSolutionId(null)
      }
      return
    }

    if (visibleSolutions.some((solution) => solution.id === selectedSolutionId)) {
      return
    }

    const currentRaw = solutions.find((solution) => solution.id === selectedSolutionId)
    if (currentRaw) {
      const replacement = visibleSolutions.find(
        (solution) => solutionSortOrderValue(solution) === solutionSortOrderValue(currentRaw),
      )
      if (replacement?.id) {
        setSelectedSolutionId(replacement.id)
        return
      }
    }

    setSelectedSolutionId(visibleSolutions[0].id)
  }, [selectedSolutionId, solutions, visibleSolutions])

  useEffect(() => {
    if (!activeSolution?.id) {
      setResetConfirmOpen(false)
    }
  }, [activeSolution?.id])

  useEffect(() => {
    setLatestRunDetails(null)
    setRunOutput({
      mode: '',
      status: '',
      message: '',
      startedAt: null,
      finishedAt: null,
      runId: null,
    })
    setShowRawStdout(false)
  }, [activeSolution?.id])

  useEffect(() => {
    const nextLeftTab = searchParams.get('tab')
    const nextNotesView = searchParams.get('notesView')
    const nextRightTab = searchParams.get('rightTab')
    const nextCommentId = toNumber(searchParams.get('comment'))
    const nextSharedNoteId = toNumber(searchParams.get('sharedNote'))
    const nextSharedSolutionId = toNumber(searchParams.get('sharedSolution'))
    const nextSolutionsView = searchParams.get('solutionsView')

    const allowedLeftTabs = isSqlTrack
      ? ['problem', 'data', 'notes', 'resources', 'solutions', 'comments']
      : ['problem', 'notes', 'resources', 'solutions', 'comments']

    if (nextLeftTab && (allowedLeftTabs.includes(nextLeftTab) || nextLeftTab === 'shared')) {
      setLeftTab(nextLeftTab === 'shared' ? 'solutions' : nextLeftTab)
      setLeftPaneCollapsed(false)
    }

    if (nextNotesView && ['mine', 'shared'].includes(nextNotesView)) {
      setNotesView(nextNotesView)
    }

    if (nextSolutionsView && ['mine', 'shared'].includes(nextSolutionsView)) {
      setSolutionsView(nextSolutionsView)
    }

    const resolvedRightTab =
      isSqlTrack && ['tests', 'cases', 'fixtures', 'stdout', 'result'].includes(nextRightTab) ? 'results' : nextRightTab

    if (resolvedRightTab && ['tests', 'fixtures', 'output', 'results', 'result', 'cases', 'stdout', 'history'].includes(resolvedRightTab)) {
      setRightTab(resolvedRightTab)
      setBottomPaneCollapsed(false)
    }

    setFocusedCommentId(nextCommentId)
    if (nextSharedNoteId) {
      setSelectedSharedNoteId(nextSharedNoteId)
    }
    if (nextSharedSolutionId) {
      setLeftTab('solutions')
      setSolutionsView('shared')
      setLeftPaneCollapsed(false)
      setSelectedSharedSolutionId(nextSharedSolutionId)
    }
  }, [isSqlTrack, searchParams])

  useEffect(() => {
    if (!isSqlTrack && leftTab === 'data') {
      setLeftTab('problem')
    }
  }, [isSqlTrack, leftTab])

  const canUseRunnerDataset = Boolean(problemState.data?.hasRunnableDataset)
  const runnerConfigured = runnerApiUrl.length > 0
  const hasCode = Boolean(activeSolution?.code?.trim())
  const canExecute = canUseRunnerDataset && runnerConfigured && hasCode

  const invalidateCaches = useCallback(async () => {
    const bundleQueryKey = problemKey
      ? ['problem-bundle', 'problem_key', problemKey, userKey]
      : ['problem-bundle', 'lc', String(problemLc), userKey]
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: bundleQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['progress'] }),
      queryClient.invalidateQueries({ queryKey: ['targets'] }),
    ])
  }, [problemKey, problemLc, queryClient, userKey])

  const persistProgressPatch = useCallback(
    async (patch) => {
      if (!supabase || !problemState.data || (!problemLc && !problemKey)) {
        return
      }

      setSaving(true)
      setSectionMessage('progress', '')

      try {
        const mergedProgress = {
          ...progress,
          ...patch,
        }

        const ratingValue = Number(mergedProgress.difficulty_rating)
        const safeDifficultyRating =
          Number.isFinite(ratingValue) && ratingValue >= 1 && ratingValue <= 5 ? ratingValue : null

        const payload = {
          ...mergedProgress,
          user_key: userKey,
          difficulty_rating: safeDifficultyRating,
        }

        if (isSqlTrack) {
          payload.problem_key = problemKey
          payload.track_key = trackKey
          payload.problem_type = 'sql'
        } else {
          payload.problem_key = problemKey
          payload.problem_lc = problemLc
          payload.track_key = trackKey
          payload.problem_type = problemState.data.active.type
        }

        if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
          const nowIso = new Date().toISOString()
          if (patch.status === 'solved') {
            payload.solved_at = mergedProgress.solved_at || progress?.solved_at || nowIso
          } else if (!Object.prototype.hasOwnProperty.call(patch, 'solved_at')) {
            payload.solved_at = null
          }
        }

        const { data, error } = await supabase
          .from('progress')
          .upsert(payload, { onConflict: isSqlTrack ? 'user_key,problem_key' : 'user_key,problem_lc' })
          .select('*')
          .single()

        if (error) {
          throw error
        }

        setProgress(data)
        await invalidateCaches()
      } catch (caughtError) {
        setSectionMessage('progress', caughtError instanceof Error ? caughtError.message : 'Failed to save progress.')
      } finally {
        setSaving(false)
      }
    },
    [invalidateCaches, isSqlTrack, problemKey, problemLc, problemState.data, progress, trackKey, userKey, setSectionMessage],
  )

  const reconcileSolvedStateFromSubmissions = useCallback(async () => {
    if (!supabase || (!problemLc && !problemKey) || !problemState.data) {
      return
    }

    let query = supabase.from('code_runs').select('id,runner_meta,status').eq('user_key', userKey).eq('status', 'passed').limit(200)
    query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
    const { data: passedRuns, error } = await query

    if (error) {
      throw error
    }

    const hasValidSubmit = (passedRuns ?? []).some((run) => isPassedSubmitRun(run))
    const currentStatus = progress?.status ?? 'unsolved'
    const nowIso = new Date().toISOString()

    if (hasValidSubmit && currentStatus !== 'solved') {
      await persistProgressPatch({
        status: 'solved',
        solved_at: progress?.solved_at || nowIso,
        last_reviewed: nowIso,
      })
      return
    }

    if (!hasValidSubmit && currentStatus === 'solved') {
      await persistProgressPatch({
        status: 'unsolved',
        solved_at: null,
        last_reviewed: nowIso,
      })
    }
  }, [persistProgressPatch, isSqlTrack, problemKey, problemLc, problemState.data, progress?.solved_at, progress?.status, userKey])

  const flushNoteSave = useCallback(
    async (noteId, patch = null) => {
      if (!supabase || (!problemLc && !problemKey)) {
        return false
      }

      const pendingPatch = {
        ...(pendingNotePatchesRef.current.get(noteId) ?? {}),
        ...(patch ?? {}),
      }

      if (Object.keys(pendingPatch).length === 0) {
        return true
      }

      const existing = noteTimersRef.current.get(noteId)
      if (existing) {
        clearTimeout(existing)
        noteTimersRef.current.delete(noteId)
      }
      pendingNotePatchesRef.current.delete(noteId)
      setSavingNoteIds((current) => new Set(current).add(noteId))

      try {
        let query = supabase
          .from('notes')
          .update({ ...pendingPatch, updated_at: new Date().toISOString() })
          .eq('id', noteId)
          .eq('user_key', userKey)

        query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
        const { error } = await query

        if (error) {
          throw error
        }

        setDirtyNoteIds((current) => {
          const next = new Set(current)
          next.delete(noteId)
          return next
        })
        setSectionMessage('notes', '')
        return true
      } catch (caughtError) {
        setSectionMessage('notes', caughtError instanceof Error ? caughtError.message : 'Failed to save note.')
        return false
      } finally {
        setSavingNoteIds((current) => {
          const next = new Set(current)
          next.delete(noteId)
          return next
        })
      }
    },
    [isSqlTrack, problemKey, problemLc, userKey, setSectionMessage],
  )

  const queueNoteSave = useCallback(
    (noteId, patch) => {
      pendingNotePatchesRef.current.set(noteId, {
        ...(pendingNotePatchesRef.current.get(noteId) ?? {}),
        ...patch,
      })
      setDirtyNoteIds((current) => new Set(current).add(noteId))

      const existing = noteTimersRef.current.get(noteId)
      if (existing) {
        clearTimeout(existing)
      }

      const timeoutId = window.setTimeout(() => {
        void flushNoteSave(noteId)
      }, 500)

      noteTimersRef.current.set(noteId, timeoutId)
    },
    [flushNoteSave],
  )

  const flushSolutionSave = useCallback(
    async (solutionId, patch = null) => {
      if (!supabase || (!problemLc && !problemKey)) {
        return false
      }

      const pendingPatch = {
        ...(pendingSolutionPatchesRef.current.get(solutionId) ?? {}),
        ...(patch ?? {}),
      }

      if (Object.keys(pendingPatch).length === 0) {
        return true
      }

      const existing = solutionTimersRef.current.get(solutionId)
      if (existing) {
        clearTimeout(existing)
        solutionTimersRef.current.delete(solutionId)
      }
      pendingSolutionPatchesRef.current.delete(solutionId)

      try {
        let query = supabase
          .from('solutions')
          .update({ ...pendingPatch, updated_at: new Date().toISOString() })
          .eq('id', solutionId)
          .eq('user_key', userKey)

        query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
        const { error } = await query

        if (error) {
          throw error
        }

        setSectionMessage('solutions', '')
        return true
      } catch (caughtError) {
        setSectionMessage('solutions', caughtError instanceof Error ? caughtError.message : 'Failed to save solution.')
        return false
      }
    },
    [isSqlTrack, problemKey, problemLc, userKey, setSectionMessage],
  )

  const queueSolutionSave = useCallback(
    (solutionId, patch) => {
      pendingSolutionPatchesRef.current.set(solutionId, {
        ...(pendingSolutionPatchesRef.current.get(solutionId) ?? {}),
        ...patch,
      })

      const existing = solutionTimersRef.current.get(solutionId)
      if (existing) {
        clearTimeout(existing)
      }

      const timeoutId = window.setTimeout(() => {
        void flushSolutionSave(solutionId)
      }, 500)

      solutionTimersRef.current.set(solutionId, timeoutId)
    },
    [flushSolutionSave],
  )

  const createNoteVersion = useCallback(
    async ({ sortOrder, seedContent = null, label: customLabel = '' } = {}) => {
      if (!supabase || (!problemLc && !problemKey)) {
        return null
      }

      try {
        const nextSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : notes.length
        const label = String(customLabel || `Note ${nextSortOrder + 1}`).trim() || `Note ${nextSortOrder + 1}`
        const payload = {
          user_key: userKey,
          label,
          content: seedContent || defaultNoteContent(),
          sort_order: nextSortOrder,
        }
        if (isSqlTrack) {
          payload.problem_key = problemKey
        } else {
          payload.problem_key = problemKey
          payload.problem_lc = problemLc
        }

        const { data, error } = await supabase
          .from('notes')
          .insert(payload)
          .select('*')
          .single()

        if (error) {
          throw error
        }

        setNotes((current) => [...current, data])
        setSelectedNoteId(data.id)
        setLeftTab('notes')
        setNotesView('mine')
        await invalidateCaches()
        return data
      } catch (caughtError) {
        setSectionMessage('notes', caughtError instanceof Error ? caughtError.message : 'Failed to add note.')
        return null
      }
    },
    [invalidateCaches, isSqlTrack, notes.length, problemKey, problemLc, userKey, setSectionMessage],
  )

  const addNote = async () => {
    await createNoteVersion({
      sortOrder: notes.length,
      seedContent: defaultNoteContent(),
    })
  }

  const insertAiPayloadIntoCurrentNote = useCallback(
    async (payload) => {
      const noteLabel = `AI Assistant — ${payload?.title || 'Chat'}`
      if (!activeNote) {
        await createNoteVersion({
          sortOrder: notes.length,
          label: noteLabel,
          seedContent: blocksToNoteDoc(payload),
        })
        return
      }

      const nextContent = appendBlocksToNoteDoc(activeNote.content || defaultNoteContent(), payload)
      setNotes((current) =>
        current.map((note) => (note.id === activeNote.id ? { ...note, content: nextContent } : note)),
      )
      queueNoteSave(activeNote.id, {
        content: nextContent,
      })
      setSelectedNoteId(activeNote.id)
      setLeftTab('notes')
    },
    [activeNote, createNoteVersion, notes.length, queueNoteSave],
  )

  const createAiNoteFromPayload = useCallback(
    async (payload) => {
      await createNoteVersion({
        sortOrder: notes.length,
        label: `AI Assistant — ${payload?.title || 'Chat'}`,
        seedContent: blocksToNoteDoc(payload),
      })
    },
    [createNoteVersion, notes.length],
  )

  const deleteNote = async (id) => {
    if (!supabase || (!problemLc && !problemKey)) {
      return
    }

    try {
      let query = supabase.from('notes').delete().eq('id', id).eq('user_key', userKey)
      query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
      const { error } = await query

      if (error) {
        throw error
      }

      const pendingTimer = noteTimersRef.current.get(id)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        noteTimersRef.current.delete(id)
      }
      pendingNotePatchesRef.current.delete(id)
      setDirtyNoteIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setSavingNoteIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setNotes((current) => {
        const next = current.filter((note) => note.id !== id)
        if (selectedNoteId === id) {
          setSelectedNoteId(next[0]?.id ?? null)
        }
        return next
      })
      await invalidateCaches()
    } catch (caughtError) {
      setSectionMessage('notes', caughtError instanceof Error ? caughtError.message : 'Failed to delete note.')
    }
  }

  const createSolutionVersion = useCallback(
    async ({ sortOrder, seedCode = '', label: customLabel = '' } = {}) => {
      if (!supabase || (!problemLc && !problemKey)) {
        return null
      }

      try {
        const nextSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : nextSolutionSortOrder(solutions)
        const label = String(customLabel || `Version ${nextSortOrder + 1}`).trim() || `Version ${nextSortOrder + 1}`
        const starter = problemState.data?.content?.starterSnippet || problemState.data?.content?.starterCode || ''
        const nextCode = seedCode || starter || ''
        const payload = {
          user_key: userKey,
          label,
          code: nextCode,
          language: editorLanguage,
          sort_order: nextSortOrder,
        }
        if (isSqlTrack) {
          payload.problem_key = problemKey
        } else {
          payload.problem_key = problemKey
          payload.problem_lc = problemLc
        }
        const { data, error } = await supabase
          .from('solutions')
          .insert(payload)
          .select('*')
          .single()

        if (error) {
          throw error
        }

        setSolutions((current) => [...current, data])
        setSelectedSolutionId(data.id)
        await invalidateCaches()
        return data
      } catch (caughtError) {
        setSectionMessage('solutions', caughtError instanceof Error ? caughtError.message : 'Failed to add code version.')
        return null
      }
    },
    [editorLanguage, invalidateCaches, isSqlTrack, problemKey, problemLc, problemState.data?.content?.starterCode, problemState.data?.content?.starterSnippet, solutions, userKey, setSectionMessage],
  )

  const addSolution = async () => {
    const carriedCode =
      activeSolution?.code || problemState.data?.content?.starterSnippet || problemState.data?.content?.starterCode || ''
    await createSolutionVersion({
      sortOrder: nextSolutionSortOrder(solutions),
      seedCode: carriedCode,
    })
  }

  const resetActiveSolution = useCallback(async () => {
    if (!activeSolution?.id) {
      return
    }

    const starterCode = String(problemState.data?.content?.starterSnippet || problemState.data?.content?.starterCode || '')
    setResettingSolution(true)

    try {
      setSolutions((current) =>
        current.map((solution) =>
          solution.id === activeSolution.id
            ? {
                ...solution,
                code: starterCode,
              }
            : solution,
        ),
      )
      queueSolutionSave(activeSolution.id, { code: starterCode, language: editorLanguage })
      setLatestRunDetails(null)
      setRunOutput({
        mode: '',
        status: '',
        message: '',
        startedAt: null,
        finishedAt: null,
        runId: null,
      })
      setShowRawStdout(false)
      setRightTab(rightPaneDefaultTab)
      setResetConfirmOpen(false)
      setSectionMessage('solutions', '')
    } finally {
      setResettingSolution(false)
    }
  }, [activeSolution?.id, editorLanguage, problemState.data?.content?.starterCode, problemState.data?.content?.starterSnippet, queueSolutionSave, rightPaneDefaultTab, setSectionMessage])

  const loadRunCodeIntoEditor = async (run) => {
    const submittedCode = String(run?.submitted_code || '')
    if (!submittedCode.trim()) {
      setSectionMessage('solutions', 'Submitted code is not available for this run.')
      return
    }

    const existing = solutions.find((solution) => String(solution?.code || '').trim() === submittedCode.trim())
    if (existing?.id) {
      setSelectedSolutionId(existing.id)
      setSectionMessage('solutions', '')
      return
    }

    await createSolutionVersion({
      sortOrder: nextSolutionSortOrder(solutions),
      seedCode: submittedCode,
      label: `Submit ${run.id}`,
    })
  }

  useEffect(() => {
    if (!problemState.data || !supabase || (!problemLc && !problemKey)) {
      return
    }

    if ((problemState.data.solutions ?? []).length > 0 || solutions.length > 0) {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(`solution-seeded:${userKey}:${problemKey || problemLc}`, '1')
      }
      return
    }

    const seedKey = `${userKey}:${problemKey || problemLc}`
    const sessionSeedKey = `solution-seeded:${seedKey}`
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionSeedKey) === '1') {
      return
    }
    if (
      defaultSolutionSeededRef.current.has(seedKey) ||
      defaultSolutionSeedingRef.current.has(seedKey)
    ) {
      return
    }

    defaultSolutionSeedingRef.current.add(seedKey)
    void (async () => {
      try {
        const created = await createSolutionVersion({
          sortOrder: 0,
          seedCode: problemState.data?.content?.starterSnippet || problemState.data?.content?.starterCode || '',
        })

        if (created?.id) {
          defaultSolutionSeededRef.current.add(seedKey)
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(sessionSeedKey, '1')
          }
        }
      } finally {
        defaultSolutionSeedingRef.current.delete(seedKey)
      }
    })()
  }, [createSolutionVersion, problemKey, problemLc, problemState.data, solutions.length, userKey])

  const deleteSolution = async (id) => {
    if (!supabase || (!problemLc && !problemKey)) {
      return
    }

    try {
      let query = supabase.from('solutions').delete().eq('id', id).eq('user_key', userKey)
      query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
      const { error } = await query

      if (error) {
        throw error
      }

      const pendingTimer = solutionTimersRef.current.get(id)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        solutionTimersRef.current.delete(id)
      }
      pendingSolutionPatchesRef.current.delete(id)
      setSolutions((current) => {
        const next = current.filter((solution) => solution.id !== id)
        if (selectedSolutionId === id) {
          setSelectedSolutionId(next[0]?.id ?? null)
        }
        return next
      })
      await invalidateCaches()
    } catch (caughtError) {
      setSectionMessage('solutions', caughtError instanceof Error ? caughtError.message : 'Failed to delete solution.')
    }
  }

  const addResource = async (event) => {
    event.preventDefault()

    if (!supabase || (!problemLc && !problemKey) || !resourceForm.url) {
      return
    }

    const embedUrl = getYoutubeEmbedUrl(resourceForm.url)
    const typeValue = embedUrl ? 'youtube' : resourceForm.type

    try {
      const payload = {
        user_key: userKey,
        url: resourceForm.url,
        title: resourceForm.title || null,
        type: typeValue,
      }
      if (isSqlTrack) {
        payload.problem_key = problemKey
      } else {
        payload.problem_key = problemKey
        payload.problem_lc = problemLc
      }

      const { data, error } = await supabase
        .from('resources')
        .insert(payload)
          .select('*')
          .single()

      if (error) {
        throw error
      }

      setResources((current) => [data, ...current])
      setResourceForm(emptyResourceForm())
      await invalidateCaches()
    } catch (caughtError) {
      setSectionMessage('resources', caughtError instanceof Error ? caughtError.message : 'Failed to add resource.')
    }
  }

  const deleteResource = async (id) => {
    if (!supabase || (!problemLc && !problemKey)) {
      return
    }

    try {
      let query = supabase.from('resources').delete().eq('id', id).eq('user_key', userKey)
      query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
      const { error } = await query

      if (error) {
        throw error
      }

      setResources((current) => current.filter((resource) => resource.id !== id))
      await invalidateCaches()
    } catch (caughtError) {
      setSectionMessage('resources', caughtError instanceof Error ? caughtError.message : 'Failed to delete resource.')
    }
  }

  const deleteRun = async (run) => {
    if (!supabase || (!problemLc && !problemKey) || !run?.id) {
      return
    }

    setDeletingRunId(run.id)
    setSectionMessage('runs', '')

    try {
      let query = supabase.from('code_runs').delete().eq('id', run.id).eq('user_key', userKey)
      query = isSqlTrack ? query.eq('problem_key', problemKey) : query.eq('problem_lc', problemLc)
      const { error } = await query

      if (error) {
        throw error
      }

      if (runOutput.runId === run.id) {
        setRunOutput({
          mode: '',
          status: '',
          message: '',
          startedAt: null,
          finishedAt: null,
          runId: null,
        })
      }

      if (latestRunDetails?.id === run.id) {
        setLatestRunDetails(null)
      }

      if (isPassedSubmitRun(run)) {
        await reconcileSolvedStateFromSubmissions()
      }

      await problemState.refetch()
      await invalidateCaches()
    } catch (caughtError) {
      setSectionMessage('runs', caughtError instanceof Error ? caughtError.message : 'Failed to delete submission.')
    } finally {
      setDeletingRunId(null)
    }
  }

  const toggleLeftPane = useCallback(() => {
    setLeftPaneCollapsed((current) => {
      if (current) {
        setLeftPaneWidth(clampNumber(lastExpandedLeftPaneWidthRef.current, LEFT_PANE_MIN, LEFT_PANE_MAX))
        return false
      }

      lastExpandedLeftPaneWidthRef.current = clampNumber(leftPaneWidth, LEFT_PANE_MIN, LEFT_PANE_MAX)
      return true
    })
  }, [leftPaneWidth])

  const toggleBottomPane = useCallback(() => {
    setBottomPaneCollapsed((current) => !current)
  }, [])

  const openAssistant = useCallback(
    (launch = null) => {
      setLeftPaneCollapsed(false)
      setAssistantOpen(true)
      setAssistantLaunch(launch)
    },
    [],
  )

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false)
    setAssistantLaunch(null)
  }, [])

  const executeRun = async (mode) => {
    setBottomPaneCollapsed(false)
    setRightTab('result')
    if (mode === 'submit') {
      setLeftTab('solutions')
    }

    if (!canUseRunnerDataset) {
      setRunOutput({
        mode,
        status: 'unavailable',
        message: 'Run/Submit is disabled. This problem has no executable dataset yet.',
        startedAt: null,
        finishedAt: null,
        runId: null,
      })
      return
    }

    if (!runnerConfigured) {
      setRunOutput({
        mode,
        status: 'unavailable',
        message: 'Runner service is not configured. Set VITE_RUNNER_API_URL.',
        startedAt: null,
        finishedAt: null,
        runId: null,
      })
      return
    }

    if (!activeSolution?.code?.trim()) {
      setRunOutput({
        mode,
        status: 'unavailable',
        message: 'Write code before running.',
        startedAt: null,
        finishedAt: null,
        runId: null,
      })
      return
    }

    try {
      const nextSelectedCaseIds = mode === 'run'
        ? (
            isSqlTrack
              ? (selectedSqlSampleId ? [selectedSqlSampleId] : [])
              : focusedTestIds
          )
        : []
      setRunOutput({
        mode,
        status: 'running',
        message: isSqlTrack
          ? mode === 'run'
            ? 'Running against sample data...'
            : 'Submitting against full grading set...'
          : nextSelectedCaseIds.length > 0
            ? `${mode} request sent for ${nextSelectedCaseIds.length} selected cases...`
            : `${mode} request sent...`,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        runId: null,
      })
      if (isSqlTrack) {
        setBottomPaneCollapsed(false)
        setRightTab(mode === 'run' ? 'output' : 'results')
      }

      const createResponse = await fetch(`${runnerApiUrl}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_key: userKey,
          mode,
          problem_key: problemKey || null,
          problem_lc: problemLc,
          track_key: problemState.data?.trackKey || 'dsa',
          language: problemState.data?.content?.editorLanguage || 'python',
          code: activeSolution.code,
          solution_id: activeSolution.id ?? null,
          selected_case_ids: nextSelectedCaseIds,
          test_ids: nextSelectedCaseIds,
        }),
      })

      if (!createResponse.ok) {
        const responseText = await createResponse.text()
        throw new Error(responseText || `Runner request failed (${createResponse.status}).`)
      }

      const created = await createResponse.json()
      const runId = created?.id ?? created?.run_id ?? created?.runId ?? null

      if (!runId) {
        await problemState.refetch()
        setRunOutput((current) => ({
          ...current,
          status: 'queued',
          message: 'Run queued. Waiting for backend polling support.',
        }))
        return
      }

      setRunOutput((current) => ({ ...current, runId }))
      setLatestRunDetails(null)

      for (let attempt = 0; attempt < 45; attempt += 1) {
        await sleep(1200)

        const pollUrl = new URL(`${runnerApiUrl}/runs/${runId}`)
        pollUrl.searchParams.set('user_key', userKey)

        const pollResponse = await fetch(pollUrl.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!pollResponse.ok) {
          continue
        }

        const run = await pollResponse.json()
        const nextStatus = String(run?.status || '').toLowerCase()

        if (FINAL_RUN_STATUSES.has(nextStatus)) {
          setLatestRunDetails(run)
          if (mode === 'submit' && nextStatus === 'passed') {
            const nowIso = new Date().toISOString()
            setProgress((current) => ({
              ...(current || {}),
              status: 'solved',
              solved_at: current?.solved_at || nowIso,
              last_reviewed: nowIso,
            }))
            void persistProgressPatch({
              status: 'solved',
              solved_at: progress?.solved_at || nowIso,
              last_reviewed: nowIso,
            })
          }

          setRunOutput({
            mode,
            status: nextStatus,
            message:
              run?.message ||
              run?.summary ||
              `${run?.tests_passed ?? 0}/${run?.tests_total ?? 0} tests passed`,
            startedAt: run?.started_at || null,
            finishedAt: run?.finished_at || new Date().toISOString(),
            runId,
          })
          if (isSqlTrack) {
            setRightTab(mode === 'run' ? 'output' : 'results')
            setBottomPaneCollapsed(false)
          }
          await problemState.refetch()
          return
        }

        setRunOutput((current) => ({
          ...current,
          status: nextStatus || 'running',
          message: run?.message || 'Running...',
        }))
      }

      setRunOutput((current) => ({
        ...current,
        status: 'timeout',
        message: 'Polling timed out. Check run history.',
      }))
      await problemState.refetch()
    } catch (caughtError) {
      setRunOutput({
        mode,
        status: 'error',
        message: caughtError instanceof Error ? caughtError.message : 'Runner request failed.',
        startedAt: null,
        finishedAt: new Date().toISOString(),
        runId: null,
      })
    }
  }

  const startWorkspaceResize = useCallback((event) => {
    if (typeof window === 'undefined' || !isWideLayout) {
      return
    }

    event.preventDefault()
    const body = document.body
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'

    const onMove = (moveEvent) => {
      const container = workspaceSplitRef.current
      if (!container) {
        return
      }

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) {
        return
      }

      const nextPercent = ((moveEvent.clientX - rect.left) / rect.width) * 100
      const clamped = clampNumber(nextPercent, LEFT_PANE_MIN, LEFT_PANE_MAX)
      setLeftPaneWidth(clamped)
      lastExpandedLeftPaneWidthRef.current = clamped
    }

    const onUp = () => {
      body.style.cursor = ''
      body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [isWideLayout])

  const startBottomResize = useCallback((event) => {
    event.preventDefault()
    const body = document.body
    body.style.cursor = 'row-resize'
    body.style.userSelect = 'none'

    const onMove = (moveEvent) => {
      const container = rightPaneRef.current
      if (!container) {
        return
      }

      const rect = container.getBoundingClientRect()
      if (rect.height <= 0) {
        return
      }

      const distanceFromBottom = rect.bottom - moveEvent.clientY
      const maxHeight = Math.max(200, rect.height - 160)
      setBottomPaneHeight(clampNumber(distanceFromBottom, 160, maxHeight))
    }

    const onUp = () => {
      body.style.cursor = ''
      body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const runs = useMemo(() => problemState.data?.runs ?? [], [problemState.data?.runs])
  const latestSolutionRun = useMemo(
    () => runs.find((run) => getRunSolutionId(run) === activeSolution?.id) ?? null,
    [activeSolution?.id, runs],
  )
  const selectedResultRun = useMemo(() => {
    if (runOutput.runId) {
      return runs.find((run) => run.id === runOutput.runId) ?? latestRunDetails ?? null
    }

    if (getRunSolutionId(latestRunDetails) === activeSolution?.id) {
      return latestRunDetails
    }

    return latestSolutionRun
  }, [activeSolution?.id, latestRunDetails, latestSolutionRun, runOutput.runId, runs])
  const selectedResultStdout = useMemo(() => extractUserStdout(selectedResultRun?.stdout), [selectedResultRun?.stdout])
  const collapsedStdout = useMemo(() => collapseStdoutLines(selectedResultStdout), [selectedResultStdout])
  const selectedResultCases = useMemo(
    () => (Array.isArray(selectedResultRun?.verdict?.cases) ? selectedResultRun.verdict.cases : []),
    [selectedResultRun?.verdict?.cases],
  )
  const selectedSqlPublicRun = useMemo(() => {
    if (!isSqlTrack) {
      return null
    }
    if (selectedResultRun && getRunMode(selectedResultRun) === 'run') {
      return selectedResultRun
    }
    return runs.find((run) => getRunMode(run) === 'run' && getRunSolutionId(run) === activeSolution?.id) ?? null
  }, [activeSolution?.id, isSqlTrack, runs, selectedResultRun])
  const selectedSqlSubmitRun = useMemo(() => {
    if (!isSqlTrack) {
      return null
    }
    if (selectedResultRun && getRunMode(selectedResultRun) === 'submit') {
      return selectedResultRun
    }
    return runs.find((run) => getRunMode(run) === 'submit' && getRunSolutionId(run) === activeSolution?.id) ?? null
  }, [activeSolution?.id, isSqlTrack, runs, selectedResultRun])
  const selectedSqlPublicCase = useMemo(() => {
    if (!isSqlTrack || !selectedSqlPublicRun) {
      return null
    }
    const cases = Array.isArray(selectedSqlPublicRun?.verdict?.cases) ? selectedSqlPublicRun.verdict.cases : []
    if (cases.length === 0) {
      return null
    }
    if (selectedSqlSampleId) {
      return cases.find((caseResult) => String(caseResult.id) === String(selectedSqlSampleId)) ?? cases[0] ?? null
    }
    return cases[0] ?? null
  }, [isSqlTrack, selectedSqlPublicRun, selectedSqlSampleId])
  const submitRuns = runs.filter((run) => getRunMode(run) === 'submit')
  const passedSubmitRuns = submitRuns.filter((run) => isPassedSubmitRun(run))

  const toggleFocusedTestId = useCallback((testId) => {
    setFocusedTestIds((current) => {
      if (current.includes(testId)) {
        return current.filter((value) => value !== testId)
      }
      return [...current, testId]
    })
  }, [])

  const clearFocusedTests = useCallback(() => {
    setFocusedTestIds([])
  }, [])

  const useFailedCasesAsFocus = useCallback(() => {
    const failedIds = selectedResultCases.filter((caseResult) => !caseResult?.passed).map((caseResult) => caseResult.id)
    setFocusedTestIds(failedIds)
  }, [selectedResultCases])

  useEffect(() => {
    setShowRawStdout(false)
  }, [selectedResultRun?.id])

  if (problemState.loading) {
    return (
      <section className="h-[100dvh] w-full overflow-hidden p-3 md:p-4">
        <div className="border border-border-subtle bg-surface p-4 text-sm text-text-muted">Loading problem...</div>
      </section>
    )
  }

  if (problemState.error || !problemState.data) {
    return (
      <section className="h-[100dvh] w-full overflow-hidden p-3 md:p-4">
        <div className="border border-border-subtle bg-surface p-4 text-sm text-text-primary">
          {problemState.error?.message || 'Unable to load problem.'}
        </div>
      </section>
    )
  }

  const { data } = problemState
  const activeTests = data.tests ?? []
  const activeSqlFixtures = data.sqlFixtures ?? []
  const publicSqlFixtures = activeSqlFixtures.filter((fixture) => fixture.is_public)
  const sqlSampleFixtures = publicSqlFixtures.length > 0 ? publicSqlFixtures : activeSqlFixtures
  const selectedSqlSampleFixture =
    sqlSampleFixtures.find((fixture) => String(fixture.fixture_key || fixture.id) === String(selectedSqlSampleId)) ??
    sqlSampleFixtures[0] ??
    null
  const activeCaseEntries = activeTests
  const sqlPresentation =
    isSqlTrack && data.content?.presentation && Array.isArray(data.content.presentation.schema)
      ? data.content.presentation
      : null
  const examples = (sqlPresentation?.examples ?? data.content?.presentation?.examples ?? data.content?.examples ?? []).slice(0, 4)
  const contentPresentation = data.content?.presentation ?? {
    statement: data.content?.description || '',
    interfaceItems: [],
    constraints: [],
    followUp: [],
    nodeShape: [],
  }
  const dsaStatementVisuals = !isSqlTrack ? extractProblemVisuals(contentPresentation, 'statement') : []
  const sqlSchemaVisuals = isSqlTrack ? extractProblemVisuals(sqlPresentation ?? contentPresentation, 'schema') : []
  const activePhaseName = String(data.row.phase_name || data.row.phaseName || '').trim()
  const sourcePlatformLabel = isSqlTrack
    ? sqlPresentation?.source?.platform || sourcePlatformForProblem(data.row)
    : data.active.leetcodeUrl
      ? 'LeetCode'
      : data.active.neetcodeUrl
        ? 'NeetCode'
        : sourcePlatformForProblem(data.row)
  const assistantProblemSummary = {
    problemKey,
    trackKey,
    title: data.active.title,
    tier: data.active.tier,
    phaseName: activePhaseName,
    statement: sqlPresentation?.statement || contentPresentation.statement,
    exampleCount: examples.length,
    schemaCount: Array.isArray(sqlPresentation?.schema) ? sqlPresentation.schema.length : 0,
    constraintCount: Array.isArray(contentPresentation.constraints) ? contentPresentation.constraints.length : 0,
  }
  const assistantWorkspaceContext = {
    editorText: activeSolution?.code || '',
    activeNoteId: activeNote?.id ?? null,
    activeNoteLabel: activeNote?.label || '',
    activeNoteContent: activeNote?.content || defaultNoteContent(),
    selectedRunId:
      selectedResultRun?.id ||
      selectedSqlPublicRun?.id ||
      selectedSqlSubmitRun?.id ||
      runOutput.runId ||
      null,
    selectedRunStatus:
      selectedResultRun?.status ||
      selectedSqlPublicRun?.status ||
      selectedSqlSubmitRun?.status ||
      runOutput.status ||
      '',
    selectedCaseIds: focusedTestIds,
    selectedFixtureId: selectedSqlSampleFixture ? String(selectedSqlSampleFixture.fixture_key || selectedSqlSampleFixture.id) : null,
    fixtures: sqlSampleFixtures,
  }
  const showDesktopAssistant = assistantOpen && !leftPaneCollapsed && isWideLayout
  const showMobileAssistant = assistantOpen && !isWideLayout

  const launchAssistantWithPreset = (launch = {}) => {
    openAssistant({
      message: launch.message || '',
      attachments: {
        include_problem: true,
        include_editor: Boolean(assistantWorkspaceContext.editorText.trim()),
        include_latest_run: Boolean(assistantWorkspaceContext.selectedRunId),
        include_note: false,
        include_stdout: false,
        selected_case_ids: assistantWorkspaceContext.selectedCaseIds,
        selected_fixture_id: assistantWorkspaceContext.selectedFixtureId,
        selected_run_id: assistantWorkspaceContext.selectedRunId,
        note_id: assistantWorkspaceContext.activeNoteId,
        provider_mode: preferredAiProviderMode,
        ...(launch.attachments || {}),
      },
    })
  }

  const copySelectedSqlOutput = async () => {
    if (!selectedSqlPublicCase?.output) {
      return
    }

    const markdown = tableToMarkdown(selectedSqlPublicCase.output)
    await copyValueToClipboard(markdown || JSON.stringify(selectedSqlPublicCase.output, null, 2))
  }

  const insertSelectedSqlOutputIntoNote = async () => {
    if (!selectedSqlPublicCase?.output) {
      return
    }

    const markdown = tableToMarkdown(selectedSqlPublicCase.output)
    await insertAiPayloadIntoCurrentNote(
      buildNotePayload(
        'SQL Sample Output',
        selectedSqlSampleFixture?.label || 'Visible output from the latest sample run.',
        [buildCodeBlock(markdown || JSON.stringify(selectedSqlPublicCase.output, null, 2), 'markdown', 'Output')],
      ),
    )
  }

  const copySelectedDsaResult = async () => {
    if (!selectedResultRun) {
      return
    }

    await copyValueToClipboard(
      JSON.stringify(
        {
          status: selectedResultRun.status,
          tests_passed: selectedResultRun.tests_passed,
          tests_total: selectedResultRun.tests_total,
          runtime_ms: selectedResultRun.runtime_ms,
          memory_kb: selectedResultRun.memory_kb,
          stderr: selectedResultRun.stderr || selectedResultRun.compile_output || '',
        },
        null,
        2,
      ),
    )
  }

  const insertSelectedDsaResultIntoNote = async () => {
    if (!selectedResultRun) {
      return
    }

    await insertAiPayloadIntoCurrentNote(
      buildNotePayload('Run Result', `${selectedResultRun.tests_passed ?? 0}/${selectedResultRun.tests_total ?? 0} tests passed`, [
        buildCodeBlock(
          JSON.stringify(
            {
              status: selectedResultRun.status,
              tests_passed: selectedResultRun.tests_passed,
              tests_total: selectedResultRun.tests_total,
              runtime_ms: selectedResultRun.runtime_ms,
              memory_kb: selectedResultRun.memory_kb,
              stderr: selectedResultRun.stderr || selectedResultRun.compile_output || '',
            },
            null,
            2,
          ),
          'json',
          'Evaluator summary',
        ),
      ]),
    )
  }

  return (
    <section className="h-[100dvh] w-full overflow-hidden p-3 md:p-4">
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <header className="border border-border-subtle bg-surface px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl leading-tight text-text-primary md:text-[30px]">{data.active.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Link
                  to={`/problems?tier=${data.active.tier}`}
                  className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 font-mono text-[10px] text-text-muted hover:border-accent hover:text-accent"
                >
                  Tier {data.active.tier}
                </Link>
                {activePhaseName ? (
                  <Link
                    to={`/problems?phase=${data.row.phase}`}
                    className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
                  >
                    {activePhaseName}
                  </Link>
                ) : null}
                {data.row.phase_order ? (
                  <span className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 font-mono text-[10px] text-text-muted">
                    #{data.row.phase_order}
                  </span>
                ) : null}
                <span className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 text-[10px] text-text-primary">
                  {data.active.difficulty}
                </span>
                {navigator.position !== null ? (
                  <span className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 text-[10px] text-text-muted">
                    {navigator.position} of {navigator.total} in tier
                  </span>
                ) : null}
                {navigator.phasePosition !== null && navigator.phaseTotal > 0 ? (
                  <span className="inline-flex h-6 items-center border border-border-subtle bg-base px-2 text-[10px] text-text-muted">
                    {navigator.phasePosition} of {navigator.phaseTotal} in phase
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex min-w-0 flex-col items-end gap-2">
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                <StatusSelector
                  value={progress?.status ?? 'unsolved'}
                  busy={saving}
                  onChange={(nextStatus) => {
                    const nowIso = new Date().toISOString()
                    setProgress((current) => {
                      const next = { ...(current || {}), status: nextStatus, last_reviewed: nowIso }
                      if (nextStatus === 'solved') {
                        return { ...next, solved_at: current?.solved_at || nowIso }
                      }
                      return { ...next, solved_at: null }
                    })

                    void persistProgressPatch({
                      status: nextStatus,
                      last_reviewed: nowIso,
                      solved_at: nextStatus === 'solved' ? progress?.solved_at || nowIso : null,
                    })
                  }}
                />
                {isSqlTrack ? (
                  <SourceHeaderButton
                    href={sqlPresentation?.source?.canonical_url || sqlPresentation?.source?.original_url || data.row.canonical_source_url || data.row.source_url}
                    platform={sourcePlatformLabel}
                  />
                ) : data.active.leetcodeUrl || data.active.neetcodeUrl ? (
                  <SourceHeaderButton
                    href={data.active.leetcodeUrl || data.active.neetcodeUrl}
                    platform={sourcePlatformLabel}
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 items-center justify-end gap-2 self-end pt-0.5">
                <button
                  type="button"
                  disabled={!navigator.prevProblem}
                  onClick={() => navigator.prevProblem && navigate(problemUrl(navigator.prevProblem))}
                  title={
                    navigator.prevProblem
                      ? `Previous in tier: ${navigator.prevProblem.title || navigator.prevProblem.problemKey || `LC ${navigator.prevProblem.lc}`}`
                      : 'No previous problem in study order'
                  }
                  className="inline-flex h-8 w-8 items-center justify-center border border-border-subtle text-text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft size={14} />
                </button>
                <button
                  type="button"
                  disabled={!navigator.nextProblem}
                  onClick={() => navigator.nextProblem && navigate(problemUrl(navigator.nextProblem))}
                  title={
                    navigator.nextProblem
                      ? `Next in tier: ${navigator.nextProblem.title || navigator.nextProblem.problemKey || `LC ${navigator.nextProblem.lc}`}`
                      : 'Last problem in study order'
                  }
                  className="inline-flex h-8 w-8 items-center justify-center border border-border-subtle bg-base text-text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </header>

        {!supabase ? (
          <div className="border border-border-subtle bg-surface px-3 py-2 text-xs text-text-primary">
            {missingSupabaseMessage}
          </div>
        ) : null}

        <div ref={workspaceSplitRef} className="flex h-full min-h-0 min-w-0 w-full flex-col gap-3 xl:flex-row">
          {!leftPaneCollapsed ? (
            <section
              className={[
                'flex min-h-0 min-w-0 w-full flex-col xl:shrink-0',
                showDesktopAssistant ? '' : 'border border-border-subtle bg-surface',
              ].join(' ')}
              style={isWideLayout ? { width: `${leftPaneWidth}%` } : undefined}
            >
            {showDesktopAssistant ? (
              <ProblemAssistantDrawer
                open={assistantOpen}
                onClose={closeAssistant}
                problem={assistantProblemSummary}
                workspaceContext={assistantWorkspaceContext}
                preferredProviderMode={preferredAiProviderMode}
                onProviderPreferenceChange={(nextMode) => {
                  void userSettingsState.update({ preferred_ai_provider_mode: nextMode })
                }}
                initialLaunch={assistantLaunch}
                onLaunchHandled={() => setAssistantLaunch(null)}
                onInsertIntoCurrentNote={insertAiPayloadIntoCurrentNote}
                onCreateAiNote={createAiNoteFromPayload}
              />
            ) : (
              <>
            <div className="flex min-w-0 items-center border-b border-border-subtle">
              <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto">
                <div className="flex min-w-max items-center">
                  <>
                    <LeftTabButton active={leftTab === 'problem'} onClick={() => setLeftTab('problem')} label="Problem" />
                    {isSqlTrack ? (
                      <LeftTabButton active={leftTab === 'data'} onClick={() => setLeftTab('data')} label="Data" />
                    ) : null}
                    <LeftTabButton active={leftTab === 'notes'} onClick={() => setLeftTab('notes')} label="Notes" />
                    <LeftTabButton active={leftTab === 'resources'} onClick={() => setLeftTab('resources')} label="Resources" />
                    <LeftTabButton active={leftTab === 'solutions'} onClick={() => setLeftTab('solutions')} label="Solutions" />
                    <LeftTabButton active={leftTab === 'comments'} onClick={() => setLeftTab('comments')} label="Comments" />
                  </>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleLeftPane}
                title="Hide problem pane"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center border-l border-border-subtle text-text-muted hover:text-accent"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
	              {(() => {
	                const tabToScope = { problem: 'progress', notes: 'notes', solutions: 'solutions', resources: 'resources', comments: null, shared: null }
	                const scope = tabToScope[leftTab]
                const msg = scope ? sectionMessages[scope] : ''
                return msg ? (
                  <div className="mb-3 border border-border-subtle bg-surface px-2.5 py-1.5 text-[11px] text-text-primary">
                    {msg}
	                    <button type="button" onClick={() => setSectionMessage(scope, '')} className="ml-2 text-text-muted hover:text-accent">×</button>
	                  </div>
	                ) : null
	              })()}
	              <AnimatePresence initial={false} mode="wait">
	                <Motion.div
	                  key={`${isSqlTrack ? 'sql' : 'dsa'}-${leftTab}`}
	                  variants={panelSwap}
	                  initial="initial"
	                  animate="animate"
	                  exit="exit"
	                  className="space-y-3"
	                >
	              {leftTab === 'problem' ? (
	                <div className="space-y-3">
                  <div className="border border-border-subtle bg-base p-3">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Statement</p>
                      <CompanySymbols companies={data.active.companies} max={10} size="xl" />
                    </div>
                    <div className="mt-2">
                      <FormattedDescription text={sqlPresentation?.statement || contentPresentation.statement} />
                    </div>
                    {!isSqlTrack && dsaStatementVisuals.length > 0 ? (
                      <div className="mt-3">
                        <ProblemVisualGallery presentation={contentPresentation} section="statement" />
                      </div>
                    ) : null}
                  </div>

                  {isSqlTrack ? (
                    <>
                      {sqlSchemaVisuals.length > 0 ? (
                        <div className="border border-border-subtle bg-base p-3">
                          <ProblemVisualGallery presentation={sqlPresentation ?? contentPresentation} section="schema" />
                        </div>
                      ) : null}
                      <SqlSchemaSection schema={sqlPresentation?.schema} />
                      <SqlExamplesSection examples={examples} />
                      <SqlRequirementsSection requirements={sqlPresentation?.requirements} />
                    </>
                  ) : (
                    <>
                      <ProblemInterfaceSection presentation={contentPresentation} />
                      <ProblemExamplesSection examples={examples} />
                      <ProblemConstraintsSection presentation={contentPresentation} />
                    </>
                  )}

                  <div className="border border-border-subtle bg-base p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Tags</p>
                    {data.content.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {data.content.tags.map((tag) => (
                          <span
                            key={`tag-${tag}`}
                            className="inline-flex h-6 items-center border border-border-subtle bg-surface px-2 font-mono text-[10px] text-text-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-text-muted">No tags available.</p>
                    )}
                  </div>

                  {navigator.nextInPhase ? (
                    <div className="border border-border-subtle bg-base p-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Do a similar problem</p>
                      <button
                        type="button"
                        onClick={() => navigate(problemUrl(navigator.nextInPhase))}
                        title={`Next in phase: ${navigator.nextInPhase.title || navigator.nextInPhase.problemKey || `LC ${navigator.nextInPhase.lc}`}`}
                        className="mt-2 inline-flex min-w-0 max-w-full items-center gap-1.5 border border-border-subtle bg-surface px-2.5 py-1.5 text-left text-[12px] text-text-primary hover:border-accent hover:text-accent"
                      >
                        <CornerDownRight size={12} className="shrink-0" />
                        <span className="truncate">
                          {navigator.nextInPhase.title || navigator.nextInPhase.problemKey || `LC ${navigator.nextInPhase.lc}`}
                        </span>
                      </button>
                    </div>
                  ) : null}

                  {!isSqlTrack ? (
                    <div className="border border-border-subtle bg-base p-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Companion</p>
                      {data.companion?.lc || data.companion?.problemKey ? (
                        <p className="mt-2 text-sm text-text-primary">
                          <Link to={problemUrl(data.companion)} className="hover:text-accent">
                            {data.companion.title}
                          </Link>
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-text-muted">No companion linked.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isSqlTrack && leftTab === 'data' ? (
                <SqlDataPanel
                  key={`sql-data-pane-${selectedSqlSampleFixture?.fixture_key || selectedSqlSampleFixture?.id || 'idle'}`}
                  fixtures={sqlSampleFixtures}
                  selectedFixtureId={selectedSqlSampleFixture ? String(selectedSqlSampleFixture.fixture_key || selectedSqlSampleFixture.id) : selectedSqlSampleId}
                  onSelectFixtureId={setSelectedSqlSampleId}
                  selectedRunCase={selectedSqlPublicCase}
                />
              ) : null}

              {leftTab === 'notes' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 border border-border-subtle bg-base p-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setNotesView('mine')}
                        className={[
                          'inline-flex h-7 items-center border px-2 text-[11px]',
                          notesView === 'mine'
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                        ].join(' ')}
                      >
                        Mine
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotesView('shared')}
                        className={[
                          'inline-flex h-7 items-center border px-2 text-[11px]',
                          notesView === 'shared'
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                        ].join(' ')}
                      >
                        Shared
                      </button>
                    </div>

                    {notesView === 'mine' ? (
                      <div className="flex items-center gap-1">
                        {activeNote ? (
                          <SharedNoteToggleButton
                            note={activeNote}
                            userKey={userKey}
                            sharedNotesState={sharedNotesState}
                            sharedNoteRecord={activeNoteSharedRecord}
                          />
                        ) : null}
                        {activeNote ? (
                          <button
                            type="button"
                            onClick={() => {
                              void flushNoteSave(activeNote.id, {
                                label: activeNote.label,
                                content: activeNote.content || defaultNoteContent(),
                              })
                            }}
                            disabled={!activeNoteIsDirty || activeNoteIsSaving}
                            className={[
                              'inline-flex h-7 items-center border px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-60',
                              activeNoteIsDirty
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-border-subtle text-text-muted',
                            ].join(' ')}
                          >
                            {activeNoteIsSaving ? 'Saving...' : activeNoteIsDirty ? 'Save' : 'Saved'}
                          </button>
                        ) : null}
                        {activeNote ? (
                          <button
                            type="button"
                            onClick={() => {
                              void deleteNote(activeNote.id)
                            }}
                            title="Delete note"
                            className="inline-flex h-7 w-7 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent"
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            void addNote()
                          }}
                          title="New note"
                          aria-label="New note"
                          className="inline-flex h-7 w-7 items-center justify-center border border-accent bg-accent/10 text-accent"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {notesView === 'mine' ? (
                    <>
                      {notes.length > 0 ? (
                        <div className="scrollbar-none overflow-x-auto border border-border-subtle bg-base p-2">
                          <div className="flex min-w-max items-center gap-1">
                            {notes.map((note) => (
                              <button
                                key={`note-chip-${note.id}`}
                                type="button"
                                onClick={() => setSelectedNoteId(note.id)}
                                className={[
                                  'inline-flex h-7 items-center gap-1 border px-2 text-[11px]',
                                  activeNote?.id === note.id
                                    ? 'border-accent bg-accent/10 text-accent'
                                    : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                                ].join(' ')}
                              >
                                {note.label}
                                {ownSharedNotesBySourceId.has(note.id) ? (
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {notes.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => void addNote()}
                          className="flex h-8 w-full items-center justify-center gap-1.5 border border-dashed border-border-subtle text-[11px] text-text-muted hover:border-accent hover:text-accent"
                        >
                          <Plus size={12} /> New note
                        </button>
                      ) : null}

                      {activeNote ? (
                        <div className="border border-border-subtle bg-base">
                          <div className="border-b border-border-subtle px-2 py-1">
                            <input
                              value={activeNote.label}
                              onChange={(event) => {
                                const label = event.target.value
                                setNotes((current) =>
                                  current.map((item) => (item.id === activeNote.id ? { ...item, label } : item)),
                                )
                                queueNoteSave(activeNote.id, { label })
                              }}
                              placeholder="Name"
                              className="h-7 w-full border border-border-subtle bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent"
                            />
                          </div>
                          <NoteEditor
                            value={activeNote.content || defaultNoteContent()}
                            problemLc={problemLc}
                            problemKey={problemKey}
                            exportFileName={`${data.active.title}-${activeNote.label}`}
                            onChange={(content) => {
                              setNotes((current) =>
                                current.map((item) => (item.id === activeNote.id ? { ...item, content } : item)),
                              )
                              queueNoteSave(activeNote.id, { content })
                            }}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <SharedNotesSection
                      sharedNotesState={sharedNotesState}
                      userKey={userKey}
                      selectedSharedNoteId={selectedSharedNoteId}
                      onSelectSharedNote={setSelectedSharedNoteId}
                      onCopyNote={async (sharedNote) => {
                        await createNoteVersion({
                          sortOrder: notes.length,
                          seedContent: sharedNote.content || defaultNoteContent(),
                          label: sharedNote.title || `Note ${notes.length + 1}`,
                        })
                      }}
                    />
                  )}
                </div>
              ) : null}

              {leftTab === 'resources' ? (
                <div className="space-y-3">
                  <form
                    onSubmit={addResource}
                    className="grid grid-cols-1 gap-2 border border-border-subtle bg-base p-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_140px_auto]"
                  >
                    <input
                      type="url"
                      required
                      placeholder="URL"
                      value={resourceForm.url}
                      onChange={(event) => {
                        const url = event.target.value
                        setResourceForm((current) => ({
                          ...current,
                          url,
                          type: getYoutubeEmbedUrl(url) ? 'youtube' : current.type,
                        }))
                      }}
                      className="h-8 border border-border-subtle bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent"
                    />
                    <input
                      placeholder="Title (optional)"
                      value={resourceForm.title}
                      onChange={(event) => {
                        setResourceForm((current) => ({ ...current, title: event.target.value }))
                      }}
                      className="h-8 border border-border-subtle bg-surface px-2 text-xs text-text-primary outline-none focus:border-accent"
                    />
                    <CustomSelect
                      value={resourceForm.type}
                      onChange={(val) => setResourceForm((current) => ({ ...current, type: val }))}
                      options={[
                        { value: 'youtube', label: 'YouTube' },
                        { value: 'article', label: 'Article' },
                        { value: 'other', label: 'Other' },
                      ]}
                    />
                    <button
                      type="submit"
                      title="Add resource"
                      aria-label="Add resource"
                      className="inline-flex h-8 w-8 items-center justify-center border border-accent bg-accent/10 text-accent"
                    >
                      <Plus size={12} />
                    </button>
                  </form>

                  <div className="space-y-2">
                    {resources.map((resource) => {
                      const embedUrl = getYoutubeEmbedUrl(resource.url)
                      return (
                        <article key={`resource-${resource.id}`} className="border border-border-subtle bg-base p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm text-text-primary">{resource.title || resource.url}</p>
                            <div className="flex items-center gap-1">
                              <a
                                href={resource.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                              >
                                Open <ExternalLink size={11} />
                              </a>
                              <button
                                type="button"
                                onClick={() => {
                                  void deleteResource(resource.id)
                                }}
                                className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-text-muted">{resource.type}</p>
                          {embedUrl ? (
                            <div className="mt-2 overflow-hidden border border-border-subtle">
                              <iframe
                                title={resource.title || `youtube-${resource.id}`}
                                src={embedUrl}
                                className="h-[260px] w-full"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {leftTab === 'solutions' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 border border-border-subtle bg-base p-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSolutionsView('mine')}
                        className={[
                          'inline-flex h-7 items-center border px-2 text-[11px]',
                          solutionsView === 'mine'
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                        ].join(' ')}
                      >
                        Mine
                      </button>
                      <button
                        type="button"
                        onClick={() => setSolutionsView('shared')}
                        className={[
                          'inline-flex h-7 items-center border px-2 text-[11px]',
                          solutionsView === 'shared'
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                        ].join(' ')}
                      >
                        Shared
                      </button>
                    </div>
                    {solutionsView === 'mine' ? (
                      <p className="font-mono text-[11px] text-text-muted">
                        Passed: {passedSubmitRuns.length} · Total: {submitRuns.length}
                      </p>
                    ) : (
                      <p className="font-mono text-[11px] text-text-muted">
                        {sharedSolutionsState.sharedSolutions.length} shared
                      </p>
                    )}
                  </div>

                  {solutionsView === 'mine' ? (
                    submitRuns.length === 0 ? (
                      <p className="px-1 text-[11px] text-text-muted">No submissions yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {submitRuns.map((run) => {
                        const openRunResult = () => {
                          setLatestRunDetails(run)
                          setRunOutput((current) => ({
                            ...current,
                            mode: getRunMode(run),
                            status: run.status || current.status,
                            message:
                              run?.message || run?.summary || `${run?.tests_passed ?? 0}/${run?.tests_total ?? 0} tests passed`,
                            startedAt: run?.started_at || current.startedAt,
                            finishedAt: run?.finished_at || current.finishedAt,
                            runId: run.id,
                          }))
                          setBottomPaneCollapsed(false)
                          setRightTab('result')
                        }

                          return (
                            <article key={`submit-run-${run.id}`} className="border border-border-subtle bg-base p-3">
                              <div className="flex items-start justify-between gap-3">
                                <button
                                  type="button"
                                  onClick={openRunResult}
                                  className="min-w-0 flex-1 text-left"
                                  title="Open result"
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="text-sm text-text-primary">Run #{run.id}</span>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                                      {getRunMode(run) || 'submit'}
                                    </span>
                                  </div>
                                  <p className="mt-1 font-mono text-[11px] text-text-muted">
                                    {formatDate(run.created_at, 'Unknown')}
                                  </p>
                                </button>
                                <div className="flex shrink-0 items-center gap-1">
                                  <span className="inline-flex h-6 items-center border border-border-subtle px-2 font-mono text-[10px] text-text-muted">
                                    {run.status}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void loadRunCodeIntoEditor(run)
                                    }}
                                    className="inline-flex h-7 w-7 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent"
                                    title="Copy run code into your editor"
                                  >
                                    <FileCode2 size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={openRunResult}
                                    className="inline-flex h-7 w-7 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent"
                                    title="Open result"
                                  >
                                    <Eye size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void deleteRun(run)
                                    }}
                                    disabled={deletingRunId === run.id}
                                    className="inline-flex h-7 w-7 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Delete run"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
                                <span>{run.tests_passed ?? 0}/{run.tests_total ?? 0} tests</span>
                                <span>{run.runtime_ms ?? '-'}ms</span>
                                <span>{run.memory_kb ?? '-'}kb</span>
                                <span>{run.runner_meta?.judge_status || '-'}</span>
                              </div>

                              <div className="mt-2 border-t border-border-subtle pt-2">
                                <SharedSolutionShareButton
                                  run={run}
                                  userKey={userKey}
                                  sharedSolutionsState={sharedSolutionsState}
                                />
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    )
                  ) : (
                    <SharedSolutionsSection
                      sharedSolutionsState={sharedSolutionsState}
                      userKey={userKey}
                      selectedSharedSolutionId={selectedSharedSolutionId}
                      onSelectSharedSolution={setSelectedSharedSolutionId}
                      onLoadCode={async (code) => {
                        await createSolutionVersion({
                          sortOrder: nextSolutionSortOrder(solutions),
                          seedCode: code,
                        })
                      }}
                    />
                  )}
                </div>
              ) : null}

              {/* ── Comments tab ── */}
              {leftTab === 'comments' ? (
                <CommentsSection
	                  commentsState={commentsState}
	                  userKey={userKey}
	                  focusedCommentId={focusedCommentId}
	                />
	              ) : null}
	                </Motion.div>
	              </AnimatePresence>

	            </div>
              </>
            )}
          </section>
          ) : null}

          {leftPaneCollapsed ? (
            <button
              type="button"
              onClick={toggleLeftPane}
              title="Show problem pane"
              className="inline-flex h-10 w-full items-center justify-center border border-border-subtle bg-surface text-text-muted hover:border-accent hover:text-accent xl:h-auto xl:w-10 xl:shrink-0"
            >
              <PanelLeftOpen size={14} />
            </button>
          ) : null}

          {!leftPaneCollapsed ? (
            <button
              type="button"
              aria-label="Resize problem and editor panels"
              onMouseDown={startWorkspaceResize}
              title="Drag to resize panes"
              className="hidden w-3 shrink-0 cursor-col-resize items-center justify-center border border-border-subtle bg-base/90 text-text-muted transition-colors hover:border-accent hover:text-accent xl:inline-flex"
            >
              <GripVertical size={12} />
            </button>
          ) : null}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-border-subtle bg-surface">
            <header className="border-b border-border-subtle p-2">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto">
                    <div className="flex min-w-max items-center gap-1">
                      {visibleSolutions.map((solution) => (
                        <button
                          key={`solution-chip-${solution.id}`}
                          type="button"
                          onClick={() => setSelectedSolutionId(solution.id)}
                          className={[
                            'h-7 shrink-0 border px-2 text-[11px]',
                            activeSolution?.id === solution.id
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
                          ].join(' ')}
                        >
                          {solution.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        void addSolution()
                      }}
                      title="New code version"
                      aria-label="New code version"
                      className="inline-flex h-7 w-7 items-center justify-center border border-accent bg-accent/10 text-accent"
                    >
                      <Plus size={12} />
                    </button>
                      {activeSolution ? (
                        <button
                          type="button"
                          onClick={() => {
                            setIsRenamingSolution((current) => !current)
                        }}
                        title="Rename version"
                        className="inline-flex h-7 w-7 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent"
                      >
                        <Edit3 size={12} />
                      </button>
                    ) : null}
                    {activeSolution ? (
                      <button
                        type="button"
                        onClick={() => {
                          void deleteSolution(activeSolution.id)
                        }}
                        className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                      >
                        <Trash2 size={11} />
                      </button>
                    ) : null}
                    {activeSolution ? (
                      <button
                        type="button"
                        onClick={() => setResetConfirmOpen(true)}
                        className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                        title="Reset code to starter template"
                      >
                        <RotateCcw size={11} />
                        Reset
                      </button>
                    ) : null}
                    {!isSqlTrack && focusedTestIds.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearFocusedTests}
                        className="inline-flex h-7 items-center gap-1 border border-accent bg-accent/10 px-2 text-[11px] text-accent"
                        title="Clear selected test cases"
                      >
                        Selected {focusedTestIds.length}
                        <X size={11} />
                      </button>
                    ) : null}
                    <Motion.button
                      type="button"
                      onClick={() =>
                        launchAssistantWithPreset({
                          attachments: {
                            include_latest_run: Boolean(
                              isSqlTrack ? selectedSqlPublicRun?.id || selectedSqlSubmitRun?.id : selectedResultRun?.id,
                            ),
                            selected_run_id:
                              isSqlTrack
                                ? selectedSqlPublicRun?.id || selectedSqlSubmitRun?.id || null
                                : selectedResultRun?.id || null,
                            selected_fixture_id: isSqlTrack
                              ? selectedSqlSampleFixture
                                ? String(selectedSqlSampleFixture.fixture_key || selectedSqlSampleFixture.id)
                                : null
                              : null,
                            selected_case_ids: !isSqlTrack ? focusedTestIds : [],
                          },
                        })
                      }
                      className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                      whileTap={buttonTap.whileTap}
                      transition={buttonTap.transition}
                    >
                      <MessageSquareReply size={11} />
                      Ask AI
                    </Motion.button>
                    <Motion.button
                      type="button"
                      onClick={() => {
                        void executeRun('run')
                      }}
                      disabled={!canExecute}
                      className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                      whileTap={buttonTap.whileTap}
                      transition={buttonTap.transition}
                    >
                      {!isSqlTrack && focusedTestIds.length > 0 ? `Run ${focusedTestIds.length}` : 'Run'}
                    </Motion.button>
                    <Motion.button
                      type="button"
                      onClick={() => {
                        void executeRun('submit')
                      }}
                      disabled={!canExecute}
                      className="inline-flex h-7 items-center gap-1 border border-accent bg-accent/10 px-2 text-[11px] text-accent disabled:cursor-not-allowed disabled:opacity-60"
                      whileTap={buttonTap.whileTap}
                      transition={buttonTap.transition}
                    >
                      Submit
                    </Motion.button>
                  </div>
                </div>

                {activeSolution ? (
                  isRenamingSolution ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={activeSolution.label || ''}
                        onChange={(event) => {
                          const label = event.target.value
                          setSolutions((current) =>
                            current.map((item) => (item.id === activeSolution.id ? { ...item, label } : item)),
                          )
                          queueSolutionSave(activeSolution.id, { label })
                        }}
                        placeholder="Name"
                        className="h-7 w-full max-w-[260px] border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
                      />
                    </div>
                  ) : null
                ) : null}
              </div>
            </header>

            <div ref={rightPaneRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {!canUseRunnerDataset ? (
                  <div className="border-b border-border-subtle bg-base px-3 py-2 text-[11px] text-text-muted">
                    {isSqlTrack
                      ? 'Practice mode only for this problem. You can still write and save SQL versions, but Run/Submit requires SQL grading data.'
                      : 'Practice mode only for this problem. You can still write and save Python code versions, but Run/Submit requires dataset tests and an entry point.'}
                  </div>
                ) : null}

                {activeSolution ? (
                  <CodeEditor
                    className="h-full border-0"
                    code={activeSolution.code}
                    language={editorLanguage}
                    pythonOnly={!isSqlTrack}
                    runtime={activeSolution.time_complexity || ''}
                    space={activeSolution.space_complexity || ''}
                    height="100%"
                    languageOptions={isSqlTrack ? [{ value: 'sql', label: 'SQL' }] : null}
                    showComplexityFields={!isSqlTrack}
                    onCodeChange={(code) => {
                      setSolutions((current) =>
                        current.map((item) => (item.id === activeSolution.id ? { ...item, code } : item)),
                      )
                      queueSolutionSave(activeSolution.id, { code, language: editorLanguage })
                    }}
                    onRuntimeChange={(time_complexity) => {
                      setSolutions((current) =>
                        current.map((item) => (item.id === activeSolution.id ? { ...item, time_complexity } : item)),
                      )
                      queueSolutionSave(activeSolution.id, { time_complexity })
                    }}
                    onSpaceChange={(space_complexity) => {
                      setSolutions((current) =>
                        current.map((item) => (item.id === activeSolution.id ? { ...item, space_complexity } : item)),
                      )
                      queueSolutionSave(activeSolution.id, { space_complexity })
                    }}
                  />
                ) : (
                  <div className="h-full border-t border-border-subtle bg-base p-3 text-sm text-text-muted">
                    Preparing default version...
                  </div>
                )}
              </div>

              <div className="flex min-w-0 items-center justify-end border-t border-border-subtle bg-base px-2 py-1">
                <button
                  type="button"
                  onClick={toggleBottomPane}
                  className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                >
                  {bottomPaneCollapsed ? <PanelBottomOpen size={12} /> : <PanelBottomClose size={12} />}
                  {bottomPaneCollapsed ? 'Show Panel' : 'Hide Panel'}
                </button>
              </div>

              {!bottomPaneCollapsed ? (
                <button
                  type="button"
                  onMouseDown={startBottomResize}
                  aria-label="Resize test panel"
                  title="Drag to resize panel"
                  className="flex h-3 shrink-0 cursor-row-resize items-center justify-center border-y border-border-subtle bg-base/90 text-text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  <GripHorizontal size={12} />
                </button>
              ) : null}

              {!bottomPaneCollapsed ? (
                <footer
                  className="flex shrink-0 min-h-0 min-w-0 flex-col border-t border-border-subtle"
                  style={{ height: `${isSqlTrack ? Math.max(bottomPaneHeight, 220) : bottomPaneHeight}px` }}
                >
                  <div className="scrollbar-none overflow-x-auto border-b border-border-subtle">
                    <div className="flex min-w-max items-center">
                      {isSqlTrack ? (
                        <>
                          <RightTabButton active={effectiveRightTab === 'output'} onClick={() => setRightTab('output')} label="Output" />
                          <RightTabButton active={effectiveRightTab === 'results'} onClick={() => setRightTab('results')} label="Results" />
                          <RightTabButton active={rightTab === 'history'} onClick={() => setRightTab('history')} label="History" />
                        </>
                      ) : (
                        <>
                          <RightTabButton
                            active={effectiveRightTab === rightPaneDefaultTab}
                            onClick={() => setRightTab(rightPaneDefaultTab)}
                            label="Tests"
                          />
                          <RightTabButton active={effectiveRightTab === 'result'} onClick={() => setRightTab('result')} label="Result" />
                          <RightTabButton active={effectiveRightTab === 'cases'} onClick={() => setRightTab('cases')} label="Cases" />
                          <RightTabButton active={rightTab === 'stdout'} onClick={() => setRightTab('stdout')} label="Stdout" />
                          <RightTabButton active={rightTab === 'history'} onClick={() => setRightTab('history')} label="History" />
                        </>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    <AnimatePresence initial={false} mode="wait">
                      <Motion.div
                        key={`${isSqlTrack ? 'sql' : 'dsa'}-${effectiveRightTab}`}
                        variants={panelSwap}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="space-y-2"
                      >
                    {!isSqlTrack && effectiveRightTab === rightPaneDefaultTab ? (
                      <div className="space-y-2">
                        {activeTests.length === 0 ? (
                          <p className="text-sm text-text-muted">No active test cases available.</p>
                        ) : (
                          <>
                            {focusedTestIds.length > 0 ? (
                              <div className="flex items-center justify-between gap-2 border border-border-subtle bg-base px-2.5 py-2">
                                <p className="font-mono text-[11px] text-text-muted">
                                  Selected {focusedTestIds.length} of {activeTests.length} cases
                                </p>
                                <button
                                  type="button"
                                  onClick={clearFocusedTests}
                                  className="inline-flex h-6 items-center border border-accent bg-accent/10 px-2 text-[10px] text-accent"
                                >
                                  Clear
                                </button>
                              </div>
                            ) : null}
                            {(focusedTestIds.length > 0
                              ? activeTests.filter((test) => focusedTestIds.includes(test.id))
                              : activeTests
                            ).map((test) => (
                              <div key={`test-${test.id}`} className="border border-border-subtle bg-base p-2">
                                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                                  Case #{test.sort_order}
                                </p>
                                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-primary">
                                  Input: {toPlainText(test.input_text)}
                                </pre>
                                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-text-primary">
                                  Expected: {toPlainText(test.expected_output)}
                                </pre>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    ) : null}

                    {isSqlTrack && effectiveRightTab === 'output' ? (
                      <Motion.div
                        key={`sql-output-${selectedSqlPublicRun?.id || runOutput.status || 'idle'}`}
                        variants={outputSwap}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="border border-border-subtle bg-base p-3"
                      >
                        {selectedSqlSampleFixture ? (
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <FileCode2 size={13} className="text-text-muted" />
                              <p className="text-sm text-text-primary">Sample Output</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setLeftTab('data')
                                  setLeftPaneCollapsed(false)
                                }}
                                className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
                              >
                                Open Data
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void copySelectedSqlOutput()
                                }}
                                disabled={!selectedSqlPublicCase?.output}
                                className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void insertSelectedSqlOutputIntoNote()
                                }}
                                disabled={!selectedSqlPublicCase?.output}
                                className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                              >
                                Insert
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {selectedSqlPublicRun ? (
                          <>
                            <p className="text-[11px] text-text-muted">
                              {runOutput.message || 'Latest sample run loaded.'}
                            </p>
                            <div className="mt-3 space-y-3">
                              {selectedSqlPublicCase?.output ? (
                                <div className="space-y-1">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Output</p>
                                  <SqlResultPreview value={selectedSqlPublicCase.output} />
                                </div>
                              ) : (
                                <p className="text-sm text-text-muted">No output captured for the current sample run.</p>
                              )}
                              {!selectedSqlPublicCase?.passed && selectedSqlPublicCase?.expected ? (
                                <div className="space-y-1">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Expected</p>
                                  <SqlResultPreview value={selectedSqlPublicCase.expected} tone="muted" />
                                </div>
                              ) : null}
                              {selectedSqlPublicCase?.error ? (
                                <div className="border border-border-subtle bg-surface px-3 py-2 text-[11px] text-text-muted">
                                  Review your query and try again.
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-text-muted">Run your query against the sample data to inspect the output here.</p>
                        )}
                      </Motion.div>
                    ) : null}

                    {!isSqlTrack && effectiveRightTab === 'result' ? (
                      <Motion.div
                        key={`dsa-result-${selectedResultRun?.id || runOutput.status || 'idle'}`}
                        variants={outputSwap}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="border border-border-subtle bg-base p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <FileCode2 size={13} className="text-text-muted" />
                            <p className="text-sm text-text-primary">
                              {runOutput.mode ? `${runOutput.mode.toUpperCase()} · ` : ''}
                              {runOutput.status || 'Idle'}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                void copySelectedDsaResult()
                              }}
                              disabled={!selectedResultRun}
                              className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void insertSelectedDsaResultIntoNote()
                              }}
                              disabled={!selectedResultRun}
                              className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              Insert
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                          {runOutput.message || 'Run or submit your current code version.'}
                        </p>
                        {runOutput.runId ? (
                          <p className="mt-1 font-mono text-[11px] text-text-muted">Run ID: {runOutput.runId}</p>
                        ) : null}
                        {runOutput.startedAt ? (
                          <p className="mt-1 font-mono text-[11px] text-text-muted">
                            Started: {formatDate(runOutput.startedAt, 'Unknown')}
                          </p>
                        ) : null}
                        {selectedResultRun ? (
                          <div className="mt-2 border-t border-border-subtle pt-2">
                            {activeCaseEntries.length > 0 ? (
                              <div className="mb-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRightTab('cases')
                                  }}
                                  className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
                                >
                                  Open Cases
                                </button>
                              </div>
                            ) : null}
                            <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted md:grid-cols-4">
                              <p className="font-mono">
                                Mode: {getRunMode(selectedResultRun) ? getRunMode(selectedResultRun).toUpperCase() : '-'}
                              </p>
                              <p className="font-mono">
                                Tests: {selectedResultRun.tests_passed ?? 0}/{selectedResultRun.tests_total ?? 0}
                              </p>
                              <p className="font-mono">Runtime: {selectedResultRun.runtime_ms ?? '-'}ms</p>
                              <p className="font-mono">Memory: {selectedResultRun.memory_kb ?? '-'}kb</p>
                            </div>
                            {!isSqlTrack ? (
                              <>
                                <p className="mt-1 font-mono text-[11px] text-text-muted">
                                  Evaluator: {selectedResultRun.status || '-'}
                                </p>
                                <p className="mt-1 font-mono text-[11px] text-text-muted">
                                  Judge Sandbox: {selectedResultRun.runner_meta?.judge_status || '-'}
                                </p>
                              </>
                            ) : null}
                            {!isSqlTrack &&
                            selectedResultRun.runner_meta?.judge_status === 'Accepted' &&
                            String(selectedResultRun.status || '').toLowerCase() !== 'passed' ? (
                              <p className="mt-1 text-[11px] text-text-muted">
                                Judge Accepted means the code executed, but your evaluator still marked tests as{' '}
                                {selectedResultRun.status || 'failed'}.
                              </p>
                            ) : null}
                            {selectedResultRun.stderr || selectedResultRun.compile_output ? (
                              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-border-subtle bg-surface p-2 font-mono text-[11px] text-text-primary">
                                {truncateRunText(selectedResultRun.stderr || selectedResultRun.compile_output)}
                              </pre>
                            ) : null}
                          </div>
                        ) : null}
                      </Motion.div>
                    ) : null}

                    {isSqlTrack && effectiveRightTab === 'results' ? (
                      <Motion.div
                        key={`sql-results-${selectedSqlSubmitRun?.id || runOutput.status || 'idle'}`}
                        variants={outputSwap}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="border border-border-subtle bg-base p-3"
                      >
                        {selectedSqlSubmitRun ? (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <FileCode2 size={13} className="text-text-muted" />
                                <p className="text-sm text-text-primary">Submission Results</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyValueToClipboard(
                                      JSON.stringify(
                                        {
                                          status: selectedSqlSubmitRun.status,
                                          tests_passed: selectedSqlSubmitRun.tests_passed,
                                          tests_total: selectedSqlSubmitRun.tests_total,
                                          runtime_ms: selectedSqlSubmitRun.runtime_ms,
                                          memory_kb: selectedSqlSubmitRun.memory_kb,
                                        },
                                        null,
                                        2,
                                      ),
                                    )
                                  }
                                  className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
                                >
                                  Copy
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void insertAiPayloadIntoCurrentNote(
                                      buildNotePayload(
                                        'SQL Submission Results',
                                        `${selectedSqlSubmitRun.tests_passed ?? 0}/${selectedSqlSubmitRun.tests_total ?? 0} checks passed`,
                                        [
                                          buildCodeBlock(
                                            JSON.stringify(
                                              {
                                                status: selectedSqlSubmitRun.status,
                                                tests_passed: selectedSqlSubmitRun.tests_passed,
                                                tests_total: selectedSqlSubmitRun.tests_total,
                                                runtime_ms: selectedSqlSubmitRun.runtime_ms,
                                                memory_kb: selectedSqlSubmitRun.memory_kb,
                                              },
                                              null,
                                              2,
                                            ),
                                            'json',
                                            'Submission summary',
                                          ),
                                        ],
                                      ),
                                    )
                                  }
                                  className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
                                >
                                  Insert
                                </button>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-text-muted">
                              {selectedSqlSubmitRun.status === 'passed'
                                ? selectedSqlSubmitRun.message || selectedSqlSubmitRun.summary || 'All checks passed.'
                                : selectedSqlSubmitRun.status === 'error'
                                  ? 'Execution failed. Review your query and try again.'
                                  : 'Some checks failed. Review your query and try again.'}
                            </p>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-muted md:grid-cols-4">
                              <p className="font-mono">
                                Mode: {getRunMode(selectedSqlSubmitRun) ? getRunMode(selectedSqlSubmitRun).toUpperCase() : '-'}
                              </p>
                              <p className="font-mono">
                                Checks: {selectedSqlSubmitRun.tests_passed ?? 0}/{selectedSqlSubmitRun.tests_total ?? 0}
                              </p>
                              <p className="font-mono">Runtime: {selectedSqlSubmitRun.runtime_ms ?? '-'}ms</p>
                              <p className="font-mono">Memory: {selectedSqlSubmitRun.memory_kb ?? '-'}kb</p>
                            </div>
                            <p className="mt-2 font-mono text-[11px] text-text-muted">
                              {formatDate(selectedSqlSubmitRun.created_at, 'Unknown')}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-text-muted">Submit your query to see grading results here.</p>
                        )}
                      </Motion.div>
                    ) : null}

                    {!isSqlTrack && effectiveRightTab === 'stdout' ? (
                      <div className="border border-border-subtle bg-base p-3">
                        {selectedResultRun ? (
                          selectedResultStdout ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-mono text-[11px] text-text-muted">
                                  {collapsedStdout.lines.length} lines
                                  {showRawStdout
                                    ? ''
                                    : ` · ${collapsedStdout.collapsed.length} grouped`}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setShowRawStdout((current) => !current)}
                                  className="inline-flex h-7 items-center border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
                                >
                                  {showRawStdout ? 'Show Grouped' : 'Show Raw'}
                                </button>
                              </div>

                              {showRawStdout ? (
                                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border border-border-subtle bg-surface p-2 font-mono text-[11px] text-text-primary">
                                  {selectedResultStdout}
                                </pre>
                              ) : (
                                <div className="max-h-[420px] space-y-1 overflow-auto border border-border-subtle bg-surface p-2 font-mono text-[11px] text-text-primary">
                                  {collapsedStdout.collapsed.map((group, index) => (
                                    <p key={`stdout-group-${index}`} className="break-words">
                                      {group.text}
                                      {group.count > 1 ? (
                                        <span className="ml-2 text-text-muted">x{group.count}</span>
                                      ) : null}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-text-muted">No stdout for this run.</p>
                          )
                        ) : (
                          <p className="text-sm text-text-muted">Run or submit your code to view stdout.</p>
                        )}
                      </div>
                    ) : null}

                    {effectiveRightTab === 'cases' ? (
                      <CaseResultsSection
                        key={`case-results-${selectedResultRun?.id ?? 'none'}`}
                        run={selectedResultRun}
                        activeTests={activeCaseEntries}
                        focusedTestIds={focusedTestIds}
                        onToggleFocusedTest={toggleFocusedTestId}
                        onClearFocusedTests={clearFocusedTests}
                        onUseFailedCases={useFailedCasesAsFocus}
                      />
                    ) : null}

                    {effectiveRightTab === 'history' ? (
                      <div className="space-y-2">
                        {data.runs.length === 0 ? (
                          <p className="text-sm text-text-muted">No run history yet.</p>
                        ) : (
                          data.runs.map((run) => (
                            <div key={`run-${run.id}`} className="border border-border-subtle bg-base p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm text-text-primary">#{run.id}</p>
                                  <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                                    {getRunMode(run) || '-'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLatestRunDetails(run)
                                      setRunOutput({
                                        mode: getRunMode(run),
                                        status: run.status || '',
                                        message: run?.message || run?.summary || `${run?.tests_passed ?? 0}/${run?.tests_total ?? 0} tests passed`,
                                        startedAt: run?.started_at || null,
                                        finishedAt: run?.finished_at || null,
                                        runId: run.id,
                                      })
                                      setBottomPaneCollapsed(false)
                                      setRightTab(isSqlTrack ? (getRunMode(run) === 'submit' ? 'results' : 'output') : 'result')
                                    }}
                                    className="inline-flex h-6 items-center border border-border-subtle px-2 text-[10px] text-text-muted hover:border-accent hover:text-accent"
                                    title={isSqlTrack ? (getRunMode(run) === 'submit' ? 'Open results' : 'Open output') : 'Open result'}
                                  >
                                    {isSqlTrack ? (getRunMode(run) === 'submit' ? 'Results' : 'Output') : 'Open'}
                                  </button>
                                  <p className="font-mono text-[11px] text-text-muted">{run.status}</p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void deleteRun(run)
                                    }}
                                    disabled={deletingRunId === run.id}
                                    className="inline-flex h-6 w-6 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Delete submission"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>
                              <p className="mt-1 text-[11px] text-text-muted">
                                {run.tests_passed ?? 0}/{run.tests_total ?? 0} tests · {run.runtime_ms ?? '-'}ms ·{' '}
                                {run.memory_kb ?? '-'}kb
                              </p>
                              {!isSqlTrack ? (
                                <p className="mt-1 text-[11px] text-text-muted">
                                  Judge: {run.runner_meta?.judge_status || '-'}
                                </p>
                              ) : null}
                              <p className="mt-1 font-mono text-[11px] text-text-muted">
                                {formatDate(run.created_at, 'Unknown')}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                      </Motion.div>
                    </AnimatePresence>
                  </div>
                </footer>
              ) : null}
            </div>
          </section>
        </div>

        {showMobileAssistant ? (
          <ProblemAssistantDrawer
            open={assistantOpen}
            mobile
            onClose={closeAssistant}
            problem={assistantProblemSummary}
            workspaceContext={assistantWorkspaceContext}
            preferredProviderMode={preferredAiProviderMode}
            onProviderPreferenceChange={(nextMode) => {
              void userSettingsState.update({ preferred_ai_provider_mode: nextMode })
            }}
            initialLaunch={assistantLaunch}
            onLaunchHandled={() => setAssistantLaunch(null)}
            onInsertIntoCurrentNote={insertAiPayloadIntoCurrentNote}
            onCreateAiNote={createAiNoteFromPayload}
          />
        ) : null}

        <Modal
          open={resetConfirmOpen}
          title="Reset Current Version"
          onClose={() => {
            if (!resettingSolution) {
              setResetConfirmOpen(false)
            }
          }}
          widthClass="max-w-md"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-text-primary">
                Reset <span className="font-mono">{activeSolution?.label || 'current version'}</span> to the starter
                template?
              </p>
              <p className="text-[11px] leading-5 text-text-muted">
                This overwrites the current code in this version. Run history and submitted solutions stay intact.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                disabled={resettingSolution}
                className="inline-flex h-8 items-center border border-border-subtle px-3 text-[11px] text-text-muted hover:border-accent hover:text-accent disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void resetActiveSolution()
                }}
                disabled={resettingSolution}
                className="inline-flex h-8 items-center border border-accent bg-accent/10 px-3 text-[11px] text-accent disabled:opacity-60"
              >
                {resettingSolution ? 'Resetting…' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </section>
  )
}
