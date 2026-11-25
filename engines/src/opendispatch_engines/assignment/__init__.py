# SPDX-License-Identifier: AGPL-3.0-only
"""Assignment scorer: rank agents for one case (see README)."""
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from ..common import envelope
from ..travel import TravelModel, km as _km

MODEL_VERSION = "scorer-0.3"
STALE_SECONDS = 900  # older positions are excluded
RECENT_SECONDS = 120  # older positions get a caution code
SHIFT_SLACK_CAP = 7200  # spare shift seconds that cost nothing
SHIFT_ENDING_SECONDS = 3600  # spare shift below this gets a caution
SCORE_SCALE = 600.0  # cost that maps to score 0.5
BUDGET_FRACTION = 0.9  # share of the deadline the engine may use
CHECK_EVERY = 16  # candidates between clock checks
COVER_CANDIDATES = 64  # nearest picks checked for cover
BUSY_STATES = ("assigned", "en_route", "on_scene")


@dataclass(frozen=True)
class Weights:
    """Named scorer weights; every cost is in seconds."""
    travel: float = 1.0  # per second to scene, wait included
    wait: float = 0.25  # extra per second waiting on a busy one
    coverage: float = 0.2  # per expected-case second of lost cover
    coverage_cap_seconds: int = 1800  # longer cover gaps count as this
    strip_seconds: float = 300.0  # last free agent of another zone
    out_of_zone_seconds: float = 120.0  # roster zone is not the case zone
    workload_seconds_per_case: float = 5.0  # per case done today
    prayer_seconds: float = 600.0  # arrival inside the prayer window
    shift_end_seconds: float = 120.0  # scaled by missing shift slack
    break_soon_seconds: float = 120.0  # break due before the job ends
    max_wait_seconds: int = 900  # longest wait for a busy agent
    job_seconds: int = 1800  # assumed on-scene time


DEFAULT_WEIGHTS = Weights()


@dataclass(frozen=True)
class DemandCell:
    """Expected cases in a micro-cell over the look-ahead."""
    latitude: float
    longitude: float
    expected_cases: float


def _dt(value):
    return datetime.fromisoformat(value) if value else None


def _clock(t: datetime) -> str:
    return t.strftime("%H:%M")


def _finish(request, status, started, ranking, excluded, exceeded):
    ms = int((time.monotonic() - started) * 1000)
    return envelope(
        request, "assignment",
        model_version=MODEL_VERSION,
        case_id=request["case"]["case_id"],
        status=status, decision_time_ms=ms,
        deadline_exceeded=exceeded,
        ranking=ranking, excluded=excluded,
    )


def _check(c, case, now, needs_vehicle, tm, w):
    """Return (exclusion, text) or (None, facts)."""
    status = c["status"]
    if status == "offline":
        return ("OFFLINE", "Offline."), None
    if status == "on_break":
        until = _dt(c.get("on_break_until"))
        txt = f"On break until {_clock(until)}." if until else "On break."
        return ("ON_BREAK", txt), None
    start = now
    if status in BUSY_STATES or c.get("busy_until"):
        busy = _dt(c.get("busy_until"))
        if busy and busy > now:
            start = busy
        late = (start - now).total_seconds() > w.max_wait_seconds
        if (status in BUSY_STATES and not busy) or late:
            return ("BUSY", "Busy with another case."), None
    age = max(0.0, (now - _dt(c["position_at"])).total_seconds())
    if age > STALE_SECONDS:
        return ("STALE_POSITION", f"Position is {int(age // 60)} minutes old."), None
    need = case.get("required_skills") or []
    if need and not set(need).issubset(c["skills"]):
        return ("MISSING_SKILL", "Lacks a required skill."), None
    if needs_vehicle and not c["has_vehicle"]:
        return ("NO_VEHICLE", "No vehicle."), None
    travel = int(round(tm.seconds(case["latitude"], case["longitude"],
                                  c["latitude"], c["longitude"])))
    arrival = start + timedelta(seconds=travel)
    due = _dt(c.get("next_break_due_at"))
    if due and due <= arrival:
        return ("ON_BREAK", f"Break due at {_clock(due)}, before arrival."), None
    end = _dt(c.get("shift_end_at"))
    slack = None
    if end:
        slack = (end - arrival).total_seconds() - w.job_seconds
        if slack < 0:
            return ("OFF_SHIFT", f"Shift ends at {_clock(end)}."), None
    return None, (start, travel, arrival, age, slack, due)


def _window(request):
    w = request.get("prayer_window")
    if w and w.get("starts_at") and w.get("ends_at"):
        return _dt(w["starts_at"]), _dt(w["ends_at"])
    return None


def _free_by_zone(candidates, now):
    """Count agents free now, per roster zone."""
    out = {}
    for c in candidates:
        if c["status"] != "available" or c.get("busy_until") and _dt(c["busy_until"]) > now:
            continue
        z = c.get("roster_zone_id")
        out[z] = out.get(z, 0) + 1
    return out


def _coverage_loss(items, demand, tm, w):
    """Expected-case seconds of cover lost per pick."""
    loss = [0.0] * len(items)
    if not demand or len(items) < 2:
        return loss
    cap = w.coverage_cap_seconds
    near = sorted(range(len(items)), key=lambda i: items[i]["total"])[:COVER_CANDIDATES]
    for d in demand:
        best = second = float(cap)
        who = -1
        for i in near:
            it = items[i]
            c = it["c"]
            eta = it["wait"] + tm.seconds(d.latitude, d.longitude,
                                           c["latitude"], c["longitude"])
            if eta < best:
                best, second, who = eta, best, i
            elif eta < second:
                second = eta
        if who >= 0:
            loss[who] += d.expected_cases * (second - best)
    return loss


def _cost(it, case, w, window, free_zone):
    c, (start, travel, arrival, age, slack, due) = it["c"], it["facts"]
    cost = w.travel * it["total"] + w.wait * it["wait"]
    cost += w.coverage * it["loss"]
    rz = c.get("roster_zone_id")
    if rz and rz != case["zone_id"]:
        cost += w.out_of_zone_seconds
        if free_zone.get(rz, 0) <= 1 and it["wait"] == 0:
            cost += w.strip_seconds
            it["strips"] = True
    cost += w.workload_seconds_per_case * c.get("cases_today", 0)
    if it["prayer"]:
        cost += w.prayer_seconds
    if slack is not None:
        cost += w.shift_end_seconds * (1 - min(slack, SHIFT_SLACK_CAP) / SHIFT_SLACK_CAP)
    if due and due <= arrival + timedelta(seconds=w.job_seconds):
        cost += w.break_soon_seconds
    return max(0.0, cost)


def _reasons(item, best, nxt, mean_cases, case, now, w):
    c, facts, total = item["c"], item["facts"], item["total"]
    start, _, arrival, age, slack, due = facts
    codes = []
    if best is item:
        codes.append("NEAREST_BY_TRAVEL_TIME")
        if nxt is not None and total < nxt["total"]:
            codes.append("SHORTER_TRAVEL_THAN_NEXT")
    elif total > best["total"]:
        codes.append("LONGER_TRAVEL_THAN_BEST")
    codes.append("AVAILABLE_NOW" if start == now else "FINISHING_CURRENT_CASE")
    if case.get("required_skills"):
        codes.append("HAS_REQUIRED_SKILL")
    if c["has_vehicle"]:
        codes.append("VEHICLE_AVAILABLE")
    n = c.get("cases_today", 0)
    if n < mean_cases:
        codes.append("LOWER_WORKLOAD")
    elif n > mean_cases:
        codes.append("HIGHER_WORKLOAD")
    rz = c.get("roster_zone_id")
    if rz == case["zone_id"]:
        codes.append("IN_ROSTER_ZONE")
    elif rz:
        codes.append("OUTSIDE_ROSTER_ZONE")
    if due and due <= arrival + timedelta(seconds=w.job_seconds):
        codes.append("BREAK_DUE_SOON")
    if item["prayer"]:
        codes.append("PRAYER_TIME_SOON")
    if slack is not None and slack < SHIFT_ENDING_SECONDS:
        codes.append("SHIFT_ENDING_SOON")
    if age > RECENT_SECONDS:
        codes.append("POSITION_NOT_RECENT")
    return codes


def _text(item, codes, best):
    mins = max(1, round(item["travel"] / 60))
    head = f"About {mins} min away"
    if "NEAREST_BY_TRAVEL_TIME" in codes:
        head = "Closest. " + head
    rest = []
    if "FINISHING_CURRENT_CASE" in codes:
        rest.append("finishing a case")
    if "IN_ROSTER_ZONE" in codes:
        rest.append("in the roster zone")
    elif "OUTSIDE_ROSTER_ZONE" in codes:
        rest.append("outside the roster zone")
    if item is not best and item["loss"] < best["loss"]:
        rest.append("keeps cover where cases are expected")
    if item.get("strips"):
        rest.append("last free agent in their zone")
    if "LOWER_WORKLOAD" in codes:
        rest.append("lighter workload")
    elif "HIGHER_WORKLOAD" in codes:
        rest.append("heavier workload")
    if "PRAYER_TIME_SOON" in codes:
        rest.append("arrives in a prayer window")
    if "BREAK_DUE_SOON" in codes:
        rest.append("break due soon")
    if "SHIFT_ENDING_SOON" in codes:
        rest.append("shift ends soon")
    return (head + (", " + ", ".join(rest) if rest else "") + ".")[:200]


def rank(request: dict, weights: Weights = DEFAULT_WEIGHTS, demand=None) -> dict:
    """Rank candidates; demand is optional look-ahead."""
    started = time.monotonic()
    w = weights
    case = request["case"]
    if case.get("existing_assignment_id"):
        return _finish(request, "already_assigned", started, [], [], False)
    deadline = request.get("decision_deadline_ms", 2000) / 1000.0
    budget = deadline * BUDGET_FRACTION
    top_n = request.get("top_n", 5)
    now = _dt(request["now"])
    tm = TravelModel(request.get("travel_model"))
    needs_vehicle = case["handling"] == "field"
    window = _window(request)
    items, excluded, partial = [], [], False
    for i, c in enumerate(request["candidates"]):
        if i % CHECK_EVERY == 0 and time.monotonic() - started > budget:
            partial = True
            break
        ex, facts = _check(c, case, now, needs_vehicle, tm, w)
        if ex:
            excluded.append({"agent_id": c["agent_id"],
                             "exclusion_code": ex[0], "text": ex[1]})
            continue
        wait = (facts[0] - now).total_seconds()
        arrival = facts[2]
        items.append({"c": c, "facts": facts, "travel": facts[1], "wait": wait,
                      "total": wait + facts[1], "loss": 0.0,
                      "prayer": bool(window and window[0] <= arrival < window[1])})
    if demand and not partial and time.monotonic() - started < budget / 2:
        for it, loss in zip(items, _coverage_loss(items, demand, tm, w)):
            it["loss"] = loss
    free_zone = _free_by_zone(request["candidates"], now)
    for it in items:
        it["cost"] = _cost(it, case, w, window, free_zone)
    items.sort(key=lambda r: (r["cost"], r["total"], r["c"]["agent_id"]))
    exceeded = partial or (time.monotonic() - started) > deadline
    if not items:
        return _finish(request, "no_eligible_agent", started, [], excluded, exceeded)
    top = items[:top_n]
    best = min(top, key=lambda r: (r["total"], r["c"]["agent_id"]))
    mean_cases = sum(r["c"].get("cases_today", 0) for r in items) / len(items)
    ranking = []
    for i, item in enumerate(top):
        nxt = top[i + 1] if i + 1 < len(top) else None
        codes = _reasons(item, best, nxt if item is best else None,
                         mean_cases, case, now, w)
        text = _text(item, codes, best)
        if exceeded:
            text = (text[:-1] + ". Partial: deadline reached.")[:200]
        ranking.append({
            "rank": i + 1,
            "agent_id": item["c"]["agent_id"],
            "estimated_travel_seconds": item["travel"],
            "estimated_arrival_at": item["facts"][2].isoformat(),
            "score": round(1.0 / (1.0 + item["cost"] / SCORE_SCALE), 4),
            "reason_codes": codes,
            "reason_text": text,
        })
    return _finish(request, "ranked", started, ranking, excluded, exceeded)


def handle(request: dict) -> dict:
    return rank(request)


def _reposition(request: dict) -> dict:
    from .reposition import handle as answer
    return answer(request)


# Extra POST routes: /v1/assignment/<key>
ROUTES = {"reposition": _reposition}
