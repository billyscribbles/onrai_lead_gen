"""Bundle granular Google Maps categories into a few industry groups.

MIRROR of web/src/lib/industry.ts — the two MUST stay in sync. The frontend copy
renders the Industry dropdown; this copy powers the server-side `industry` filter
and the facet options (registered as the SQLite `industry_group` function in
app/db.py).

Order matters: the first group whose pattern matches wins, so specific groups
(hospitality, beauty) come before the broad "E-commerce & Retail" catch-all — otherwise
"Coffee shop" / "Barber shop" would be swallowed by the bare word "shop".
"""
from __future__ import annotations

import re
from typing import Iterable

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

_OTHER = "Other"
GROUP_LABELS: list[str] = [label for label, _ in _GROUPS]


def industry_group(category: str) -> str:
    """Map one raw category to its bundled industry group."""
    c = (category or "").strip().lower()
    if not c:
        return _OTHER
    for label, pattern in _GROUPS:
        if pattern.search(c):
            return label
    return _OTHER


def industry_options(categories: Iterable[str]) -> list[str]:
    """Distinct groups present, in canonical order, with 'Other' last."""
    present = {industry_group(c) for c in categories}
    ordered = [g for g in GROUP_LABELS if g in present]
    if _OTHER in present:
        ordered.append(_OTHER)
    return ordered
