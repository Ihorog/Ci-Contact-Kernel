#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
from pathlib import Path

VERSION = "1.0.0"

PROVIDERS = {
    "CI.GITHUB": {
        "name": "GitHub",
        "cli": "gh",
        "credential_env": ["GH_TOKEN", "GITHUB_TOKEN"],
        "credential_paths": ["~/.config/gh/hosts.yml"],
        "commands": {
            "identity": ["gh", "api", "user", "--jq", ".login"],
            "inventory": ["gh", "repo", "list", "Ihorog", "--limit", "30", "--json", "name,url,isPrivate"],
        },
    },
    "CI.VERCEL": {
        "name": "Vercel",
        "cli": "vercel",
        "credential_env": ["VERCEL_TOKEN"],
        "credential_paths": ["~/.config/com.vercel.cli/auth.json", "~/.local/share/com.vercel.cli/auth.json"],
        "commands": {
            "identity": ["vercel", "whoami"],
        },
    },
    "CI.SUPABASE": {
        "name": "Supabase",
        "cli": "supabase",
        "credential_env": ["SUPABASE_ACCESS_TOKEN"],
        "credential_paths": ["~/.supabase/access-token"],
        "commands": {
            "inventory": ["supabase", "projects", "list", "--output", "json"],
        },
    },
    "CI.CLOUDFLARE": {
        "name": "Cloudflare",
        "cli": "wrangler",
        "credential_env": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY"],
        "credential_paths": ["~/.wrangler/config/default.toml", "~/.config/.wrangler/config/default.toml"],
        "commands": {
            "identity": ["wrangler", "whoami"],
        },
    },
}


def _present_path(raw):
    return Path(os.path.expanduser(raw)).exists()


def probe(coordinate):
    cfg = PROVIDERS.get(coordinate)
    if not cfg:
        return {"coordinate": coordinate, "state": "NO_ADAPTER", "directRead": False}
    cli_path = shutil.which(cfg["cli"])
    env_names = [name for name in cfg.get("credential_env", []) if os.getenv(name)]
    path_hits = [raw for raw in cfg.get("credential_paths", []) if _present_path(raw)]
    credential_signal = bool(env_names or path_hits)
    if not cli_path:
        state = "MISSING_CLI"
    elif not credential_signal:
        state = "AUTH_NOT_DETECTED"
    else:
        state = "CANDIDATE_READY"
    return {
        "coordinate": coordinate,
        "provider": cfg["name"],
        "state": state,
        "directRead": state == "CANDIDATE_READY",
        "cli": cfg["cli"],
        "cliPresent": bool(cli_path),
        "credentialSignal": credential_signal,
        "credentialEnvNames": env_names,
        "credentialPathsPresent": path_hits,
        "operations": sorted(cfg.get("commands", {}).keys()),
    }


def probe_all():
    rows = [probe(cid) for cid in PROVIDERS]
    return {
        "version": VERSION,
        "directReadCandidates": [row["coordinate"] for row in rows if row.get("directRead")],
        "providers": rows,
    }


def execute_read(coordinate, operation):
    cfg = PROVIDERS.get(coordinate)
    if not cfg:
        return {"ok": False, "executed": False, "error": "no_adapter", "coordinate": coordinate}
    command = cfg.get("commands", {}).get(operation)
    if not command:
        return {
            "ok": False,
            "executed": False,
            "error": "unsupported_read_operation",
            "coordinate": coordinate,
            "allowed": sorted(cfg.get("commands", {}).keys()),
        }
    readiness = probe(coordinate)
    if not readiness.get("directRead"):
        return {"ok": False, "executed": False, "error": "adapter_not_ready", "adapter": readiness}
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False)
    except Exception as exc:
        return {"ok": False, "executed": False, "error": "adapter_exec_error", "message": str(exc)[:240], "adapter": readiness}
    stdout = (proc.stdout or "").strip()[:100000]
    stderr = (proc.stderr or "").strip()[:4000]
    parsed = None
    if stdout.startswith("{") or stdout.startswith("["):
        try:
            parsed = json.loads(stdout)
        except Exception:
            parsed = None
    return {
        "ok": proc.returncode == 0,
        "executed": True,
        "readOnly": True,
        "coordinate": coordinate,
        "provider": cfg["name"],
        "operation": operation,
        "returnCode": proc.returncode,
        "result": parsed if parsed is not None else stdout,
        "errorText": stderr if proc.returncode != 0 else None,
        "evidence": {"executor": "orange-local-cli", "argv0": command[0], "adapterVersion": VERSION},
    }
