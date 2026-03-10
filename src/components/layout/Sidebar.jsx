import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion as Motion } from 'framer-motion'
import {
  Bell,
  Braces,
  CircuitBoard,
  CheckCheck,
  Database,
  House,
  List,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sun,
} from 'lucide-react'
import { NavLink, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { useCurrentUser } from '../../context/user-store'
import { useSolveDestination } from '../../hooks/useSolveDestination'
import { buttonTap, overlayPop } from '../../lib/motion'
import { useNotifications } from '../../hooks/useNotifications'
import { hasSupabaseCredentials } from '../../lib/supabase'


function formatNotificationTime(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const now = new Date()
  const isSameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate()

  if (isSameDay) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function notificationTitle(notification) {
  const actor = String(notification?.actor_user_key || 'Someone')
  const payload = notification?.payload || {}

  switch (notification?.type) {
    case 'comment_replied':
      return `${actor} replied`
    case 'comment_added':
      return `${actor} commented`
    case 'shared_solution':
      return `${actor} shared a solution`
    case 'shared_note':
      return `${actor} shared a note`
    case 'problem_added':
      return `${actor} added a problem`
    case 'test_case_added':
      return `${actor} added test cases`
    case 'test_case_updated':
      return `${actor} updated test cases`
    case 'tier_completed':
      return `${actor} completed Tier ${payload?.tier ?? '?'}`
    case 'daily_solved_milestone':
      return `${actor} solved ${payload?.count ?? '?'} today`
    case 'problem_solved':
      return `${actor} solved a problem`
    case 'announcement':
      return payload?.title || `${actor} · announcement`
    default:
      return notification?.type
        ? `${actor} · ${String(notification.type).replace(/_/g, ' ')}`
        : actor
  }
}

function notificationBody(notification) {
  const payload = notification?.payload || {}
  const title = payload?.title || payload?.problem_title || ''
  const trackLabel = notification?.track_key === 'sql' ? 'SQL' : 'DSA'

  switch (notification?.type) {
    case 'comment_replied':
    case 'comment_added':
      return payload?.preview || 'Open problem'
    case 'shared_solution':
      return payload?.title || 'Load it into your editor'
    case 'shared_note':
      return payload?.title || 'Open shared notes'
    case 'problem_added':
      return title || `${trackLabel} problem`
    case 'test_case_added':
      return `${title || `${trackLabel} problem`} · case #${payload?.sort_order ?? '?'}`
    case 'test_case_updated':
      return `${title || `${trackLabel} problem`} · case #${payload?.sort_order ?? '?'}`
    case 'tier_completed':
      return `Tier ${payload?.tier ?? '?'} · ${payload?.solved ?? '?'} / ${payload?.total ?? '?'}`
    case 'daily_solved_milestone':
      return `Daily milestone · ${payload?.count ?? '?'} solved`
    case 'problem_solved':
      return title || `${trackLabel} problem solved`
    case 'announcement':
      return payload?.body || 'Announcement from admin'
    default:
      if (title) {
        return title
      }
      if (notification?.problem_key) {
        return notification.problem_key
      }
      return notification?.problem_lc ? `Problem LC${notification.problem_lc}` : ''
  }
}

function notificationHref(notification) {
  const params = new URLSearchParams()

  if (notification?.type === 'comment_added' || notification?.type === 'comment_replied') {
    params.set('tab', 'comments')
    if (notification?.payload?.comment_id) {
      params.set('comment', String(notification.payload.comment_id))
    }
  }

  if (notification?.type === 'shared_solution') {
    params.set('tab', 'solutions')
    params.set('solutionsView', 'shared')
    if (notification?.payload?.shared_solution_id) {
      params.set('sharedSolution', String(notification.payload.shared_solution_id))
    }
  }

  if (notification?.type === 'shared_note') {
    params.set('tab', 'notes')
    params.set('notesView', 'shared')
    if (notification?.payload?.shared_note_id) {
      params.set('sharedNote', String(notification.payload.shared_note_id))
    }
  }

  if (notification?.type === 'test_case_added' || notification?.type === 'test_case_updated') {
    params.set('rightTab', 'tests')
  }

  if (notification?.problem_key) {
    const suffix = params.toString()
    return `/problem/${notification.problem_key}${suffix ? `?${suffix}` : ''}`
  }

  if (notification?.problem_lc) {
    const suffix = params.toString()
    return `/problem/${notification.problem_lc}${suffix ? `?${suffix}` : ''}`
  }

  return '/'
}

function NotificationsTray({ open, onClose, notificationsState, containerRef }) {
  const navigate = useNavigate()
  const { notifications, loading, error, unreadCount, hasUnread, markAllRead, markRead } = notificationsState

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        onClose()
      }
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [containerRef, onClose, open])

  if (!open) {
    return null
  }

  return (
    <Motion.div
      variants={overlayPop}
      initial="initial"
      animate="animate"
      exit="exit"
      className="absolute left-full top-2 z-[90] ml-2 flex max-h-[min(560px,calc(100dvh-32px))] w-[320px] flex-col overflow-hidden border border-border-subtle bg-surface shadow-[0_10px_40px_rgba(0,0,0,0.24)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Notifications</p>
          <p className="mt-1 font-mono text-[11px] text-text-muted">{unreadCount} unread</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void markAllRead().catch(() => {})
          }}
          disabled={!hasUnread}
          className="inline-flex h-7 items-center gap-1 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCheck size={12} />
          Read
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto">
        {loading ? <p className="px-3 py-3 text-[11px] text-text-muted">Loading…</p> : null}
        {error ? <p className="px-3 py-3 text-[11px] text-red-500">{error}</p> : null}
        {!loading && notifications.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-text-muted">No notifications.</p>
        ) : null}

        {notifications.map((notification) => (
          <button
            key={`notification-${notification.id}`}
            type="button"
            onClick={() => {
              if (!notification.read_at) {
                void markRead(notification.id).catch(() => {})
              }
              navigate(notificationHref(notification))
              onClose()
            }}
            className={[
              'flex w-full items-start gap-3 border-b border-border-subtle px-3 py-2.5 text-left transition-colors last:border-b-0',
              notification.read_at ? 'bg-surface' : 'bg-accent/5',
              'hover:bg-base',
            ].join(' ')}
          >
            <span
              className={[
                'mt-1.5 h-2 w-2 shrink-0 rounded-full border',
                notification.read_at ? 'border-border-subtle bg-surface' : 'border-accent bg-accent',
              ].join(' ')}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2">
                <span className="truncate text-[12px] text-text-primary">{notificationTitle(notification)}</span>
                <span className="shrink-0 font-mono text-[10px] text-text-muted">
                  {formatNotificationTime(notification.created_at)}
                </span>
              </span>
              {notificationBody(notification) ? (
                <span className="mt-1 block break-words text-[11px] leading-5 text-text-muted">
                  {notificationBody(notification)}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </Motion.div>
  )
}

const navItems = [
  { to: '/', label: 'Dashboard', Icon: House, end: true },
  { to: '/problems', label: 'Problem List', Icon: List, end: true },
]

function linkClassName(isActive) {
  return [
    'flex h-9 w-9 items-center justify-center border rounded-[2px] transition-colors duration-150',
    isActive
      ? 'border-accent text-accent bg-elevated'
      : 'border-transparent text-text-muted hover:text-text-primary hover:border-border-subtle',
  ].join(' ')
}

function panelButtonClassName(isActive = false) {
  return [
    'relative flex h-9 w-9 items-center justify-center border rounded-[2px] transition-colors duration-150',
    isActive
      ? 'border-accent text-accent bg-elevated'
      : 'border-border-subtle text-text-muted hover:border-accent hover:text-accent',
  ].join(' ')
}

function SignOutConfirm({ open, onClose, onConfirm, containerRef }) {
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) onClose()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, containerRef])

  if (!open) return null

  return (
    <Motion.div
      variants={overlayPop}
      initial="initial"
      animate="animate"
      exit="exit"
      className="absolute bottom-0 left-full z-40 ml-2 flex items-center gap-1 border border-border-subtle bg-surface p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.24)]"
    >
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex h-6 items-center gap-1 whitespace-nowrap border border-red-500/40 bg-red-500/10 px-2 text-[10px] text-red-400 hover:bg-red-500/20"
      >
        <LogOut size={10} /> Sign out
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-6 items-center whitespace-nowrap px-1.5 text-[10px] text-text-muted hover:text-text-primary"
      >
        Cancel
      </button>
    </Motion.div>
  )
}

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const notificationsContainerRef = useRef(null)
  const signOutContainerRef = useRef(null)
  const identityContainerRef = useRef(null)
  const { isDark, toggleTheme } = useTheme()
  const { userKey, activeUser, session, signOut, isAdmin, activeTrackKey, setActiveTrackKey } =
    useCurrentUser()
  const solveDestination = useSolveDestination()
  const showNotifications = Boolean(hasSupabaseCredentials && session && userKey)
  const notifications = useNotifications(showNotifications ? userKey : '')
  const solveActive =
    location.pathname === '/solve' ||
    Boolean(matchPath('/problem/:slug', location.pathname)) ||
    Boolean(matchPath('/problem/:slug/studio', location.pathname))
  const nextTrackKey = activeTrackKey === 'sql' ? 'dsa' : 'sql'
  const nextTrackLabel = nextTrackKey === 'sql' ? 'SQL' : 'DSA'
  const NextTrackIcon = nextTrackKey === 'sql' ? Database : CircuitBoard
  const activeUserInitials = (() => {
    const label = String(activeUser?.shortLabel || activeUser?.label || activeUser?.short || '').trim()
    if (!label) {
      return ''
    }
    const parts = label.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
    }
    return label.slice(0, 2).toUpperCase()
  })()

  const handleTrackSwitch = () => {
    setNotificationsOpen(false)
    setSignOutOpen(false)
    setActiveTrackKey(nextTrackKey)

    if (solveActive && location.pathname !== '/solve') {
      navigate('/solve')
    }
  }

  return (
    <aside className="relative w-12 overflow-visible border-r border-border-subtle bg-surface">
      <div className="flex h-full flex-col items-center gap-1 py-2">
        <nav className="flex flex-col items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              aria-label={item.label}
              className={({ isActive }) => linkClassName(isActive)}
              onClick={() => {
                setNotificationsOpen(false)
                setSignOutOpen(false)
              }}
            >
              <item.Icon size={16} strokeWidth={2} />
            </NavLink>
          ))}
          <button
            type="button"
            title="Solve"
            aria-label="Solve"
            disabled={solveDestination.loading}
            onClick={() => {
              setNotificationsOpen(false)
              setSignOutOpen(false)
              navigate('/solve')
            }}
            className={[
              linkClassName(solveActive),
              solveDestination.loading ? 'cursor-wait opacity-60' : '',
            ].join(' ')}
          >
            <Braces size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleTrackSwitch}
            title={`Switch to ${nextTrackLabel}`}
            aria-label={`Switch to ${nextTrackLabel}`}
            className="group relative mt-1 inline-flex h-9 w-9 items-center justify-center border border-border-subtle bg-base text-text-primary transition-colors hover:border-accent hover:text-accent"
          >
            <NextTrackIcon size={14} strokeWidth={2} />
            <span className="pointer-events-none absolute bottom-0.5 right-0.5 font-mono text-[7px] leading-none text-text-muted transition-colors group-hover:text-accent">
              {nextTrackLabel}
            </span>
          </button>
        </nav>

        {showNotifications ? (
          <div ref={notificationsContainerRef} className="relative mt-1">
            <Motion.button
              type="button"
              onClick={() => {
                setNotificationsOpen((c) => !c)
                setSignOutOpen(false)
              }}
              title="Notifications"
              aria-label="Notifications"
              whileTap={buttonTap.whileTap}
              transition={buttonTap.transition}
              className={panelButtonClassName(notificationsOpen)}
            >
              <Bell size={16} strokeWidth={2} />
              {notifications.unreadCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              ) : null}
            </Motion.button>
            <AnimatePresence>
              {notificationsOpen ? (
                <NotificationsTray
                  open={notificationsOpen}
                  onClose={() => setNotificationsOpen(false)}
                  notificationsState={notifications}
                  containerRef={notificationsContainerRef}
                />
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1">
          <NavLink
            to="/settings"
            title="Settings"
            aria-label="Settings"
            className={({ isActive }) => linkClassName(isActive)}
            onClick={() => {
              setNotificationsOpen(false)
              setSignOutOpen(false)
            }}
          >
            <Settings size={16} strokeWidth={2} />
          </NavLink>

          {isAdmin ? (
            <NavLink
              to="/admin"
              title="Admin"
              aria-label="Admin"
              className={({ isActive }) => linkClassName(isActive)}
              onClick={() => {
                setNotificationsOpen(false)
                setSignOutOpen(false)
              }}
            >
              <Shield size={16} strokeWidth={2} />
            </NavLink>
          ) : null}

          <Motion.button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Light mode' : 'Dark mode'}
            aria-label={isDark ? 'Light mode' : 'Dark mode'}
            whileTap={buttonTap.whileTap}
            transition={buttonTap.transition}
            className={panelButtonClassName(false)}
          >
            {isDark ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
          </Motion.button>

          {activeUser ? (
            <div ref={identityContainerRef} className="group relative">
              <div
                tabIndex={0}
                title={activeUser.label}
                aria-label={`Current user: ${activeUser.label}`}
                className="inline-flex h-9 w-9 items-center justify-center border border-border-subtle font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary transition-colors hover:border-accent hover:text-accent focus:border-accent focus:text-accent focus:outline-none"
              >
                {activeUserInitials}
              </div>
              <div className="pointer-events-none absolute bottom-0 left-full z-[90] ml-2 whitespace-nowrap border border-border-subtle bg-surface px-2.5 py-1.5 text-[12px] text-text-primary opacity-0 shadow-[0_10px_40px_rgba(0,0,0,0.24)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                {activeUser.label}
              </div>
            </div>
          ) : null}

          {hasSupabaseCredentials && session ? (
            <div ref={signOutContainerRef} className="relative">
              <Motion.button
                type="button"
                onClick={() => {
                  setNotificationsOpen(false)
                  setSignOutOpen((c) => !c)
                }}
                title="Sign out"
                aria-label="Sign out"
                whileTap={buttonTap.whileTap}
                transition={buttonTap.transition}
                className={panelButtonClassName(signOutOpen)}
              >
                <LogOut size={16} strokeWidth={2} />
              </Motion.button>
              <AnimatePresence>
                {signOutOpen ? (
                  <SignOutConfirm
                    open={signOutOpen}
                    onClose={() => setSignOutOpen(false)}
                    onConfirm={() => {
                      setSignOutOpen(false)
                      void signOut()
                    }}
                    containerRef={signOutContainerRef}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
