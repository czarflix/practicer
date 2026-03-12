import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, LayoutGroup, motion as Motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Copy,
  Edit3,
  History,
  LoaderCircle,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  StickyNote,
  X,
} from 'lucide-react'
import { useAssistantWindow } from '../../context/AssistantWindowContext'
import { assistantRequest, assistantStream, isAssistantConfigured } from '../../lib/assistant-client'
import { FAST_TRANSITION, SPRING_TRANSITION } from '../../lib/motion'
import { AssistantRichText } from './AssistantRichText'

const CHAT_MODE = 'chat'
const THREAD_TITLE_FALLBACK = 'New chat'
const DESKTOP_MIN_WIDTH = 540
const DESKTOP_MAX_WIDTH = 820
const DESKTOP_MIN_HEIGHT = 520
const DESKTOP_MAX_HEIGHT = 920
const WINDOW_MARGIN = 16
const RESIZE_HANDLE_SIZE = 16

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeLauncherRect(rect) {
  if (!rect) {
    return null
  }

  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width)
  const height = Number(rect.height)

  if (![left, top, width, height].every(Number.isFinite)) {
    return null
  }

  return { left, top, width, height }
}

function buildLauncherAnimation(rect, target) {
  const normalized = normalizeLauncherRect(rect)
  if (!normalized) {
    return {
      opacity: 0,
      scaleX: 0.96,
      scaleY: 0.96,
      x: 0,
      y: 12,
    }
  }

  const targetWidth = Math.max(target.width, 1)
  const targetHeight = Math.max(target.height, 1)

  return {
    opacity: 0.72,
    scaleX: clampNumber(normalized.width / targetWidth, 0.18, 1),
    scaleY: clampNumber(normalized.height / targetHeight, 0.12, 1),
    x: normalized.left - target.left,
    y: normalized.top - target.top,
  }
}

function trimText(value, max = 5000) {
  return String(value || '').trim().slice(0, max)
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

function threadPreview(thread) {
  return String(thread?.rolling_summary || '').trim()
}

function hasMeaningfulMessage(message) {
  if (!message) {
    return false
  }

  if (message.status === 'pending') {
    return true
  }

  if (message.role === 'user') {
    return Boolean(String(message.content?.text || '').trim())
  }

  return Boolean(
    String(message.content?.summary || '').trim() ||
      String(message.content?.title || '').trim() ||
      (Array.isArray(message.content?.blocks) && message.content.blocks.length > 0),
  )
}

function copyText(value) {
  return navigator.clipboard.writeText(String(value || ''))
}

function iconButtonClass({ active = false } = {}) {
  return [
    'inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
    active
      ? 'border-accent/60 bg-accent/12 text-accent shadow-[0_0_0_1px_rgba(20,184,166,0.12)]'
      : 'border-border-subtle/80 bg-base/80 text-text-muted hover:border-accent/45 hover:text-accent',
  ].join(' ')
}

function contextChipClass({ interactive = false } = {}) {
  return [
    'inline-flex h-8 items-center gap-1.5 rounded-full border border-border-subtle/80 bg-base/82 px-3 text-[11px] text-text-primary transition-colors',
    interactive ? 'hover:border-accent/45 hover:text-accent' : '',
  ].join(' ')
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

function assistantThreadsQueryKey(problemKey) {
  return ['assistant', 'threads', problemKey]
}

function assistantMessagesQueryKey(threadId) {
  return ['assistant', 'messages', threadId]
}

function sortThreadsByActivity(threads) {
  return [...threads].sort((left, right) => {
    const leftTime = new Date(left?.last_message_at || left?.created_at || 0).getTime()
    const rightTime = new Date(right?.last_message_at || right?.created_at || 0).getTime()
    return rightTime - leftTime
  })
}

function upsertThreadList(threads, thread) {
  if (!thread?.id) {
    return Array.isArray(threads) ? threads : []
  }

  const next = Array.isArray(threads) ? threads.filter((item) => item.id !== thread.id) : []
  next.push(thread)
  return sortThreadsByActivity(next)
}

function buildDefaultAttachments(workspaceContext, providerMode = 'platform') {
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

function attachmentsEqual(left, right) {
  if (left === right) {
    return true
  }

  return (
    Boolean(left?.include_problem) === Boolean(right?.include_problem) &&
    Boolean(left?.include_editor) === Boolean(right?.include_editor) &&
    Boolean(left?.include_latest_run) === Boolean(right?.include_latest_run) &&
    Boolean(left?.include_note) === Boolean(right?.include_note) &&
    Boolean(left?.include_stdout) === Boolean(right?.include_stdout) &&
    String(left?.provider_mode || '') === String(right?.provider_mode || '') &&
    String(left?.selected_fixture_id || '') === String(right?.selected_fixture_id || '') &&
    String(left?.selected_run_id || '') === String(right?.selected_run_id || '') &&
    String(left?.note_id || '') === String(right?.note_id || '') &&
    JSON.stringify(Array.isArray(left?.selected_case_ids) ? left.selected_case_ids : []) ===
      JSON.stringify(Array.isArray(right?.selected_case_ids) ? right.selected_case_ids : [])
  )
}

function syncAttachments(current, workspaceContext, providerMode = 'platform') {
  const next = {
    ...current,
    include_problem: true,
    provider_mode: providerMode,
  }

  if (!workspaceContext?.editorText?.trim()) {
    next.include_editor = false
  }

  const currentResult = workspaceContext?.currentResultAttachment
  if (!currentResult?.available) {
    next.include_latest_run = false
    next.selected_run_id = null
    next.selected_case_ids = []
    next.selected_fixture_id = null
  } else if (next.include_latest_run) {
    next.selected_run_id = currentResult.selected_run_id || null
    next.selected_case_ids = Array.isArray(currentResult.selected_case_ids) ? currentResult.selected_case_ids : []
    next.selected_fixture_id = currentResult.selected_fixture_id || null
  }

  return attachmentsEqual(current, next) ? current : next
}

function clampWindowPlacement(windowState, viewportWidth, viewportHeight) {
  const maxWidth = Math.min(DESKTOP_MAX_WIDTH, viewportWidth - WINDOW_MARGIN * 2)
  const maxHeight = Math.min(DESKTOP_MAX_HEIGHT, viewportHeight - WINDOW_MARGIN * 2)
  const width = clampNumber(windowState.width, DESKTOP_MIN_WIDTH, maxWidth)
  const height = clampNumber(windowState.height, DESKTOP_MIN_HEIGHT, maxHeight)
  const x = clampNumber(windowState.x, WINDOW_MARGIN, Math.max(WINDOW_MARGIN, viewportWidth - width - WINDOW_MARGIN))
  const y = clampNumber(windowState.y, WINDOW_MARGIN, Math.max(WINDOW_MARGIN, viewportHeight - height - WINDOW_MARGIN))
  return { x, y, width, height }
}

function buildLocalAssistantErrorMessage(reason) {
  const detail = String(reason || 'The assistant could not complete this turn.').trim()
  return {
    id: `local-assistant-error-${Date.now()}`,
    role: 'assistant',
    created_at: new Date().toISOString(),
    status: 'error',
    content: {
      title: 'Assistant unavailable',
      summary: detail,
      blocks: [
        {
          id: 'block-0',
          kind: 'warning',
          text: detail,
          copy_value: detail,
        },
      ],
    },
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted/i.test(String(error?.message || ''))
}

function useDismissableLayer(open, refs, onDismiss) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handlePointerDown = (event) => {
      const target = event.target
      const inside = refs.some((ref) => ref.current && ref.current.contains(target))
      if (!inside) {
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
    <section className="group relative mt-4 overflow-hidden border border-border-subtle bg-base">
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
      <section className="group relative mt-4 max-w-[64ch] pr-8">
        {block.heading ? <p className="mb-2 text-[11px] text-text-muted">{block.heading}</p> : null}
        <div className="absolute right-0 top-0">
          <BlockCopyButton onClick={() => onCopy(block.copy_value || '')} />
        </div>
        <ul className="space-y-2 text-[14px] leading-7 text-text-primary">
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
      <section className="group relative mt-4 max-w-[64ch] overflow-hidden border assistant-warning-surface px-3.5 py-3 pr-10">
        <div className="absolute right-2 top-2">
          <BlockCopyButton onClick={() => onCopy(block.copy_value || block.text || '')} />
        </div>
        <AssistantRichText text={block.text} className="assistant-rich-copy text-[14px] leading-7" />
      </section>
    )
  }

  return (
    <section
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

function PendingAssistantBubble({ createdAt }) {
  return (
    <article className="max-w-[68ch]">
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <Bot size={12} className="text-accent" />
        <span>Assistant</span>
      </div>
      <div className="mt-2 inline-flex items-center gap-2 rounded-[20px] rounded-tl-[8px] border border-border-subtle/80 bg-base/78 px-4 py-3 text-[13px] text-text-primary shadow-[0_10px_28px_rgba(0,0,0,0.14)]">
        <LoaderCircle size={14} className="animate-spin text-accent" />
        <span>Thinking…</span>
      </div>
      <p className="mt-3 font-mono text-[10px] text-text-muted">{formatRelativeDate(createdAt)}</p>
    </article>
  )
}

function AssistantFailureNotice({ message }) {
  const blocks = Array.isArray(message?.content?.blocks) ? message.content.blocks : []
  const warning = blocks.find((block) => block?.kind === 'warning' && String(block?.text || '').trim())
  const detail = String(warning?.text || message?.content?.summary || 'The assistant could not complete this turn.').trim()

  return (
    <article className="max-w-[68ch] rounded-[20px] rounded-tl-[8px] border border-border-subtle/80 bg-base/80 px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.12)]">
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

function AssistantMessageArticle({ message, onCreateNoteFromMessage, onCopyBlock }) {
  const isAssistant = message.role === 'assistant'
  const blocks = Array.isArray(message?.content?.blocks) ? message.content.blocks : []
  const summary = isAssistant ? message?.content?.summary : message?.content?.text

  if (!isAssistant) {
    return (
      <article className="ml-auto w-full max-w-[360px] rounded-[20px] rounded-tr-[8px] border border-border-subtle/80 bg-accent/[0.06] px-3.5 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-text-muted">You</span>
          <span className="font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</span>
        </div>
        {summary ? <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-text-primary">{summary}</p> : null}
      </article>
    )
  }

  if (message.status === 'pending') {
    return <PendingAssistantBubble createdAt={message.created_at} />
  }

  if (message.status === 'error' || String(message?.content?.title || '').trim() === 'Assistant unavailable') {
    return <AssistantFailureNotice message={message} />
  }

  return (
    <article className="group w-full max-w-[68ch]">
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
            title="Create a new note from this reply"
            onClick={() => onCreateNoteFromMessage?.(message, blocks)}
            className={iconButtonClass({ active: false })}
          >
            <StickyNote size={12} />
          </button>
        </div>
      </div>

      <div className="mt-2 rounded-[22px] rounded-tl-[8px] border border-border-subtle/80 bg-base/76 px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
        {summary ? (
          <AssistantRichText
            text={summary}
            className="assistant-rich-copy max-w-[62ch] text-[14px] leading-7 text-text-primary"
          />
        ) : null}

        {blocks.map((block) =>
          block.kind === 'code' || block.kind === 'sql' ? (
            <CodeBlock key={`${message.id}-${block.id || block.kind}`} block={block} onCopy={onCopyBlock} />
          ) : (
            <AssistantTextBlock key={`${message.id}-${block.id || block.kind}`} block={block} onCopy={onCopyBlock} />
          ),
        )}
      </div>

      <p className="mt-4 font-mono text-[10px] text-text-muted">{formatRelativeDate(message.created_at)}</p>
    </article>
  )
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
            className={['pointer-events-auto border px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.16)]', noticeClass(notice.tone)].join(' ')}
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

function AssistantHistorySheet({
  open,
  threads,
  selectedThreadId,
  editingThreadId,
  renameValue,
  onRenameValueChange,
  onBeginRename,
  onSaveRename,
  onSelectThread,
  onNewChat,
  onClose,
}) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      searchRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [open])

  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return threads
    }

    return threads.filter((thread) => `${thread.title} ${threadPreview(thread)}`.toLowerCase().includes(normalized))
  }, [query, threads])

  useDismissableLayer(open, [dialogRef], onClose)

  if (!open) {
    return null
  }

  return (
    <AnimatePresence>
      <Motion.div
        key="assistant-history-sheet"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={FAST_TRANSITION}
        className="absolute inset-0 z-30 bg-black/30"
      >
      <Motion.div
        ref={dialogRef}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={FAST_TRANSITION}
        className="absolute left-3 right-3 top-10 max-h-[56%] overflow-hidden rounded-[22px] border border-border-subtle/80 bg-surface/98 shadow-[0_22px_54px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      >
          <div className="border-b border-border-subtle px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[12px] font-medium text-text-primary">Chat history</h3>
              <div className="flex items-center gap-1">
                <button type="button" title="New chat" onClick={onNewChat} className={iconButtonClass()}>
                  <Plus size={13} />
                </button>
                <button type="button" onClick={onClose} className={iconButtonClass()}>
                  <X size={14} />
                </button>
              </div>
            </div>
            {threads.length > 6 ? (
              <div className="relative mt-2">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search chats"
                  className="h-9 w-full border border-border-subtle bg-base pl-9 pr-3 text-[13px] text-text-primary outline-none focus:border-accent"
                />
              </div>
            ) : null}
          </div>

          <div className="max-h-[420px] overflow-y-auto px-2 py-1.5">
            {filteredThreads.length === 0 ? (
              <div className="border border-dashed border-border-subtle bg-base/70 px-4 py-4 text-[12px] text-text-muted">
                {query.trim() ? 'No matches.' : 'No chats yet.'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredThreads.map((thread) => {
                  const isActive = thread.id === selectedThreadId
                  const isEditing = editingThreadId === thread.id
                  return (
                    <div
                      key={`assistant-thread-${thread.id}`}
                    className={[
                        'rounded-[16px] border px-3 py-2 transition-colors',
                        isActive ? 'border-accent/60 bg-accent/7' : 'border-border-subtle/80 bg-base/80 hover:border-accent/30',
                      ].join(' ')}
                    >
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
                          className="h-8 w-full border border-border-subtle bg-surface px-3 text-[13px] text-text-primary outline-none focus:border-accent"
                        />
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <button type="button" onClick={() => onSelectThread(thread.id)} className="min-w-0 flex-1 text-left">
                            <p className="truncate text-[13px] font-medium text-text-primary">{thread.title || THREAD_TITLE_FALLBACK}</p>
                            {threadPreview(thread) ? (
                              <p className="mt-0.5 line-clamp-1 text-[11px] leading-5 text-text-muted">{threadPreview(thread)}</p>
                            ) : null}
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="font-mono text-[10px] text-text-muted">
                              {formatRelativeDate(thread.last_message_at || thread.created_at)}
                            </span>
                            {isActive ? (
                              <button type="button" title="Rename chat" onClick={() => onBeginRename(thread)} className={iconButtonClass({ active: false })}>
                                <Edit3 size={12} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  )
}

export function FloatingAssistantWindow() {
  const {
    windowState,
    problemContext,
    launcherRect,
    actionsRef,
    minimizeAssistant,
    restoreAssistant,
    closeAssistant,
    updateWindowPlacement,
  } = useAssistantWindow()

  const reduceMotion = useReducedMotion()
  const queryClient = useQueryClient()
  const assistantConfigured = isAssistantConfigured()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [draftOpen, setDraftOpen] = useState(true)
  const [composerValue, setComposerValue] = useState('')
  const [attachments, setAttachments] = useState(() =>
    buildDefaultAttachments(problemContext?.workspaceContext, problemContext?.preferredProviderMode || 'platform'),
  )
  const [transientTurn, setTransientTurn] = useState(null)
  const [notices, setNotices] = useState([])
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }))
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const feedRef = useRef(null)
  const latestWorkspaceContextRef = useRef(problemContext?.workspaceContext || null)
  const overflowAnchorRef = useRef(null)
  const overflowPanelRef = useRef(null)
  const noticeTimersRef = useRef(new Map())
  const streamAbortRef = useRef(null)
  const resizeStateRef = useRef(null)
  const dragStateRef = useRef(null)
  const placementFrameRef = useRef(null)
  const placementPatchRef = useRef(null)
  const bodyInteractionRef = useRef({ cursor: '', userSelect: '' })
  const autoScrollAllowedRef = useRef(false)
  const ignoreNextScrollRef = useRef(false)
  const previousEditorAvailabilityRef = useRef(Boolean(problemContext?.workspaceContext?.editorText?.trim()))

  const problem = problemContext?.problem || null
  const workspaceContext = problemContext?.workspaceContext || null
  const providerMode = problemContext?.preferredProviderMode || 'platform'
  const currentResults = workspaceContext?.currentResultAttachment || null
  const editorContextAvailable = Boolean(workspaceContext?.editorText?.trim())
  const isDesktopFloating = viewport.width >= 960
  const enabled = windowState.status !== 'closed' && assistantConfigured && Boolean(problem?.problemKey)
  const desktopWindowHeight = Math.min(windowState.height, viewport.height - WINDOW_MARGIN * 2)
  const targetRect = useMemo(
    () => ({
      left: windowState.x,
      top: windowState.y,
      width: windowState.width,
      height: desktopWindowHeight,
    }),
    [desktopWindowHeight, windowState.width, windowState.x, windowState.y],
  )
  const openAnimation = useMemo(() => buildLauncherAnimation(launcherRect, targetRect), [launcherRect, targetRect])

  const threadsQuery = useQuery({
    queryKey: assistantThreadsQueryKey(problem?.problemKey || 'none'),
    queryFn: ({ signal }) =>
      assistantRequest(`/assistant/threads?problem_key=${encodeURIComponent(problem.problemKey)}`, { signal }),
    enabled,
    staleTime: 30_000,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const threads = useMemo(
    () =>
      sortThreadsByActivity(
        (threadsQuery.data || []).filter(
          (thread) =>
            String(thread?.chat_mode || CHAT_MODE) === CHAT_MODE &&
            Boolean(thread?.last_message_at || threadPreview(thread) || thread?.updated_at),
        ),
      ),
    [threadsQuery.data],
  )
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [selectedThreadId, threads],
  )

  const messagesQuery = useQuery({
    queryKey: assistantMessagesQueryKey(selectedThreadId || 'draft'),
    queryFn: ({ signal }) => assistantRequest(`/assistant/threads/${selectedThreadId}/messages`, { signal }),
    enabled: enabled && Boolean(selectedThreadId) && !draftOpen,
    staleTime: 15_000,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  useEffect(() => {
    const timers = noticeTimersRef.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
      streamAbortRef.current?.abort?.()
      if (placementFrameRef.current) {
        window.cancelAnimationFrame(placementFrameRef.current)
        placementFrameRef.current = null
      }
      if (typeof document !== 'undefined') {
        document.body.style.cursor = bodyInteractionRef.current.cursor || ''
        document.body.style.userSelect = bodyInteractionRef.current.userSelect || ''
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    window.addEventListener('resize', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    if (!resizing) {
      return undefined
    }

    if (typeof document !== 'undefined') {
      bodyInteractionRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      }
      document.body.style.cursor = resizeStateRef.current?.cursor || 'nwse-resize'
      document.body.style.userSelect = 'none'
    }

    const handlePointerMove = (event) => {
      const state = resizeStateRef.current
      if (!state) {
        return
      }

      const deltaX = event.clientX - state.pointerX
      const deltaY = event.clientY - state.pointerY
      const maxWidth = Math.min(DESKTOP_MAX_WIDTH, viewport.width - WINDOW_MARGIN * 2)
      const maxHeight = Math.min(DESKTOP_MAX_HEIGHT, viewport.height - WINDOW_MARGIN * 2)

      let nextX = state.x
      let nextY = state.y
      let nextWidth = state.width
      let nextHeight = state.height

      if (state.edge.includes('e')) {
        nextWidth = clampNumber(state.width + deltaX, DESKTOP_MIN_WIDTH, maxWidth)
      }

      if (state.edge.includes('s')) {
        nextHeight = clampNumber(state.height + deltaY, DESKTOP_MIN_HEIGHT, maxHeight)
      }

      if (state.edge.includes('w')) {
        const proposedWidth = clampNumber(state.width - deltaX, DESKTOP_MIN_WIDTH, maxWidth)
        const consumed = proposedWidth - state.width
        nextWidth = proposedWidth
        nextX = clampNumber(state.x - consumed, WINDOW_MARGIN, viewport.width - nextWidth - WINDOW_MARGIN)
      }

      if (state.edge.includes('n')) {
        const proposedHeight = clampNumber(state.height - deltaY, DESKTOP_MIN_HEIGHT, maxHeight)
        const consumed = proposedHeight - state.height
        nextHeight = proposedHeight
        nextY = clampNumber(state.y - consumed, WINDOW_MARGIN, viewport.height - nextHeight - WINDOW_MARGIN)
      }

      nextWidth = clampNumber(nextWidth, DESKTOP_MIN_WIDTH, Math.min(maxWidth, viewport.width - nextX - WINDOW_MARGIN))
      nextHeight = clampNumber(nextHeight, DESKTOP_MIN_HEIGHT, Math.min(maxHeight, viewport.height - nextY - WINDOW_MARGIN))

      placementPatchRef.current = {
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
      }
      if (!placementFrameRef.current) {
        placementFrameRef.current = window.requestAnimationFrame(() => {
          placementFrameRef.current = null
          if (placementPatchRef.current) {
            updateWindowPlacement(placementPatchRef.current)
            placementPatchRef.current = null
          }
        })
      }
    }

    const handlePointerUp = () => {
      resizeStateRef.current = null
      setResizing(false)
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      if (typeof document !== 'undefined') {
        document.body.style.cursor = bodyInteractionRef.current.cursor || ''
        document.body.style.userSelect = bodyInteractionRef.current.userSelect || ''
      }
    }
  }, [resizing, updateWindowPlacement, viewport.height, viewport.width])

  useEffect(() => {
    if (!dragging) {
      return undefined
    }

    if (typeof document !== 'undefined') {
      bodyInteractionRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      }
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    const handlePointerMove = (event) => {
      const state = dragStateRef.current
      if (!state) {
        return
      }

      const deltaX = event.clientX - state.pointerX
      const deltaY = event.clientY - state.pointerY
      const x = clampNumber(
        state.x + deltaX,
        WINDOW_MARGIN,
        Math.max(WINDOW_MARGIN, viewport.width - state.width - WINDOW_MARGIN),
      )
      const y = clampNumber(
        state.y + deltaY,
        WINDOW_MARGIN,
        Math.max(WINDOW_MARGIN, viewport.height - state.height - WINDOW_MARGIN),
      )

      placementPatchRef.current = { x, y }
      if (!placementFrameRef.current) {
        placementFrameRef.current = window.requestAnimationFrame(() => {
          placementFrameRef.current = null
          if (placementPatchRef.current) {
            updateWindowPlacement(placementPatchRef.current)
            placementPatchRef.current = null
          }
        })
      }
    }

    const handlePointerUp = () => {
      dragStateRef.current = null
      setDragging(false)
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      if (typeof document !== 'undefined') {
        document.body.style.cursor = bodyInteractionRef.current.cursor || ''
        document.body.style.userSelect = bodyInteractionRef.current.userSelect || ''
      }
    }
  }, [dragging, updateWindowPlacement, viewport.height, viewport.width])

  useEffect(() => {
    latestWorkspaceContextRef.current = workspaceContext
  }, [workspaceContext])

  useEffect(() => {
    const wasAvailable = previousEditorAvailabilityRef.current
    previousEditorAvailabilityRef.current = editorContextAvailable

    if (editorContextAvailable && !wasAvailable) {
      setAttachments((current) =>
        syncAttachments(
          {
            ...current,
            include_editor: true,
          },
          workspaceContext,
          providerMode,
        ),
      )
      return
    }

    if (!editorContextAvailable && wasAvailable) {
      setAttachments((current) =>
        syncAttachments(
          {
            ...current,
            include_editor: false,
          },
          workspaceContext,
          providerMode,
        ),
      )
    }
  }, [editorContextAvailable, providerMode, workspaceContext])

  useEffect(() => {
    if (!problem?.problemKey) {
      return
    }

    setHistoryOpen(false)
    setOverflowOpen(false)
    setEditingThreadId(null)
    setRenameValue('')
    setComposerValue('')
    setDraftOpen(true)
    setSelectedThreadId(null)
    setAttachments(buildDefaultAttachments(latestWorkspaceContextRef.current, providerMode))
    previousEditorAvailabilityRef.current = Boolean(latestWorkspaceContextRef.current?.editorText?.trim())
    setTransientTurn(null)
  }, [problem?.problemKey, providerMode])

  useEffect(() => {
    setAttachments((current) => syncAttachments(current, workspaceContext, providerMode))
  }, [providerMode, workspaceContext])

  useEffect(() => {
    if (!isDesktopFloating) {
      return
    }

    const next = clampWindowPlacement(
      {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
      },
      viewport.width,
      viewport.height,
    )
    if (
      next.x === windowState.x &&
      next.y === windowState.y &&
      next.width === windowState.width &&
      next.height === windowState.height
    ) {
      return
    }

    updateWindowPlacement(next)
  }, [
    isDesktopFloating,
    updateWindowPlacement,
    viewport.height,
    viewport.width,
    windowState.height,
    windowState.width,
    windowState.x,
    windowState.y,
  ])

  useEffect(() => {
    if (!enabled) {
      return
    }

    if (draftOpen) {
      return
    }

    if (selectedThreadId && threads.some((thread) => thread.id === selectedThreadId)) {
      return
    }

    setSelectedThreadId(threads[0]?.id || null)
  }, [draftOpen, enabled, selectedThreadId, threads])

  useEffect(() => {
    if (!transientTurn?.resolvedMessage || !selectedThreadId || !messagesQuery.data) {
      return
    }

    if (selectedThreadId !== transientTurn.threadId) {
      return
    }

    const hasPersistedReply = messagesQuery.data.some((message) => message.id === transientTurn.resolvedMessage.id)
    if (hasPersistedReply) {
      setTransientTurn(null)
    }
  }, [messagesQuery.data, selectedThreadId, transientTurn])

  useEffect(() => {
    if (!feedRef.current || !transientTurn?.anchorId || !autoScrollAllowedRef.current) {
      return
    }

    const container = feedRef.current
    const target = container.querySelector(`[data-message-anchor-id="${transientTurn.anchorId}"]`)
    if (!target) {
      return
    }

    ignoreNextScrollRef.current = true
    container.scrollTo({
      top: Math.max(0, target.offsetTop - 10),
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [messagesQuery.data, reduceMotion, transientTurn])

  useEffect(() => {
    const node = feedRef.current
    if (!node) {
      return undefined
    }

    const handleScroll = () => {
      if (ignoreNextScrollRef.current) {
        ignoreNextScrollRef.current = false
        return
      }

      if (transientTurn) {
        autoScrollAllowedRef.current = false
      }
    }

    node.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', handleScroll)
    }
  }, [transientTurn])

  const startResize = (edge, event) => {
    event.preventDefault()
    event.stopPropagation()
    const cursorByEdge = {
      n: 'ns-resize',
      s: 'ns-resize',
      e: 'ew-resize',
      w: 'ew-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      nw: 'nwse-resize',
      se: 'nwse-resize',
    }
    resizeStateRef.current = {
      edge,
      cursor: cursorByEdge[edge] || 'nwse-resize',
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: windowState.x,
      y: windowState.y,
      width: windowState.width,
      height: desktopWindowHeight,
    }
    setResizing(true)
  }

  const startDrag = (event) => {
    if (!isDesktopFloating || resizing || event.button !== 0) {
      return
    }

    const target = event.target
    if (target instanceof Element && target.closest('button, input, textarea, a')) {
      return
    }

    event.preventDefault()
    dragStateRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: windowState.x,
      y: windowState.y,
      width: windowState.width,
      height: desktopWindowHeight,
    }
    setDragging(true)
  }

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
    const timer = window.setTimeout(() => dismissNotice(noticeId), 3200)
    noticeTimersRef.current.set(noticeId, timer)
  }

  useDismissableLayer(overflowOpen, [overflowAnchorRef, overflowPanelRef], () => setOverflowOpen(false))

  const loadingMessages = Boolean(selectedThreadId) && !draftOpen && messagesQuery.status === 'pending'

  const messages = useMemo(() => {
    const persisted = Array.isArray(messagesQuery.data) ? messagesQuery.data : []
    if (!transientTurn || transientTurn.threadId !== selectedThreadId) {
      return persisted
    }

    const next = [...persisted]

    if (!persisted.some((message) => message.id === transientTurn.userMessage.id)) {
      next.push(transientTurn.userMessage)
    }

    if (transientTurn.resolvedMessage) {
      if (!persisted.some((message) => message.id === transientTurn.resolvedMessage.id)) {
        next.push(transientTurn.resolvedMessage)
      }
    } else {
      next.push(transientTurn.pendingMessage)
    }

    return next.filter(hasMeaningfulMessage)
  }, [messagesQuery.data, selectedThreadId, transientTurn])

  const startNewChat = () => {
    streamAbortRef.current?.abort?.()
    setDraftOpen(true)
    setSelectedThreadId(null)
    setComposerValue('')
    setAttachments(buildDefaultAttachments(workspaceContext, providerMode))
    previousEditorAvailabilityRef.current = Boolean(workspaceContext?.editorText?.trim())
    setHistoryOpen(false)
    setOverflowOpen(false)
    setEditingThreadId(null)
    setRenameValue('')
    setTransientTurn(null)
  }

  const handleSelectThread = (threadId) => {
    if (transientTurn && transientTurn.threadId !== threadId) {
      streamAbortRef.current?.abort?.()
      setTransientTurn(null)
    }
    setDraftOpen(false)
    setSelectedThreadId(threadId)
    setHistoryOpen(false)
    setEditingThreadId(null)
    setRenameValue('')
  }

  const handleRenameThread = async () => {
    if (!editingThreadId || !renameValue.trim()) {
      setEditingThreadId(null)
      setRenameValue('')
      return
    }

    const updated = await assistantRequest(`/assistant/threads/${editingThreadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: renameValue.trim() }),
    })

    queryClient.setQueryData(assistantThreadsQueryKey(problem.problemKey), (current) => upsertThreadList(current || [], updated))
    setEditingThreadId(null)
    setRenameValue('')
  }

  const handleAddResults = () => {
    if (!currentResults?.available) {
      return
    }

    setAttachments((current) =>
      syncAttachments(
        {
          ...current,
          include_latest_run: true,
          selected_run_id: currentResults.selected_run_id || null,
          selected_case_ids: Array.isArray(currentResults.selected_case_ids) ? currentResults.selected_case_ids : [],
          selected_fixture_id: currentResults.selected_fixture_id || null,
        },
        workspaceContext,
        providerMode,
      ),
    )
  }

  const handleRemoveAttachment = (key) => {
    setAttachments((current) => {
      const next = { ...current }

      if (key === 'editor') {
        next.include_editor = false
      } else if (key === 'results') {
        next.include_latest_run = false
        next.selected_run_id = null
        next.selected_case_ids = []
        next.selected_fixture_id = null
      }

      return syncAttachments(next, workspaceContext, providerMode)
    })
  }

  const createNoteFromMessage = async (message, blocks) => {
    const payload = {
      title: message?.content?.title || 'AI Assistant',
      summary: message?.content?.summary || '',
      blocks,
    }

    try {
      const result = await actionsRef.current.onCreateAiNote?.(payload)
      if (!result) {
        pushNotice({
          tone: 'error',
          message: 'Open a problem page to create a note from this reply.',
        })
        return
      }
      if (result.ok) {
        pushNotice({
          tone: 'success',
          message: `Created ${result.noteLabel || 'AI note'}.`,
          actionLabel: result.noteId ? 'Open note' : '',
          noteId: result.noteId || null,
        })
      } else {
        pushNotice({
          tone: 'error',
          message: result.error || 'Could not create a note from this reply.',
        })
      }
    } catch (error) {
      pushNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not create a note from this reply.',
      })
    }
  }

  const handleCopyBlock = async (value) => {
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

  const handleSend = async () => {
    const message = trimText(composerValue)
    if (!message || transientTurn || !assistantConfigured || !problem?.problemKey) {
      return
    }

    autoScrollAllowedRef.current = true
    setComposerValue('')
    setHistoryOpen(false)
    setOverflowOpen(false)

    let thread = activeThread

    if (!thread) {
      thread = await assistantRequest('/assistant/threads', {
        method: 'POST',
        body: JSON.stringify({
          problem_key: problem.problemKey,
          track_key: problem.trackKey,
          provider_mode: providerMode,
          chat_mode: CHAT_MODE,
        }),
      })
      queryClient.setQueryData(assistantThreadsQueryKey(problem.problemKey), (current) => upsertThreadList(current || [], thread))
      setSelectedThreadId(thread.id)
      setDraftOpen(false)
    }

    const now = new Date().toISOString()
    const userMessage = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      created_at: now,
      status: 'completed',
      content: { text: message },
    }
    const pendingMessage = {
      id: `pending-assistant-${Date.now()}`,
      role: 'assistant',
      created_at: now,
      status: 'pending',
      content: { title: 'Thinking…', summary: '', blocks: [] },
    }

    setTransientTurn({
      threadId: thread.id,
      userMessage,
      pendingMessage,
      resolvedMessage: null,
      anchorId: pendingMessage.id,
    })

    const controller = new AbortController()
    streamAbortRef.current?.abort?.()
    streamAbortRef.current = controller

    try {
      await assistantStream(
        `/assistant/threads/${thread.id}/messages/stream`,
        {
          message,
          intent: 'general',
          attachments: {
            ...attachments,
            provider_mode: providerMode,
          },
          editor_snapshot: workspaceContext?.editorText || '',
          note_snapshot: null,
        },
        {
          onMessage: (event) => {
            queryClient.setQueryData(assistantThreadsQueryKey(problem.problemKey), (current) => upsertThreadList(current || [], event.thread || thread))
            queryClient.invalidateQueries({
              queryKey: assistantMessagesQueryKey(thread.id),
            })
            setTransientTurn((current) =>
              current?.threadId === thread.id
                ? {
                    ...current,
                    resolvedMessage: event.message,
                    pendingMessage: null,
                    anchorId: event.message.id,
                  }
                : current,
            )
          },
        },
        {
          signal: controller.signal,
        },
      )
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      setTransientTurn((current) =>
        current?.threadId === thread.id
          ? {
              ...current,
              resolvedMessage: buildLocalAssistantErrorMessage(
                error instanceof Error ? error.message : 'Assistant request failed.',
              ),
              pendingMessage: null,
              anchorId: current.pendingMessage?.id || current.anchorId,
            }
          : current,
      )
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
    }
  }

  const visibleChips = [
    attachments.include_editor ? { key: 'editor', label: 'Current code' } : null,
    attachments.include_latest_run ? { key: 'results', label: 'Current results' } : null,
  ].filter(Boolean)

  const floatingWindow = (
    <LayoutGroup>
      <AnimatePresence initial={false}>
        {windowState.status === 'open' && problem ? (
          <Motion.div
            key="floating-assistant-window"
            layoutId="assistant-shell"
            initial={openAnimation}
            animate={{ opacity: 1, scaleX: 1, scaleY: 1, x: 0, y: 0 }}
            exit={buildLauncherAnimation(launcherRect, targetRect)}
            transition={reduceMotion ? FAST_TRANSITION : SPRING_TRANSITION}
            className={[
              'fixed z-[80] flex min-h-0 min-w-0 flex-col overflow-hidden border border-border-subtle/80 bg-surface/96 shadow-[0_28px_90px_rgba(0,0,0,0.32)] backdrop-blur-xl origin-top-left',
              isDesktopFloating ? 'rounded-[26px]' : 'inset-0 rounded-none',
              dragging || resizing ? 'cursor-grabbing' : '',
            ].join(' ')}
            style={{
              left: isDesktopFloating ? windowState.x : 0,
              top: isDesktopFloating ? windowState.y : 0,
              width: isDesktopFloating ? windowState.width : viewport.width,
              height: isDesktopFloating ? desktopWindowHeight : viewport.height,
            }}
            onMouseDown={startDrag}
          >
            <header
              className={[
                'relative select-none border-b border-border-subtle/70 px-4 py-3',
                isDesktopFloating ? 'cursor-grab active:cursor-grabbing' : '',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[16px] font-medium tracking-[-0.01em] text-text-primary">{problem.title || 'Practicer AI'}</h2>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">
                    {(problem.trackKey || 'dsa').toUpperCase()} · Tier {problem.tier ?? '-'} · {problem.phaseName || 'Practice'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" title="History" onClick={() => setHistoryOpen(true)} className={iconButtonClass()}>
                    <History size={14} />
                  </button>
                  <button
                    ref={overflowAnchorRef}
                    type="button"
                    title="Options"
                    onClick={() => setOverflowOpen((current) => !current)}
                    className={iconButtonClass({ active: overflowOpen })}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  <button type="button" title="Minimize" onClick={minimizeAssistant} className={iconButtonClass()}>
                    <Minus size={14} />
                  </button>
                  <button type="button" title="Close" onClick={closeAssistant} className={iconButtonClass()}>
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
                    className="absolute right-3 top-[calc(100%+8px)] z-20 min-w-[176px] overflow-hidden rounded-[18px] border border-border-subtle/80 bg-surface/98 shadow-[0_20px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        startNewChat()
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-elevated hover:text-accent"
                    >
                      <span>New chat</span>
                      <Plus size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={!activeThread}
                      onClick={() => {
                        if (!activeThread) {
                          return
                        }
                        setHistoryOpen(true)
                        setEditingThreadId(activeThread.id)
                        setRenameValue(activeThread.title || '')
                        setOverflowOpen(false)
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-text-primary transition-colors hover:bg-elevated hover:text-accent disabled:opacity-40"
                    >
                      <span>Rename chat</span>
                      <Edit3 size={13} />
                    </button>
                  </Motion.div>
                ) : null}
              </AnimatePresence>
            </header>

            <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto w-full max-w-[680px] space-y-5">
                {!assistantConfigured ? (
                  <div className="rounded-[18px] border border-border-subtle/80 bg-base/78 px-4 py-3 text-[13px] text-text-primary">
                    Configure the runner before using the assistant.
                  </div>
                ) : null}

                {threadsQuery.error ? (
                  <div className="rounded-[18px] border border-border-subtle/80 bg-base/78 px-4 py-3 text-[13px] text-text-primary">
                    {threadsQuery.error instanceof Error ? threadsQuery.error.message : 'Could not load chats.'}
                  </div>
                ) : null}

                {messagesQuery.error && selectedThreadId ? (
                  <div className="rounded-[18px] border border-border-subtle/80 bg-base/78 px-4 py-3 text-[13px] text-text-primary">
                    {messagesQuery.error instanceof Error ? messagesQuery.error.message : 'Could not load messages.'}
                  </div>
                ) : null}

                {assistantConfigured && !threadsQuery.error && loadingMessages && !messages.length ? (
                  <div className="flex min-h-[160px] items-center justify-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-border-subtle/80 bg-base/70 px-4 py-2 text-[12px] text-text-muted">
                      <LoaderCircle size={13} className="animate-spin text-accent" />
                      <span>Loading messages…</span>
                    </div>
                  </div>
                ) : null}

                {!loadingMessages && messages.length === 0 && !threadsQuery.error ? (
                  <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
                    <div className="rounded-full border border-border-subtle/70 bg-base/70 px-4 py-2 text-[12px] font-medium text-text-primary">
                      Problem context is already in.
                    </div>
                    <p className="mt-2 text-[12px] leading-6 text-text-muted">Add current code or failed results when useful.</p>
                  </div>
                ) : null}

                {messages.map((message) => (
                  <Motion.div
                    key={`assistant-message-${message.id}`}
                    data-message-anchor-id={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={FAST_TRANSITION}
                  >
                    <AssistantMessageArticle
                      message={message}
                      onCreateNoteFromMessage={createNoteFromMessage}
                      onCopyBlock={handleCopyBlock}
                    />
                  </Motion.div>
                ))}
              </div>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault()
                void handleSend()
              }}
              className="border-t border-border-subtle/70 bg-surface/96 px-4 py-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {visibleChips.map((chip) => (
                  <span
                    key={`assistant-chip-${chip.key}`}
                    className={contextChipClass()}
                  >
                    <span>{chip.label}</span>
                    <button
                      type="button"
                      title={`Remove ${chip.label}`}
                      onClick={() => handleRemoveAttachment(chip.key)}
                      className="inline-flex h-4 w-4 items-center justify-center text-text-muted hover:text-accent"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}

                {currentResults?.available && !attachments.include_latest_run ? (
                  <button
                    type="button"
                    onClick={handleAddResults}
                    className={contextChipClass({ interactive: true })}
                  >
                    <Plus size={11} />
                    Current results
                  </button>
                ) : null}
              </div>

              <div className="flex items-end gap-2 rounded-[22px] border border-border-subtle/80 bg-base/76 p-2 shadow-[0_12px_26px_rgba(0,0,0,0.12)]">
                <textarea
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void handleSend()
                    }
                  }}
                  rows={1}
                  placeholder="Message, code, SQL, or output"
                  disabled={!assistantConfigured || !problem}
                  className="min-h-[40px] max-h-[112px] w-full flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={Boolean(transientTurn) || !trimText(composerValue) || !assistantConfigured || !problem}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-accent/65 bg-accent/12 px-3.5 text-sm text-accent transition-colors hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={14} />
                  <span className="hidden sm:inline">Send</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>

            {isDesktopFloating
              ? [
                  { edge: 'n', className: 'absolute left-0 right-0 top-0', style: { height: RESIZE_HANDLE_SIZE }, cursor: 'cursor-ns-resize' },
                  { edge: 's', className: 'absolute bottom-0 left-0 right-0', style: { height: RESIZE_HANDLE_SIZE }, cursor: 'cursor-ns-resize' },
                  { edge: 'e', className: 'absolute right-0 top-0 bottom-0', style: { width: RESIZE_HANDLE_SIZE }, cursor: 'cursor-ew-resize' },
                  { edge: 'w', className: 'absolute left-0 top-0 bottom-0', style: { width: RESIZE_HANDLE_SIZE }, cursor: 'cursor-ew-resize' },
                  { edge: 'ne', className: 'absolute right-0 top-0', style: { height: RESIZE_HANDLE_SIZE, width: RESIZE_HANDLE_SIZE }, cursor: 'cursor-nesw-resize' },
                  { edge: 'nw', className: 'absolute left-0 top-0', style: { height: RESIZE_HANDLE_SIZE, width: RESIZE_HANDLE_SIZE }, cursor: 'cursor-nwse-resize' },
                  { edge: 'se', className: 'absolute bottom-0 right-0', style: { height: RESIZE_HANDLE_SIZE, width: RESIZE_HANDLE_SIZE }, cursor: 'cursor-nwse-resize' },
                  { edge: 'sw', className: 'absolute bottom-0 left-0', style: { height: RESIZE_HANDLE_SIZE, width: RESIZE_HANDLE_SIZE }, cursor: 'cursor-nesw-resize' },
                ].map((handle) => (
                  <button
                    key={`assistant-resize-${handle.edge}`}
                    type="button"
                    aria-label={`Resize assistant ${handle.edge}`}
                    onMouseDown={(event) => startResize(handle.edge, event)}
                    className={`${handle.className} ${handle.cursor} opacity-0`}
                    style={{ ...handle.style, touchAction: 'none' }}
                  />
                ))
              : null}

            {historyOpen ? (
              <AssistantHistorySheet
                open={historyOpen}
                threads={threads}
                selectedThreadId={selectedThreadId}
                editingThreadId={editingThreadId}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                onBeginRename={(thread) => {
                  setEditingThreadId(thread.id)
                  setRenameValue(thread.title || '')
                }}
                onSaveRename={handleRenameThread}
                onSelectThread={handleSelectThread}
                onNewChat={startNewChat}
                onClose={() => {
                  setHistoryOpen(false)
                  setEditingThreadId(null)
                  setRenameValue('')
                }}
              />
            ) : null}

            <AssistantNoticeStack
              notices={notices}
              onDismiss={dismissNotice}
              onAction={(notice) => {
                if (notice.noteId && actionsRef.current.onOpenNote) {
                  actionsRef.current.onOpenNote(notice.noteId)
                }
                dismissNotice(notice.id)
              }}
            />
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {windowState.status === 'minimized' && problem ? (
          <Motion.button
            key="assistant-dock-pill"
            layoutId="assistant-shell"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={reduceMotion ? FAST_TRANSITION : SPRING_TRANSITION}
            onClick={() => {
              restoreAssistant()
            }}
            className="fixed bottom-4 right-4 z-[80] inline-flex h-12 items-center gap-2 rounded-full border border-border-subtle/80 bg-surface/96 px-4 text-sm text-text-primary shadow-[0_20px_48px_rgba(0,0,0,0.24)] backdrop-blur-xl"
          >
            <MessageSquare size={16} className="text-accent" />
            <div className="flex flex-col items-start leading-none">
              <span>Assistant</span>
              <span className="mt-1 text-[10px] text-text-muted">{problem.title}</span>
            </div>
          </Motion.button>
        ) : null}
      </AnimatePresence>
    </LayoutGroup>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(floatingWindow, document.body)
}
