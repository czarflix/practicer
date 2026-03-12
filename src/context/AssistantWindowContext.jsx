/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const AssistantWindowContext = createContext(null)

const STORAGE_KEY = 'practicer-assistant-window-v6'
const MIN_MARGIN = 16
const SIDEBAR_WIDTH = 48
const DEFAULT_LEFT = SIDEBAR_WIDTH + MIN_MARGIN
const DEFAULT_TOP = MIN_MARGIN

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function buildDefaultWindowState(viewportWidth, viewportHeight) {
  const maxWidth = Math.min(760, viewportWidth - MIN_MARGIN * 2)
  const idealWidth = Math.round((viewportWidth - SIDEBAR_WIDTH - MIN_MARGIN * 3) * 0.38)
  const width = clampNumber(idealWidth || 560, 560, maxWidth)
  const height = clampNumber(viewportHeight - MIN_MARGIN * 2, 620, Math.min(880, viewportHeight - MIN_MARGIN * 2))
  const x = clampNumber(DEFAULT_LEFT, MIN_MARGIN, Math.max(MIN_MARGIN, viewportWidth - width - MIN_MARGIN))
  const y = clampNumber(DEFAULT_TOP, MIN_MARGIN, Math.max(MIN_MARGIN, viewportHeight - height - MIN_MARGIN))
  return { x, y, width, height }
}

function readStoredWindowState() {
  if (typeof window === 'undefined') {
    return buildDefaultWindowState(1440, 900)
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const defaults = buildDefaultWindowState(viewportWidth, viewportHeight)
    const width = clampNumber(Number(parsed.width) || defaults.width, 460, Math.min(760, viewportWidth - MIN_MARGIN * 2))
    const height = clampNumber(Number(parsed.height) || defaults.height, 560, Math.min(880, viewportHeight - MIN_MARGIN * 2))
    const x = clampNumber(
      Number(parsed.x) || defaults.x,
      MIN_MARGIN,
      Math.max(MIN_MARGIN, viewportWidth - width - MIN_MARGIN),
    )
    const y = clampNumber(
      Number(parsed.y) || defaults.y,
      MIN_MARGIN,
      Math.max(MIN_MARGIN, viewportHeight - height - MIN_MARGIN),
    )
    return { x, y, width, height }
  } catch {
    return buildDefaultWindowState(window.innerWidth, window.innerHeight)
  }
}

function normalizeRect(rect) {
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

  return {
    left,
    top,
    width,
    height,
  }
}

function serializeComparable(value) {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return ''
  }
}

export function AssistantWindowProvider({ children }) {
  const [windowState, setWindowState] = useState(() => ({
    status: 'closed',
    ...readStoredWindowState(),
  }))
  const [problemContext, setProblemContext] = useState(null)
  const [launcherRect, setLauncherRect] = useState(null)
  const problemContextRef = useRef(null)
  const actionsRef = useRef({
    onInsertIntoCurrentNote: null,
    onCreateAiNote: null,
    onOpenNote: null,
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
      }),
    )
  }, [windowState.height, windowState.width, windowState.x, windowState.y])

  useEffect(() => {
    problemContextRef.current = problemContext
  }, [problemContext])

  const registerProblemContext = useCallback((payload) => {
    if (!payload?.problem?.problemKey) {
      return
    }

    setProblemContext((current) => {
      const next = {
        ...(current || {}),
        problem: payload.problem,
        workspaceContext: payload.workspaceContext,
        preferredProviderMode: payload.preferredProviderMode || 'platform',
        onProviderPreferenceChange: payload.onProviderPreferenceChange || null,
      }

      if (
        serializeComparable(current?.problem) === serializeComparable(next.problem) &&
        serializeComparable(current?.workspaceContext) === serializeComparable(next.workspaceContext) &&
        current?.preferredProviderMode === next.preferredProviderMode &&
        current?.onProviderPreferenceChange === next.onProviderPreferenceChange
      ) {
        return current
      }

      problemContextRef.current = next
      return next
    })

    actionsRef.current = {
      onInsertIntoCurrentNote: payload.onInsertIntoCurrentNote || null,
      onCreateAiNote: payload.onCreateAiNote || null,
      onOpenNote: payload.onOpenNote || null,
    }
  }, [])

  const unregisterProblemContext = useCallback((problemKey) => {
    const activeProblemKey = problemContextRef.current?.problem?.problemKey
    if (activeProblemKey && activeProblemKey !== problemKey) {
      return
    }

    problemContextRef.current = null
    setProblemContext(null)
    setLauncherRect(null)
    setWindowState((current) => ({
      ...current,
      status: 'closed',
    }))
    actionsRef.current = {
      onInsertIntoCurrentNote: null,
      onCreateAiNote: null,
      onOpenNote: null,
    }
  }, [])

  const openAssistant = useCallback((options = {}) => {
    const nextLauncherRect = normalizeRect(options.launcherRect)
    if (nextLauncherRect) {
      setLauncherRect(nextLauncherRect)
    }

    setWindowState((current) => ({
      ...current,
      status: 'open',
    }))
  }, [])

  const minimizeAssistant = useCallback(() => {
    setWindowState((current) => ({
      ...current,
      status: 'minimized',
    }))
  }, [])

  const restoreAssistant = useCallback(() => {
    setWindowState((current) => ({
      ...current,
      status: 'open',
    }))
  }, [])

  const closeAssistant = useCallback(() => {
    setWindowState((current) => ({
      ...current,
      status: 'closed',
    }))
  }, [])

  const updateWindowPlacement = useCallback((patch) => {
    setWindowState((current) => ({
      ...current,
      ...patch,
    }))
  }, [])

  const value = useMemo(
    () => ({
      windowState,
      problemContext,
      launcherRect,
      actionsRef,
      registerProblemContext,
      unregisterProblemContext,
      openAssistant,
      minimizeAssistant,
      restoreAssistant,
      closeAssistant,
      updateWindowPlacement,
    }),
    [
      closeAssistant,
      minimizeAssistant,
      launcherRect,
      openAssistant,
      problemContext,
      registerProblemContext,
      restoreAssistant,
      unregisterProblemContext,
      updateWindowPlacement,
      windowState,
    ],
  )

  return <AssistantWindowContext.Provider value={value}>{children}</AssistantWindowContext.Provider>
}

export function useAssistantWindow() {
  const value = useContext(AssistantWindowContext)
  if (!value) {
    throw new Error('useAssistantWindow must be used inside AssistantWindowProvider.')
  }
  return value
}
