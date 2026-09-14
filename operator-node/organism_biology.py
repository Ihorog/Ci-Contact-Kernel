#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path

ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Ci"
STATE = ROOT / "organism-state.json"
ROOT.mkdir(parents=True, exist_ok=True)

def load():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {"schema": "ci.organism.local/v1", "components": {}}

def save(state):
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def classify(sample):
    if sample.get("invariantBroken") or not sample.get("authorityPreserved", True):
        return "QUARANTINE"
    if sample.get("immediateFailure") or sample.get("environmentChanged"):
        return "DEOPT"
    if not (sample.get("functionPreserved") and sample.get("evidenceComplete")):
        return "LEARN"
    if sample.get("repeatedEquivalentWork"):
        return "SLEEP"
    return "ACTIVE"

def observe(component, sample):
    state = load()
    c = state["components"].get(component, {"samples": 0, "preventedWork": 0, "mode": "LEARN"})
    c["samples"] = c.get("samples", 0) + 1
    c["preventedWork"] = c.get("preventedWork", 0) + max(
        0, int(sample.get("baselineWork", 0)) - int(sample.get("actualWork", 0))
    )
    c["mode"] = classify(sample)
    c["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    c["last"] = sample
    state["components"][component] = c
    save(state)
    return c

def main():
    if len(sys.argv) < 2 or sys.argv[1] == "status":
        print(json.dumps(load(), ensure_ascii=False, indent=2))
        return 0
    if sys.argv[1] == "observe":
        component = sys.argv[2]
        sample = json.loads(sys.argv[3])
        print(json.dumps(observe(component, sample), ensure_ascii=False, indent=2))
        return 0
    return 2

if __name__ == "__main__":
    raise SystemExit(main())
