#!/usr/bin/env python3
import time

import ci_operator as base
import ci_orchestrator
import operator_telemetry as telemetry
import provider_adapters
import release_manager
import self_update as updater
import vault_node
import home_repair

VERSION = "1.7.0"
NODE_ID = base.NODE_ID


def _evidence_present(result):
    if not isinstance(result, dict):
        return False
    if result.get("evidence") or result.get("upstream") or result.get("verification"):
        return True
    if result.get("executed") and result.get("commit") and (
        (result.get("backup") and result.get("files"))
        or (result.get("runtimeBackup") and result.get("connectorBackup"))
    ):
        return True
    return False


def _record(event, started, result, coordinate=None, route=None, fallback=False):
    elapsed = (time.perf_counter() - started) * 1000
    if isinstance(result, dict):
        coordinate = result.get("coordinate") or result.get("resolution", {}).get("coordinate") or coordinate
        route = result.get("execution") or result.get("executor") or route
        ok = bool(result.get("ok"))
        executed = bool(result.get("executed"))
        error = result.get("error")
    else:
        ok, executed, error = True, False, None
    telemetry.record(
        event, coordinate=coordinate, route=route,
        outcome="ok" if ok else "error", latency_ms=elapsed,
        executed=executed, evidence=_evidence_present(result),
        fallback=fallback, error_code=error,
    )


def status():
    value = dict(base.status())
    value["version"] = VERSION
    value["providerAdapters"] = provider_adapters.probe_all()
    value["orchestration"] = ci_orchestrator.status()
    value["selfUpdate"] = {**updater.source_status(),
        "repository": updater.REPO, "exactCommitRequired": True,
        "allowlistedFiles": list(updater.ALLOWED)}
    value["releaseManager"] = {
        "version": release_manager.VERSION,
        "canonicalRepository": updater.REPO,
        "connectorPatch": True,
        "rollback": True,
    }
    value["telemetry"] = {
        "schema": "ci.operator.telemetry/v1",
        "piiPolicy": "intent_payload_provider_output_not_recorded",
        "metricsTool": "ci_operator_metrics",
    }
    return value


def resolve(intent: str, target=None):
    started = time.perf_counter()
    value = dict(base.resolve(intent, target))
    adapter = provider_adapters.probe(value.get("coordinate"))
    value["providerAdapter"] = adapter
    fallback = False
    if value.get("execution") == "DELEGATE_CONNECTOR" and adapter.get("directRead"):
        value["execution"] = "ORANGE_PROVIDER_READ"
        value["delegateFallback"] = "DELEGATE_CONNECTOR"
    elif value.get("execution") == "DELEGATE_CONNECTOR":
        fallback = True
    _record("resolve", started, value, fallback=fallback)
    return value


def delegate(intent: str, operation: str, target=None):
    started = time.perf_counter()
    result = base.delegate(intent, operation, target)
    result["operatorRuntimeVersion"] = VERSION
    _record("delegate", started, result, route="EXTERNAL_NODE")
    return result


def dispatch(intent: str, target=None, mode="contact"):
    started = time.perf_counter()
    result = base.dispatch(intent, target, mode)
    if isinstance(result, dict):
        result["operatorRuntimeVersion"] = VERSION
    _record("dispatch", started, result, route="CI.LINK")
    return result


def resource_audit(target=None):
    value = base.resource_audit(target)
    if isinstance(value, dict):
        value["operatorRuntimeVersion"] = VERSION
    return value


def executor_status():
    return {"ok": True, "node": NODE_ID, "operatorRuntimeVersion": VERSION, "adapters": provider_adapters.probe_all(), "vault": vault_node.status(), "home": home_repair.home_status()}


def home_status():
    value = home_repair.home_status()
    value["node"] = NODE_ID
    value["operatorRuntimeVersion"] = VERSION
    return value


def home_repair_action(action: str, idempotency_key: str):
    started = time.perf_counter()
    result = home_repair.execute(action, idempotency_key)
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    coordinate = "CI.VAULT" if action.startswith("vault.") else "CI.HOME"
    _record("home_repair_" + str(action).replace(".", "_"), started, result, coordinate=coordinate, route="ORANGE_HOME_REPAIR")
    return result


def vault(action: str, **kwargs):
    started = time.perf_counter()
    result = vault_node.execute(action, **kwargs)
    result["operatorRuntimeVersion"] = VERSION
    _record("vault_" + str(action), started, result, coordinate="CI.VAULT", route="ORANGE_VAULT")
    return result


def execute_read(coordinate: str, operation: str):
    started = time.perf_counter()
    audit = base.resource_audit(coordinate)
    resource = audit.get("resource", {}) if isinstance(audit, dict) else {}
    if resource.get("personal_resource") and not resource.get("trusted"):
        result = {
            "ok": False,
            "executed": False,
            "coordinate": coordinate,
            "operation": operation,
            "error": "personal_resource_unverified",
            "resourceAudit": resource,
        }
        result["node"] = NODE_ID
        result["operatorRuntimeVersion"] = VERSION
        _record("provider_read", started, result, coordinate=coordinate, route="PERSONAL_TRUST_BLOCKED")
        return result
    result = provider_adapters.execute_read(coordinate, operation)
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    _record("provider_read", started, result, coordinate=coordinate, route="ORANGE_PROVIDER_READ")
    return result


def operator_update(commit: str, activate=False):
    started = time.perf_counter()
    result = updater.apply(commit, bool(activate))
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    _record("operator_update", started, result, coordinate="CI.ORANGE", route="LOCAL_MODEL_UPDATE")
    return result


def operator_release(commit: str, activate=False):
    started = time.perf_counter()
    result = release_manager.deploy(commit, activate)
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    _record("operator_release", started, result, coordinate="CI.ORANGE", route="LOCAL_MODEL_RELEASE")
    return result


def orchestrate(template="distributed_acceptance"):
    started = time.perf_counter()
    result = ci_orchestrator.run_template(template)
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    _record("orchestrate", started, result, coordinate="CI.ORANGE", route="EXECUTOR_MESH")
    return result


def metrics(limit=500):
    value = telemetry.summary(limit)
    value["node"] = NODE_ID
    value["operatorRuntimeVersion"] = VERSION
    return value


# --- H8: one-time sealed secret transfer (values are never returned or logged) ---
import base64 as _b64
import hashlib as _hashlib
import json as _json
import os as _os
import re as _re
import secrets as _secrets
import subprocess as _subprocess
from pathlib import Path as _Path

SECRETS_DIR = _Path('/home/kazkar/cit/state/.ci-secrets')
PENDING_DIR = SECRETS_DIR / '.pending'
SECRET_TTL = 900
_NAME_RE = _re.compile(r'^[A-Za-z0-9_]{1,64}$')
_RID_RE = _re.compile(r'^[a-f0-9]{32}$')


def _secret_dirs():
    old = _os.umask(0o077)
    try:
        for d in (SECRETS_DIR, PENDING_DIR):
            d.mkdir(parents=True, exist_ok=True)
            _os.chmod(d, 0o700)
    finally:
        _os.umask(old)


def _purge_pending():
    now = time.time()
    for p in PENDING_DIR.glob('*'):
        try:
            if now - p.stat().st_mtime > SECRET_TTL:
                p.unlink()
        except OSError:
            pass


def _crypto_backend():
    try:
        from cryptography.hazmat.primitives.asymmetric import rsa, padding  # noqa: F401
        return 'cryptography'
    except Exception:
        return 'openssl'


def secret_keygen(name: str):
    try:
        if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
            return {'ok': False, 'error': 'invalid_name'}
        _secret_dirs(); _purge_pending()
        rid = _secrets.token_hex(16)
        key_path = PENDING_DIR / f'{rid}.key'
        backend = _crypto_backend()
        old = _os.umask(0o077)
        try:
            if backend == 'cryptography':
                from cryptography.hazmat.primitives.asymmetric import rsa
                from cryptography.hazmat.primitives import serialization
                key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
                pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption())
                fd = _os.open(str(key_path), _os.O_WRONLY | _os.O_CREAT | _os.O_EXCL, 0o600)
                with _os.fdopen(fd, 'wb') as f:
                    f.write(pem)
                pub = key.public_key().public_bytes(serialization.Encoding.PEM,
                                                    serialization.PublicFormat.SubjectPublicKeyInfo).decode()
            else:
                p = _subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072',
                                     '-out', str(key_path)], capture_output=True, timeout=120)
                if p.returncode:
                    return {'ok': False, 'error': 'keygen_failed', 'backend': backend}
                _os.chmod(key_path, 0o600)
                p = _subprocess.run(['openssl', 'pkey', '-in', str(key_path), '-pubout'], capture_output=True, timeout=30)
                if p.returncode:
                    key_path.unlink(missing_ok=True)
                    return {'ok': False, 'error': 'pubkey_failed', 'backend': backend}
                pub = p.stdout.decode()
        finally:
            _os.umask(old)
        (PENDING_DIR / f'{rid}.json').write_text(_json.dumps({'name': name, 'created': int(time.time())}))
        return {'ok': True, 'request_id': rid, 'name': name, 'algorithm': 'RSA-OAEP-3072-SHA256',
                'public_key_pem': pub, 'ttl_seconds': SECRET_TTL, 'backend': backend}
    except Exception as exc:
        return {'ok': False, 'error': 'keygen_exception', 'type': type(exc).__name__}


def _rsa_decrypt(key_path, ciphertext):
    if _crypto_backend() == 'cryptography':
        from cryptography.hazmat.primitives import serialization, hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
        return key.decrypt(ciphertext, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                                                    algorithm=hashes.SHA256(), label=None))
    p = _subprocess.run(['openssl', 'pkeyutl', '-decrypt', '-inkey', str(key_path),
                         '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256',
                         '-pkeyopt', 'rsa_mgf1_md:sha256'],
                        input=ciphertext, capture_output=True, timeout=30)
    if p.returncode:
        raise RuntimeError('decrypt_failed')
    return p.stdout


def secret_set(request_id: str, name: str, ciphertext_b64: str):
    key_path = meta_path = None
    try:
        if not isinstance(request_id, str) or not _RID_RE.fullmatch(request_id):
            return {'ok': False, 'error': 'invalid_request_id'}
        if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
            return {'ok': False, 'error': 'invalid_name'}
        _secret_dirs()
        key_path = PENDING_DIR / f'{request_id}.key'
        meta_path = PENDING_DIR / f'{request_id}.json'
        if not key_path.exists() or not meta_path.exists():
            return {'ok': False, 'error': 'unknown_or_used_request'}
        meta = _json.loads(meta_path.read_text())
        if meta.get('name') != name:
            return {'ok': False, 'error': 'name_mismatch'}
        if time.time() - float(meta.get('created', 0)) > SECRET_TTL:
            return {'ok': False, 'error': 'request_expired'}
        try:
            value = _rsa_decrypt(key_path, _b64.b64decode(str(ciphertext_b64), validate=True))
        except Exception:
            return {'ok': False, 'error': 'decrypt_failed'}
        value = value.strip()
        if not value or b'\n' in value or b'\r' in value:
            return {'ok': False, 'error': 'invalid_value_shape'}
        target = SECRETS_DIR / name.lower()
        tmp = SECRETS_DIR / f'.{name.lower()}.tmp.{_secrets.token_hex(4)}'
        old = _os.umask(0o077)
        try:
            fd = _os.open(str(tmp), _os.O_WRONLY | _os.O_CREAT | _os.O_EXCL, 0o600)
            with _os.fdopen(fd, 'wb') as f:
                f.write(value); f.flush(); _os.fsync(f.fileno())
            _os.chmod(tmp, 0o600)
            _os.replace(tmp, target)
        finally:
            _os.umask(old)
            if tmp.exists():
                tmp.unlink()
        st = target.stat()
        return {'ok': True, 'name': name, 'path': str(target), 'mode': oct(st.st_mode & 0o777),
                'length': len(value), 'sha256_prefix': _hashlib.sha256(value).hexdigest()[:8]}
    except Exception as exc:
        return {'ok': False, 'error': 'set_exception', 'type': type(exc).__name__}
    finally:
        for p in (key_path, meta_path):
            try:
                if p is not None:
                    p.unlink(missing_ok=True)
            except Exception:
                pass


def groq_health():
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    out = {'ok': False}
    try:
        path = SECRETS_DIR / 'groq_api_key'
        if not path.exists():
            return {'ok': False, 'error': 'secret_missing'}
        key = path.read_text().strip()
        hdr = {'Authorization': 'Bearer ' + key, 'User-Agent': 'ci-operator-groq-health/1',
               'Content-Type': 'application/json'}

        def _call(url, body=None):
            req = Request(url, data=body, headers=hdr, method='POST' if body else 'GET')
            try:
                with urlopen(req, timeout=20) as r:
                    return r.status, r.read()
            except HTTPError as e:
                return e.code, b''
        code, raw = _call('https://api.groq.com/openai/v1/models')
        out['models_http'] = code
        ids = []
        if code == 200:
            ids = [m.get('id') for m in (_json.loads(raw).get('data') or []) if isinstance(m, dict)]
            out['model_count'] = len(ids)
        prefs = ['llama-3.1-8b-instant', 'llama3-8b-8192', 'gemma2-9b-it', 'llama-3.3-70b-versatile']
        model = next((m for m in prefs if m in ids), None) or next((m for m in ids if m and 'whisper' not in m and 'guard' not in m and 'tts' not in m), None)
        if model:
            body = _json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'ping'}], 'max_tokens': 5}).encode()
            ccode, _ = _call('https://api.groq.com/openai/v1/chat/completions', body)
            out['chat_http'] = ccode
            out['model'] = model
        out['ok'] = out.get('models_http') == 200 and out.get('chat_http') == 200
        return out
    except Exception as exc:
        out['error'] = 'health_exception'; out['type'] = type(exc).__name__
        return out
