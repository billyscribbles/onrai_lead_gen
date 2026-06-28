import type { Lead, UserStatus } from '../types'
import { compact, platformLabel, telHref } from '../lib/format'
import { Archive, Close, MapPin, Phone, Search, SocialIcon, Star } from './Icons'

interface Props {
  lead: Lead | null
  onClose: () => void
  onSetStatus: (dbId: number, status: UserStatus) => void
}

export function LeadDrawer({ lead, onClose, onSetStatus }: Props) {
  return (
    <>
      <div
        className={`scrim ${lead ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`drawer ${lead ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={lead ? `${lead.name} details` : 'Lead details'}
      >
        {lead && (
          <div className="drawer__inner">
            <button className="drawer__close" onClick={onClose} aria-label="Close">
              <Close />
            </button>

            <div className="drawer__status">
              <button
                type="button"
                className={`iconbtn ${lead.userStatus === 'favourite' ? 'is-fav' : ''}`}
                aria-pressed={lead.userStatus === 'favourite'}
                onClick={() =>
                  onSetStatus(
                    lead.dbId,
                    lead.userStatus === 'favourite' ? 'normal' : 'favourite',
                  )
                }
              >
                <Star /> {lead.userStatus === 'favourite' ? 'Favourited' : 'Favourite'}
              </button>
              <button
                type="button"
                className={`iconbtn ${lead.userStatus === 'archived' ? 'is-arch' : ''}`}
                aria-pressed={lead.userStatus === 'archived'}
                onClick={() =>
                  onSetStatus(
                    lead.dbId,
                    lead.userStatus === 'archived' ? 'normal' : 'archived',
                  )
                }
              >
                <Archive /> {lead.userStatus === 'archived' ? 'Archived' : 'Archive'}
              </button>
            </div>

            <span className={`tag tag--t${lead.tier}`}>{lead.tierLabel}</span>
            <h2 className="drawer__name">{lead.name}</h2>
            <p className="drawer__meta">
              {lead.category}
              {lead.suburb && ` · ${lead.suburb}`}
            </p>

            <div className="drawer__stats">
              <div>
                <span className="drawer__stat-num">
                  {lead.rating !== null ? (
                    <>
                      <Star className="drawer__star" />
                      {lead.rating.toFixed(1)}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="drawer__stat-lbl">Rating</span>
              </div>
              <div>
                <span className="drawer__stat-num">{compact(lead.reviews)}</span>
                <span className="drawer__stat-lbl">Reviews</span>
              </div>
              <div>
                <span className="drawer__stat-num">{lead.heat}</span>
                <span className="drawer__stat-lbl">Heat</span>
              </div>
            </div>

            <p className="drawer__pitch">{whyPitch(lead)}</p>

            {lead.address && (
              <div className="drawer__field">
                <span className="drawer__field-lbl">Address</span>
                <span>{lead.address}</span>
              </div>
            )}
            {lead.phone && (
              <div className="drawer__field">
                <span className="drawer__field-lbl">Phone</span>
                <span className="mono">{lead.phone}</span>
              </div>
            )}
            {lead.website && (
              <div className="drawer__field">
                <span className="drawer__field-lbl">
                  {platformLabel(lead.social) || 'Link'}
                </span>
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noreferrer"
                  className="drawer__link"
                >
                  {lead.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}

            <div className="drawer__actions">
              {lead.hasPhone && (
                <a className="btn btn--primary" href={telHref(lead.phone)}>
                  <Phone /> Call now
                </a>
              )}
              {lead.website && (
                <a className="btn" href={lead.website} target="_blank" rel="noreferrer">
                  <SocialIcon platform={lead.social} /> Message on{' '}
                  {platformLabel(lead.social)}
                </a>
              )}
              {lead.mapsUrl && (
                <a className="btn" href={lead.mapsUrl} target="_blank" rel="noreferrer">
                  <MapPin /> Maps
                </a>
              )}
              {lead.searchUrl && (
                <a className="btn" href={lead.searchUrl} target="_blank" rel="noreferrer">
                  <Search /> Google
                </a>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

function whyPitch(lead: Lead): string {
  const proof =
    lead.reviews >= 500
      ? `${compact(lead.reviews)} Google reviews`
      : `${lead.reviews} reviews`
  if (lead.webStatus === 'social_only') {
    return `Established on ${platformLabel(lead.social) || 'social'} with ${proof} but no website — they already invest in being found and will feel the gap. ${
      lead.hasPhone ? 'Phone on the listing makes outreach trivial.' : 'Reach them via DM.'
    }`
  }
  if (lead.webStatus === 'none') {
    return `Real going concern with ${proof} and no website at all — a clean, obvious gap to pitch. ${
      lead.hasPhone ? 'Call straight off the listing.' : 'Reach via their listing.'
    }`
  }
  return `${proof}. Web presence flagged as a redesign candidate — verify the current site before pitching.`
}
