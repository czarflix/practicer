import { X } from 'lucide-react'

export function Modal({ open, title, onClose, children, widthClass = 'max-w-3xl' }) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/85 p-4 md:p-8" onClick={onClose}>
      <div
        className={`w-full ${widthClass} border border-border-subtle bg-surface`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center border border-border-subtle text-text-muted hover:border-accent hover:text-accent"
          >
            <X size={14} />
          </button>
        </header>
        <div className="max-h-[78vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
