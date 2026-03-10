export function StatusDot({ status = 'unsolved', className = '' }) {
  const baseClass = `relative inline-flex h-2.5 w-2.5 overflow-hidden rounded-full border border-text-muted/70 ${className}`

  if (status === 'solved') {
    return <span className={baseClass}><span className="absolute inset-0 bg-accent" /></span>
  }

  if (status === 'attempted') {
    return <span className={baseClass}><span className="absolute inset-y-0 left-0 w-1/2 bg-accent" /></span>
  }

  if (status === 'review') {
    return (
      <span className={baseClass}>
        <span className="absolute inset-[2px] rounded-full bg-text-primary" />
      </span>
    )
  }

  return <span className={baseClass} />
}
