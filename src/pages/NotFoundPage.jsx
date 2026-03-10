import { motion as Motion } from 'framer-motion'
import { Home, ArrowLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

export function NotFoundPage() {
  const { pathname } = useLocation()

  return (
    <section className="flex h-[100dvh] w-full items-center justify-center bg-base p-4">
      <Motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm border border-border-subtle bg-surface p-6 text-center"
      >
        <p className="font-mono text-5xl font-bold text-accent">404</p>
        <p className="mt-3 text-sm text-text-primary">Page not found</p>
        <p className="mt-1 text-[11px] text-text-muted">
          The path <span className="font-mono text-text-primary">{pathname}</span> doesn't exist.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link
            to="/"
            className="inline-flex h-8 items-center gap-1.5 border border-accent bg-accent/10 px-4 text-xs text-accent hover:bg-accent/20"
          >
            <Home size={12} />
            Dashboard
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex h-8 items-center gap-1.5 border border-border-subtle px-4 text-xs text-text-muted hover:border-accent hover:text-accent"
          >
            <ArrowLeft size={12} />
            Go back
          </button>
        </div>
      </Motion.div>
    </section>
  )
}
