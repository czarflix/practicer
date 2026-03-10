import { useState } from 'react'
import { motion as Motion } from 'framer-motion'
import { ArrowRight, Blocks, Database, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { pageReveal, sectionReveal, staggerContainer } from '../lib/motion'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!supabase) return

    setLoading(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError(signInError.message)
    }
    // On success, onAuthStateChange in UserContext will update state automatically.
    setLoading(false)
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-base px-4 py-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage: `
            radial-gradient(circle at 18% 22%, rgba(20,184,166,0.15), transparent 30%),
            radial-gradient(circle at 82% 18%, rgba(255,255,255,0.06), transparent 24%),
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: 'auto, auto, 28px 28px, 28px 28px',
          backgroundPosition: 'center, center, center, center',
        }}
      />

      <Motion.div
        variants={pageReveal}
        initial="hidden"
        animate="visible"
        className="relative grid w-full max-w-[980px] overflow-hidden border border-border-subtle bg-surface/95 shadow-[0_20px_80px_rgba(0,0,0,0.34)] backdrop-blur-sm lg:grid-cols-[1.12fr_0.88fr]"
      >
        <Motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="flex flex-col justify-between border-b border-border-subtle p-6 sm:p-8 lg:border-b-0 lg:border-r"
        >
          <Motion.div variants={sectionReveal} className="space-y-5">
            <img
              src="/practicer-logo.svg"
              alt="Practicer"
              className="h-10 w-auto sm:h-11"
            />
            <div className="max-w-[460px] space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
                Practicer
              </p>
              <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-text-primary sm:text-[36px]">
                Practice DSA and SQL in one place.
              </h1>
              <p className="max-w-[40ch] text-[15px] leading-7 text-text-muted sm:text-[16px]">
                Verified problems, compact tooling, and a workspace built to stay out of the way.
              </p>
            </div>
          </Motion.div>

          <Motion.div
            variants={sectionReveal}
            className="mt-8 grid gap-3 sm:grid-cols-3"
          >
            <div className="border border-border-subtle bg-base/50 p-3">
              <div className="mb-2 inline-flex h-8 w-8 items-center justify-center border border-border-subtle bg-surface text-accent">
                <Blocks size={16} />
              </div>
              <p className="text-sm font-medium text-text-primary">One workspace</p>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">DSA and SQL stay in the same workflow.</p>
            </div>
            <div className="border border-border-subtle bg-base/50 p-3">
              <div className="mb-2 inline-flex h-8 w-8 items-center justify-center border border-border-subtle bg-surface text-accent">
                <Database size={16} />
              </div>
              <p className="text-sm font-medium text-text-primary">Verified data</p>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">Problems and datasets are checked before they land.</p>
            </div>
            <div className="border border-border-subtle bg-base/50 p-3">
              <div className="mb-2 inline-flex h-8 w-8 items-center justify-center border border-border-subtle bg-surface text-accent">
                <Sparkles size={16} />
              </div>
              <p className="text-sm font-medium text-text-primary">Low noise</p>
              <p className="mt-1 text-[12px] leading-5 text-text-muted">Lean UI, stable defaults, less friction.</p>
            </div>
          </Motion.div>
        </Motion.div>

        <Motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="flex items-center bg-surface p-6 sm:p-8"
        >
          <div className="w-full max-w-[380px] space-y-6">
            <Motion.div variants={sectionReveal} className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
                Account
              </p>
              <h2 className="text-[26px] font-semibold tracking-[-0.04em] text-text-primary">
                Sign in
              </h2>
              <p className="text-sm leading-6 text-text-muted">
                Use your mapped account to continue into the workspace.
              </p>
            </Motion.div>

            <Motion.form variants={sectionReveal} onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="you@example.com"
                  className="h-11 w-full border border-border-subtle bg-base px-3 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-60"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="Password"
                  className="h-11 w-full border border-border-subtle bg-base px-3 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-60"
                />
              </div>
              {error ? (
                <p className="border border-accent/40 bg-accent/8 px-3 py-2 text-[12px] leading-5 text-accent">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={loading}
                className="group flex h-11 w-full items-center justify-center gap-2 border border-accent bg-accent/10 text-sm font-medium text-accent hover:bg-accent/18 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loading ? 'Signing in...' : 'Enter Practicer'}</span>
                {!loading ? <ArrowRight size={15} className="transition-transform duration-150 group-hover:translate-x-0.5" /> : null}
              </button>
            </Motion.form>
          </div>
        </Motion.div>
      </Motion.div>
    </div>
  )
}
