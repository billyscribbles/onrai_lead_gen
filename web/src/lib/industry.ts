/**
 * Bundles granular Google Maps categories ("Italian restaurant", "Coffee shop",
 * "Pizza restaurant" …) into a small set of industry groups so the Industry
 * filter has a handful of meaningful options instead of dozens of near-dupes.
 *
 * Order matters: the first group whose pattern matches wins, so specific groups
 * (hospitality, beauty) come before the broad "E-commerce & Retail" catch-all — otherwise
 * "Coffee shop" / "Barber shop" would be swallowed by the bare word "shop".
 * The leading \b in each pattern means a stem like `plumb` matches "plumber" and
 * "plumbing" but not mid-word (e.g. \bcar\b avoids matching "carpet").
 */

interface Group {
  label: string
  re: RegExp
}

const GROUPS: Group[] = [
  {
    label: 'Hospitality & Tourism',
    re: /\b(restaurant|cafe|café|coffee|bakery|bakehouse|takeaway|take ?away|pizz|eatery|diner|bistro|brasserie|grill|brunch|dessert|patisser|deli|caterer|catering|juice|smoothie|sushi|ramen|noodle|bbq|steakhouse|gelato|ice cream|brewery|wine bar|\bbar\b|\bpub\b|tavern|food|hotel|motel|accommodation|hostel|resort|\btour\b|tours|tourism|travel agen)/i,
  },
  {
    label: 'Beauty & grooming',
    re: /\b(salon|barber|hairdress|hair|nail|beauty|lash|brow|wax|makeup|make ?up|tanning|cosmetic|aesthetic|\bspa\b)/i,
  },
  {
    label: 'Healthcare & Clinics',
    re: /\b(dentist|dental|doctor|clinic|physio|chiro|massage|wellness|gym|fitness|yoga|pilates|medical|pharmacy|chemist|optometr|optician|podiatr|psycholog|therap|osteo|acupunctur|health)/i,
  },
  {
    label: 'Education & Training',
    re: /\b(tutor|tuition|coaching|academy|training|educat|childcare|child ?care|kindergarten|montessori|driving school|college|institute|school)/i,
  },
  {
    label: 'Pets',
    re: /\b(veterin|\bvet\b|pet|dog|\bcat\b|grooming|kennel|cattery|aquarium)/i,
  },
  {
    label: 'Automotive & Dealerships',
    re: /\b(mechanic|auto|\bcar\b|car wash|vehicle|tyre|tire|panel beat|detailing|smash repair|automotive|dealership|car dealer)/i,
  },
  {
    label: 'Construction & Contracting',
    re: /\b(plumb|electric|builder|building|carpentr|carpenter|landscap|garden|painter|painting|roof|handyman|cleaning|cleaner|removal|locksmith|contractor|renovat|tiler|tiling|glazier|fencing|paving|concret|air ?conditioning|hvac|pest control|flooring|plaster|waterproof|solar|joinery|cabinet)/i,
  },
  {
    label: 'Real Estate & Property Management',
    re: /\b(real estate|realtor|estate agent|property manage|property manager|conveyanc|strata)/i,
  },
  {
    label: 'Legal & Consultancy',
    re: /\b(lawyer|solicitor|attorney|barrister|law firm|legal|consult)/i,
  },
  {
    label: 'Professional services',
    re: /\b(accountant|accounting|bookkeep|insurance|financ|mortgage|broker|marketing|advertis|photograph|architect|surveyor|recruit|migration agent|notary)/i,
  },
  {
    label: 'E-commerce & Retail',
    re: /\b(shop|store|boutique|florist|jewell|clothing|apparel|grocer|supermarket|market|butcher|gift|furniture|homeware|nursery|bookshop|bookstore|optic|tobacc|liquor|cellar)/i,
  },
]

const OTHER = 'Other'

/** Map one raw category to its bundled industry group. */
export function industryGroup(category: string): string {
  const c = category.trim().toLowerCase()
  if (!c) return OTHER
  for (const g of GROUPS) {
    if (g.re.test(c)) return g.label
  }
  return OTHER
}

/**
 * Distinct industry groups present across the given categories, ordered by the
 * canonical GROUPS order with "Other" last (so the dropdown reads sensibly).
 */
export function industryOptions(categories: string[]): string[] {
  const present = new Set(categories.map(industryGroup))
  const ordered = GROUPS.map((g) => g.label).filter((l) => present.has(l))
  if (present.has(OTHER)) ordered.push(OTHER)
  return ordered
}
