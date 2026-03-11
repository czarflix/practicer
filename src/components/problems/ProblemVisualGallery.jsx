import { useMemo, useState } from 'react'
import { Expand } from 'lucide-react'
import { extractProblemVisuals } from '../../lib/problem-visuals'
import { Modal } from '../ui/Modal'

export function ProblemVisualGallery({ presentation, section, title = 'Visual' }) {
  const visuals = useMemo(() => extractProblemVisuals(presentation, section), [presentation, section])
  const [activeId, setActiveId] = useState('')

  const activeVisual = visuals.find((visual) => visual.id === activeId) ?? null

  if (visuals.length === 0) {
    return null
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{title}</p>
        <div className="space-y-3">
          {visuals.map((visual) => (
            <figure key={visual.id} className="overflow-hidden border border-border-subtle bg-surface">
              <button
                type="button"
                onClick={() => setActiveId(visual.id)}
                className="group relative block w-full overflow-hidden bg-white"
              >
                <img
                  src={visual.public_url}
                  alt={visual.alt || visual.caption || 'Problem visual'}
                  loading="lazy"
                  className="h-auto w-full object-contain"
                />
                <span className="pointer-events-none absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center border border-border-subtle bg-surface/90 text-text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  <Expand size={13} />
                </span>
              </button>
              {visual.caption ? (
                <figcaption className="border-t border-border-subtle px-3 py-2 text-[12px] leading-6 text-text-primary">
                  {visual.caption}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      </div>

      <Modal
        open={Boolean(activeVisual)}
        title={activeVisual?.caption || activeVisual?.alt || 'Problem visual'}
        onClose={() => setActiveId('')}
        widthClass="max-w-6xl"
      >
        {activeVisual ? (
          <div className="space-y-3">
            <div className="overflow-hidden border border-border-subtle bg-white">
              <img
                src={activeVisual.public_url}
                alt={activeVisual.alt || activeVisual.caption || 'Problem visual'}
                className="h-auto w-full object-contain"
              />
            </div>
            {activeVisual.caption ? (
              <p className="text-sm leading-6 text-text-primary">{activeVisual.caption}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
