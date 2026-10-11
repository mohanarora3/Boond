import pytest

from src.common import config


@pytest.fixture
def rules():
    return config.rules()


@pytest.fixture
def structures():
    return config.structures()


@pytest.fixture
def local_env(tmp_path, monkeypatch):
    """Local file store + local file storage, no network for rainfall."""
    from src.calculator import rainfall
    from src.common import db

    monkeypatch.setenv("BOOND_LOCAL_DB", str(tmp_path / "db.json"))
    monkeypatch.delenv("BOOND_FAKE_AI", raising=False)
    db.set_store(db.LocalStore(str(tmp_path / "db.json")))
    monkeypatch.setattr(rainfall, "fetch_open_meteo", lambda *a: {"daily": {"time": ["2024-01-01"], "precipitation_sum": [700.0]}})
    yield tmp_path
    db.set_store(None)


@pytest.fixture
def plan(local_env):
    from src.plans import service
    from tests.helpers import PLAN_BODY

    return service.create_plan(PLAN_BODY)
