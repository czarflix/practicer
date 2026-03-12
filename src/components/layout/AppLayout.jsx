import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import {
  problemsQueryOptions,
  progressQueryOptions,
  targetsQueryOptions,
} from '../../lib/supabase-queries'
import { hasSupabaseCredentials } from '../../lib/supabase'
import { useCurrentUser } from '../../context/user-store'
import { problemUrl } from '../../lib/problem-utils'
import { DashboardPage } from '../../pages/DashboardPage'
import { LoginPage } from '../../pages/LoginPage'
import { NotFoundPage } from '../../pages/NotFoundPage'
import { ProblemDetailPage } from '../../pages/ProblemDetailPage'
import { ProblemsPage } from '../../pages/ProblemsPage'
import { SettingsPage } from '../../pages/SettingsPage'
import { AdminPage } from '../../pages/AdminPage'
import { useSolveDestination } from '../../hooks/useSolveDestination'
import { FloatingAssistantWindow } from '../assistant/FloatingAssistantWindow'
import { Sidebar } from './Sidebar'

function StudioRedirect() {
  const { slug } = useParams()
  return <Navigate to={`/problem/${slug}`} replace />
}

function SolveRedirect() {
  const destination = useSolveDestination()

  if (destination.loading) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center border border-border-subtle bg-surface">
        <p className="font-mono text-[11px] text-text-muted">Resolving next problem…</p>
      </div>
    )
  }

  return <Navigate to={destination.problem ? problemUrl(destination.problem) : '/problems'} replace />
}

export function AppLayout() {
  const queryClient = useQueryClient()
  const { userKey, session, authLoading, isAdmin, activeTrackKey } = useCurrentUser()

  useEffect(() => {
    if (!userKey) return
    void queryClient.prefetchQuery(problemsQueryOptions())
    void queryClient.prefetchQuery(progressQueryOptions(userKey))
    void queryClient.prefetchQuery(targetsQueryOptions(true, userKey, activeTrackKey))
  }, [activeTrackKey, queryClient, userKey])

  // In auth mode: show loading spinner until initial session resolved
  if (hasSupabaseCredentials && authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-base">
        <p className="font-mono text-xs text-text-muted">Loading...</p>
      </div>
    )
  }

  // In auth mode: no session → show login page
  if (hasSupabaseCredentials && !session) {
    return <LoginPage />
  }

  // In auth mode: session exists but no mapped userKey → account not linked
  if (hasSupabaseCredentials && session && !userKey) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-base">
        <div className="max-w-sm border border-border-subtle bg-surface p-6 text-sm text-text-primary">
          <p className="font-semibold">Account not linked</p>
          <p className="mt-2 text-text-muted">
            Your auth account is not mapped to an app user yet. Ask an admin to run:
          </p>
          <pre className="mt-3 overflow-x-auto border border-border-subtle bg-base p-2 font-mono text-[11px] text-text-primary">
            {`UPDATE app_users\nSET auth_user_id = '<your-uuid>'\nWHERE user_key = 'AYAAN';`}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-base text-text-primary">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/problems" element={<ProblemsPage />} />
          <Route path="/solve" element={<SolveRedirect />} />
          <Route path="/problem/:slug" element={<ProblemDetailPage />} />
          <Route path="/problem/:slug/studio" element={<StudioRedirect />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="/problem-admin" element={<Navigate to={isAdmin ? '/admin' : '/'} replace />} />
          <Route path="/phases" element={<Navigate to="/problems" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <FloatingAssistantWindow />
    </div>
  )
}
