"""The mobile catalogue must reuse published prices and disclose missing write support."""

from fastapi.testclient import TestClient

from app.analytics import plans
from app.main import app


def test_mobile_plans_are_live_catalogue_and_read_only() -> None:
    response = TestClient(app).get("/api/households/H-JUL/plans")
    assert response.status_code == 200
    body = response.json()
    assert [style["name"] for style in body["pricing_styles"]] == [
        plan.name for plan in plans.CATALOGUE
    ]
    assert body["pricing_styles"][0]["rate"] == "$0.325/kWh"
    assert body["change_requests_available"] is True
    assert body["current_plan"] == {"pricing_style": None, "term": None}


def test_mobile_plan_rate_rows_preserve_band_prices_and_free_window() -> None:
    body = TestClient(app).get("/api/households/H-JUL/plans").json()
    styles = {style["id"]: style for style in body["pricing_styles"]}
    assert [(rate["label"], rate["value"]) for rate in styles["time-of-use"]["rates"]] == [
        ("Peak", "$0.390"),
        ("Off-peak", "$0.270"),
        ("Night", "$0.180"),
    ]
    assert styles["time-of-use"]["rates"][2]["window"] == "11 PM–7 AM"
    assert styles["free-weekends"]["rates"][1] == {
        "label": "Free weekend power",
        "value": "$0.000",
        "unit": "/kWh",
        "window": "Sat & Sun · 09:00–17:00",
    }


def test_mobile_plans_reject_unknown_household() -> None:
    assert TestClient(app).get("/api/households/NO-SUCH-HOME/plans").status_code == 404
