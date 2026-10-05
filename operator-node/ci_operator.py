#!/usr/bin/env python3
import json
import os
import platform
import re
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import vault_node

VERSION = "1.1.0"
NODE_ID = "CI.OPERATOR.ORANGE"
REGISTRY_PATH = Path(os.getenv("CI_REGISTRY_PATH", "/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/ci-registry.json"))
ACCEPTANCE_PATH = Path(os.getenv("CI_ACCEPTANCE_PATH", "/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/acceptance/current.json"))
DEFAULT_LINK = os.getenv("CI_LINK_ENDPOINT", "https://ci-link.vercel.app/ci")
SOURCE = os.getenv("CI_OPERATOR_SOURCE", "ci.operator.orange")

KEYWORDS = [
    (r"sharepoint", "CI.SHAREPOINT"),
    (r"dropbox", "CI.DROPBOX"),
    (r"notion", "CI.NOTION"),
    (r"microsoft teams|\bteams\b", "CI.TEAMS"),
    (r"hubspot", "CI.HUBSPOT"),
    (r"airtable", "CI.AIRTABLE"),
    (r"figma", "CI.FIGMA"),
    (r"canva", "CI.CANVA"),
    (r"supabase|postgres|database|\bsql\b|база", "CI.SUPABASE"),
    (r"vercel|deploy|deployment|депло", "CI.VERCEL"),
    (r"cloudflare|worker|tunnel|воркер", "CI.CLOUDFLARE"),
    (r"github|\brepo\b|repository|\bgit\b|репозитор|коміт|commit", "CI.GITHUB"),
    (r"orange pi|orangepi|\borange\b|systemd", "CI.ORANGE"),
    (r"vault|сховищ|сховище", "CI.VAULT"),
    (r"keenetic|router|роутер", "CI.KEENETIC"),
    (r"remote desktop|\brdc\b|cihub", "CI.RDC"),
    (r"gmail|\bmail\b|\bemail\b|пошта", "CI.GMAIL"),
    (r"calendar|календар", "CI.CALENDAR"),
    (r"contacts?|контакт", "CI.CONTACTS"),
    (r"google drive|\bdrive\b|диск", "CI.DRIVE"),
    (r"openai|api key|\bgpt\b", "CI.OPENAI"),
    (r"automation|schedule|reminder|автомат|нагад", "CI.AUTOMATION"),
    (r"image|зображ|картин", "CI.IMAGE"),
    (r"python|compute|обчис", "CI.PYTHON"),
    (r"\bweb\b|internet|search|пошук", "CI.WEB"),
    (r"file|document|файл|документ", "CI.FILES"),
    (r"home|дім|хата|будинок", "CI.HOME"),
]

LOCAL_COORDINATES = {"CI.ORANGE", "CI.KEENETIC", "CI.VAULT", "CI.HOME", "CI.RDC"}


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"_error": str(exc), "_path": str(path)}


def _registry():
    return _load(REGISTRY_PATH)


def _acceptance():
    current = _load(ACCEPTANCE_PATH)
    if current.get("kind") == "CI_REGISTRY_ACCEPTANCE_POINTER" and current.get("current"):
        target = ACCEPTANCE_PATH.parent / str(current["current"])
        snapshot = _load(target)
        if "_error" not in snapshot:
            snapshot["_pointer"] = {
                "path": str(ACCEPTANCE_PATH),
                "target": str(target),
                "sha256": current.get("sha256"),
            }
        return snapshot
    return current


def _snapshot_freshness(snapshot, reg):
    policy = reg.get("policy", {}).get("freshness", {}) if isinstance(reg, dict) else {}
    max_age = int(policy.get("acceptance_max_age_seconds", 86400))
    generated = snapshot.get("generated_at") if isinstance(snapshot, dict) else None
    if not generated:
        return {"status": "UNKNOWN", "generatedAt": None, "ageSeconds": None, "maxAgeSeconds": max_age}
    try:
        stamp = datetime.fromisoformat(str(generated).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        age = max(0, int((datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds()))
        return {
            "status": "FRESH" if age <= max_age else "STALE",
            "generatedAt": generated,
            "ageSeconds": age,
            "maxAgeSeconds": max_age,
        }
    except Exception:
        return {"status": "UNKNOWN", "generatedAt": generated, "ageSeconds": None, "maxAgeSeconds": max_age}


def _connections(reg):
    rows = reg.get("connections")
    if isinstance(rows, list):
        return {row.get("id"): row for row in rows if isinstance(row, dict) and row.get("id")}
    routes = reg.get("routes")
    if isinstance(routes, dict):
        out = {}
        for cid, row in routes.items():
            if not isinstance(row, dict):
                continue
            out[cid] = {
                "id": cid,
                "resolve": row.get("via", []),
                "fallback": row.get("fallback", []),
                "risk": row.get("risk"),
                "availability": row.get("live"),
                "capabilities": row.get("ops", []),
                "autoOperations": row.get("auto_ops", []),
                "passport": row.get("passport"),
                "endpoint": row.get("endpoint"),
            }
        return out
    return {}


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


def _public_personal_resource_summary(reg, snapshot, freshness):
    connections = _connections(reg)
    states = _states(snapshot)
    resources = []
    for coordinate, connection in connections.items():
        audit = _build_personal_resource_audit(
            coordinate,
            connection,
            states.get(coordinate, {}),
            reg,
        )
        if audit.get("personal_resource"):
            resources.append(audit)
    counts = {
        "ownedVerified": sum(1 for row in resources if row.get("verification_status") == "OWNED_VERIFIED"),
        "delegatedVerified": sum(1 for row in resources if row.get("verification_status") == "DELEGATED_VERIFIED"),
        "availableUnverified": sum(1 for row in resources if row.get("verification_status") == "AVAILABLE_UNVERIFIED"),
        "stale": sum(1 for row in resources if row.get("verification_status") == "STALE"),
        "blocked": sum(1 for row in resources if row.get("verification_status") == "BLOCKED"),
    }
    trusted = counts["ownedVerified"] + counts["delegatedVerified"]
    return {
        "contract": "ci-personal-resource-trust/v1",
        "freshness": freshness.get("status", "UNKNOWN"),
        "trustedResources": trusted,
        "totalResources": len(resources),
        **counts,
        "serverAuthoritative": True,
    }


def status():
    reg = _registry()
    snapshot = _acceptance()
    connections = _connections(reg)
    freshness = _snapshot_freshness(snapshot, reg)
    personal_resources = _public_personal_resource_summary(reg, snapshot, freshness)
    return {
        "ok": "_error" not in reg and "_error" not in snapshot and bool(connections),
        "node": NODE_ID,
        "version": VERSION,
        "host": socket.gethostname(),
        "arch": platform.machine(),
        "registry": {
            "path": str(REGISTRY_PATH),
            "kind": reg.get("kind"),
            "version": reg.get("version"),
            "root": reg.get("root"),
            "connections": len(connections),
            "error": reg.get("_error"),
        },
        "acceptance": {
            "path": str(ACCEPTANCE_PATH),
            "freshness": freshness,
            "generatedAt": snapshot.get("generated_at"),
            "summary": snapshot.get("summary"),
            "coordinates": len(snapshot.get("coordinates", [])),
            "pointer": snapshot.get("_pointer"),
            "error": snapshot.get("_error"),
        },
        "personalResources": personal_resources,
        "executors": {
            "localSafe": sorted(LOCAL_COORDINATES),
            "ciLink": _link_endpoint(reg),
            "externalProviders": "delegate_until_provider_credentials_are_mounted_on_orange",
            "vault": vault_node.status(),
        },
    }


def _infer_target(intent: str):
    text = (intent or "").lower()
    for pattern, coordinate in KEYWORDS:
        if re.search(pattern, text, re.I):
            return coordinate
    return "CI.LINK"


def _delegation_from_routes(coordinate, routes, capabilities, risk, fallback):
    for route in routes:
        if not isinstance(route, str) or ":" not in route:
            continue
        prefix, name = route.split(":", 1)
        kind = {"connector": "chatgpt_connector", "runtime_connector": "runtime_connector", "native": "native_tool"}.get(prefix)
        if not kind:
            continue
        return {
            "kind": kind,
            "executor": name,
            "coordinate": coordinate,
            "operations": list(capabilities or []),
            "risk": risk,
            "fallback": list(fallback or []),
            "requiresLiveCheck": True,
            "requiresEvidence": True,
            "executionPlane": "external_node",
            "clientExecution": False,
        }
    return None

def _external_node_delegation(coordinate, capabilities, risk, fallback):
    return {
        "kind": "ci_node",
        "executor": NODE_ID,
        "coordinate": coordinate,
        "transport": "remote_mcp",
        "operations": list(capabilities or []),
        "risk": risk,
        "fallback": list(fallback or []),
        "requiresLiveCheck": True,
        "requiresEvidence": True,
        "executionPlane": "external_node",
        "clientExecution": False,
    }



PERSONAL_TRUSTED_STATES = {"OWNED_VERIFIED", "DELEGATED_VERIFIED"}


def _personal_resource_required(coordinate, connection):
    if coordinate in LOCAL_COORDINATES:
        return True
    for route in connection.get("resolve", []):
        if isinstance(route, str) and (route.startswith("connector:") or route.startswith("runtime_connector:")):
            return True
    return False


def _resource_freshness(acceptance, reg):
    trust = reg.get("policy", {}).get("personal_resource_trust", {}) if isinstance(reg, dict) else {}
    freshness_policy = trust.get("freshness", {}) if isinstance(trust, dict) else {}
    max_age = int(freshness_policy.get("max_age_seconds", 86400))
    stamp_value = acceptance.get("last_verified") if isinstance(acceptance, dict) else None
    if not stamp_value:
        return {"status": "STALE", "lastVerified": None, "ageSeconds": None, "maxAgeSeconds": max_age, "reason": "missing_last_verified"}
    try:
        stamp = datetime.fromisoformat(str(stamp_value).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        age = max(0, int((datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds()))
        return {
            "status": "FRESH" if age <= max_age else "STALE",
            "lastVerified": stamp_value,
            "ageSeconds": age,
            "maxAgeSeconds": max_age,
            "clock": "UTC",
        }
    except Exception:
        return {"status": "STALE", "lastVerified": stamp_value, "ageSeconds": None, "maxAgeSeconds": max_age, "reason": "invalid_last_verified"}


def _build_personal_resource_audit(coordinate, connection, acceptance, reg):
    required = _personal_resource_required(coordinate, connection)
    routes = list(connection.get("resolve", []))
    allowed_ops = list(connection.get("capabilities", []))
    if not required:
        return {
            "ci_id": coordinate,
            "route": routes,
            "authority": None,
            "verification_status": "NOT_APPLICABLE",
            "evidence": acceptance.get("evidence") if isinstance(acceptance, dict) else None,
            "last_verified": acceptance.get("last_verified") if isinstance(acceptance, dict) else None,
            "allowed_ops": allowed_ops,
            "blocker": None,
            "personal_resource": False,
            "trusted": True,
        }

    authority = acceptance.get("authority") if isinstance(acceptance, dict) else None
    authority = authority if isinstance(authority, dict) else {"kind": "unknown"}
    evidence = acceptance.get("evidence") if isinstance(acceptance, dict) else None
    provenance = acceptance.get("provenance") if isinstance(acceptance, dict) else None
    state = str(acceptance.get("state", "UNKNOWN")).upper() if isinstance(acceptance, dict) else "UNKNOWN"
    freshness = _resource_freshness(acceptance or {}, reg)

    blocker = acceptance.get("blocker") if isinstance(acceptance, dict) else None
    if state in {"BLOCKED", "UNAVAILABLE"}:
        verification_status = "BLOCKED"
        blocker = blocker or "resource_state_blocked"
    elif state not in {"VERIFIED", "CALLABLE"}:
        verification_status = "AVAILABLE_UNVERIFIED"
        blocker = blocker or "resource_not_fully_verified"
    elif freshness.get("status") != "FRESH":
        verification_status = "STALE"
        blocker = blocker or freshness.get("reason") or "verification_stale"
    elif not evidence or not provenance:
        verification_status = "AVAILABLE_UNVERIFIED"
        blocker = blocker or "evidence_or_provenance_missing"
    elif str(authority.get("kind", "")).lower() == "owner":
        verification_status = "OWNED_VERIFIED"
    elif str(authority.get("kind", "")).lower() == "delegated":
        verification_status = "DELEGATED_VERIFIED"
    else:
        verification_status = "AVAILABLE_UNVERIFIED"
        blocker = blocker or "explicit_authority_missing"

    return {
        "ci_id": coordinate,
        "route": routes,
        "authority": authority,
        "verification_status": verification_status,
        "evidence": evidence,
        "last_verified": freshness.get("lastVerified"),
        "allowed_ops": allowed_ops,
        "blocker": blocker,
        "personal_resource": True,
        "trusted": verification_status in PERSONAL_TRUSTED_STATES,
        "freshness": freshness,
        "provenance": provenance,
    }


def resource_audit(target=None):
    reg = _registry()
    snapshot = _acceptance()
    connections = _connections(reg)
    states = _states(snapshot)
    if target:
        if target not in connections:
            return {"ok": False, "error": "unknown_coordinate", "coordinate": target}
        audit = _build_personal_resource_audit(target, connections.get(target, {}), states.get(target, {}), reg)
        return {"ok": True, "resource": audit}
    resources = []
    for coordinate, connection in connections.items():
        audit = _build_personal_resource_audit(coordinate, connection, states.get(coordinate, {}), reg)
        if audit.get("personal_resource"):
            resources.append(audit)
    summary = {
        "total": len(resources),
        "owned_verified": sum(1 for row in resources if row.get("verification_status") == "OWNED_VERIFIED"),
        "delegated_verified": sum(1 for row in resources if row.get("verification_status") == "DELEGATED_VERIFIED"),
        "available_unverified": sum(1 for row in resources if row.get("verification_status") == "AVAILABLE_UNVERIFIED"),
        "stale": sum(1 for row in resources if row.get("verification_status") == "STALE"),
        "blocked": sum(1 for row in resources if row.get("verification_status") == "BLOCKED"),
    }
    return {"ok": True, "summary": summary, "resources": resources}


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
    freshness = _snapshot_freshness(snapshot, reg)
    state = acceptance.get("state", "UNKNOWN")
    state_source = "acceptance_snapshot"
    evidence = acceptance.get("evidence")
    evidence_current = freshness.get("status") == "FRESH"
    if selected == "CI.VAULT":
        live = vault_node.status()
        write_probe = live.get("writeProbe") if isinstance(live.get("writeProbe"), dict) else {}
        live_rw = bool(live.get("ok") and live.get("writable") and write_probe.get("ok"))
        if live_rw:
            state = "VERIFIED"
        elif live.get("ok"):
            state = "VERIFIED_PARTIAL"
        else:
            state = "UNAVAILABLE"
        state_source = "live_probe"
        evidence = live
        evidence_current = live_rw
        freshness = {"status": "FRESH" if live_rw else "UNKNOWN", "source": "live_probe", "checkedAt": datetime.now(timezone.utc).isoformat()}
    if state == "BLOCKED":
        execution = "BLOCKED"
    elif selected == "CI.LINK":
        execution = "CI_LINK"
    elif selected in LOCAL_COORDINATES:
        execution = "ORANGE_LOCAL_SAFE"
    else:
        execution = "DELEGATE_CONNECTOR"
    personal_resource = _build_personal_resource_audit(selected, connection, acceptance, reg)
    if selected == "CI.VAULT" and state != "VERIFIED":
        personal_resource = dict(personal_resource)
        personal_resource["trusted"] = False
        personal_resource["verification_status"] = "AVAILABLE_UNVERIFIED"
        personal_resource["blocker"] = "vault_live_rw_probe_failed"
    candidate_execution = execution
    if personal_resource.get("personal_resource") and not personal_resource.get("trusted"):
        execution = "PERSONAL_TRUST_BLOCKED"
    routes = connection.get("resolve", [])
    capabilities = connection.get("capabilities", [])
    fallback = connection.get("fallback", [])
    risk = connection.get("risk")
    if execution == "DELEGATE_CONNECTOR":
        delegation = _delegation_from_routes(selected, routes, capabilities, risk, fallback)
    elif execution == "ORANGE_LOCAL_SAFE":
        delegation = _external_node_delegation(selected, capabilities, risk, fallback)
    else:
        delegation = None
    return {
        "ok": state not in {"BLOCKED", "UNAVAILABLE"} and execution != "PERSONAL_TRUST_BLOCKED",
        "node": NODE_ID,
        "intent": intent,
        "coordinate": selected,
        "state": state,
        "effectiveState": "VERIFY_REQUIRED" if freshness.get("status") != "FRESH" and state != "BLOCKED" else state,
        "stateSource": state_source,
        "freshness": freshness,
        "execution": execution,
        "candidateExecution": candidate_execution,
        "personalResource": personal_resource,
        "route": routes,
        "fallback": fallback,
        "risk": risk,
        "capabilities": capabilities,
        "limitation": acceptance.get("limitation"),
        "evidence": evidence,
        "evidenceCurrent": evidence_current,
        "connectorHint": delegation.get("executor") if delegation else None,
        "delegation": delegation,
    }

LIVE_DELEGATION_STATES = {"VERIFIED", "VERIFIED_PARTIAL", "CALLABLE"}


def delegate(intent: str, operation: str, target=None):
    resolution = resolve(intent, target)
    coordinate = resolution.get("coordinate")
    connection = _connections(_registry()).get(coordinate, {})
    capabilities = list(connection.get("capabilities", []))
    auto_ops = list(connection.get("autoOperations", []))
    if operation not in capabilities:
        return {
            "ok": False, "executed": False, "coordinate": coordinate,
            "operation": operation, "searchRequired": False,
            "error": "operation_not_registered", "allowed": capabilities,
        }
    delegation = resolution.get("delegation")
    if delegation is None and coordinate == "CI.LINK":
        delegation = {
            "kind": "ci_contact", "executor": "CI.LINK",
            "coordinate": coordinate, "operations": capabilities,
            "risk": resolution.get("risk"), "fallback": resolution.get("fallback", []),
            "requiresLiveCheck": True, "requiresEvidence": True,
            "executionPlane": "external_node", "clientExecution": False,
        }
    personal_resource = resolution.get("personalResource", {})
    personal_trusted = (not personal_resource.get("personal_resource")) or bool(personal_resource.get("trusted"))
    route_usable = resolution.get("state") in LIVE_DELEGATION_STATES and personal_trusted
    freshness_status = resolution.get("freshness", {}).get("status", "UNKNOWN")
    automatic = bool(route_usable and operation in auto_ops and delegation)
    freshness_check_required = freshness_status != "FRESH"
    return {
        "ok": bool(route_usable and delegation), "executed": False,
        "mode": "auto_delegate" if automatic else "gated_delegate",
        "coordinate": coordinate, "operation": operation,
        "automatic": automatic,
        "permissionRequired": bool(operation not in auto_ops),
        "freshnessCheckRequired": freshness_check_required,
        "searchRequired": False, "resolution": resolution,
        "delegation": delegation,
        "client": {
            "role": "thin_surface", "executesOperation": False,
            "allowedLocal": ["input_capture", "render_result", "ephemeral_cache", "connectivity", "secure_auth_handoff", "device_presence"],
        },
        "condition": {
            "coordinateKnown": True, "operationRegistered": True,
            "routeUsable": route_usable, "boundExecutor": bool(delegation),
            "snapshotFreshness": freshness_status,
        },
        "expectedResult": {
            "terminalState": "VERIFIED", "evidenceRequired": True,
            "onFailure": "BLOCKED_OR_DEGRADED",
        },
        "nextAction": (
            "REVERIFY_PERSONAL_RESOURCE" if personal_resource.get("personal_resource") and not personal_trusted
            else "VERIFY_BOUND_NODE_THEN_EXECUTE" if automatic and freshness_check_required
            else "EXECUTE_EXTERNAL_NODE" if automatic
            else "REQUEST_PERMISSION_FOR_BOUND_NODE"
        ),
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
    if resolution.get("execution") == "PERSONAL_TRUST_BLOCKED":
        return {"ok": False, "mode": mode, "resolution": resolution, "executed": False, "error": "personal_resource_unverified"}
    if resolution.get("execution") == "DELEGATE_CONNECTOR":
        delegation = resolution.get("delegation")
        return {
            "ok": bool(delegation),
            "mode": "delegate",
            "requestedMode": mode,
            "resolution": resolution,
            "executed": False,
            "executor": "CALLER_RUNTIME",
            "delegation": delegation,
            "nextAction": "CALL_DELEGATED_EXECUTOR" if delegation else "NO_CALLABLE_DELEGATION",
            "evidenceRequired": True,
        }

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
        body = upstream.get("body") if isinstance(upstream.get("body"), dict) else {}
        accepted = bool(body.get("evidence", {}).get("requestAccepted"))
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
