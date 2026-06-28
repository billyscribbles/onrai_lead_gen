# Industry Taxonomy Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the industry taxonomy to 11 merged groups (adding Real Estate, Legal & Consultancy, Education & Training; renaming several) across both the Python grouping, its TypeScript mirror, and add the matching Google Maps search categories.

**Architecture:** Three coordinated edits to pure-logic/data files. `app/industry.py` holds the canonical `_GROUPS` ordered list of (label, compiled regex); `web/src/lib/industry.ts` is a hand-kept identical mirror that drives the dashboard dropdown; `melbourne_categories.txt` is the newline-delimited list of search terms swept on Google Maps. No network, no schema changes.

**Tech Stack:** Python 3 + `re` (pytest), TypeScript/React (tsc build), plain-text data file.

## Global Constraints

- `app/industry.py` and `web/src/lib/industry.ts` MUST stay in sync — identical labels, identical regex alternations, identical order. The file headers already state this.
- Group order is significant: `industry_group` / `industryGroup` return the **first** matching group. Narrow groups MUST precede broad ones. Specifically Real Estate (#8) and Legal & Consultancy (#9) MUST precede the residual Professional services (#10); Beauty (#2) precedes Education (#4); all specific groups precede E-commerce & Retail (#11).
- Final group order and labels (verbatim):
  1. `Hospitality & Tourism`
  2. `Beauty & grooming`
  3. `Healthcare & Clinics`
  4. `Education & Training`
  5. `Pets`
  6. `Automotive & Dealerships`
  7. `Construction & Contracting`
  8. `Real Estate & Property Management`
  9. `Legal & Consultancy`
  10. `Professional services`
  11. `E-commerce & Retail`
  - plus `Other` (catch-all, always last).

---

### Task 1: Rewrite the Python industry taxonomy

**Files:**
- Modify: `app/industry.py` (replace the `_GROUPS` list, lines 17-50)
- Test: `tests/test_industry.py` (replace renamed-group expectations, add new-group cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `industry_group(category: str) -> str` and `industry_options(categories) -> list[str]` returning the new 11 labels above. `app/db.py` already registers `industry_group` as the SQLite `industry_group()` SQL function via import — unchanged.

- [ ] **Step 1: Rewrite the tests to expect the new taxonomy**

Replace the body of `tests/test_industry.py` (keep the module docstring and imports) with:

```python
def test_hospitality_group():
    assert industry_group("Coffee shop") == "Hospitality & Tourism"
    assert industry_group("Italian restaurant") == "Hospitality & Tourism"
    assert industry_group("Hotel") == "Hospitality & Tourism"
    assert industry_group("Travel agency") == "Hospitality & Tourism"


def test_beauty_before_retail_catchall():
    # "Barber shop" must land in Beauty, not be swallowed by the "shop" catch-all.
    assert industry_group("Barber shop") == "Beauty & grooming"


def test_healthcare_includes_fitness():
    assert industry_group("Dentist") == "Healthcare & Clinics"
    assert industry_group("Gym") == "Healthcare & Clinics"
    assert industry_group("Yoga studio") == "Healthcare & Clinics"


def test_education_group():
    assert industry_group("Tutoring service") == "Education & Training"
    assert industry_group("Driving school") == "Education & Training"
    assert industry_group("Childcare centre") == "Education & Training"


def test_automotive_includes_dealership():
    assert industry_group("Car dealership") == "Automotive & Dealerships"
    assert industry_group("Mechanic") == "Automotive & Dealerships"


def test_construction_group():
    assert industry_group("Plumber") == "Construction & Contracting"
    assert industry_group("Electrician") == "Construction & Contracting"


def test_real_estate_group():
    assert industry_group("Real estate agency") == "Real Estate & Property Management"
    assert industry_group("Property management company") == "Real Estate & Property Management"


def test_legal_and_consultancy_group():
    assert industry_group("Law firm") == "Legal & Consultancy"
    assert industry_group("Solicitor") == "Legal & Consultancy"
    assert industry_group("Business consultant") == "Legal & Consultancy"


def test_real_estate_and_legal_beat_residual_professional_services():
    # Real Estate (#8) and Legal (#9) must win over the residual Professional
    # services bucket (#10), which now holds accounting/finance/marketing/etc.
    assert industry_group("Real estate agency") != "Professional services"
    assert industry_group("Law firm") != "Professional services"
    assert industry_group("Accountant") == "Professional services"
    assert industry_group("Marketing agency") == "Professional services"


def test_retail_catchall():
    assert industry_group("Gift store") == "E-commerce & Retail"


def test_blank_and_unknown_are_other():
    assert industry_group("") == "Other"
    assert industry_group("   ") == "Other"
    assert industry_group("Wizarding supplies") == "Other"


def test_options_ordered_with_other_last():
    opts = industry_options(["Gift store", "Cafe", "Wizarding supplies", "Barber"])
    assert opts == [
        "Hospitality & Tourism",
        "Beauty & grooming",
        "E-commerce & Retail",
        "Other",
    ]


def test_industry_group_registered_as_sql_function(tmp_path):
    conn = db.connect(str(tmp_path / "leads.db"))
    db.init_db(conn)
    row = conn.execute("SELECT industry_group(?) AS g", ("Coffee shop",)).fetchone()
    assert row["g"] == "Hospitality & Tourism"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/billyhuynh/Github/onrai_lead_gen && python -m pytest tests/test_industry.py -q`
Expected: FAIL — e.g. `assert 'Food & drink' == 'Hospitality & Tourism'` (old labels still returned).

- [ ] **Step 3: Replace the `_GROUPS` list in `app/industry.py`**

Replace lines 17-50 (the entire `_GROUPS: list[...] = [ ... ]` block) with:

```python
_GROUPS: list[tuple[str, re.Pattern]] = [
    ("Hospitality & Tourism", re.compile(
        r"\b(restaurant|cafe|café|coffee|bakery|bakehouse|takeaway|take ?away|"
        r"pizz|eatery|diner|bistro|brasserie|grill|brunch|dessert|patisser|deli|"
        r"caterer|catering|juice|smoothie|sushi|ramen|noodle|bbq|steakhouse|gelato|"
        r"ice cream|brewery|wine bar|\bbar\b|\bpub\b|tavern|food|"
        r"hotel|motel|accommodation|hostel|resort|\btour\b|tours|tourism|"
        r"travel agen)", re.I)),
    ("Beauty & grooming", re.compile(
        r"\b(salon|barber|hairdress|hair|nail|beauty|lash|brow|wax|makeup|make ?up|"
        r"tanning|cosmetic|aesthetic|\bspa\b)", re.I)),
    ("Healthcare & Clinics", re.compile(
        r"\b(dentist|dental|doctor|clinic|physio|chiro|massage|wellness|gym|fitness|"
        r"yoga|pilates|medical|pharmacy|chemist|optometr|optician|podiatr|psycholog|"
        r"therap|osteo|acupunctur|health)", re.I)),
    ("Education & Training", re.compile(
        r"\b(tutor|tuition|coaching|academy|training|educat|childcare|child ?care|"
        r"kindergarten|montessori|driving school|college|institute|school)", re.I)),
    ("Pets", re.compile(
        r"\b(veterin|\bvet\b|pet|dog|\bcat\b|grooming|kennel|cattery|aquarium)", re.I)),
    ("Automotive & Dealerships", re.compile(
        r"\b(mechanic|auto|\bcar\b|car wash|vehicle|tyre|tire|panel beat|detailing|"
        r"smash repair|automotive|dealership|car dealer)", re.I)),
    ("Construction & Contracting", re.compile(
        r"\b(plumb|electric|builder|building|carpentr|carpenter|landscap|garden|"
        r"painter|painting|roof|handyman|cleaning|cleaner|removal|locksmith|"
        r"contractor|renovat|tiler|tiling|glazier|fencing|paving|concret|"
        r"air ?conditioning|hvac|pest control|flooring|plaster|waterproof|solar|"
        r"joinery|cabinet)", re.I)),
    ("Real Estate & Property Management", re.compile(
        r"\b(real estate|realtor|estate agent|property manage|property manager|"
        r"conveyanc|strata)", re.I)),
    ("Legal & Consultancy", re.compile(
        r"\b(lawyer|solicitor|attorney|barrister|law firm|legal|consult)", re.I)),
    ("Professional services", re.compile(
        r"\b(accountant|accounting|bookkeep|insurance|financ|mortgage|broker|"
        r"marketing|advertis|photograph|architect|surveyor|recruit|migration agent|"
        r"notary)", re.I)),
    ("E-commerce & Retail", re.compile(
        r"\b(shop|store|boutique|florist|jewell|clothing|apparel|grocer|supermarket|"
        r"market|butcher|gift|furniture|homeware|nursery|bookshop|bookstore|optic|"
        r"tobacc|liquor|cellar)", re.I)),
]
```

Also update the module docstring's parenthetical example (line 9-10) so it names current groups: change `(food, beauty)` references if present to stay accurate — replace the sentence "specific groups (food, beauty) come before the broad "Retail & shops" catch-all" with "specific groups (hospitality, beauty) come before the broad "E-commerce & Retail" catch-all". Make the same wording fix in the `Order matters:` comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/billyhuynh/Github/onrai_lead_gen && python -m pytest tests/test_industry.py -q`
Expected: PASS (all tests green).

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `cd /Users/billyhuynh/Github/onrai_lead_gen && python -m pytest -q`
Expected: PASS. (If another test hard-codes an old label like "Food & drink", update that expectation to the new label — these are the only consumers.)

- [ ] **Step 6: Commit**

```bash
cd /Users/billyhuynh/Github/onrai_lead_gen
git add app/industry.py tests/test_industry.py
git commit -m "feat(industry): expand Python taxonomy to 11 merged groups"
```

---

### Task 2: Mirror the taxonomy in TypeScript

**Files:**
- Modify: `web/src/lib/industry.ts` (replace the `GROUPS` array)

**Interfaces:**
- Consumes: the canonical labels/order/regex from Task 1.
- Produces: `industryGroup(category) -> string`, `industryOptions(categories) -> string[]` returning the identical 11 labels. Consumed by the dashboard Industry dropdown.

- [ ] **Step 1: Replace the `GROUPS` array in `web/src/lib/industry.ts`**

Replace the `const GROUPS: Group[] = [ ... ]` block with the identical taxonomy (same labels, same regex alternations, same order as Task 1):

```ts
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
```

Also update the doc-comment example wording: replace "(food, beauty) come before the broad "Retail & shops" catch-all" with "(hospitality, beauty) come before the broad "E-commerce & Retail" catch-all".

- [ ] **Step 2: Type-check / build the web app to verify the edit compiles**

Run: `cd /Users/billyhuynh/Github/onrai_lead_gen/web && npm run build`
Expected: build succeeds (tsc + vite), no type errors.

- [ ] **Step 3: Verify the mirror matches Python label-for-label**

Run: `cd /Users/billyhuynh/Github/onrai_lead_gen && python - <<'PY'
import re
from app.industry import GROUP_LABELS
ts = open('web/src/lib/industry.ts').read()
ts_labels = re.findall(r"label: '([^']+)'", ts)
assert ts_labels == GROUP_LABELS, f"MISMATCH\n py={GROUP_LABELS}\n ts={ts_labels}"
print("labels in sync:", ts_labels)
PY`
Expected: prints `labels in sync: [...]` with all 11 labels in order (no assertion error).

- [ ] **Step 4: Commit**

```bash
cd /Users/billyhuynh/Github/onrai_lead_gen
git add web/src/lib/industry.ts
git commit -m "feat(web): mirror expanded industry taxonomy in industry.ts"
```

---

### Task 3: Add the new Google Maps search categories

**Files:**
- Modify: `melbourne_categories.txt` (append new category lines)

**Interfaces:**
- Consumes: nothing. The file is read by `scrape_no_website.py` via `web_presence.parse_suburb_lines`, one `category` per non-comment line; each becomes `"<category> <suburb> VIC"` searches.
- Produces: 11 additional sweep categories.

- [ ] **Step 1: Append the new categories**

Append these lines to the end of `melbourne_categories.txt` (after the existing `homewares` line):

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

(`real estate agency`, not `real estate agent` — targets firms, not individual agents.)

- [ ] **Step 2: Verify the file parses and the category count increased**

Run: `cd /Users/billyhuynh/Github/onrai_lead_gen && python - <<'PY'
from pathlib import Path
import web_presence
cats = web_presence.parse_suburb_lines(Path('melbourne_categories.txt').read_text(encoding='utf-8'))
print("category count:", len(cats))
for new in ["real estate agency", "law firm", "business consultant",
            "tutoring service", "driving school", "childcare centre",
            "hotel", "motel", "travel agency", "car dealership",
            "property management"]:
    assert new in cats, f"missing: {new}"
print("all 11 new categories present; comments ignored")
PY`
Expected: `category count: 41` and `all 11 new categories present; comments ignored` (was 30 before; comment/blank lines are stripped by `parse_suburb_lines`).

- [ ] **Step 3: Commit**

```bash
cd /Users/billyhuynh/Github/onrai_lead_gen
git add melbourne_categories.txt
git commit -m "feat: sweep real-estate, legal, education, tourism & dealership categories"
```

---

## Notes for the implementer

- **Yield caveat (not a bug):** hotels, dealerships, childcare centres, real estate agencies and law firms often already have a website, so the no-website gate filters most of them out. These categories will yield fewer leads than cafes/barbers. Expected.
- **Apify cost:** each new category is ~47 searches (one per suburb) at a full sweep; controlled at runtime by `--max-searches`. No code change needed.
- Do not reintroduce removed pipelines (real-estate low-rating, ASIC) — out of scope and explicitly banned by CLAUDE.md.
