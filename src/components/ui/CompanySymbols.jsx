import {
  BriefcaseBusiness,
  Landmark,
} from 'lucide-react'
import {
  FaAirbnb,
  FaAmazon,
  FaApple,
  FaAtlassian,
  FaFacebookF,
  FaGoogle,
  FaLinkedinIn,
  FaMeta,
  FaMicrosoft,
  FaPaypal,
  FaSalesforce,
  FaSnapchat,
  FaTiktok,
  FaUber,
} from 'react-icons/fa6'
import {
  SiAdyen,
  SiExpedia,
  SiBytedance,
  SiCashapp,
  SiDell,
  SiDoordash,
  SiFitbit,
  SiGoldmansachs,
  SiHubspot,
  SiIntel,
  SiIntuit,
  SiLyft,
  SiNetflix,
  SiPinterest,
  SiRobinhood,
  SiRoblox,
  SiShopify,
  SiSpotify,
  SiSquare,
  SiStripe,
  SiTarget,
  SiTwitch,
  SiUber,
  SiVerizon,
  SiVisa,
  SiX,
  SiYelp,
  SiZoho,
} from 'react-icons/si'
import activecampaignMark from '../../assets/companies/activecampaign.png'
import adobeMark from '../../assets/companies/adobe.png'
import awsMark from '../../assets/companies/aws.png'
import azureMark from '../../assets/companies/azure.png'
import bloombergMark from '../../assets/companies/bloomberg.png'
import chimeMark from '../../assets/companies/chime.png'
import creditkarmaMark from '../../assets/companies/creditkarma.png'
import cvshealthMark from '../../assets/companies/cvshealth.png'
import deshawMark from '../../assets/companies/deshaw.png'
import draftkingsMark from '../../assets/companies/draftkings.png'
import espnMark from '../../assets/companies/espn.png'
import fanduelMark from '../../assets/companies/fanduel.png'
import flipkartMark from '../../assets/companies/flipkart.png'
import jpmorganchaseMark from '../../assets/companies/jpmorganchase.png'
import mckinseyMark from '../../assets/companies/mckinsey.png'
import mercariMark from '../../assets/companies/mercari.png'
import mercuryMark from '../../assets/companies/mercury.png'
import mathworksMark from '../../assets/companies/mathworks.png'
import oracleMark from '../../assets/companies/oracle.png'
import poshmarkMark from '../../assets/companies/poshmark.png'
import unitedhealthgroupMark from '../../assets/companies/unitedhealthgroup.png'
import venmoMark from '../../assets/companies/venmo.png'
import wayfairMark from '../../assets/companies/wayfair.png'
import waymoMark from '../../assets/companies/waymo.png'

const ICON_BY_COMPANY = {
  adyen: SiAdyen,
  airbnb: FaAirbnb,
  alphabet: FaGoogle,
  amazon: FaAmazon,
  apple: FaApple,
  atlassian: FaAtlassian,
  bytedance: SiBytedance,
  'cash app': SiCashapp,
  cashapp: SiCashapp,
  dell: SiDell,
  doordash: SiDoordash,
  facebook: FaFacebookF,
  fitbit: SiFitbit,
  expedia: SiExpedia,
  'goldman sachs': SiGoldmansachs,
  google: FaGoogle,
  hubspot: SiHubspot,
  intel: SiIntel,
  intuit: SiIntuit,
  linkedin: FaLinkedinIn,
  lyft: SiLyft,
  meta: FaMeta,
  microsoft: FaMicrosoft,
  netflix: SiNetflix,
  paypal: FaPaypal,
  pinterest: SiPinterest,
  roblox: SiRoblox,
  robinhood: SiRobinhood,
  salesforce: FaSalesforce,
  shopify: SiShopify,
  snapchat: FaSnapchat,
  spotify: SiSpotify,
  square: SiSquare,
  stripe: SiStripe,
  target: SiTarget,
  tiktok: FaTiktok,
  twitch: SiTwitch,
  uber: FaUber,
  ubereats: SiUber,
  verizon: SiVerizon,
  visa: SiVisa,
  x: SiX,
  twitter: SiX,
  yelp: SiYelp,
  zoho: SiZoho,
}

const IMAGE_BY_COMPANY = {
  adobe: adobeMark,
  'active campaign': activecampaignMark,
  activecampaign: activecampaignMark,
  aws: awsMark,
  'amazon web services': awsMark,
  azure: azureMark,
  bloomberg: bloombergMark,
  chime: chimeMark,
  'credit karma': creditkarmaMark,
  creditkarma: creditkarmaMark,
  'cvs health': cvshealthMark,
  cvshealth: cvshealthMark,
  'de shaw': deshawMark,
  deshaw: deshawMark,
  draftkings: draftkingsMark,
  espn: espnMark,
  fanduel: fanduelMark,
  flipkart: flipkartMark,
  'j p morgan chase': jpmorganchaseMark,
  'jp morgan chase': jpmorganchaseMark,
  'jpmorgan chase': jpmorganchaseMark,
  jpmorganchase: jpmorganchaseMark,
  mckinsey: mckinseyMark,
  mercari: mercariMark,
  mercury: mercuryMark,
  mathworks: mathworksMark,
  oracle: oracleMark,
  poshmark: poshmarkMark,
  'unitedhealth group': unitedhealthgroupMark,
  unitedhealthgroup: unitedhealthgroupMark,
  venmo: venmoMark,
  wayfair: wayfairMark,
  waymo: waymoMark,
}

const GENERIC_ICON_BY_COMPANY = {
  'local government': Landmark,
  'data consulting': BriefcaseBusiness,
  'data consulting bc': BriefcaseBusiness,
}

function baseCompanyName(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.split('-')[0].trim()
}

function companyKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
}

function companyMonogram(name) {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return '?'
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

const SIZE_PRESETS = {
  sm: {
    iconSize: 11,
    iconContainer: 'h-5 w-5 text-[11px]',
    monogram: 'h-5 min-w-[20px] px-1 text-[10px]',
    gap: 'gap-1',
    overflow: 'text-[10px]',
  },
  md: {
    iconSize: 12,
    iconContainer: 'h-6 w-6 text-[12px]',
    monogram: 'h-6 min-w-[24px] px-1.5 text-[10px]',
    gap: 'gap-1',
    overflow: 'text-[10px]',
  },
  lg: {
    iconSize: 14,
    iconContainer: 'h-7 w-7 text-[13px]',
    monogram: 'h-7 min-w-[28px] px-1.5 text-[11px]',
    gap: 'gap-1.5',
    overflow: 'text-[11px]',
  },
  xl: {
    iconSize: 16,
    iconContainer: 'h-8 w-8 text-[14px]',
    monogram: 'h-8 min-w-[32px] px-2 text-[11px]',
    gap: 'gap-2',
    overflow: 'text-[11px]',
  },
}

function SymbolFrame({ preset, children, monogram = false }) {
  return (
    <span
      className={[
        'inline-flex items-center justify-center border border-border-subtle bg-base text-text-primary',
        monogram ? preset.monogram : preset.iconContainer,
      ].join(' ')}
    >
      {children}
    </span>
  )
}

function Tooltip({ children, align = 'center' }) {
  const alignment =
    align === 'right'
      ? 'right-0'
      : align === 'left'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2'

  return (
    <div
      className={[
        'pointer-events-none absolute top-[calc(100%+6px)] z-50 hidden whitespace-nowrap border border-border-subtle bg-surface px-2 py-1 text-[10px] text-text-primary shadow-[0_10px_24px_rgba(0,0,0,0.3)] group-hover:flex',
        alignment,
      ].join(' ')}
    >
      {children}
    </div>
  )
}

function CompanySymbol({ name, preset, showTooltip = true }) {
  const key = companyKey(name)
  const Icon = ICON_BY_COMPANY[key]
  const GenericIcon = GENERIC_ICON_BY_COMPANY[key]
  const imageSrc = IMAGE_BY_COMPANY[key]

  if (Icon) {
    return (
      <span className="group relative z-0 inline-flex hover:z-20 focus-within:z-20">
        <SymbolFrame preset={preset}>
          <Icon size={preset.iconSize} />
        </SymbolFrame>
        {showTooltip ? <Tooltip>{name}</Tooltip> : null}
      </span>
    )
  }

  if (imageSrc) {
    return (
      <span className="group relative z-0 inline-flex hover:z-20 focus-within:z-20">
        <SymbolFrame preset={preset}>
          <img src={imageSrc} alt="" className="h-[72%] w-[72%] object-contain" />
        </SymbolFrame>
        {showTooltip ? <Tooltip>{name}</Tooltip> : null}
      </span>
    )
  }

  if (GenericIcon) {
    return (
      <span className="group relative z-0 inline-flex hover:z-20 focus-within:z-20">
        <SymbolFrame preset={preset}>
          <GenericIcon size={preset.iconSize} />
        </SymbolFrame>
        {showTooltip ? <Tooltip>{name}</Tooltip> : null}
      </span>
    )
  }

  return (
    <span className="group relative z-0 inline-flex hover:z-20 focus-within:z-20">
      <SymbolFrame preset={preset} monogram>
        <span className="font-mono text-text-muted">{companyMonogram(name)}</span>
      </SymbolFrame>
      {showTooltip ? <Tooltip>{name}</Tooltip> : null}
    </span>
  )
}

export function CompanySymbols({ companies, max = 6, size = 'sm' }) {
  const preset = SIZE_PRESETS[size] || SIZE_PRESETS.sm
  const names = Array.from(
    new Set(
      (Array.isArray(companies) ? companies : [])
        .map(baseCompanyName)
        .filter((name) => name.length > 0),
    ),
  )

  if (names.length === 0) {
    return <span className="text-text-muted">-</span>
  }

  const visible = names.slice(0, max)
  const hidden = names.slice(max)

  return (
    <div className={['isolate flex items-center', preset.gap].join(' ')}>
      {visible.map((name) => (
        <CompanySymbol key={name} name={name} preset={preset} />
      ))}
      {hidden.length > 0 ? (
        <span className="group relative z-0 inline-flex hover:z-20 focus-within:z-20">
          <SymbolFrame preset={preset} monogram>
            <span className={['font-mono text-text-muted', preset.overflow].join(' ')}>+{hidden.length}</span>
          </SymbolFrame>
          <div className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-50 hidden min-w-[168px] flex-col gap-1 border border-border-subtle bg-surface p-2 shadow-[0_10px_24px_rgba(0,0,0,0.3)] group-hover:flex">
            {hidden.map((name) => (
              <div key={`hidden-${name}`} className="flex items-center gap-2 text-[10px] text-text-primary">
                <CompanySymbol name={name} preset={preset} showTooltip={false} />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </span>
      ) : null}
    </div>
  )
}
