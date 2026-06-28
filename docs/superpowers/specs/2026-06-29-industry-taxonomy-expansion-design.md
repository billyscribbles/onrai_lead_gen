# Industry taxonomy expansion — design

**Date:** 2026-06-29
**Status:** Approved, pending implementation

## Goal

Make sure eight target industries are first-class in the lead finder, across
**both** systems that touch "industry":

1. **Search categories** (`melbourne_categories.txt`) — the `category` terms
   swept on Google Maps that actually *produce* leads.
2. **Industry grouping** (`app/industry.py` + its mirror `web/src/lib/industry.ts`)
   — how scraped leads are bucketed into the dashboard's Industry dropdown.

The eight target industries:

1. Real Estate & Property Management
2. Healthcare & Clinics
3. Construction & Contracting
4. E-commerce & Retail
5. Education & Training
6. Hospitality & Tourism
7. Legal & Consultancy
8. Automotive & Dealerships

Decision: **merge** these with the existing taxonomy rather than replace it.
Existing groups not in the eight (Beauty & grooming, Pets) are retained.

## Final taxonomy (11 groups + Other)

Order matters — `industry_group` returns the **first** group whose pattern
matches, so narrow buckets must precede broad ones. In particular Real Estate
(#8) and Legal & Consultancy (#9) sit **before** the residual Professional
services (#10) so they win the match for `real estate` / `lawyer` / `consult`.

| # | Group | Origin | Key terms (stems) |
|---|-------|--------|-------------------|
| 1 | **Hospitality & Tourism** | rename of *Food & drink* | existing food/drink stems **+** `hotel`, `motel`, `accommodation`, `hostel`, `resort`, `tour`/`tours`/`tourism`, `travel agen` |
| 2 | **Beauty & grooming** | retained as-is | salon, barber, hair, nail, beauty, lash, brow, wax, makeup, tanning, cosmetic, aesthetic, spa |
| 3 | **Healthcare & Clinics** | rename of *Health & wellness* | unchanged stems — already includes `gym`, `fitness`, `yoga`, `pilates` (fitness folds in here per decision A) |
| 4 | **Education & Training** | **NEW** | `tutor`, `tuition`, `coaching`, `academy`, `training`, `educat`, `childcare`/`child care`, `kindergarten`, `montessori`, `driving school`, `college`, `institute`, `school` |
| 5 | **Pets** | retained as-is | veterin, vet, pet, dog, cat, kennel, cattery, aquarium |
| 6 | **Automotive & Dealerships** | rename of *Automotive* | existing auto stems **+** `dealer`/`dealership` |
| 7 | **Construction & Contracting** | rename of *Trades & home services* | unchanged stems (plumb, electric, builder, landscap, etc.) |
| 8 | **Real Estate & Property Management** | **NEW** (split from Prof. services) | `real estate`, `realtor`, `estate agent`, `property manage`, `property manager`, `conveyanc`, `strata` |
| 9 | **Legal & Consultancy** | **NEW** (split from Prof. services) | `lawyer`, `solicitor`, `attorney`, `barrister`, `legal`, `consult` |
| 10 | **Professional services** | residual | `accountant`, `accounting`, `bookkeep`, `insurance`, `financ`, `mortgage`, `broker`, `marketing`, `advertis`, `photograph`, `architect`, `surveyor`, `recruit`, `migration agent`, `notary` |
| 11 | **E-commerce & Retail** | rename of *Retail & shops* | unchanged stems (shop, store, boutique, florist, etc.) |
| — | Other | catch-all | no match |

### Notes on ordering / collision safety

- Group 4 (Education) includes the bare stem `school`. It sits after Beauty (#2)
  so "old school barber" still lands in Beauty. `driving school` lands in
  Education (which precedes Automotive #6), which is intended.
- `consult` lives in Legal & Consultancy (#9), so "marketing consultant" buckets
  there rather than in Professional services — acceptable given the bucket name.
- Real estate and legal stems are **removed** from the residual Professional
  services pattern (they moved to #8 / #9).

## Search-category changes (`melbourne_categories.txt`)

Append ~11 new category lines so the new/expanded industries actually get swept.
Each line becomes one `"<category> <suburb> VIC"` Google Maps search per suburb
(47 suburbs), gated by `--max-searches`.

```
# Real estate
real estate agency
property management

# Legal / consultancy
law firm
business consultant

# Education
tutoring service
driving school
childcare centre

# Hospitality / tourism
hotel
motel
travel agency

# Automotive
car dealership
```

`real estate agency` (not `real estate agent`) deliberately targets the firm/
office listings rather than individual agents.

### Yield caveat (documented, not blocking)

Hotels, car dealerships, childcare centres, real estate agencies and law firms
**often already have a working website**, so the no-website gate in
`app/engines/no_website.py` / `web_presence.py` will filter most of them out.
These industries are expected to yield **fewer** leads than cafes/barbers. They
are still worth sweeping; this is a known trade-off, not a bug.

## Affected files

- `app/industry.py` — new `_GROUPS` list (labels, patterns, order).
- `web/src/lib/industry.ts` — **identical** taxonomy (labels, regex, order).
  These two MUST stay in sync; the file headers already say so.
- `melbourne_categories.txt` — append the new search categories.
- `tests/test_industry.py` — update expectations for renamed groups and add
  cases for the new groups (Real Estate, Legal, Education, Hospitality & Tourism,
  Automotive & Dealerships) and the ordering guarantees (real-estate/legal beat
  the residual Professional services; driving school → Education).

Out of scope: `app/db.py` already registers `industry_group` as the SQLite
`industry_group` SQL function by importing from `app/industry.py`; no change
needed there beyond the function's new return values flowing through.

## Testing

- `pytest -q tests/test_industry.py` — pure-logic grouping + the SQLite
  registration test.
- Manually eyeball `industry_options(...)` ordering: groups appear in canonical
  order with Other last.
- Frontend: no automated test today; verify by inspection that `industry.ts`
  GROUPS array matches `industry.py` `_GROUPS` label-for-label and regex-for-regex.
