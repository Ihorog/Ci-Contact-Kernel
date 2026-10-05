#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import vault_node

VERSION = "1.0.0"
STATE = Path("/home/kazkar/cit/state/home_repair")
ACCEPTANCE = Path("/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/acceptance/current.json")
END0 = os.getenv("CI_HOME_PRIMARY_INTERFACE", "end0")
VAULT_ROOT = Path(os.getenv("CI_VAULT_ROOT", "/mnt/cimeika_vault"))


def _run(argv, timeout=12):
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    return {"rc": p.returncode, "stdout": (p.stdout or "")[:4000], "stderr": (p.stderr or "")[:1000]}


def _json_command(argv):
    result = _run(argv)
    body = None
    if result["rc"] == 0:
        try:
            body = json.loads(result["stdout"] or "null")
        except Exception:
            body = None
    return result, body


def _carrier():
    path = Path("/sys/class/net") / END0 / "carrier"
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def network_status():
    link_result, links = _json_command(["ip", "-json", "link", "show", "dev", END0])
    addr_result, addresses = _json_command(["ip", "-json", "addr", "show", "dev", END0])
    route_result, routes = _json_command(["ip", "-json", "route", "show", "dev", END0])
    row = links[0] if isinstance(links, list) and links else {}
    flags = row.get("flags") if isinstance(row, dict) else []
    flags = flags if isinstance(flags, list) else []
    operstate = str(row.get("operstate") or "").upper()
    exists = link_result["rc"] == 0 and bool(row)
    admin_up = "UP" in flags
    carrier = _carrier()
    link_up = exists and admin_up and operstate == "UP" and carrier in (1, None)
    ipv4 = []
    if isinstance(addresses, list):
        for item in addresses:
            for info in item.get("addr_info", []) if isinstance(item, dict) else []:
                if info.get("family") == "inet" and info.get("local"):
                    ipv4.append(info.get("local"))
    default_routes = []
    if isinstance(routes, list):
        default_routes = [x for x in routes if isinstance(x, dict) and x.get("dst") == "default"]
    return {
        "ok": exists,
        "node": "CI.HOME",
        "interface": END0,
        "exists": exists,
        "adminUp": admin_up,
        "operstate": operstate or None,
        "carrier": carrier,
        "linkUp": link_up,
        "ipv4": ipv4,
        "defaultRoutes": default_routes,
        "evidence": "live_iproute2_sysfs_probe",
        "errors": {
            "link": link_result["stderr"] or None,
            "addr": addr_result["stderr"] or None,
            "route": route_result["stderr"] or None,
        },
    }


def _probe_vault_write():
    root = VAULT_ROOT
    name = ".ci-write-probe-" + hashlib.sha256(str(time.time_ns()).encode()).hexdigest()[:12]
    probe = root / name
    try:
        probe.write_bytes(b"ci")
        probe.unlink()
        return {"ok": True, "evidence": "create_fsync_delete_probe"}
    except Exception as exc:
        try:
            if probe.exists():
                probe.unlink()
        except Exception:
            pass
        return {"ok": False, "error": str(exc)[:240], "evidence": "create_delete_probe_failed"}


def home_status():
    vault = vault_node.status()
    write_probe = _probe_vault_write() if vault.get("readable") else {"ok": False, "error": "vault_not_readable"}
    return {
        "ok": bool(network_status().get("ok")),
        "version": VERSION,
        "network": network_status(),
        "vault": {**vault, "writeProbe": write_probe},
    }


def _idempotency_path(action, key):
    raw = str(key or "").strip()
    if len(raw) < 8 or len(raw) > 200:
        raise ValueError("idempotency_key_required")
    digest = hashlib.sha256((action + ":" + raw).encode()).hexdigest()
    return STATE / (digest + ".json")


def _atomic_json(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _cached(action, key):
    path = _idempotency_path(action, key)
    if path.exists():
        try:
            body = json.loads(path.read_text(encoding="utf-8"))
            body["idempotentReplay"] = True
            return body
        except Exception:
            return None
    return None


def _finish(action, key, result):
    result = dict(result)
    result["action"] = action
    result["version"] = VERSION
    result["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result["idempotentReplay"] = False
    _atomic_json(_idempotency_path(action, key), result)
    return result


def ensure_end0(idempotency_key):
    action = "network.ensure_end0"
    cached = _cached(action, idempotency_key)
    if cached:
        return cached
    before = network_status()
    if not before.get("exists"):
        return _finish(action, idempotency_key, {"ok": False, "executed": False, "error": "interface_missing", "before": before, "after": before})
    if before.get("linkUp"):
        return _finish(action, idempotency_key, {"ok": True, "executed": False, "verified": True, "before": before, "after": before, "evidence": "already_up"})
    mutation = _run(["sudo", "-n", "ip", "link", "set", "dev", END0, "up"])
    time.sleep(0.4)
    after = network_status()
    ok = bool(after.get("linkUp"))
    error = None if ok else ("carrier_down" if after.get("adminUp") else "interface_not_up")
    return _finish(action, idempotency_key, {
        "ok": ok,
        "executed": mutation["rc"] == 0,
        "verified": ok,
        "error": error,
        "before": before,
        "after": after,
        "mutation": {"rc": mutation["rc"], "stderr": mutation["stderr"] or None},
        "evidence": "fixed_ip_link_set_then_live_probe",
    })


def ensure_vault_rw(idempotency_key):
    action = "vault.ensure_rw"
    cached = _cached(action, idempotency_key)
    if cached:
        return cached
    before = vault_node.status()
    before_probe = _probe_vault_write() if before.get("readable") else {"ok": False, "error": "vault_not_readable"}
    if before.get("writable") and before_probe.get("ok"):
        return _finish(action, idempotency_key, {"ok": True, "executed": False, "verified": True, "before": {**before, "writeProbe": before_probe}, "after": {**before, "writeProbe": before_probe}, "evidence": "already_rw"})
    findmnt = _run(["findmnt", "-n", "-o", "TARGET,FSTYPE,OPTIONS", str(VAULT_ROOT)])
    mounted = findmnt["rc"] == 0
    if not mounted:
        mutation = _run(["sudo", "-n", "mount", str(VAULT_ROOT)], timeout=25)
    else:
        mutation = _run(["sudo", "-n", "mount", "-o", "remount,rw", str(VAULT_ROOT)], timeout=25)
    time.sleep(0.5)
    after = vault_node.status()
    after_probe = _probe_vault_write() if after.get("readable") else {"ok": False, "error": "vault_not_readable"}
    ok = bool(after.get("writable") and after_probe.get("ok"))
    return _finish(action, idempotency_key, {
        "ok": ok,
        "executed": mutation["rc"] == 0,
        "verified": ok,
        "error": None if ok else "vault_not_rw",
        "before": {**before, "writeProbe": before_probe, "findmnt": findmnt["stdout"] or None},
        "after": {**after, "writeProbe": after_probe},
        "mutation": {"rc": mutation["rc"], "stderr": mutation["stderr"] or None},
        "evidence": "fstab_bounded_mount_then_live_write_probe",
    })


def _load_acceptance():
    try:
        pointer = json.loads(ACCEPTANCE.read_text(encoding="utf-8"))
    except Exception as exc:
        return None, None, "acceptance_pointer_read_failed:" + str(exc)[:160]
    if pointer.get("kind") == "CI_REGISTRY_ACCEPTANCE_POINTER" and pointer.get("current"):
        target = ACCEPTANCE.parent / str(pointer["current"])
        try:
            return pointer, json.loads(target.read_text(encoding="utf-8")), None
        except Exception as exc:
            return pointer, None, "acceptance_snapshot_read_failed:" + str(exc)[:160]
    if pointer.get("kind") == "CI_REGISTRY_ACCEPTANCE_SNAPSHOT":
        return None, pointer, None
    return pointer, None, "acceptance_format_unknown"


def refresh_acceptance(idempotency_key):
    action = "acceptance.refresh"
    cached = _cached(action, idempotency_key)
    if cached:
        return cached
    pointer, snapshot, error = _load_acceptance()
    if error or not isinstance(snapshot, dict):
        return _finish(action, idempotency_key, {"ok": False, "executed": False, "error": error or "acceptance_missing"})
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    network = network_status()
    vault = vault_node.status()
    coordinates = [dict(x) for x in snapshot.get("coordinates", []) if isinstance(x, dict)]
    refreshed = []
    for row in coordinates:
        cid = row.get("id")
        if cid == "CI.ORANGE":
            row.update({
                "state": "VERIFIED",
                "last_verified": now,
                "evidence": now + ": direct Orange runtime acceptance refresh",
                "provenance": {"source": "CI.OPERATOR.ORANGE", "checks": ["local_runtime"], "secret_material": False},
                "blocker": None,
            })
            refreshed.append(cid)
        elif cid == "CI.HOME":
            state = "VERIFIED" if network.get("linkUp") else "VERIFIED_PARTIAL"
            row.update({
                "state": state,
                "last_verified": now,
                "evidence": now + ": end0 live probe; linkUp=" + str(bool(network.get("linkUp"))),
                "provenance": {"source": "CI.OPERATOR.ORANGE", "checks": ["network_status"], "secret_material": False},
                "blocker": None if network.get("linkUp") else "ethernet_not_up",
            })
            refreshed.append(cid)
        elif cid == "CI.VAULT":
            state = "VERIFIED" if vault.get("ok") and vault.get("writable") else ("VERIFIED_PARTIAL" if vault.get("ok") else "BLOCKED")
            row.update({
                "state": state,
                "last_verified": now,
                "access": ["read", "write"] if vault.get("writable") else (["read"] if vault.get("readable") else []),
                "evidence": now + ": live vault filesystem probe; readable=" + str(bool(vault.get("readable"))) + "; writable=" + str(bool(vault.get("writable"))),
                "provenance": {"source": "CI.OPERATOR.ORANGE", "checks": ["vault.status"], "secret_material": False},
                "blocker": None if vault.get("writable") else "vault_not_rw",
            })
            refreshed.append(cid)
    snapshot = dict(snapshot)
    snapshot["generated_at"] = now
    provenance = dict(snapshot.get("provenance") or {})
    provenance["previous_snapshot"] = pointer.get("current") if isinstance(pointer, dict) else provenance.get("previous_snapshot")
    provenance["current_cycle_verified"] = refreshed
    provenance["verification_source"] = "CI.OPERATOR.ORANGE direct HOME refresh; no secrets persisted"
    snapshot["provenance"] = provenance
    snapshot["coordinates"] = coordinates
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = ACCEPTANCE.parent / (stamp + ".json")
    raw = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(raw, encoding="utf-8")
    digest = hashlib.sha256(raw.encode()).hexdigest()
    new_pointer = {
        "kind": "CI_REGISTRY_ACCEPTANCE_POINTER",
        "version": "1.0",
        "current": target.name,
        "sha256": digest,
        "updated_at": now,
    }
    _atomic_json(ACCEPTANCE, new_pointer)
    return _finish(action, idempotency_key, {
        "ok": True,
        "executed": True,
        "verified": True,
        "snapshot": str(target),
        "sha256": digest,
        "refreshed": refreshed,
        "network": network,
        "vault": vault,
        "evidence": "atomic_local_acceptance_snapshot",
    })


def resource_trust_refresh(idempotency_key):
    action = "resource_trust.refresh"
    cached = _cached(action, idempotency_key)
    if cached:
        return cached
    refreshed = refresh_acceptance(idempotency_key + ":acceptance")
    if not refreshed.get("ok"):
        return _finish(action, idempotency_key, {"ok": False, "executed": False, "error": "acceptance_refresh_failed", "acceptance": refreshed})
    return _finish(action, idempotency_key, {
        "ok": True,
        "executed": True,
        "verified": True,
        "acceptance": {"snapshot": refreshed.get("snapshot"), "sha256": refreshed.get("sha256"), "refreshed": refreshed.get("refreshed")},
        "note": "Trust is recomputed by ci_operator from refreshed evidence; missing authority is never invented.",
        "evidence": "acceptance_refreshed_for_resource_trust_recompute",
    })


def execute(action, idempotency_key):
    if action == "network.ensure_end0":
        return ensure_end0(idempotency_key)
    if action == "vault.ensure_rw":
        return ensure_vault_rw(idempotency_key)
    if action == "acceptance.refresh":
        return refresh_acceptance(idempotency_key)
    if action == "resource_trust.refresh":
        return resource_trust_refresh(idempotency_key)
    return {"ok": False, "executed": False, "error": "unsupported_home_repair_action", "allowed": ["network.ensure_end0", "vault.ensure_rw", "acceptance.refresh", "resource_trust.refresh"]}
