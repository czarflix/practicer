import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * CustomSelect — drop-in replacement for <select>.
 *
 * @param {Object}   props
 * @param {string}   props.value       Current value
 * @param {Function} props.onChange     Callback(newValue)
 * @param {Array}    props.options      [{ value, label }]
 * @param {boolean}  [props.disabled]
 * @param {string}   [props.className]  Extra classes on the trigger button
 * @param {string}   [props.placeholder] Text when value is empty
 */
export function CustomSelect({
  value,
  onChange,
  options = [],
  disabled = false,
  className = '',
  placeholder = 'Select…',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? placeholder

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((c) => !c)}
        className={[
          'flex h-8 w-full items-center justify-between gap-1 border px-2 text-xs outline-none transition-colors',
          open ? 'border-accent' : 'border-border-subtle',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'hover:border-accent',
          'bg-base text-text-primary',
        ].join(' ')}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={12}
          className={[
            'shrink-0 text-text-muted transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-0.5 max-h-[200px] w-full overflow-y-auto border border-border-subtle bg-surface shadow-[0_6px_20px_rgba(0,0,0,0.2)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={[
                'flex w-full items-center px-3 py-2 text-left text-xs transition-colors',
                option.value === value
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-primary hover:bg-elevated hover:text-accent',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
