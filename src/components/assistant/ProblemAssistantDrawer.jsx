import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion as Motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  History,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react'
import { assistantRequest, assistantStream, isAssistantConfigured } from '../../lib/assistant-client'
import { FAST_TRANSITION, SPRING_TRANSITION } from '../../lib/motion'

const SLASH_COMMANDS = [
  { command: '/hint', intent: 'hint', label: 'Hint' },
  { command: '/debug', intent: 'debug', label: 'Debug' },
  { command: '/review', intent: 'review', label: 'Review' },
  { command: '/optimize', intent: 'optimize', label: 'Optimize' },
  { command: '/solution', intent: 'reveal_full_solution', label: 'Solution' },
  { command: '/explain', intent: 'explain', label: 'Explain' },
]

function iconButtonClass({ subtle = false } = {}) {
  return [
    'inline-flex h-8 w-8 items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
    subtle
      ? 'border-transparent text-text-muted hover:border-border-subtle hover:bg-base hover:text-accent'
      : 'border-border-subtle bg-base text-text-muted hover:border-accent hover:text-accent',
  ].join(' ')
}

function menuItemClass(active = false) {
  return [
    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors',
    active ? 'bg-accent/10 text-accent' : 'text-text-primary hover:bg-elevated hover:text-accent',
  ].join(' ')
}

function pillButtonClass(active = false) {
  return [
    'inline-flex h-7 items-center border px-2.5 text-[11px] transition-colors',
    active
      ? 'border-accent bg-accent/10 text-accent'
      : 'border-border-subtle bg-base text-text-muted hover:border-accent hover:text-accent',
  ].join(' ')
}

function formatRelativeDate(value) {
  if (!value) {
    return 'Now'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Now'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function clampMessage(value) {
  return String(value || '').trim().slice(0, 5000)
}

function buildDefaultMessage(intent, trackKey) {
  switch (intent) {
    case 'explain':
      return 'Explain the problem, the key constraints, and the likely pattern without giving the full solution yet.'
    case 'hint':
      return 'Give me a smaller hint that nudges me in the right direction without revealing the whole answer.'
    case 'debug':
      return trackKey === 'sql'
        ? 'Debug my current SQL using the attached query and latest visible run.'
        : 'Debug my current Python solution using the attached code and latest run.'
    case 'review':
      return trackKey === 'sql'
        ? 'Review my current SQL query and tell me what is correct, risky, or missing.'
        : 'Review my current Python approach and tell me what is correct, risky, or missing.'
    case 'optimize':
      return trackKey === 'sql'
        ? 'Optimize my current SQL query and explain the tradeoffs.'
        : 'Optimize my current Python solution and explain the tradeoffs.'
    case 'generate_edge_cases':
      return 'Generate edge cases I should test next and explain why each one matters.'
    case 'reveal_full_solution':
      return trackKey === 'sql'
        ? 'Reveal a full PostgreSQL 14 solution and explain it clearly.'
        : 'Reveal a full Python solution and explain it clearly.'
    default:
      return ''
  }
}

function buildBaseAttachments(workspaceContext, providerMode) {
  return {
    include_problem: true,
    include_editor: Boolean(workspaceContext?.editorText?.trim()),
    include_latest_run: Boolean(workspaceContext?.selectedRunId),
    include_note: false,
    include_stdout: false,
    selected_case_ids: Array.isArray(workspaceContext?.selectedCaseIds) ? workspaceContext.selectedCaseIds : [],
    selected_fixture_id: workspaceContext?.selectedFixtureId || null,
    selected_run_id: workspaceContext?.selectedRunId || null,
    note_id: workspaceContext?.activeNoteId || null,
    provider_mode: providerMode,
  }
}

function getContextItems(attachments, workspaceContext, trackKey) {
  const items = []

  if (attachments.include_problem) {
    items.push({ key: 'problem', label: 'Problem' })
  }
  if (attachments.include_editor) {
    items.push({ key: 'editor', label: trackKey === 'sql' ? 'Current query' : 'Current code' })
  }
  if (attachments.include_latest_run && attachments.selected_run_id) {
    items.push({ key: 'run', label: `Run #${attachments.selected_run_id}` })
  }
  if (trackKey === 'dsa' && attachments.selected_case_ids?.length > 0) {
    items.push({
      key: 'cases',
      label: attachments.selected_case_ids.length === 1 ? '1 focused case' : `${attachments.selected_case_ids.length} focused cases`,
    })
  }
  if (trackKey === 'sql' && attachments.selected_fixture_id) {
    const fixture = workspaceContext?.fixtures?.find(
      (item) => String(item.fixture_key || item.id) === String(attachments.selected_fixture_id),
    )
    items.push({ key: 'fixture', label: fixture?.label || 'Selected sample' })
  }
  if (attachments.include_note && attachments.note_id) {
    items.push({ key: 'note', label: workspaceContext?.activeNoteLabel || 'Current note' })
  }
  if (attachments.include_stdout) {
    items.push({ key: 'stdout', label: 'Stdout' })
  }

  return items
}

function buildContextSummary(attachments, workspaceContext, trackKey) {
  const items = getContextItems(attachments, workspaceContext, trackKey)
  if (items.length === 0) {
    return 'No context'
  }

  const compact = items
    .slice(0, 3)
    .map((item) => item.label.replace(/^Current\s+/i, '').replace(/^Selected\s+/i, '').toLowerCase())

  const remaining = items.length - compact.length
  return `${compact.join(' · ')}${remaining > 0 ? ` · +${remaining}` : ''}`
}

function copyText(value) {
  return navigator.clipboard.writeText(String(value || ''))
}

function parseSlashCommand(value, trackKey) {
  const text = clampMessage(value)
  if (!text) {
    return null
  }

  if (!text.startsWith('/')) {
    return {
      intent: 'general',
      message: text,
    }
  }

  const [commandToken, ...restParts] = text.split(/\s+/)
  const normalized = commandToken.trim().toLowerCase()
  const command = SLASH_COMMANDS.find((item) => item.command === normalized)
  if (!command) {
    return {
      intent: 'general',
      message: text,
    }
  }

  const remainder = restParts.join(' ').trim()
  return {
    intent: command.intent,
    message: remainder || buildDefaultMessage(command.intent, trackKey),
  }
}

function buildEmptyStateSuggestions(problem, workspaceContext) {
  const trackKey = problem?.trackKey || 'dsa'
  const selectedRunStatus = String(workspaceContext?.selectedRunStatus || '').trim().toLowerCase()
  const suggestions = []

  if (['failed', 'error', 'timeout'].includes(selectedRunStatus)) {
    suggestions.push({
      intent: 'debug',
      label: 'Debug run',
      message: buildDefaultMessage('debug', trackKey),
    })
  }

  if (workspaceContext?.editorText?.trim()) {
    suggestions.push({
      intent: 'review',
      label: trackKey === 'sql' ? 'Review query' : 'Review code',
      message: buildDefaultMessage('review', trackKey),
    })
  } else {
    suggestions.push({
      intent: 'explain',
      label: 'Explain',
      message: buildDefaultMessage('explain', trackKey),
    })
  }

  suggestions.push({
    intent: 'hint',
    label: 'Hint',
    message: buildDefaultMessage('hint', trackKey),
  })

  return suggestions.slice(0, 3)
}

function threadPreview(thread) {
  return String(thread?.rolling_summary || '').trim()
}

function assistantBlockLabel(block) {
  if (block.heading) {
    return block.heading
  }
  if (block.kind === 'sql') {
    return 'SQL'
  }
  if (block.kind === 'code') {
    return block.language ? String(block.language).toUpperCase() : 'Code'
  }
  return String(block.kind || 'text').replace(/_/g, ' ')
}

function useDismissableLayer(open, refs, onDismiss) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handlePointerDown = (event) => {
      const target = event.target
      const clickedInside = refs.some((ref) => ref.current && ref.current.contains(target))
      if (!clickedInside) {
        onDismiss()
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onDismiss()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss, open, refs])
}

function AssistantHeader({
  problem,
  activeThread,
  hasUserCredential,
  providerMode,
  overflowOpen,
  overflowAnchorRef,
  overflowPanelRef,
  onToggleOverflow,
  onOpenHistory,
  onClose,
  onCreateThread,
  onBeginRename,
  onSwitchProviderMode,
}) {
  return (
    <header className="relative border-b border-border-subtle px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.08em] text-text-muted">Assistant</p>
          <h2 className="mt-2 truncate text-lg font-medium text-text-primary">{problem?.title || 'Practicer AI'}</h2>
          <p className="mt-1 truncate text-[12px] text-text-muted">
            {(problem?.trackKey || 'dsa').toUpperCase()} · Tier {problem?.tier ?? '-'} · {problem?.phaseName || 'Practice'}
            {activeThread?.title && activeThread.title !== 'New chat' ? ` · ${activeThread.title}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Chat history"
            onClick={onOpenHistory}
            className={iconButtonClass()}
          >
            <History size={14} />
          </button>
          <button
            ref={overflowAnchorRef}
            type="button"
            title="Assistant options"
            onClick={onToggleOverflow}
            className={iconButtonClass()}
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            type="button"
            title="Close assistant"
            onClick={onClose}
            className={iconButtonClass()}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {overflowOpen ? (
          <Motion.div
            ref={overflowPanelRef}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={FAST_TRANSITION}
            className="absolute right-4 top-[calc(100%+8px)] z-30 min-w-[220px] overflow-hidden border border-border-subtle bg-surface shadow-[0_18px_48px_rgba(0,0,0,0.18)]"
          >
            <button type="button" onClick={onCreateThread} className={menuItemClass()}>
              <span>New chat</span>
              <Plus size={13} />
            </button>
            <button type="button" onClick={onBeginRename} disabled={!activeThread} className={menuItemClass()}>
              <span>Rename chat</span>
              <Edit3 size={13} />
            </button>
            {hasUserCredential ? (
              <div className="border-t border-border-subtle py-1">
                <p className="px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-muted">Provider</p>
                <button
                  type="button"
                  onClick={() => onSwitchProviderMode('platform')}
                  className={menuItemClass(providerMode === 'platform')}
                >
                  <span>Use Practicer AI</span>
                  {providerMode === 'platform' ? <Check size={13} /> : null}
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchProviderMode('user_key')}
                  className={menuItemClass(providerMode === 'user_key')}
                >
                  <span>Use your Gemini key</span>
                  {providerMode === 'user_key' ? <Check size={13} /> : null}
                </button>
              </div>
            ) : null}
          </Motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  )
}

function AssistantHistoryModal({
  open,
  mobile,
  threads,
  selectedThreadId,
  loading,
  editingThreadId,
  renameValue,
  onRenameValueChange,
  onBeginRename,
  onSaveRename,
  onSelectThread,
  onCreateThread,
  onClose,
}) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return
    }

    window.setTimeout(() => {
      searchRef.current?.focus()
    }, 0)
  }, [open])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const node = dialogRef.current
      if (!node) {
        return
      }

      const focusable = node.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) {
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  const filteredThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return threads
    }

    return threads.filter((thread) => {
      const haystack = [thread.title, threadPreview(thread)].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [query, threads])
  const showSearch = threads.length > 6

  if (!open) {
    return null
  }

  return (
    <AnimatePresence>
      <Motion.div
        key="assistant-history"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={FAST_TRANSITION}
        className="absolute inset-0 z-40 flex items-start justify-center bg-black/55 p-3"
        onClick={onClose}
      >
        <Motion.div
          ref={dialogRef}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={FAST_TRANSITION}
          onClick={(event) => event.stopPropagation()}
          className={[
            'flex w-full flex-col overflow-hidden border border-border-subtle bg-surface shadow-[0_18px_48px_rgba(0,0,0,0.22)]',
            mobile ? 'mt-0 h-full max-h-full' : 'mt-8 max-h-[min(72vh,720px)] max-w-[760px]',
          ].join(' ')}
          role="dialog"
          aria-modal="true"
          aria-label="Assistant history"
        >
          <div className="border-b border-border-subtle px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-text-primary">History</h3>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onCreateThread} className={pillButtonClass(true)}>
                  <Plus size={12} />
                  New chat
                </button>
                <button type="button" onClick={onClose} className={iconButtonClass()}>
                  <X size={14} />
                </button>
              </div>
            </div>
            {showSearch ? (
              <div className="relative mt-3">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search chats"
                  className="h-10 w-full border border-border-subtle bg-base pl-9 pr-3 text-sm text-text-primary outline-none focus:border-accent"
                />
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {loading ? <p className="text-sm text-text-muted">Loading…</p> : null}
            {!loading && filteredThreads.length === 0 ? (
              <div className="border border-dashed border-border-subtle bg-base/70 px-4 py-4 text-sm text-text-muted">
                {query.trim() ? 'No matches.' : 'No chats yet.'}
              </div>
            ) : null}

            <div className="space-y-2">
              {filteredThreads.map((thread) => {
                const isActive = thread.id === selectedThreadId
                const isEditing = editingThreadId === thread.id
                const preview = threadPreview(thread)
                return (
                  <div
                    key={`history-thread-${thread.id}`}
                    className={[
                      'border px-3 py-3 transition-colors',
                      isActive ? 'border-accent bg-accent/8' : 'border-border-subtle bg-base hover:border-accent/40',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            value={renameValue}
                            onChange={(event) => onRenameValueChange(event.target.value)}
                            onBlur={() => void onSaveRename()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                void onSaveRename()
                              }
                            }}
                            autoFocus
                            className="h-9 w-full border border-border-subtle bg-surface px-3 text-sm text-text-primary outline-none focus:border-accent"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectThread(thread.id)}
                            className="w-full text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="truncate text-sm font-medium text-text-primary">{thread.title}</p>
                              <span className="shrink-0 font-mono text-[10px] text-text-muted">
                                {formatRelativeDate(thread.last_message_at || thread.created_at)}
                              </span>
                            </div>
                            {preview ? <p className="mt-1 line-clamp-1 text-[12px] leading-5 text-text-muted">{preview}</p> : null}
                          </button>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center">
                        <button type="button" title="Rename chat" onClick={() => onBeginRename(thread)} className={iconButtonClass({ subtle: true })}>
                          <Edit3 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  )
}

function AssistantContextPopover({
  open,
  popoverRef,
  problem,
  workspaceContext,
  attachments,
  onHoverStart,
  onHoverEnd,
}) {
  const contextItems = getContextItems(attachments, workspaceContext, problem?.trackKey || 'dsa')

  return (
    <AnimatePresence>
      {open ? (
        <Motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={FAST_TRANSITION}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
          className="absolute inset-x-0 bottom-[calc(100%+12px)] z-30 border border-border-subtle bg-surface p-4 shadow-[0_18px_48px_rgba(0,0,0,0.18)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary">Context</h3>
              <p className="mt-1 text-[12px] text-text-muted">
                {problem?.exampleCount ?? 0} examples
                {problem?.trackKey === 'sql'
                  ? ` · ${problem?.schemaCount ?? 0} schema tables`
                  : ` · ${problem?.constraintCount ?? 0} constraints`}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {contextItems.length > 0 ? (
                contextItems.map((item) => (
                  <span
                    key={`context-item-${item.key}`}
                    className="inline-flex h-7 items-center border border-border-subtle bg-base px-2.5 text-[11px] text-text-primary"
                  >
                    {item.label}
                  </span>
                ))
              ) : (
                <span className="text-[12px] text-text-muted">Nothing attached.</span>
              )}
            </div>
          </div>
        </Motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function CodeBlock({ block }) {
  const copyValue = block.copy_value || block.code || ''
  return (
    <section className="group relative mt-4 overflow-hidden border border-border-subtle bg-base">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
        <p className="text-[11px] text-text-muted">{assistantBlockLabel(block)}</p>
        <button
          type="button"
          title="Copy block"
          onClick={() => void copyText(copyValue)}
          className="inline-flex h-7 w-7 items-center justify-center text-text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Copy size={12} />
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-6 text-text-primary">
        {block.code}
      </pre>
    </section>
  )
}

function AssistantMessageArticle({ message, onInsertMessage, onCreateNoteFromMessage }) {
  const isAssistant = message.role === 'assistant'
  const blocks = Array.isArray(message?.content?.blocks) ? message.content.blocks : []
  const summary = isAssistant ? message?.content?.summary : message?.content?.text

  if (!isAssistant) {
    return (
      <article className="ml-auto max-w-[76%] border border-border-subtle bg-base px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <Sparkles size={12} className="text-accent" />
            <span>You</span>
          </div>
          <span className="font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</span>
        </div>
        {summary ? <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-text-primary">{summary}</p> : null}
      </article>
    )
  }

  return (
    <article className="group border border-border-subtle bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <Bot size={12} className="text-accent" />
            <span>Assistant</span>
          </div>
          {message?.content?.title ? (
            <h3 className="mt-2 text-[15px] font-medium text-text-primary">{message.content.title}</h3>
          ) : null}
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            title="Insert reply into current note"
            onClick={() => onInsertMessage?.(message, blocks)}
            className={iconButtonClass({ subtle: true })}
          >
            <StickyNote size={12} />
          </button>
          <button
            type="button"
            title="Create a new note from this reply"
            onClick={() => onCreateNoteFromMessage?.(message, blocks)}
            className={iconButtonClass({ subtle: true })}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {summary ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-primary">{summary}</p> : null}

      {blocks.map((block) => {
        if (block.kind === 'code' || block.kind === 'sql') {
          return <CodeBlock key={`${message.id}-${block.id || block.kind}`} block={block} />
        }

        if (block.kind === 'bullets' || block.kind === 'checklist') {
          return (
            <section key={`${message.id}-${block.id || block.kind}`} className="mt-4">
              {block.heading ? <p className="mb-2 text-[11px] text-text-muted">{block.heading}</p> : null}
              <ul className="space-y-2 text-sm leading-6 text-text-primary">
                {block.items.map((item, index) => (
                  <li key={`${block.id}-item-${index}`} className="flex gap-2.5">
                    <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        }

        if (block.kind === 'warning') {
          return (
            <section
              key={`${message.id}-${block.id || block.kind}`}
              className="mt-4 border-l-2 border-amber-500/60 pl-3 text-sm leading-6 text-amber-700 dark:text-amber-300"
            >
              {block.heading ? <p className="mb-1 text-[11px]">{block.heading}</p> : null}
              <p className="whitespace-pre-wrap">{block.text}</p>
            </section>
          )
        }

        return (
          <section
            key={`${message.id}-${block.id || block.kind}`}
            className={[
              'mt-4 text-sm leading-6 text-text-primary',
              block.kind === 'result_explanation' ? 'border-l-2 border-accent/55 pl-3' : '',
            ].join(' ')}
          >
            {block.heading ? <p className="mb-1 text-[11px] text-text-muted">{block.heading}</p> : null}
            <p className="whitespace-pre-wrap">{block.text}</p>
          </section>
        )
      })}

      <p className="mt-4 font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</p>
    </article>
  )
}

function AssistantFeed({
  assistantConfigured,
  loadingMessages,
  messages,
  errorMessage,
  streaming,
  statusText,
  suggestions,
  onSuggestion,
  onInsertMessage,
  onCreateNoteFromMessage,
  endRef,
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {errorMessage ? (
        <div className="mb-4 border border-border-subtle bg-base/80 px-3 py-2 text-[12px] text-text-primary">
          {errorMessage}
        </div>
      ) : null}

      {!assistantConfigured ? (
        <div className="border border-dashed border-border-subtle bg-base/70 px-4 py-4">
          <p className="text-sm text-text-primary">Assistant runner is not configured.</p>
          <p className="mt-2 text-[12px] leading-6 text-text-muted">
            Set <code>VITE_RUNNER_API_URL</code> in the frontend and the Vertex variables in the runner service.
          </p>
        </div>
      ) : null}

      {assistantConfigured && loadingMessages ? <p className="text-sm text-text-muted">Loading messages...</p> : null}

      {assistantConfigured && !loadingMessages && messages.length === 0 && !errorMessage ? (
        <div className="border border-dashed border-border-subtle bg-base/70 px-5 py-5">
          <p className="text-base font-medium text-text-primary">Ask anything.</p>
          <p className="mt-2 text-sm leading-6 text-text-muted">Problem and current run are already attached.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={`suggestion-${suggestion.intent}-${suggestion.label}`}
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className={pillButtonClass(false)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-5">
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <Motion.div
              key={`message-${message.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={FAST_TRANSITION}
            >
              <AssistantMessageArticle
                message={message}
                onInsertMessage={onInsertMessage}
                onCreateNoteFromMessage={onCreateNoteFromMessage}
              />
            </Motion.div>
          ))}
        </AnimatePresence>

        {streaming ? (
          <div className="border border-border-subtle bg-surface px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <LoaderCircle size={14} className="animate-spin text-accent" />
              {statusText || 'Thinking...'}
            </div>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
    </div>
  )
}

function AssistantComposerDock({
  onToggleContext,
  onContextHoverStart,
  onContextHoverEnd,
  contextSummary,
  contextOpen,
  composerValue,
  onComposerChange,
  onComposerKeyDown,
  onSend,
  assistantConfigured,
  streaming,
  statusText,
  contextPopover,
  contextAnchorRef,
}) {
  const showCommandHint = composerValue.trim().length === 0 || composerValue.trim().startsWith('/')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void onSend()
      }}
      className="relative border-t border-border-subtle px-4 py-4"
    >
      {contextPopover}

      <button
        ref={contextAnchorRef}
        type="button"
        onClick={onToggleContext}
        onMouseEnter={onContextHoverStart}
        onMouseLeave={onContextHoverEnd}
        onFocus={onContextHoverStart}
        onBlur={onContextHoverEnd}
        className="mb-3 inline-flex items-center gap-2 text-[12px] text-text-muted transition-colors hover:text-text-primary"
      >
        {contextOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <span>{contextSummary}</span>
      </button>

      <textarea
        value={composerValue}
        onChange={(event) => onComposerChange(event.target.value)}
        onKeyDown={onComposerKeyDown}
        placeholder="Ask about the problem or your current run"
        rows={2}
        disabled={!assistantConfigured}
        className="min-h-[88px] w-full resize-none border border-border-subtle bg-base px-3 py-3 text-sm leading-6 text-text-primary outline-none focus:border-accent disabled:opacity-60"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          {showCommandHint ? (
            <p className="font-mono text-[12px] text-text-muted">/hint /debug /review /optimize /solution</p>
          ) : null}
          {statusText && !streaming ? <p className="text-[12px] text-text-muted">{statusText}</p> : null}
        </div>

        <button
          type="submit"
          disabled={streaming || !composerValue.trim() || !assistantConfigured}
          className="inline-flex h-9 items-center gap-2 border border-accent bg-accent/10 px-3 text-sm text-accent transition-colors hover:bg-accent/14 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} />
          Send
          <ArrowRight size={14} />
        </button>
      </div>
    </form>
  )
}

export function ProblemAssistantDrawer({
  open,
  mobile = false,
  onClose,
  problem,
  workspaceContext,
  preferredProviderMode = 'platform',
  onProviderPreferenceChange,
  initialLaunch = null,
  onLaunchHandled,
  onInsertIntoCurrentNote,
  onCreateAiNote,
}) {
  const reduceMotion = useReducedMotion()
  const [threads, setThreads] = useState([])
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [composerValue, setComposerValue] = useState('')
  const [attachments, setAttachments] = useState(() => buildBaseAttachments(workspaceContext, preferredProviderMode))
  const [credentials, setCredentials] = useState([])
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [editingThreadId, setEditingThreadId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [contextPinned, setContextPinned] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const endRef = useRef(null)
  const overflowAnchorRef = useRef(null)
  const overflowPanelRef = useRef(null)
  const contextAnchorRef = useRef(null)
  const contextPanelRef = useRef(null)

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads],
  )
  const hasUserCredential = credentials.some((item) => item.is_active)
  const assistantConfigured = isAssistantConfigured()
  const canUseAssistant = open && assistantConfigured && problem?.problemKey
  const providerMode = activeThread?.provider_mode || attachments.provider_mode || preferredProviderMode
  const contextSummary = useMemo(
    () => buildContextSummary(attachments, workspaceContext, problem?.trackKey || 'dsa'),
    [attachments, problem?.trackKey, workspaceContext],
  )
  const emptyStateSuggestions = useMemo(
    () => buildEmptyStateSuggestions(problem, workspaceContext),
    [problem, workspaceContext],
  )

  useDismissableLayer(overflowOpen, [overflowAnchorRef, overflowPanelRef], () => setOverflowOpen(false))
  useDismissableLayer(contextOpen, [contextAnchorRef, contextPanelRef], () => {
    setContextOpen(false)
    setContextPinned(false)
  })

  useEffect(() => {
    setAttachments(
      buildBaseAttachments(
        {
          activeNoteId: workspaceContext?.activeNoteId ?? null,
          editorText: workspaceContext?.editorText ?? '',
          selectedCaseIds: workspaceContext?.selectedCaseIds ?? [],
          selectedFixtureId: workspaceContext?.selectedFixtureId ?? null,
          selectedRunId: workspaceContext?.selectedRunId ?? null,
        },
        activeThread?.provider_mode || preferredProviderMode,
      ),
    )
  }, [
    activeThread?.provider_mode,
    preferredProviderMode,
    workspaceContext?.activeNoteId,
    workspaceContext?.editorText,
    workspaceContext?.selectedCaseIds,
    workspaceContext?.selectedFixtureId,
    workspaceContext?.selectedRunId,
  ])

  useEffect(() => {
    if (!open || !canUseAssistant) {
      return
    }

    const load = async () => {
      setLoadingThreads(true)
      setErrorMessage('')
      try {
        const [threadRows, credentialRows] = await Promise.all([
          assistantRequest(`/assistant/threads?problem_key=${encodeURIComponent(problem.problemKey)}`),
          assistantRequest('/assistant/credentials'),
        ])

        setThreads(threadRows)
        setCredentials(credentialRows)
        setSelectedThreadId((current) => current ?? threadRows[0]?.id ?? null)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load assistant data.')
      } finally {
        setLoadingThreads(false)
      }
    }

    void load()
  }, [canUseAssistant, open, problem?.problemKey])

  useEffect(() => {
    if (!selectedThreadId || !open) {
      setMessages([])
      return
    }

    const loadMessages = async () => {
      setLoadingMessages(true)
      setErrorMessage('')
      setMessages([])
      try {
        const rows = await assistantRequest(`/assistant/threads/${selectedThreadId}/messages`)
        setMessages(rows)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load assistant messages.')
      } finally {
        setLoadingMessages(false)
      }
    }

    void loadMessages()
  }, [open, selectedThreadId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming, statusText])

  useEffect(() => {
    if (!initialLaunch || !open) {
      return
    }

    setAttachments((current) => ({
      ...current,
      ...initialLaunch.attachments,
      provider_mode: activeThread?.provider_mode || current.provider_mode,
    }))
    setComposerValue('')
    onLaunchHandled?.()
  }, [activeThread?.provider_mode, initialLaunch, onLaunchHandled, open])

  const createThread = async (provider = preferredProviderMode) => {
    const row = await assistantRequest('/assistant/threads', {
      method: 'POST',
      body: JSON.stringify({
        problem_key: problem.problemKey,
        track_key: problem.trackKey,
        provider_mode: provider,
      }),
    })
    setThreads((current) => [row, ...current])
    setSelectedThreadId(row.id)
    setMessages([])
    setHistoryOpen(false)
    return row
  }

  const beginRename = (thread = activeThread) => {
    if (!thread) {
      return
    }
    setEditingThreadId(thread.id)
    setRenameValue(thread.title || '')
    setHistoryOpen(true)
    setOverflowOpen(false)
  }

  const saveThreadRename = async () => {
    if (!editingThreadId) {
      return
    }

    const nextTitle = renameValue.trim()
    if (!nextTitle) {
      setEditingThreadId(null)
      setRenameValue('')
      return
    }

    const updated = await assistantRequest(`/assistant/threads/${editingThreadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: nextTitle }),
    })
    setThreads((current) => current.map((thread) => (thread.id === updated.id ? updated : thread)))
    setEditingThreadId(null)
    setRenameValue('')
  }

  const switchProviderMode = async (nextMode) => {
    if (!activeThread) {
      onProviderPreferenceChange?.(nextMode)
      setAttachments((current) => ({ ...current, provider_mode: nextMode }))
      setOverflowOpen(false)
      return
    }

    const updated = await assistantRequest(`/assistant/threads/${activeThread.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ provider_mode: nextMode }),
    })
    setThreads((current) => current.map((thread) => (thread.id === updated.id ? updated : thread)))
    setAttachments((current) => ({ ...current, provider_mode: nextMode }))
    setOverflowOpen(false)
  }

  const sendMessage = async (override = {}) => {
    const parsed = override.message || override.intent
      ? {
          intent: override.intent || 'general',
          message: clampMessage(override.message || composerValue),
        }
      : parseSlashCommand(composerValue, problem?.trackKey || 'dsa')

    if (!parsed?.message || streaming || !assistantConfigured) {
      return
    }

    setStreaming(true)
    setStatusText('Preparing request...')
    setErrorMessage('')

    try {
      const thread = activeThread || (await createThread(providerMode))
      const userDraft = {
        id: `temp-user-${Date.now()}`,
        role: 'user',
        created_at: new Date().toISOString(),
        content: { text: parsed.message },
      }
      const placeholder = {
        id: `temp-assistant-${Date.now()}`,
        role: 'assistant',
        created_at: new Date().toISOString(),
        content: { title: 'Thinking', summary: '', blocks: [] },
      }

      setMessages((current) => [...current, userDraft, placeholder])
      setComposerValue('')

      await assistantStream(
        `/assistant/threads/${thread.id}/messages/stream`,
        {
          message: parsed.message,
          intent: parsed.intent,
          attachments: {
            ...attachments,
            ...override.attachments,
            provider_mode: thread.provider_mode || providerMode,
          },
          editor_snapshot: workspaceContext?.editorText || '',
          note_snapshot: attachments.include_note ? workspaceContext?.activeNoteContent || null : null,
        },
        {
          onStatus: (event) => {
            setStatusText(event.message || '')
          },
          onMessage: (event) => {
            setMessages((current) => {
              const withoutPlaceholder = current.filter((item) => !String(item.id).startsWith('temp-assistant-'))
              return [...withoutPlaceholder, event.message]
            })
            if (event.thread) {
              setThreads((current) => {
                const existing = current.some((threadRow) => threadRow.id === event.thread.id)
                return existing
                  ? current.map((threadRow) => (threadRow.id === event.thread.id ? event.thread : threadRow))
                  : [event.thread, ...current]
              })
              setSelectedThreadId(event.thread.id)
            }
          },
          onError: (event) => {
            setErrorMessage(event.error || 'Assistant request failed.')
          },
          onDone: () => {
            setStatusText('')
          },
        },
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Assistant request failed.')
      setMessages((current) =>
        current.filter(
          (item) =>
            !String(item.id).startsWith('temp-assistant-') && !String(item.id).startsWith('temp-user-'),
        ),
      )
    } finally {
      setStreaming(false)
      setStatusText('')
    }
  }

  const insertMessageBlocks = async (message, blocks) => {
    const payload = {
      title: message?.content?.title || 'AI Assistant',
      summary: message?.content?.summary || '',
      blocks,
    }
    await onInsertIntoCurrentNote?.(payload)
  }

  const createNoteFromMessage = async (message, blocks) => {
    const payload = {
      title: message?.content?.title || 'AI Assistant',
      summary: message?.content?.summary || '',
      blocks,
    }
    await onCreateAiNote?.(payload)
  }

  const surface = (
    <Motion.aside
      initial={mobile ? { opacity: 0, y: 12 } : { opacity: 0, x: -20 }}
      animate={mobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
      exit={mobile ? { opacity: 0, y: 12 } : { opacity: 0, x: -20 }}
      transition={mobile || reduceMotion ? FAST_TRANSITION : SPRING_TRANSITION}
      className={[
        'relative flex min-h-0 min-w-0 flex-col overflow-hidden border border-border-subtle bg-surface shadow-[0_18px_48px_rgba(0,0,0,0.18)]',
        mobile ? 'h-[min(92vh,980px)] w-[min(100vw-24px,980px)]' : 'h-full w-full',
      ].join(' ')}
    >
      <AssistantHeader
        problem={problem}
        activeThread={activeThread}
        hasUserCredential={hasUserCredential}
        providerMode={providerMode}
        overflowOpen={overflowOpen}
        overflowAnchorRef={overflowAnchorRef}
        overflowPanelRef={overflowPanelRef}
        onToggleOverflow={() => setOverflowOpen((current) => !current)}
        onOpenHistory={() => {
          setHistoryOpen(true)
          setOverflowOpen(false)
        }}
        onClose={onClose}
        onCreateThread={() => void createThread(providerMode)}
        onBeginRename={() => beginRename()}
        onSwitchProviderMode={(nextMode) => void switchProviderMode(nextMode)}
        mobile={mobile}
      />

      <AssistantFeed
        assistantConfigured={assistantConfigured}
        loadingMessages={loadingMessages}
        messages={messages}
        errorMessage={errorMessage}
        streaming={streaming}
        statusText={statusText}
        suggestions={emptyStateSuggestions}
        onSuggestion={(suggestion) => void sendMessage(suggestion)}
        onInsertMessage={insertMessageBlocks}
        onCreateNoteFromMessage={createNoteFromMessage}
        endRef={endRef}
      />

      <AssistantComposerDock
        onToggleContext={() => {
          setContextOpen((current) => !current)
          setContextPinned((current) => !current)
        }}
        onContextHoverStart={() => {
          if (!contextPinned) {
            setContextOpen(true)
          }
        }}
        onContextHoverEnd={() => {
          if (!contextPinned) {
            setContextOpen(false)
          }
        }}
        contextSummary={contextSummary}
        contextOpen={contextOpen}
        composerValue={composerValue}
        onComposerChange={setComposerValue}
        onComposerKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void sendMessage()
          }
        }}
        onSend={sendMessage}
        assistantConfigured={assistantConfigured}
        streaming={streaming}
        statusText={statusText}
        contextAnchorRef={contextAnchorRef}
        contextPopover={
          <AssistantContextPopover
            open={contextOpen}
            popoverRef={contextPanelRef}
            problem={problem}
            workspaceContext={workspaceContext}
            attachments={attachments}
            onHoverStart={() => {
              if (!contextPinned) {
                setContextOpen(true)
              }
            }}
            onHoverEnd={() => {
              if (!contextPinned) {
                setContextOpen(false)
              }
            }}
          />
        }
      />

      <AssistantHistoryModal
        open={historyOpen}
        mobile={mobile}
        threads={threads}
        selectedThreadId={selectedThreadId}
        loading={loadingThreads}
        editingThreadId={editingThreadId}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onBeginRename={beginRename}
        onSaveRename={saveThreadRename}
        onSelectThread={(threadId) => {
          setSelectedThreadId(threadId)
          setHistoryOpen(false)
          setEditingThreadId(null)
          setRenameValue('')
        }}
        onCreateThread={() => void createThread(providerMode)}
        onClose={() => {
          setHistoryOpen(false)
          setEditingThreadId(null)
          setRenameValue('')
        }}
      />
    </Motion.aside>
  )

  if (!open) {
    return null
  }

  if (mobile) {
    return (
      <AnimatePresence>
        <Motion.div
          key="assistant-mobile-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FAST_TRANSITION}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3"
        >
          {surface}
        </Motion.div>
      </AnimatePresence>
    )
  }

  return surface
}
