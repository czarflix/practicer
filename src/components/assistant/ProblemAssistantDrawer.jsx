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
  StickyNote,
  X,
} from 'lucide-react'
import { assistantRequest, assistantStream, isAssistantConfigured } from '../../lib/assistant-client'
import { FAST_TRANSITION, SPRING_TRANSITION } from '../../lib/motion'
import { AssistantRichText } from './AssistantRichText'

const SLASH_COMMANDS = [
  { command: '/hint', intent: 'hint', label: 'Hint' },
  { command: '/debug', intent: 'debug', label: 'Debug' },
  { command: '/review', intent: 'review', label: 'Review' },
  { command: '/optimize', intent: 'optimize', label: 'Optimize' },
  { command: '/solution', intent: 'reveal_full_solution', label: 'Solution' },
  { command: '/explain', intent: 'explain', label: 'Explain' },
]
const ASSIST_MODE = 'assist'
const CHAT_MODE = 'chat'
const CHAT_MODE_OPTIONS = [
  { value: ASSIST_MODE, label: 'Assist' },
  { value: CHAT_MODE, label: 'Chat' },
]

function normalizeChatMode(value) {
  return value === CHAT_MODE ? CHAT_MODE : ASSIST_MODE
}

function noticeClass(tone = 'info') {
  if (tone === 'success') {
    return 'border-accent/45 bg-accent/10 text-text-primary'
  }

  if (tone === 'error') {
    return 'assistant-warning-surface'
  }

  return 'border-border-subtle bg-surface text-text-primary'
}

function iconButtonClass({ subtle = false } = {}) {
  return [
    'inline-flex h-7 w-7 items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
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
    'inline-flex h-6 items-center border px-2.5 text-[11px] transition-colors',
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

function buildBaseAttachments(workspaceContext, providerMode, chatMode = ASSIST_MODE) {
  if (normalizeChatMode(chatMode) === CHAT_MODE) {
    return {
      include_problem: true,
      include_editor: Boolean(workspaceContext?.editorText?.trim()),
      include_latest_run: false,
      include_note: false,
      include_stdout: false,
      selected_case_ids: [],
      selected_fixture_id: null,
      selected_run_id: null,
      note_id: null,
      provider_mode: providerMode,
    }
  }

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

function syncChatAttachments(currentAttachments, workspaceContext, providerMode) {
  const next = {
    ...currentAttachments,
    provider_mode: providerMode,
  }

  const hasEditor = Boolean(workspaceContext?.editorText?.trim())
  const hasRun = Boolean(workspaceContext?.selectedRunId)
  const hasNote = Boolean(workspaceContext?.activeNoteId)
  const hasStdout = Boolean(workspaceContext?.stdoutText?.trim())

  if (!hasEditor) {
    next.include_editor = false
  }

  if (!hasRun) {
    next.include_latest_run = false
    next.selected_run_id = null
    next.selected_case_ids = []
    next.selected_fixture_id = null
    if (!hasStdout) {
      next.include_stdout = false
    }
  } else {
    if (next.include_latest_run || next.include_stdout) {
      next.selected_run_id = workspaceContext?.selectedRunId || null
    }
    if (next.include_latest_run) {
      next.selected_case_ids = Array.isArray(workspaceContext?.selectedCaseIds) ? workspaceContext.selectedCaseIds : []
      next.selected_fixture_id = workspaceContext?.selectedFixtureId || null
    } else {
      next.selected_case_ids = []
      next.selected_fixture_id = null
    }
  }

  if (!hasNote) {
    next.include_note = false
    next.note_id = null
  } else if (next.include_note) {
    next.note_id = workspaceContext?.activeNoteId || null
  }

  if (!hasStdout) {
    next.include_stdout = false
  }

  return next
}

function getChatAttachmentChips(attachments, workspaceContext, trackKey) {
  const chips = []

  if (attachments.include_problem) {
    chips.push({ key: 'problem', label: 'Problem' })
  }

  if (attachments.include_editor) {
    chips.push({ key: 'editor', label: trackKey === 'sql' ? 'Current query' : 'Current code' })
  }

  if (attachments.include_latest_run) {
    chips.push({
      key: 'run',
      label: attachments.selected_run_id ? `Run #${attachments.selected_run_id}` : 'Latest run',
    })
  }

  if (attachments.include_note) {
    chips.push({ key: 'note', label: 'Note' })
  }

  if (attachments.include_stdout) {
    chips.push({ key: 'stdout', label: 'Stdout' })
  }

  return chips
}

function getChatAttachmentMenuItems(attachments, workspaceContext, trackKey) {
  const items = []

  if (!attachments.include_problem) {
    items.push({ key: 'problem', label: 'Problem' })
  }

  if (!attachments.include_editor && workspaceContext?.editorText?.trim()) {
    items.push({ key: 'editor', label: trackKey === 'sql' ? 'Current query' : 'Current code' })
  }

  if (!attachments.include_latest_run && workspaceContext?.selectedRunId) {
    items.push({ key: 'run', label: 'Latest run' })
  }

  if (!attachments.include_note && workspaceContext?.activeNoteId) {
    items.push({ key: 'note', label: 'Current note' })
  }

  if (!attachments.include_stdout && workspaceContext?.stdoutText?.trim()) {
    items.push({ key: 'stdout', label: 'Stdout' })
  }

  return items
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

function buildModeThreadMap(threads) {
  return {
    [ASSIST_MODE]: threads.filter((thread) => normalizeChatMode(thread?.chat_mode) === ASSIST_MODE),
    [CHAT_MODE]: threads.filter((thread) => normalizeChatMode(thread?.chat_mode) === CHAT_MODE),
  }
}

function threadPreview(thread) {
  return String(thread?.rolling_summary || '').trim()
}

function AssistantNoticeStack({ notices, onDismiss, onAction }) {
  if (notices.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-40 flex w-[min(320px,calc(100%-32px))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <Motion.div
            key={`assistant-notice-${notice.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={FAST_TRANSITION}
            className={[
              'pointer-events-auto border px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.16)]',
              noticeClass(notice.tone),
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-[12px] leading-5">{notice.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(notice.id)}
                className="inline-flex h-6 w-6 items-center justify-center text-text-muted hover:text-accent"
              >
                <X size={12} />
              </button>
            </div>
            {notice.actionLabel ? (
              <button
                type="button"
                onClick={() => onAction(notice)}
                className="mt-2 inline-flex h-7 items-center border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
              >
                {notice.actionLabel}
              </button>
            ) : null}
          </Motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
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
  chatMode,
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
  onChangeChatMode,
  onSwitchProviderMode,
}) {
  return (
    <header className="relative border-b border-border-subtle px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-[0.06em] text-text-muted">Assistant</p>
          <h2 className="mt-1 truncate text-[16px] font-medium text-text-primary">{problem?.title || 'Practicer AI'}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className="truncate text-[11px] text-text-muted">
              {(problem?.trackKey || 'dsa').toUpperCase()} · Tier {problem?.tier ?? '-'} · {problem?.phaseName || 'Practice'}
              {activeThread?.title && activeThread.title !== 'New chat' ? ` · ${activeThread.title}` : ''}
            </p>
            <div className="inline-flex items-center gap-0.5 border border-border-subtle bg-base p-0.5">
              {CHAT_MODE_OPTIONS.map((option) => (
                <button
                  key={`assistant-chat-mode-${option.value}`}
                  type="button"
                  onClick={() => onChangeChatMode(option.value)}
                  className={[
                    'inline-flex h-5.5 items-center border px-2 text-[10px] transition-colors',
                    chatMode === option.value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-transparent text-text-muted hover:border-border-subtle hover:text-text-primary',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Chat history"
            onClick={onOpenHistory}
            className={iconButtonClass({ subtle: true })}
          >
            <History size={14} />
          </button>
          <button
            ref={overflowAnchorRef}
            type="button"
            title="Assistant options"
            onClick={onToggleOverflow}
            className={iconButtonClass({ subtle: true })}
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            type="button"
            title="Close assistant"
            onClick={onClose}
            className={iconButtonClass({ subtle: true })}
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
  chatMode,
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
              <h3 className="text-sm font-medium text-text-primary">
                {chatMode === CHAT_MODE ? 'Chat history' : 'Assist history'}
              </h3>
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

function ChatAttachmentRail({
  attachments,
  workspaceContext,
  trackKey,
  onAddAttachment,
  onRemoveAttachment,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef(null)
  const menuRef = useRef(null)
  const chips = useMemo(
    () => getChatAttachmentChips(attachments, workspaceContext, trackKey),
    [attachments, trackKey, workspaceContext],
  )
  const menuItems = useMemo(
    () => getChatAttachmentMenuItems(attachments, workspaceContext, trackKey),
    [attachments, trackKey, workspaceContext],
  )

  useDismissableLayer(menuOpen, [anchorRef, menuRef], () => setMenuOpen(false))

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={`chat-attachment-chip-${chip.key}`}
          className="inline-flex h-6 items-center gap-1.5 border border-border-subtle bg-base px-2 text-[10px] text-text-primary"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            title={`Remove ${chip.label}`}
            onClick={() => onRemoveAttachment(chip.key)}
            className="inline-flex h-4 w-4 items-center justify-center text-text-muted hover:text-accent"
          >
            <X size={11} />
          </button>
        </span>
      ))}

      <div className="relative">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          className="inline-flex h-6 items-center gap-1.5 border border-border-subtle bg-base px-2 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <Plus size={12} />
          Attach
        </button>

        <AnimatePresence>
          {menuOpen ? (
            <Motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={FAST_TRANSITION}
              className="absolute left-0 top-[calc(100%+8px)] z-30 min-w-[180px] overflow-hidden border border-border-subtle bg-surface shadow-[0_18px_48px_rgba(0,0,0,0.18)]"
            >
              {menuItems.length > 0 ? (
                menuItems.map((item) => (
                  <button
                    key={`chat-attachment-option-${item.key}`}
                    type="button"
                    onClick={() => {
                      onAddAttachment(item.key)
                      setMenuOpen(false)
                    }}
                    className={menuItemClass()}
                  >
                    <span>{item.label}</span>
                    <Plus size={12} />
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-[11px] text-text-muted">Nothing else to attach.</div>
              )}
            </Motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

function BlockCopyButton({ title = 'Copy block', onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center text-text-muted opacity-70 transition-opacity hover:text-accent md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
    >
      <Copy size={12} />
    </button>
  )
}

function CodeBlock({ block, onCopy }) {
  const copyValue = block.copy_value || block.code || ''
  return (
    <section className="group relative mt-5 overflow-hidden border border-border-subtle bg-base">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
        <p className="text-[11px] text-text-muted">{assistantBlockLabel(block)}</p>
        <BlockCopyButton onClick={() => onCopy(copyValue)} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-6 text-text-primary">
        {block.code}
      </pre>
    </section>
  )
}

function AssistantTextBlock({ block, onCopy }) {
  if (block.kind === 'bullets' || block.kind === 'checklist') {
      return (
      <section key={block.id} className="group relative mt-4 max-w-[64ch] pr-8">
        {block.heading ? <p className="mb-2 text-[11px] text-text-muted">{block.heading}</p> : null}
        <div className="absolute right-0 top-0">
          <BlockCopyButton onClick={() => onCopy(block.copy_value || '')} />
        </div>
        <ul className="space-y-2.5 text-[14px] leading-7 text-text-primary">
          {block.items.map((item, index) => (
            <li key={`${block.id}-item-${index}`} className="flex gap-2.5">
              <span className="mt-[13px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/80" />
              <AssistantRichText as="span" text={item} className="assistant-rich-copy" />
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if (block.kind === 'warning') {
    return (
      <section key={block.id} className="group relative mt-4 max-w-[64ch] overflow-hidden border assistant-warning-surface px-3.5 py-3 pr-10">
        <div className="absolute right-2 top-2">
          <BlockCopyButton onClick={() => onCopy(block.copy_value || block.text || '')} />
        </div>
        {block.heading ? <p className="mb-2 text-[11px] text-current/80">{block.heading}</p> : null}
        <AssistantRichText text={block.text} className="assistant-rich-copy text-[14px] leading-7" />
      </section>
    )
  }

  return (
    <section
      key={block.id}
      className={[
        'group relative mt-4 max-w-[64ch] pr-8 text-[14px] leading-7 text-text-primary',
        block.kind === 'result_explanation' ? 'border-l border-accent/45 pl-4' : '',
      ].join(' ')}
    >
      <div className="absolute right-0 top-0">
        <BlockCopyButton onClick={() => onCopy(block.copy_value || block.text || '')} />
      </div>
      {block.heading ? <p className="mb-1.5 text-[11px] text-text-muted">{block.heading}</p> : null}
      <AssistantRichText text={block.text} className="assistant-rich-copy" />
    </section>
  )
}

function AssistantFailureNotice({ message }) {
  const blocks = Array.isArray(message?.content?.blocks) ? message.content.blocks : []
  const visibleWarning = blocks.find((block) => {
    const text = String(block?.text || '').trim()
    return block?.kind === 'warning' && text && !/^Intent:/i.test(text)
  })
  const detail = String(
    visibleWarning?.text
      || message?.content?.summary
      || 'The assistant could not complete this turn.',
  ).trim()

  return (
    <article className="max-w-[64ch] border border-border-subtle bg-base px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-text-primary">{message?.content?.title || 'Assistant unavailable'}</p>
          <p className="mt-1 text-[13px] leading-6 text-text-muted">{detail}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</span>
      </div>
    </article>
  )
}

function AssistantMessageArticle({ message, onInsertMessage, onCreateNoteFromMessage, onCopyBlock }) {
  const isAssistant = message.role === 'assistant'
  const blocks = Array.isArray(message?.content?.blocks) ? message.content.blocks : []
  const summary = isAssistant ? message?.content?.summary : message?.content?.text
  const isFailure = isAssistant && (message.status === 'error' || String(message?.content?.title || '').trim() === 'Assistant unavailable')

  if (!isAssistant) {
    return (
      <article className="ml-auto w-full max-w-[380px] border border-border-subtle bg-base px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-text-muted">You</span>
          <span className="font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</span>
        </div>
        {summary ? <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-text-primary">{summary}</p> : null}
      </article>
    )
  }

  if (isFailure) {
    return <AssistantFailureNotice message={message} />
  }

  return (
    <article className="group w-full">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 max-w-[64ch]">
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <Bot size={12} className="text-accent" />
            <span>Assistant</span>
          </div>
          {message?.content?.title ? (
            <h3 className="mt-1.5 text-[17px] font-medium tracking-[-0.01em] text-text-primary">{message.content.title}</h3>
          ) : null}
        </div>
        <div className="flex items-center gap-1 opacity-70 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
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

      {summary ? (
        <AssistantRichText
          text={summary}
          className="assistant-rich-copy mt-3 max-w-[64ch] text-[14px] leading-7 text-text-primary"
        />
      ) : null}

      {blocks.map((block) => {
        if (block.kind === 'code' || block.kind === 'sql') {
          return <CodeBlock key={`${message.id}-${block.id || block.kind}`} block={block} onCopy={onCopyBlock} />
        }

        return <AssistantTextBlock key={`${message.id}-${block.id || block.kind}`} block={block} onCopy={onCopyBlock} />
      })}

      <p className="mt-4 font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</p>
    </article>
  )
}

function AssistantFeed({
  chatMode,
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
  onCopyBlock,
  endRef,
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto w-full max-w-[720px]">
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
        <div className="border border-dashed border-border-subtle bg-base/70 px-4 py-4">
          <p className="text-[14px] font-medium text-text-primary">
            {chatMode === CHAT_MODE ? 'Start a chat.' : 'Ask for a hint, review, or debug.'}
          </p>
          <p className="mt-1.5 text-[12px] leading-6 text-text-muted">
            {chatMode === CHAT_MODE
              ? 'Only attached chips and what you type will be sent.'
              : 'The current problem and visible workspace state are attached when they matter.'}
          </p>
          {chatMode === ASSIST_MODE && suggestions.length > 0 ? (
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
          ) : null}
        </div>
      ) : null}

      <div className="space-y-6">
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
                onCopyBlock={onCopyBlock}
              />
            </Motion.div>
          ))}
        </AnimatePresence>

        {streaming ? (
          <div className="max-w-[64ch] border border-border-subtle bg-surface px-3.5 py-3">
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <LoaderCircle size={14} className="animate-spin text-accent" />
              {statusText || 'Thinking...'}
            </div>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>
      </div>
    </div>
  )
}

function AssistantComposerDock({
  chatMode,
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
  attachmentRail = null,
}) {
  const textareaRef = useRef(null)
  const normalizedMode = normalizeChatMode(chatMode)
  const showCommandHint =
    normalizedMode === ASSIST_MODE &&
    (composerValue.trim().length === 0 || composerValue.trim().startsWith('/'))

  useEffect(() => {
    const node = textareaRef.current
    if (!node) {
      return
    }

    node.style.height = '0px'
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 48), 156)}px`
  }, [composerValue])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void onSend()
      }}
      className="relative border-t border-border-subtle px-3 py-2.5"
    >
      {normalizedMode === ASSIST_MODE ? contextPopover : null}

      {normalizedMode === ASSIST_MODE ? (
        <button
          ref={contextAnchorRef}
          type="button"
          onClick={onToggleContext}
          onMouseEnter={onContextHoverStart}
          onMouseLeave={onContextHoverEnd}
          onFocus={onContextHoverStart}
          onBlur={onContextHoverEnd}
          className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-text-muted transition-colors hover:text-text-primary"
        >
          {contextOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span>{contextSummary}</span>
        </button>
      ) : null}

      {normalizedMode === CHAT_MODE ? attachmentRail : null}

      {(statusText && !streaming) || showCommandHint ? (
        <div className="mb-2 min-h-[14px] text-[10px] text-text-muted">
          {statusText && !streaming ? <p>{statusText}</p> : null}
          {!statusText && showCommandHint ? <p className="font-mono">/hint /debug /review /optimize /solution</p> : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={composerValue}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={normalizedMode === CHAT_MODE ? 'Message, code, SQL, or output' : 'Ask about the problem or current run'}
          rows={1}
          disabled={!assistantConfigured}
          className="max-h-[156px] min-h-[48px] w-full flex-1 resize-none border border-border-subtle bg-base px-3 py-2.5 text-sm leading-6 text-text-primary outline-none focus:border-accent disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={streaming || !composerValue.trim() || !assistantConfigured}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 border border-accent bg-accent/10 px-3 text-sm text-accent transition-colors hover:bg-accent/14 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} />
          <span className="hidden sm:inline">Send</span>
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
  onOpenNote,
}) {
  const reduceMotion = useReducedMotion()
  const [threads, setThreads] = useState([])
  const [chatMode, setChatMode] = useState(ASSIST_MODE)
  const [selectedThreadIds, setSelectedThreadIds] = useState({
    [ASSIST_MODE]: null,
    [CHAT_MODE]: null,
  })
  const [messages, setMessages] = useState([])
  const [composerValue, setComposerValue] = useState('')
  const [attachments, setAttachments] = useState(() =>
    buildBaseAttachments(workspaceContext, preferredProviderMode, ASSIST_MODE),
  )
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
  const [notices, setNotices] = useState([])
  const endRef = useRef(null)
  const overflowAnchorRef = useRef(null)
  const overflowPanelRef = useRef(null)
  const contextAnchorRef = useRef(null)
  const contextPanelRef = useRef(null)
  const noticeTimersRef = useRef(new Map())

  const threadsByMode = useMemo(() => buildModeThreadMap(threads), [threads])
  const modeThreads = useMemo(() => threadsByMode[chatMode] || [], [chatMode, threadsByMode])
  const activeThreadId = selectedThreadIds[chatMode] ?? null

  const activeThread = useMemo(
    () => modeThreads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, modeThreads],
  )
  const hasUserCredential = credentials.some((item) => item.is_active)
  const assistantConfigured = isAssistantConfigured()
  const canUseAssistant = open && assistantConfigured && problem?.problemKey
  const workspaceAttachmentState = useMemo(
    () => ({
      activeNoteId: workspaceContext?.activeNoteId ?? null,
      activeNoteLabel: workspaceContext?.activeNoteLabel ?? '',
      editorText: workspaceContext?.editorText ?? '',
      selectedCaseIds: workspaceContext?.selectedCaseIds ?? [],
      selectedFixtureId: workspaceContext?.selectedFixtureId ?? null,
      selectedRunId: workspaceContext?.selectedRunId ?? null,
      stdoutText: workspaceContext?.stdoutText ?? '',
    }),
    [
      workspaceContext?.activeNoteId,
      workspaceContext?.activeNoteLabel,
      workspaceContext?.editorText,
      workspaceContext?.selectedCaseIds,
      workspaceContext?.selectedFixtureId,
      workspaceContext?.selectedRunId,
      workspaceContext?.stdoutText,
    ],
  )
  const providerMode = activeThread?.provider_mode || attachments.provider_mode || preferredProviderMode
  const contextSummary = useMemo(
    () =>
      chatMode === CHAT_MODE ? '' : buildContextSummary(attachments, workspaceContext, problem?.trackKey || 'dsa'),
    [attachments, chatMode, problem?.trackKey, workspaceContext],
  )
  const emptyStateSuggestions = useMemo(
    () => (chatMode === CHAT_MODE ? [] : buildEmptyStateSuggestions(problem, workspaceContext)),
    [chatMode, problem, workspaceContext],
  )

  useDismissableLayer(overflowOpen, [overflowAnchorRef, overflowPanelRef], () => setOverflowOpen(false))
  useDismissableLayer(chatMode === ASSIST_MODE && contextOpen, [contextAnchorRef, contextPanelRef], () => {
    setContextOpen(false)
    setContextPinned(false)
  })

  useEffect(() => {
    const noticeTimers = noticeTimersRef.current
    return () => {
      noticeTimers.forEach((timer) => window.clearTimeout(timer))
      noticeTimers.clear()
    }
  }, [])

  const dismissNotice = (noticeId) => {
    const timer = noticeTimersRef.current.get(noticeId)
    if (timer) {
      window.clearTimeout(timer)
      noticeTimersRef.current.delete(noticeId)
    }
    setNotices((current) => current.filter((notice) => notice.id !== noticeId))
  }

  const pushNotice = ({ tone = 'info', message, actionLabel = '', noteId = null }) => {
    const noticeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setNotices((current) => [...current, { id: noticeId, tone, message, actionLabel, noteId }].slice(-4))
    const timer = window.setTimeout(() => {
      dismissNotice(noticeId)
    }, 3200)
    noticeTimersRef.current.set(noticeId, timer)
  }

  useEffect(() => {
    setSelectedThreadIds((current) => {
      const next = { ...current }
      let changed = false

      CHAT_MODE_OPTIONS.forEach((option) => {
        const optionThreads = threadsByMode[option.value] || []
        const currentId = next[option.value]
        const fallbackId = optionThreads[0]?.id ?? null
        if (currentId && optionThreads.some((thread) => thread.id === currentId)) {
          return
        }
        if (currentId !== fallbackId) {
          next[option.value] = fallbackId
          changed = true
        }
      })

      return changed ? next : current
    })
  }, [threadsByMode])

  useEffect(() => {
    const nextProviderMode = activeThread?.provider_mode || preferredProviderMode
    setAttachments(() => {
      const base = buildBaseAttachments(workspaceAttachmentState, nextProviderMode, chatMode)
      return chatMode === CHAT_MODE ? syncChatAttachments(base, workspaceAttachmentState, nextProviderMode) : base
    })
    setContextOpen(false)
    setContextPinned(false)
  }, [activeThread?.id, activeThread?.provider_mode, chatMode, preferredProviderMode, problem?.problemKey, workspaceAttachmentState])

  useEffect(() => {
    const nextProviderMode = activeThread?.provider_mode || preferredProviderMode
    setAttachments((current) => {
      if (chatMode === CHAT_MODE) {
        return syncChatAttachments(current, workspaceAttachmentState, nextProviderMode)
      }
      return buildBaseAttachments(workspaceAttachmentState, nextProviderMode, ASSIST_MODE)
    })
  }, [
    activeThread?.provider_mode,
    chatMode,
    preferredProviderMode,
    workspaceAttachmentState,
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
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load assistant data.')
      } finally {
        setLoadingThreads(false)
      }
    }

    void load()
  }, [canUseAssistant, open, problem?.problemKey])

  useEffect(() => {
    if (!activeThreadId || !open) {
      setMessages([])
      return
    }

    const loadMessages = async () => {
      setLoadingMessages(true)
      setErrorMessage('')
      setMessages([])
      try {
        const rows = await assistantRequest(`/assistant/threads/${activeThreadId}/messages`)
        setMessages(rows)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load assistant messages.')
      } finally {
        setLoadingMessages(false)
      }
    }

    void loadMessages()
  }, [activeThreadId, open])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming, statusText])

  useEffect(() => {
    if (!initialLaunch || !open) {
      return
    }

    const launchMode = normalizeChatMode(initialLaunch.chatMode)
    const launchThreadId = selectedThreadIds[launchMode] ?? null
    const launchThread = (threadsByMode[launchMode] || []).find((thread) => thread.id === launchThreadId) ?? null
    setChatMode(launchMode)
    setContextOpen(false)
    setContextPinned(false)
    setAttachments((current) => ({
      ...buildBaseAttachments(
        workspaceAttachmentState,
        launchThread?.provider_mode || preferredProviderMode,
        launchMode,
      ),
      ...(launchMode === ASSIST_MODE ? initialLaunch.attachments : {}),
      provider_mode: launchThread?.provider_mode || current.provider_mode,
    }))
    setComposerValue('')
    onLaunchHandled?.()
  }, [initialLaunch, onLaunchHandled, open, preferredProviderMode, selectedThreadIds, threadsByMode, workspaceAttachmentState])

  const createThread = async (provider = preferredProviderMode, nextMode = chatMode) => {
    const row = await assistantRequest('/assistant/threads', {
      method: 'POST',
      body: JSON.stringify({
        problem_key: problem.problemKey,
        track_key: problem.trackKey,
        provider_mode: provider,
        chat_mode: nextMode,
      }),
    })
    setThreads((current) => [row, ...current])
    setSelectedThreadIds((current) => ({ ...current, [normalizeChatMode(nextMode)]: row.id }))
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

  const addChatAttachment = (key) => {
    setAttachments((current) => {
      const next = { ...current }

      if (key === 'problem') {
        next.include_problem = true
      }

      if (key === 'editor' && workspaceAttachmentState?.editorText?.trim()) {
        next.include_editor = true
      }

      if (key === 'run' && workspaceAttachmentState?.selectedRunId) {
        next.include_latest_run = true
        next.selected_run_id = workspaceAttachmentState.selectedRunId
        next.selected_case_ids = Array.isArray(workspaceAttachmentState?.selectedCaseIds) ? workspaceAttachmentState.selectedCaseIds : []
        next.selected_fixture_id = workspaceAttachmentState?.selectedFixtureId || null
      }

      if (key === 'note' && workspaceAttachmentState?.activeNoteId) {
        next.include_note = true
        next.note_id = workspaceAttachmentState.activeNoteId
      }

      if (key === 'stdout' && workspaceAttachmentState?.stdoutText?.trim()) {
        next.include_stdout = true
        next.selected_run_id = workspaceAttachmentState?.selectedRunId || next.selected_run_id || null
      }

        return syncChatAttachments(next, workspaceAttachmentState, activeThread?.provider_mode || preferredProviderMode)
      })
  }

  const removeChatAttachment = (key) => {
    setAttachments((current) => {
      const next = { ...current }

      if (key === 'problem') {
        next.include_problem = false
      }

      if (key === 'editor') {
        next.include_editor = false
      }

      if (key === 'run') {
        next.include_latest_run = false
        next.selected_run_id = next.include_stdout ? workspaceAttachmentState?.selectedRunId || null : null
        next.selected_case_ids = []
        next.selected_fixture_id = null
      }

      if (key === 'note') {
        next.include_note = false
        next.note_id = null
      }

      if (key === 'stdout') {
        next.include_stdout = false
        next.selected_run_id = next.include_latest_run ? workspaceAttachmentState?.selectedRunId || null : null
      }

        return syncChatAttachments(next, workspaceAttachmentState, activeThread?.provider_mode || preferredProviderMode)
      })
  }

  const sendMessage = async (override = {}) => {
    const parsed = override.message || override.intent
      ? {
          intent: override.intent || 'general',
          message: clampMessage(override.message || composerValue),
        }
      : chatMode === CHAT_MODE
        ? {
            intent: 'general',
            message: clampMessage(composerValue),
          }
        : parseSlashCommand(composerValue, problem?.trackKey || 'dsa')

    if (!parsed?.message || streaming || !assistantConfigured) {
      return
    }

    setStreaming(true)
    setStatusText('Preparing request...')
    setErrorMessage('')

    try {
      const thread = activeThread || (await createThread(providerMode, chatMode))
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
              setSelectedThreadIds((current) => ({
                ...current,
                [normalizeChatMode(event.thread.chat_mode)]: event.thread.id,
              }))
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
    try {
      const result = await onInsertIntoCurrentNote?.(payload)
      if (!result) {
        return
      }
      if (result.ok) {
        pushNotice({
          tone: 'success',
          message:
            result.action === 'created'
              ? `Created ${result.noteLabel || 'AI note'}.`
              : `Added to ${result.noteLabel || 'current note'}.`,
          actionLabel: result.noteId ? 'Open note' : '',
          noteId: result.noteId || null,
        })
        return
      }
      pushNotice({
        tone: 'error',
        message: result.error || 'Could not add this reply to a note.',
      })
    } catch (error) {
      pushNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not add this reply to a note.',
      })
    }
  }

  const createNoteFromMessage = async (message, blocks) => {
    const payload = {
      title: message?.content?.title || 'AI Assistant',
      summary: message?.content?.summary || '',
      blocks,
    }
    try {
      const result = await onCreateAiNote?.(payload)
      if (!result) {
        return
      }
      if (result.ok) {
        pushNotice({
          tone: 'success',
          message: `Created ${result.noteLabel || 'AI note'}.`,
          actionLabel: result.noteId ? 'Open note' : '',
          noteId: result.noteId || null,
        })
        return
      }
      pushNotice({
        tone: 'error',
        message: result.error || 'Could not create a note from this reply.',
      })
    } catch (error) {
      pushNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not create a note from this reply.',
      })
    }
  }

  const copyBlock = async (value) => {
    try {
      await copyText(value)
      pushNotice({
        tone: 'success',
        message: 'Copied to clipboard.',
      })
    } catch (error) {
      pushNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not copy that block.',
      })
    }
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
        chatMode={chatMode}
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
        onCreateThread={() => void createThread(providerMode, chatMode)}
        onBeginRename={() => beginRename()}
        onChangeChatMode={(nextMode) => {
          setChatMode(normalizeChatMode(nextMode))
          setHistoryOpen(false)
          setOverflowOpen(false)
          setContextOpen(false)
          setContextPinned(false)
          setMessages([])
          setErrorMessage('')
          setStatusText('')
          setComposerValue('')
        }}
        onSwitchProviderMode={(nextMode) => void switchProviderMode(nextMode)}
        mobile={mobile}
      />

      <AssistantFeed
        chatMode={chatMode}
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
        onCopyBlock={copyBlock}
        endRef={endRef}
      />

      <AssistantComposerDock
        chatMode={chatMode}
        onToggleContext={() => {
          if (chatMode === CHAT_MODE) {
            return
          }
          setContextOpen((current) => !current)
          setContextPinned((current) => !current)
        }}
        onContextHoverStart={() => {
          if (chatMode === ASSIST_MODE && !contextPinned) {
            setContextOpen(true)
          }
        }}
        onContextHoverEnd={() => {
          if (chatMode === ASSIST_MODE && !contextPinned) {
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
        attachmentRail={
          <ChatAttachmentRail
            attachments={attachments}
            workspaceContext={workspaceContext}
            trackKey={problem?.trackKey || 'dsa'}
            onAddAttachment={addChatAttachment}
            onRemoveAttachment={removeChatAttachment}
          />
        }
        contextPopover={
          <AssistantContextPopover
            open={chatMode === ASSIST_MODE && contextOpen}
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

      <AssistantNoticeStack
        notices={notices}
        onDismiss={dismissNotice}
        onAction={(notice) => {
          if (notice.noteId && onOpenNote) {
            onOpenNote(notice.noteId)
          }
          dismissNotice(notice.id)
        }}
      />

      <AssistantHistoryModal
        open={historyOpen}
        mobile={mobile}
        chatMode={chatMode}
        threads={modeThreads}
        selectedThreadId={activeThreadId}
        loading={loadingThreads}
        editingThreadId={editingThreadId}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onBeginRename={beginRename}
        onSaveRename={saveThreadRename}
        onSelectThread={(threadId) => {
          setSelectedThreadIds((current) => ({ ...current, [chatMode]: threadId }))
          setHistoryOpen(false)
          setEditingThreadId(null)
          setRenameValue('')
        }}
        onCreateThread={() => void createThread(providerMode, chatMode)}
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
