import math

import pytest

from src.wards import footprints as fp

CFG = {"min_area_m2": 20, "default_roof_type": "rcc"}


def rect(lon, lat, w_m, h_m):
    """Rectangle of w × h metres at lon/lat (small, so planar degrees are fine)."""
    dlat = h_m / 111_320
    dlon = w_m / (111_320 * math.cos(math.radians(lat)))
    ring = [[lon, lat], [lon + dlon, lat], [lon + dlon, lat + dlat], [lon, lat + dlat], [lon, lat]]
    return {"type": "Polygon", "coordinates": [ring]}


def test_area_matches_flat_rectangle_within_1_percent():
    for w, h in [(10, 12), (25, 40), (5, 5)]:
        assert fp.geodesic_area_m2(rect(77.2, 28.6, w, h)) == pytest.approx(w * h, rel=0.01)


def test_area_matches_turf_reference_value():
    # @turf/area 7.x on this demo outline gives 119.99 m² (checked with node).
    demo = {"type": "Polygon", "coordinates": [[[77.2162722, 28.5896908], [77.216395, 28.5896908], [77.216395, 28.5897808],
                                                [77.2162722, 28.5897808], [77.2162722, 28.5896908]]]}
    assert fp.geodesic_area_m2(demo) == pytest.approx(119.99, rel=0.001)


def test_holes_and_multipolygons():
    outer = rect(77.2, 28.6, 20, 20)["coordinates"][0]
    hole = rect(77.20005, 28.60005, 5, 5)["coordinates"][0]
    assert fp.geodesic_area_m2({"type": "Polygon", "coordinates": [outer, hole]}) == pytest.approx(375, rel=0.01)
    multi = {"type": "MultiPolygon", "coordinates": [[outer], [outer]]}
    assert fp.geodesic_area_m2(multi) == pytest.approx(800, rel=0.01)


def test_mandatory_label_threshold(rules):
    limit = rules["mandatory_min_plot_m2"]
    assert fp.mandatory_label(limit, rules) == "required"
    assert fp.mandatory_label(limit + 30, rules) == "required"
    assert fp.mandatory_label(limit - 0.1, rules) == "maybe"


def test_building_properties_and_min_area(rules):
    props = fp.building_properties("b1", rect(77.2, 28.6, 10, 12), 750, rules, CFG)
    assert props["mandatory"] == "required"
    assert props["litresPerYear"] == pytest.approx(props["areaM2"] * 750 * rules["runoff_coefficients"]["rcc"], abs=50)
    assert fp.building_properties("tiny", rect(77.2, 28.6, 3, 3), 750, rules, CFG) is None


def test_confidence_filter():
    assert fp.passes_confidence([{"dataset": "Google Open Buildings", "confidence": 0.8}], 0.75)
    assert not fp.passes_confidence([{"dataset": "Google Open Buildings", "confidence": 0.7}], 0.75)
    assert fp.passes_confidence([{"dataset": "OpenStreetMap", "confidence": None}], 0.75)
    assert fp.passes_confidence(None, 0.75)


def test_summary_equals_sum_of_features(rules):
    feats = [{"properties": fp.building_properties(f"b{i}", rect(77.2, 28.6, 5 + i, 8), 700, rules, CFG)} for i in range(1, 30)]
    feats = [f for f in feats if f["properties"]]
    s = fp.summarise(feats)
    assert s["buildingCount"] == len(feats)
    assert s["totalLitresPerYear"] == sum(f["properties"]["litresPerYear"] for f in feats)
    assert s["requiredCount"] == sum(1 for f in feats if f["properties"]["mandatory"] == "required")


def test_bucket_index():
    assert [fp.bucket_index(v, [10, 20, 30]) for v in (0, 10, 25, 30, 99)] == [0, 1, 2, 3, 3]
