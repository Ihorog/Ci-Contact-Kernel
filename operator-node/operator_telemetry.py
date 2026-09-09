#!/usr/bin/env python3
import json
import os
import statistics
import time
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path

VERSION = "1.0.0"
DEFAULT_PATH = "/home/kazkar/cit/state/ci_operator_metrics.jsonl"
METRICS_PATH = Path(os.getenv("CI_OPERATOR_METRICS_PATH", DEFAULT_PATH))
MAX_TEXT = 96


def _text(value):
    if value is None:
        return None
    return str(value)[:MAX_TEXT]


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _percentile(values, percentile):
    if not values:
        return None
    ordered = sorted(float(v) for v in values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    rank = (len(ordered) - 1) * percentile
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return round(ordered[low] * (1 - weight) + ordered[high] * weight, 2)


def record(event_type, coordinate=None, route=None, outcome="unknown", latency_ms=None,
           executed=False, evidence=False, fallback=False, error_code=None):
    """Best-effort, PII-safe event record. Never stores intent, payload, credentials or provider output."""
    row = {
        "ts": _utc_now(),
        "schema": "ci.operator.telemetry/v1",
        "event": _text(event_type),
        "coordinate": _text(coordinate),
        "route": _text(route),
        "outcome": _text(outcome),
        "latencyMs": round(float(latency_ms), 2) if latency_ms is not None else None,
        "executed": bool(executed),
        "evidence": bool(evidence),
        "fallback": bool(fallback),
        "errorCode": _text(error_code),
    }
    try:
        METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with METRICS_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        return True
    except Exception:
        return False


def measure(event_type, fn, coordinate=None, route=None, fallback=False):
    started = time.perf_counter()
    try:
        result = fn()
    except Exception as exc:
        elapsed = (time.perf_counter() - started) * 1000
        record(event_type, coordinate, route, "exception", elapsed, False, False, fallback, type(exc).__name__)
        raise
    elapsed = (time.perf_counter() - started) * 1000
    ok = bool(result.get("ok")) if isinstance(result, dict) else True
    executed = bool(result.get("executed")) if isinstance(result, dict) else False
    evidence = False
    if isinstance(result, dict):
        evidence = bool(result.get("evidence") or result.get("upstream") or result.get("verification"))
    record(event_type, coordinate, route, "ok" if ok else "error", elapsed, executed, evidence, fallback,
           result.get("error") if isinstance(result, dict) else None)
    return result


def _read_recent(limit):
    limit = max(1, min(int(limit), 5000))
    rows = deque(maxlen=limit)
    try:
        with METRICS_PATH.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    item = json.loads(line)
                except Exception:
                    continue
                if item.get("schema") == "ci.operator.telemetry/v1":
                    rows.append(item)
    except FileNotFoundError:
        pass
    return list(rows)


def summary(limit=500):
    rows = _read_recent(limit)
    latencies = [r["latencyMs"] for r in rows if isinstance(r.get("latencyMs"), (int, float))]
    outcomes = Counter(r.get("outcome") or "unknown" for r in rows)
    coordinates = Counter(r.get("coordinate") or "UNSPECIFIED" for r in rows)
    total = len(rows)
    ok_count = outcomes.get("ok", 0)
    executed_rows = [r for r in rows if r.get("executed")]
    evidence_count = sum(1 for r in executed_rows if r.get("evidence"))
    return {
        "ok": True,
        "schema": "ci.operator.metrics/v1",
        "telemetryVersion": VERSION,
        "path": str(METRICS_PATH),
        "window": total,
        "kpi": {
            "successRate": round(ok_count / total, 4) if total else None,
            "evidenceCompleteness": round(evidence_count / len(executed_rows), 4) if executed_rows else None,
            "fallbackRate": round(sum(1 for r in rows if r.get("fallback")) / total, 4) if total else None,
            "executedRate": round(len(executed_rows) / total, 4) if total else None,
            "latencyMs": {
                "p50": _percentile(latencies, 0.50),
                "p95": _percentile(latencies, 0.95),
                "mean": round(statistics.fmean(latencies), 2) if latencies else None,
            },
        },
        "outcomes": dict(outcomes),
        "coordinates": dict(coordinates),
        "dataQuality": {
            "events": total,
            "latencyCoverage": round(len(latencies) / total, 4) if total else None,
            "piiPolicy": "intent_payload_provider_output_not_recorded",
        },
    }
