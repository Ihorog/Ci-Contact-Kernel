#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import py_compile
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "Ihorog/Ci-Contact-Kernel"
API = f"https://api.github.com/repos/{REPO}/contents/operator-node"
TARGET = Path("/home/kazkar/cit/modules/ci_operator")
BACKUPS = TARGET / ".backups"
ALLOWED = [
    "ci_operator.py",
    "provider_adapters.py",
    "ci_operator_runtime.py",
    "operator_telemetry.py",
    "queue_contract.py",
    "vault_node.py",
    "release_manager.py",
    "self_update.py",
    "mcp_probe.py",
]
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def _git_blob_sha(content: bytes):
    head = f"blob {len(content)}\0".encode()
    return hashlib.sha1(head + content).hexdigest()


def _fetch_json(url):
    req = Request(url, headers={"accept": "application/vnd.github+json", "user-agent": "ci-operator-self-update/1"})
    with urlopen(req, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_file(name, commit):
    meta = _fetch_json(f"{API}/{quote(name)}?ref={commit}")
    encoded = meta.get("content")
    if not encoded or meta.get("encoding") != "base64":
        raise RuntimeError(f"missing_base64_content:{name}")
    content = base64.b64decode(encoded)
    actual = _git_blob_sha(content)
    expected = meta.get("sha")
    if actual != expected:
        raise RuntimeError(f"blob_sha_mismatch:{name}")
    return content, expected


def prepare(commit):
    if not SHA_RE.fullmatch(str(commit or "")):
        return {"ok": False, "error": "exact_40_hex_commit_required", "executed": False}
    TARGET.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="ci-operator-stage-", dir=str(TARGET)))
    evidence = []
    try:
        for name in ALLOWED:
            content, blob = _fetch_file(name, commit)
            path = stage / name
            path.write_bytes(content)
            py_compile.compile(str(path), doraise=True)
            evidence.append({"file": name, "gitBlobSha": blob, "bytes": len(content)})
        return {"ok": True, "executed": False, "prepared": True, "commit": commit, "stage": str(stage), "files": evidence}
    except Exception as exc:
        shutil.rmtree(stage, ignore_errors=True)
        return {"ok": False, "executed": False, "error": str(exc)[:300]}


def apply(commit, activate=False):
    prepared = prepare(commit)
    if not prepared.get("ok"):
        return prepared
    stage = Path(prepared["stage"])
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = BACKUPS / f"{stamp}-{commit[:12]}"
    backup.mkdir(parents=True, exist_ok=True)
    try:
        for name in ALLOWED:
            current = TARGET / name
            if current.exists():
                shutil.copy2(current, backup / name)
        for name in ALLOWED:
            os.replace(stage / name, TARGET / name)
        shutil.rmtree(stage, ignore_errors=True)
    except Exception as exc:
        return {"ok": False, "executed": False, "error": "apply_failed", "message": str(exc)[:300], "backup": str(backup)}

    result = {
        "ok": True,
        "executed": True,
        "commit": commit,
        "backup": str(backup),
        "files": prepared["files"],
        "activationScheduled": False,
    }
    if activate:
        subprocess.Popen(["sh", "-c", f"sleep 2; kill -TERM {os.getpid()}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        result["activationScheduled"] = True
    return result
