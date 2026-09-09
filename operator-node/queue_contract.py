#!/usr/bin/env python3
import json
import re
import shlex
import uuid

VERSION = "1.0.0"
SCHEMA = "ci.operator.command/v1"
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")

ACTIONS = {
    "operator.health": {"risk": "read", "argv": ["curl", "-fsS", "http://127.0.0.1:8796/operator/health"]},
    "operator.metrics": {"risk": "read"},
    "operator.self_update": {"risk": "elevated_write"},
}


def _bounded_limit(value):
    try:
        value = int(value)
    except Exception as exc:
        raise ValueError("limit_must_be_integer") from exc
    if not 1 <= value <= 5000:
        raise ValueError("limit_out_of_range")
    return value


def build(action, args=None, request_id=None):
    args = dict(args or {})
    cfg = ACTIONS.get(action)
    if not cfg:
        raise ValueError("unsupported_action")
    rid = request_id or str(uuid.uuid4())
    try:
        uuid.UUID(rid)
    except Exception as exc:
        raise ValueError("invalid_request_id") from exc

    if action == "operator.health":
        argv = list(cfg["argv"])
    elif action == "operator.metrics":
        limit = _bounded_limit(args.get("limit", 500))
        code = (
            "import sys;sys.path.insert(0,'/home/kazkar/cit/modules/ci_operator');"
            "import ci_operator_runtime as r;import json;"
            f"print(json.dumps(r.metrics({limit}),separators=(',',':')))"
        )
        argv = ["python3", "-c", code]
    else:
        commit = str(args.get("commit", ""))
        activate = bool(args.get("activate", False))
        if not COMMIT_RE.fullmatch(commit):
            raise ValueError("invalid_commit")
        code = (
            "import sys;sys.path.insert(0,'/home/kazkar/cit/modules/ci_operator');"
            "import ci_operator_runtime as r;import json;"
            f"print(json.dumps(r.operator_update('{commit}',{activate!r}),separators=(',',':')))"
        )
        argv = ["python3", "-c", code]

    return {
        "schema": SCHEMA,
        "version": VERSION,
        "requestId": rid,
        "target": "orange",
        "action": action,
        "risk": cfg["risk"],
        "argv": argv,
        "legacyShell": shlex.join(argv),
        "context": json.dumps({"schema": SCHEMA, "requestId": rid, "action": action}, separators=(",", ":")),
    }
