from src.geocode import handler as geo
from tests.helpers import call


def test_reverse_outside_delhi_is_400():
    status, body = call(geo.lambda_handler, "GET", query={"lat": "19.07", "lon": "72.87"})
    assert status == 400 and "Delhi" in body["error"]


def test_reverse_keeps_users_point(monkeypatch):
    monkeypatch.delenv("PLACE_INDEX_NAME", raising=False)
    monkeypatch.setattr(geo, "_nominatim_get", lambda url, params: {
        "lat": "28.5900", "lon": "77.2200", "display_name": "Lodhi Road, New Delhi", "address": {"suburb": "Lodhi Colony"}})
    status, body = call(geo.lambda_handler, "GET", query={"lat": "28.5897", "lon": "77.2163"})
    assert status == 200
    assert body["data"][0] == {"label": "Lodhi Road, New Delhi", "lat": 28.5897, "lon": 77.2163, "ward": "Lodhi Colony"}


def test_reverse_falls_back_to_bare_point(monkeypatch):
    monkeypatch.delenv("PLACE_INDEX_NAME", raising=False)

    def boom(*_):
        raise TimeoutError

    monkeypatch.setattr(geo, "_nominatim_get", boom)
    status, body = call(geo.lambda_handler, "GET", query={"lat": "28.6", "lon": "77.2"})
    assert status == 200 and body["data"][0]["ward"] == "Unassigned"


def test_search_needs_three_chars():
    assert call(geo.lambda_handler, "GET", query={"q": "ab"})[0] == 400


def test_rules_endpoint_exposes_config_values(rules):
    from src.rules.handler import lambda_handler as rules_handler

    status, body = call(rules_handler, "GET")
    data = body["data"]
    assert status == 200 and data["mandatory_min_plot_m2"] == rules["mandatory_min_plot_m2"]
    assert data["rebate_fraction"] == rules["rebate_fraction"] and "penalty_fraction" in data["sources"]
    assert "_note" not in data["sources"]
