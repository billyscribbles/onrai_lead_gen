"""Pure-logic tests for the Python industry grouping (mirror of industry.ts)."""

from app import db
from app.industry import industry_group, industry_options


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
