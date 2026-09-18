#!/usr/bin/env python3
"""Ci Keenetic LAN inventory sync -> state JSON + ci_unit.db for ci_devices."""
from __future__ import annotations
import hashlib, http.cookiejar, json, ssl, sqlite3, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

SECRET = Path('/home/kazkar/cit/state/.ci-secrets/keenetic_admin')
PASSPORTS = Path('/home/kazkar/cit/docs/ci-canon/ci-device-passports.json')
OUT_JSON = Path('/home/kazkar/cit/state/lan-inventory.json')
DB = Path('/home/kazkar/cit/state/ci_unit.db')
BASES = ['http://192.168.1.1', 'https://cimeiniy.keenetic.link', 'http://cimeiniy.keenetic.link']
LOGIN = 'admin'
ORANGE_MACS = {'02:07:e6:d6:da:1c', '10:08:36:62:62:d3'}
KIND_TO_CAT = {"node":"infrastructure","pc":"computers","phone":"phones","tablet":"tablets","tv":"tv_media","camera":"smart_home","appliance":"smart_home","iot":"smart_home","av":"tv_media","unknown":"unknown"}
KIND_TO_CLASS = {"node":"device.compute","pc":"device.computer","phone":"device.phone","tablet":"device.tablet","tv":"device.tv","camera":"device.camera","appliance":"device.appliance","iot":"device.iot","av":"device.media","unknown":"device.unknown"}

def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

def load_pw():
    if not SECRET.exists() or SECRET.stat().st_size == 0: raise SystemExit("NO_SECRET")
    return SECRET.read_text(encoding="utf-8").strip()

def auth(base, login, pw):
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(jar))
    url = base.rstrip("/") + "/auth"
    try:
        opener.open(urllib.request.Request(url, method="GET"), timeout=12); return opener
    except urllib.error.HTTPError as e:
        h = {k.lower(): v for k, v in e.headers.items()}
        realm, chal = h.get("x-ndm-realm") or "", h.get("x-ndm-challenge") or ""
        if e.code != 401 or not chal: return None
    ha1 = hashlib.md5(f"{login}:{realm}:{pw}".encode()).hexdigest()
    resp = hashlib.sha256((chal + ha1).encode()).hexdigest()
    body = json.dumps({"login": login, "password": resp}).encode()
    try:
        r = opener.open(urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"}), timeout=12)
        return opener if r.status in (200, 201) else None
    except urllib.error.HTTPError:
        return None

def rci(opener, base, query):
    data = json.dumps(query).encode()
    req = urllib.request.Request(base.rstrip("/") + "/rci/", data=data, headers={"Content-Type": "application/json"}, method="POST")
    with opener.open(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))

def walk_hosts(obj, out):
    if isinstance(obj, dict):
        if "mac" in obj and ("ip" in obj or "hostname" in obj or "name" in obj):
            out.append({"ip": obj.get("ip") or obj.get("address") or "0.0.0.0", "mac": (obj.get("mac") or "").lower(), "hostname": obj.get("hostname") or obj.get("name") or "", "active": bool(obj.get("active")), "ssid": obj.get("ssid")})
        for v in obj.values(): walk_hosts(v, out)
    elif isinstance(obj, list):
        for v in obj: walk_hosts(v, out)

def load_passports():
    if not PASSPORTS.exists(): return {}
    doc = json.loads(PASSPORTS.read_text(encoding="utf-8"))
    return {(p.get("mac") or "").lower(): p for p in (doc.get("passports") or []) if isinstance(p, dict)}

def build_devices(hosts, passports):
    by_mac = {}
    for h in hosts:
        mac = h.get("mac") or ""
        if not mac: continue
        by_mac.setdefault(mac, {"mac": mac, "rows": []})["rows"].append(h)
    devices = []
    orange_rows = []
    for m in list(ORANGE_MACS):
        orange_rows.extend(by_mac.pop(m, {"rows": []})["rows"])
    ips = sorted({r.get("ip") for r in orange_rows if r.get("ip") and r.get("ip") != "0.0.0.0"})
    devices.append({"source_id": "device:orangepi3-lts", "class_code": "device.compute", "role": "ci_server", "label": "orangepi3-lts", "owner": "system", "trust": "trusted", "active": 1, "category": "infrastructure", "kind": "node", "facts": {"hostname": "orangepi3-lts", "ips": ips or ["192.168.1.54", "192.168.1.132"], "macs": sorted(ORANGE_MACS), "interfaces": [{"name": "end0", "ip": "192.168.1.54", "mac": "02:07:e6:d6:da:1c"}, {"name": "wlan0", "ip": "192.168.1.132", "mac": "10:08:36:62:62:d3"}], "category": "infrastructure", "active": True}})
    for mac, bundle in by_mac.items():
        rows = bundle["rows"]
        primary = next((r for r in rows if r.get("active") and r.get("ip") not in (None, "", "0.0.0.0")), None)
        if primary is None: primary = next((r for r in rows if r.get("ip") not in (None, "", "0.0.0.0")), rows[0])
        p = dict(passports.get(mac) or {})
        if mac == "14:14:16:9e:f8:43":
            p.update({"owner": "unknown", "kind": "unknown", "truth_status": "OBSERVED", "label": p.get("label") or primary.get("hostname") or mac, "note": "Gaoshengda Wi-Fi OUI; unknown until identified"})
        kind = p.get("kind") or "unknown"
        cat = KIND_TO_CAT.get(kind, "unknown")
        class_code = KIND_TO_CLASS.get(kind, "device.unknown")
        active = 1 if any(r.get("active") for r in rows) else 0
        sid = f"device:lan:{mac.replace(':', '')}"
        devices.append({"source_id": sid, "class_code": class_code, "role": p.get("role") or kind, "label": p.get("label") or primary.get("hostname") or mac, "owner": p.get("owner") or "unknown", "trust": "trusted" if p.get("truth_status") == "VERIFIED" else "observed", "active": active, "category": cat, "kind": kind, "facts": {"ip": primary.get("ip"), "mac": mac, "hostname": primary.get("hostname"), "active": bool(active), "passport_label": p.get("label"), "kind": kind, "category": cat, "ssid": primary.get("ssid")}})
    return devices

def upsert_db(devices, ts):
    if not DB.exists():
        print("NO_DB", DB); return False
    con = sqlite3.connect(str(DB)); con.row_factory = sqlite3.Row
    cols = {r[1] for r in con.execute("PRAGMA table_info(entities)").fetchall()}
    if "id" not in cols:
        print("DB_SCHEMA_UNEXPECTED"); con.close(); return False
    fact_cols = {r[1] for r in con.execute("PRAGMA table_info(current_facts)").fetchall()}
    lan_ids = [d["source_id"] for d in devices if d["source_id"].startswith("device:lan:")]
    existing = [r["id"] for r in con.execute("SELECT id FROM entities WHERE id LIKE 'device:lan:%'").fetchall()]
    keep = set(lan_ids) | {"device:orangepi3-lts"}
    for eid in existing:
        if eid not in keep: con.execute("UPDATE entities SET active=0, last_seen=? WHERE id=?", (ts, eid))
    sql_ent = "INSERT INTO entities(id, class_code, role, label, owner, trust, active, last_seen) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET class_code=excluded.class_code, role=excluded.role, label=excluded.label, owner=excluded.owner, trust=excluded.trust, active=excluded.active, last_seen=excluded.last_seen"
    for d in devices:
        eid = d["source_id"]
        con.execute(sql_ent, (eid, d["class_code"], d["role"], d["label"], d["owner"], d["trust"], d["active"], ts))
        for key, val in (d.get("facts") or {}).items():
            vjson = json.dumps(val, ensure_ascii=False)
            if "value_type" in fact_cols:
                con.execute("INSERT INTO current_facts(entity_id, key, value_json, value_type, observed_at, source, confidence, evidence) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(entity_id, key) DO UPDATE SET value_json=excluded.value_json, observed_at=excluded.observed_at, source=excluded.source, confidence=excluded.confidence, evidence=excluded.evidence", (eid, key, vjson, type(val).__name__, ts, "keenetic.lan_sync", 1.0, "ci_keenetic_lan_sync"))
            else:
                con.execute("INSERT INTO current_facts(entity_id, key, value_json, observed_at, source, confidence, evidence) VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_id, key) DO UPDATE SET value_json=excluded.value_json, observed_at=excluded.observed_at, source=excluded.source", (eid, key, vjson, ts, "keenetic.lan_sync", 1.0, "ci_keenetic_lan_sync"))
        try:
            con.execute("INSERT OR IGNORE INTO relations(src_id, relation, dst_id, status, observed_at, source) VALUES(?,?,?,?,?,?)", (eid, "belongs_to", "network:home", "active", ts, "keenetic.lan_sync"))
        except sqlite3.Error:
            pass
        try:
            con.execute("INSERT INTO events(event_type, entity_id, before_json, after_json, occurred_at, source) VALUES(?,?,?,?,?,?)", ("lan_sync_upsert", eid, None, json.dumps({"label": d["label"], "category": d["category"]}, ensure_ascii=False), ts, "keenetic.lan_sync"))
        except sqlite3.Error:
            pass
    con.commit(); con.close(); return True

def main():
    pw = load_pw(); opener = base_ok = None
    for b in BASES:
        try:
            opener = auth(b, LOGIN, pw)
            if opener: base_ok = b; break
        except Exception as e:
            print("AUTH_EXC", b, type(e).__name__)
    if not opener: print("AUTH_FAILED"); sys.exit(3)
    data = rci(opener, base_ok, {"show": {"ip": {"hotspot": {}}}})
    hosts = []; walk_hosts(data, hosts)
    seen = set(); uniq = []
    for h in hosts:
        k = (h["mac"], h["ip"])
        if k in seen: continue
        seen.add(k); uniq.append(h)
    devices = build_devices(uniq, load_passports()); ts = now_iso()
    by_cat = {}
    for d in devices: by_cat[d["category"]] = by_cat.get(d["category"], 0) + 1
    doc = {"canon": "ci.lan.inventory/v1", "updated_at": ts, "source": "keenetic.rci.hotspot", "base": base_ok, "host_rows": len(uniq), "device_count": len(devices), "active_count": sum(1 for d in devices if d.get("active")), "by_category": by_cat, "devices": devices}
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    ok_db = upsert_db(devices, ts)
    print(json.dumps({"ok": True, "base": base_ok, "wrote": str(OUT_JSON), "device_count": len(devices), "active_count": doc["active_count"], "by_category": by_cat, "db_upsert": ok_db}, ensure_ascii=False))

if __name__ == "__main__":
    main()
