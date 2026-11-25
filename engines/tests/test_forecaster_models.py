# SPDX-License-Identifier: AGPL-3.0-only
"""Optional models lightgbm-1, ets-1, sarima-1, prophet-1, mlp-1 (alias lstm-1).

SYNTHETIC data only: nothing here measures real accuracy.
Each test skips when its library is absent.
"""
import copy
import importlib
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from jsonschema import Draft202012Validator, FormatChecker

import test_forecaster_long_history as LH
from opendispatch_engines.forecaster import handle, registry

from test_forecaster_engine import _invariants

TZ = timezone(timedelta(hours=3))
LIBS = {v: libs for v, (_, libs) in registry.OPTIONAL.items()}


def _need(version):
    for lib in LIBS[version]:
        pytest.importorskip(lib)


@pytest.fixture(scope="module")
def small():
    rec, agg = LH._gen(detail=56)
    r = LH._request(rec, agg)
    r["horizon"]["days"] = 7
    return r


def _ask(req, version):
    r = copy.deepcopy(req)
    r["model"]["model_version"] = version
    return handle(r)


@pytest.mark.parametrize("version", sorted(registry.OPTIONAL))
def test_model_runs_schema_valid_and_named(load, small, version):
    _need(version)
    out = _ask(small, version)
    Draft202012Validator(load("forecaster.output.schema.json"), format_checker=FormatChecker()).validate(out)
    _invariants(out, small)
    assert out["model_version"] == version
    assert out["illustrative"] is True
    assert "explanations" not in out
    assert sum(v["expected"] for v in out["values"]) > 0


@pytest.mark.parametrize("version", sorted(registry.OPTIONAL))
def test_model_is_deterministic(small, version):
    _need(version)
    assert _ask(small, version)["values"] == _ask(small, version)["values"]


def test_missing_library_runs_default_with_warning(small, monkeypatch):
    real = importlib.import_module

    def fake(name, *a, **k):
        if name == "lightgbm":
            raise ImportError("no lightgbm", name="lightgbm")
        return real(name, *a, **k)

    monkeypatch.setattr(registry.importlib, "import_module", fake)
    out = _ask(small, "lightgbm-1")
    assert out["model_version"] == registry.DEFAULT
    assert out["warnings"][-1]["code"] == "MODEL_UNAVAILABLE"
    assert out["values"] == _ask(small, registry.DEFAULT)["values"]
    assert "lightgbm-1" not in registry.available() or importlib.util.find_spec("lightgbm") is not None


def test_unknown_lists_optional_models(small):
    out = _ask(small, "nope-1")
    assert out["warnings"][-1]["code"] == "UNKNOWN_MODEL_VERSION"
    assert "lightgbm-1" in out["warnings"][-1]["message"]


def _leak_check(mod, ctx_of, small):
    """Features of a training day ignore days after its origin."""
    from opendispatch_engines.forecaster import tabular as T
    import numpy as np
    data = T.Data(copy.deepcopy(small))
    ctx = ctx_of(data)
    nd = data.detail.shape[1]
    for k, L in ((nd - 1, 1), (nd - 3, 7), (nd - 10, 10), (nd - 20, 14)):
        a = mod.block(ctx, k, L)
        bumped = ctx_of(data)
        bumped.Y[:, k - L + 1:] += 1000.0
        if hasattr(bumped, "daily"):
            bumped.daily[:, data.d0 + k - L + 1:] += 1000.0
            bumped.zd[:, data.d0 + k - L + 1:] += 1000.0
        b = mod.block(bumped, k, L)
        assert np.array_equal(a, b, equal_nan=True), (k, L)
        bumped.Y[:, k - L] += 1000.0
        assert not np.array_equal(a, mod.block(bumped, k, L), equal_nan=True), "origin day must matter"


def test_lightgbm_features_have_no_leakage(small):
    _need("lightgbm-1")
    from opendispatch_engines.forecaster import lgbm
    _leak_check(lgbm, lgbm.Ctx, small)


def test_mlp_features_have_no_leakage(small):
    _need("mlp-1")
    from opendispatch_engines.forecaster import mlp
    _leak_check(mlp, mlp.Ctx, small)


def test_forecast_ignores_values_after_the_history(small):
    _need("ets-1")
    r = copy.deepcopy(small)
    later = date.fromisoformat(r["horizon"]["start_date"]) + timedelta(days=30)
    r["history"]["records"].append({"sub_zone_id": LH.SUBS[0][0], "interval_start": f"{later}T10:00:00+03:00",
                                    "cases_total": 999, "cases_field": 0})
    for v in ("ets-1", "lightgbm-1"):
        if all(importlib.util.find_spec(x) for x in LIBS[v]):
            assert _ask(r, v)["values"] == _ask(small, v)["values"]


def _big(n_zones=36, detail=84, years=3, horizon=10):
    """36 zones x 3 sub-zones, 12 weeks at 15 minutes plus years of totals."""
    import numpy as np
    rng = np.random.default_rng(3)
    h0 = date(2026, 2, 14)
    first = h0 - timedelta(days=365 * years)
    zones = [str(uuid.UUID(int=0xF000 + z)) for z in range(n_zones)]
    subs = [[str(uuid.UUID(int=0xF100 + z * 10 + k)) for k in range(3)] for z in range(n_zones)]
    base = np.array(LH.BASE96)
    rec, agg = [], []
    cal = []
    for i in range((h0 - first).days + horizon):
        d = first + timedelta(days=i)
        cal.append({"date": d.isoformat(), "is_holiday": LH._kind(d) == "eid", "is_ramadan": LH._kind(d) == "ramadan",
                    "is_payday": d.day == 27, "events": [{"type": "eid"}] if LH._kind(d) == "eid" else []})
        if d >= h0:
            continue
        m = LH._mult(d)
        for z in range(n_zones):
            for k, sid in enumerate(subs[z]):
                lam = base * m * (0.5 + z / n_zones) * LH.SC[k] * 0.5
                if (h0 - d).days <= detail:
                    for s, n in enumerate(rng.poisson(lam)):
                        if n:
                            ts = datetime(d.year, d.month, d.day, s // 4, s % 4 * 15, tzinfo=TZ).isoformat()
                            rec.append({"sub_zone_id": sid, "interval_start": ts, "cases_total": int(n), "cases_field": int(n) // 2})
                else:
                    n = int(rng.poisson(lam.sum()))
                    agg.append({"sub_zone_id": sid, "period_start": datetime(d.year, d.month, d.day, tzinfo=TZ).isoformat(),
                                "period_minutes": 1440, "cases_total": n, "cases_field": n // 2})
    return {
        "schema_version": "1.0", "request_id": str(uuid.UUID(int=10)), "requested_at": "2026-02-13T02:00:00+03:00",
        "data_source": "SYNTHETIC", "input_data_sources": ["SYNTHETIC"],
        "horizon": {"start_date": h0.isoformat(), "days": horizon}, "model": {"model_version": "m", "range_coverage": 0.8},
        "zones": [{"zone_id": zones[z], "sub_zones": [{"sub_zone_id": s} for s in subs[z]]} for z in range(n_zones)],
        "calendar": cal, "history": {"records": rec, "aggregated_records": agg},
    }


BOUNDS = {"lightgbm-1": 60.0, "ets-1": 10.0, "sarima-1": 300.0, "prophet-1": 300.0, "mlp-1": 300.0}


@pytest.fixture(scope="module")
def big():
    pytest.importorskip("numpy")
    return _big()


@pytest.mark.parametrize("version", sorted(BOUNDS))
def test_performance_36_zones_10_days(big, version):
    _need(version)
    t = time.perf_counter()
    out = _ask(big, version)
    secs = time.perf_counter() - t
    codes = [w["code"] for w in out.get("warnings", [])]
    print(f"\n{version}: {secs:.1f} s for 36 zones x 3 sub-zones x 10 days (bound {BOUNDS[version]:.0f} s) {codes}")
    assert out["model_version"] == version
    assert len(out["values"]) == 36 * 3 * 10 * 96
    assert "MODEL_FIT_FALLBACK" not in codes
    assert secs < BOUNDS[version]


def test_lstm_alias_runs_mlp_with_warning(small):
    _need("mlp-1")
    out = _ask(small, "lstm-1")
    assert out["model_version"] == "mlp-1"
    assert out["warnings"][-1]["code"] == "MODEL_ALIAS"
    assert out["values"] == _ask(small, "mlp-1")["values"]
