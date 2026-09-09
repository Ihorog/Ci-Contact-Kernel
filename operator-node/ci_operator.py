#!/usr/bin/env python3
import json
import os
import platform
import re
import socket
import time
from pathlib import Path
from urllib.request import Request, urlopen

VERSION = "1.0.0"
NODE_ID = "CI.OPERATOR.ORANGE"
REGISTRY_PATH = Path(os.getenv("CI_REGISTRY_PATH", "/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/ci-registry.json"))
ACCEPTANCE_PATH = Path(os.getenv("CI_ACCEPTANCE_PATH", "/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/acceptance/current.json"))
DEFAULT_LINK = os.getenv("CI_LINK_ENDPOINT", "https://ci-link.vercel.app/ci")
SOURCE = os.getenv("CI_OPERATOR_SOURCE", "ci.operator.orange")

KEYWORDS = [
    (r"github|repo|repository|git|репозитор|коміт|commit", "CI.GITHUB"),
    (r"supabase|postgres|database|sql|база", "CI.SUPABASE"),
    (r"vercel|deploy|deployment|депло", "CI.VERCEL"),
    (r"cloudflare|worker|tunnel|воркер", "CI.CLOUDFLARE"),
    (r"orange|orange pi|orangepi|service|systemd", "CI.ORANGE"),
    (r"keenetic|router|vault|роутер|сховищ", "CI.KEENETIC"),
    (r"remote desktop|rdc|cihub", "CI.RDC"),
    (r"gmail|mail|email|пошта", "CI.GMAIL"),
    (r"calendar|календар", "CI.CALENDAR"),
    (r"contact|contacts|контакт", "CI.CONTACTS"),
    (r"google drive|drive|диск", "CI.DRIVE"),
    (r"dropbox", "CI.DROPBOX"),
    (r"sharepoint", "CI.SHAREPOINT"),
    (r"notion", "CI.NOTION"),
    (r"teams|microsoft teams", "CI.TEAMS"),
    (r"hubspot", "CI.HUBSPOT"),
    (r"airtable", "CI.AIRTABLE"),
    (r"figma", "CI.FIGMA"),
    (r"canva", "CI.CANVA"),
    (r"openai|api key|gpt", "CI.OPENAI"),
    (r"automation|schedule|reminder|автомат|нагад", "CI.AUTOMATION"),
    (r"image|зображ|картин", "CI.IMAGE"),
    (r"python|compute|обчис", "CI.PYTHON"),
    (r"web|internet|search|пошук", "CI.WEB"),
    (r"file|document|файл|документ", "CI.FILES"),
    (r"home|дім|хата|будинок", "CI.HOME"),
]

LOCAL_COORDINATES = {"CI.ORANGE", "CI.KEENETIC", "CI.HOME", "CI.RDC"}


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"_error": str(exc), "_path": str(path)}


def _registry():
    return _load(REGISTRY_PATH)


def _acceptance():
    return _load(ACCEPTANCE_PATH)


def _connections(reg):
    return {row.get("id"): row for row in reg.get("connections", []) if isinstance(row, dict) and row.get("id")}


def _states(snapshot):
    return {row.get("id"): row for row in snapshot.get("coordinates", []) if isinstance(row, dict) and row.get("id")}


def _link_endpoint(reg):
    row = _connections(reg).get("CI.LINK", {})
    return row.get("endpoint") or DEFAULT_LINK


def _http_json(url, method="GET", payload=None, timeout=8):
    data = None
    headers = {"accept": "application/json", "user-agent": "ci-operator-orange/1.0"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["content-type"] = "application/json"
    req = Request(url, data=data, method=method, headers=headers)
    started = time.time()
    with urlopen(req, timeout=timeout) as response:
        raw = response.read(256_000)
        body = json.loads(raw.decode("utf-8")) if raw else None
        return {
            "ok": 200 <= response.status < 300,
            "status": response.status,
            "elapsedMs": round((time.time() - started) * 1000),
            "body": body,
        }


def status():
    reg = _registry()
    snapshot = _acceptance()
    connections = reg.get("connections", []) if isinstance(reg, dict) else []
    return {
        "ok": "_error" not in reg and "_error" not in snapshot,
        "node": NODE_ID,
        "version": VERSION,
        "host": socket.gethostname(),
        "arch": platform.machine(),
        "registry": {
            "path": str(REGISTRY_PATH),
            "version": reg.get("version"),
            "root": reg.get("root"),
            "connections": len(connections),
            "error": reg.get("_error"),
        },
        "acceptance": {
            "path": str(ACCEPTANCE_PATH),
            "generatedAt": snapshot.get("generated_at"),
            "summary": snapshot.get("summary"),
            "error": snapshot.get("_error"),
        },
        "executors": {
            "localSafe": sorted(LOCAL_COORDINATES),
            "ciLink": _link_endpoint(reg),
            "externalProviders": "delegate_until_provider_credentials_are_mounted_on_orange",
        },
    }


def _infer_target(intent: str):
    text = (intent or "").lower()
    for pattern, coordinate in KEYWORDS:
        if re.search(pattern, text, re.I):
            return coordinate
    return "CI.LINK"


def resolve(intent: str, target=None):
    reg = _registry()
    snapshot = _acceptance()
    connections = _connections(reg)
    states = _states(snapshot)
    selected = target if target in connections else _infer_target(intent)
    if selected not in connections:
        selected = "CI.LINK"
    connection = connections.get(selected, {})
    acceptance = states.get(selected, {})
    state = acceptance.get("state", "UNKNOWN")
    if state == "BLOCKED":
        execution = "BLOCKED"
    elif selected == "CI.LINK":
        execution = "CI_LINK"
    elif selected in LOCAL_COORDINATES:
        execution = "ORANGE_LOCAL_SAFE"
    else:
        execution = "DELEGATE_CONNECTOR"
    routes = connection.get("resolve", [])
    return {
        "ok": state != "BLOCKED",
        "node": NODE_ID,
        "intent": intent,
        "coordinate": selected,
        "state": state,
        "execution": execution,
        "route": routes,
        "risk": connection.get("risk"),
        "capabilities": connection.get("capabilities", []),
        "limitation": acceptance.get("limitation"),
        "evidence": acceptance.get("evidence"),
        "connectorHint": next((r.split(":", 1)[1] for r in routes if isinstance(r, str) and r.startswith("connector:")), None),
    }


def dispatch(intent: str, target=None, mode="contact"):
    resolution = resolve(intent, target)
    if mode == "resolve":
        return {"ok": True, "mode": mode, "resolution": resolution, "executed": False}
    if mode == "status":
        return {"ok": True, "mode": mode, "operator": status(), "resolution": resolution, "executed": False}
    if mode not in {"contact", "sync"}:
        return {"ok": False, "error": "unsupported_mode", "allowed": ["resolve", "status", "contact", "sync"]}
    if resolution.get("execution") == "BLOCKED":
        return {"ok": False, "mode": mode, "resolution": resolution, "executed": False, "error": "coordinate_blocked"}

    reg = _registry()
    endpoint = _link_endpoint(reg)
    payload = {
        "mode": mode,
        "source": SOURCE,
        "intent": intent if mode == "contact" else None,
        "surface": {
            "operator": NODE_ID,
            "operatorVersion": VERSION,
            "resolvedCoordinate": resolution.get("coordinate"),
            "execution": resolution.get("execution"),
        },
        "context": {
            "resolvedCoordinate": resolution.get("coordinate"),
            "route": resolution.get("route"),
            "connectorHint": resolution.get("connectorHint"),
        },
    }
    if payload["intent"] is None:
        payload.pop("intent")
    try:
        upstream = _http_json(endpoint, "POST", payload)
        accepted = bool(upstream.get("body", {}).get("evidence", {}).get("requestAccepted")) if isinstance(upstream.get("body"), dict) else False
        return {
            "ok": upstream.get("ok", False),
            "mode": mode,
            "resolution": resolution,
            "executed": accepted,
            "executor": "CI.LINK",
            "upstream": upstream,
        }
    except Exception as exc:
        return {"ok": False, "mode": mode, "resolution": resolution, "executed": False, "executor": "CI.LINK", "error": str(exc)}


if __name__ == "__main__":
    print(json.dumps(status(), ensure_ascii=False, indent=2))
