import type { Lead } from '../types'
import { compact, platformLabel, telHref } from '../lib/format'
import { MapPin, Phone, Search, SocialIcon, Star } from './Icons'

interface Props {
  lead: Lead
  rank: number
  onSelect: (lead: Lead) => void
}

export function LeadRow({ lead, rank, onSelect }: Props) {
  return (
    <article
      className={`row row--t${lead.tier}`}
      onClick={() => onSelect(lead)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(lead)
        }
      }}
    >
      <span className="row__rank">{String(rank).padStart(2, '0')}</span>

      <div className="row__id">
        <h3 className="row__name">{lead.name}</h3>
        <p className="row__meta">
          {lead.category}
          {lead.suburb && <span className="row__dot">·</span>}
          {lead.suburb}
        </p>
      </div>

      <span className={`tag tag--t${lead.tier}`}>{lead.tierLabel}</span>

      <div className="row__data">
        {lead.rating !== null && (
          <span className="row__rating">
            <Star className="row__star" />
            {lead.rating.toFixed(1)}
          </span>
        )}
        <span className="row__reviews">{compact(lead.reviews)} reviews</span>
      </div>

      <div className="row__reach">
        {lead.hasPhone && (
          <span className="chip chip--phone" title={lead.phone}>
            <Phone />
            Phone
          </span>
        )}
        {lead.social && (
          <span className="chip chip--social" title={lead.website}>
            <SocialIcon platform={lead.social} />
            {platformLabel(lead.social)}
          </span>
        )}
      </div>

      <div className="row__heat" title={`Heat ${lead.heat}/100`}>
        <span className="row__heat-track">
          <span
            className="row__heat-mask"
            style={{ width: `${100 - lead.heat}%` }}
          />
        </span>
        <span className="row__heat-num">{lead.heat}</span>
      </div>

      <div className="row__actions" onClick={(e) => e.stopPropagation()}>
        {lead.hasPhone && (
          <a className="iconbtn" href={telHref(lead.phone)} title="Call" aria-label={`Call ${lead.name}`}>
            <Phone />
          </a>
        )}
        {lead.website && (
          <a className="iconbtn" href={lead.website} target="_blank" rel="noreferrer" title="Open social" aria-label="Open social profile">
            <SocialIcon platform={lead.social} />
          </a>
        )}
        {lead.mapsUrl && (
          <a className="iconbtn" href={lead.mapsUrl} target="_blank" rel="noreferrer" title="Google Maps" aria-label="Open in Google Maps">
            <MapPin />
          </a>
        )}
        {lead.searchUrl && (
          <a className="iconbtn" href={lead.searchUrl} target="_blank" rel="noreferrer" title="Google Search" aria-label="Search on Google">
            <Search />
          </a>
        )}
      </div>
    </article>
  )
}
