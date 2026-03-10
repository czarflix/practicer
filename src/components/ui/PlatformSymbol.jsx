import { Globe2 } from 'lucide-react'
import { SiHackerrank, SiLeetcode, SiMedium } from 'react-icons/si'
import datalemurMark from '../../assets/platforms/datalemur.png'
import interviewqueryMark from '../../assets/platforms/interviewquery.png'
import stratascratchMark from '../../assets/platforms/stratascratch.svg'

function normalizePlatform(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

const PLATFORM_ICON_MAP = {
  leetcode: { type: 'icon', component: SiLeetcode, brandClass: 'text-[#ffa116]' },
  hackerrank: { type: 'icon', component: SiHackerrank, brandClass: 'text-[#2ec866]' },
  'medium/assorted': { type: 'icon', component: SiMedium, brandClass: 'text-text-primary' },
  medium: { type: 'icon', component: SiMedium, brandClass: 'text-text-primary' },
  datalemur: { type: 'image', src: datalemurMark },
  interviewquery: { type: 'image', src: interviewqueryMark },
  stratascratch: { type: 'image', src: stratascratchMark },
}

const SIZE_PRESETS = {
  sm: {
    frame: 'h-6 w-6',
    icon: 12,
    image: 'h-3.5 w-3.5',
  },
  md: {
    frame: 'h-7 w-7',
    icon: 14,
    image: 'h-4 w-4',
  },
}

function SymbolInner({ platform, size }) {
  const preset = SIZE_PRESETS[size] || SIZE_PRESETS.sm
  const normalized = normalizePlatform(platform)
  const descriptor = PLATFORM_ICON_MAP[normalized]

  if (descriptor?.type === 'icon') {
    const Icon = descriptor.component
    return <Icon size={preset.icon} className={descriptor.brandClass} />
  }

  if (descriptor?.type === 'image') {
    return <img src={descriptor.src} alt="" className={`${preset.image} object-contain`} />
  }

  return <Globe2 size={preset.icon} className="text-text-muted" />
}

export function PlatformSymbol({
  platform,
  href = '',
  size = 'sm',
  className = '',
  bare = false,
}) {
  const preset = SIZE_PRESETS[size] || SIZE_PRESETS.sm
  const frameClass = [
    bare
      ? 'inline-flex items-center justify-center text-text-primary transition-colors'
      : 'inline-flex items-center justify-center border border-border-subtle bg-base text-text-primary transition-colors',
    href && !bare ? 'hover:border-accent hover:bg-elevated' : '',
    href && bare ? 'hover:text-accent' : '',
    preset.frame,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const label = platform || 'Source'

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        className={frameClass}
      >
        <SymbolInner platform={platform} size={size} />
      </a>
    )
  }

  return (
    <span aria-label={label} className={frameClass}>
      <SymbolInner platform={platform} size={size} />
    </span>
  )
}
