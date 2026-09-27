#!/usr/bin/env python3
import json
import os
import py_compile
import re
import shlex
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = "Ihorog/Ci-Contact-Kernel"
TARGET = Path(os.getenv("CI_LOCAL_AI_TARGET", "/home/kazkar/cit/modules/ci_local_ai"))
UNIT = Path.home() / ".config/systemd/user/ci-local-ai.service"
FILES = ("ci_local_ai_server.py", "ci_context_runtime.py")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def fetch(commit, name):
    url = f"https://raw.githubusercontent.com/{REPO}/{commit}/tools/local-ai/{name}"
    req = urllib.request.Request(url, headers={"User-Agent": "CiLocalAIInstaller/1.0"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.read()




def install_cron_fallback():
    log_dir = Path("/home/kazkar/cit/logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "ci_local_ai.log"
    target_q = shlex.quote(str(TARGET))
    script_q = shlex.quote(str(TARGET / "ci_local_ai_server.py"))
    log_q = shlex.quote(str(log_path))
    launcher = TARGET / "run_ci_local_ai.sh"
    launcher.write_text(
        "#!/bin/sh\n"
        f"export PYTHONPATH={target_q}:/home/kazkar/cit/modules/ci_operator\n"
        "export CI_LOCAL_AI_HOST=0.0.0.0\n"
        "export CI_LOCAL_AI_PORT=8791\n"
        "export CI_LOCAL_AI_LOCATION=Orange\n"
        f"exec /usr/bin/python3 {script_q} >>{log_q} 2>&1\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)

    current = subprocess.run(
        ["crontab", "-l"],
        capture_output=True, text=True, timeout=20, check=False,
    )
    existing = current.stdout if current.returncode == 0 else ""
    lines = [line for line in existing.splitlines() if "# CI_LOCAL_AI" not in line]
    lines.append(f"@reboot {shlex.quote(str(launcher))} # CI_LOCAL_AI")
    cron = subprocess.run(
        ["crontab", "-"],
        input="\n".join(lines) + "\n",
        capture_output=True, text=True, timeout=20, check=False,
    )
    if cron.returncode != 0:
        raise RuntimeError("cron_install_failed:" + (cron.stderr or "")[-240:])

    pattern = str(TARGET / "ci_local_ai_server.py")
    found = subprocess.run(
        ["pgrep", "-f", pattern],
        capture_output=True, text=True, timeout=10, check=False,
    )
    for raw in found.stdout.split():
        if raw.isdigit():
            pid = int(raw)
            if pid != os.getpid():
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
    time.sleep(0.3)
    subprocess.Popen(
        [str(launcher)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    return "cron_reboot_auxiliary"


def http_json(url, payload=None):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=8) as response:
        return response.getcode(), json.loads(response.read().decode("utf-8"))


def main():
    commit = os.getenv("CI_SOURCE_COMMIT", "").strip()
    if len(sys.argv) > 1:
        commit = sys.argv[1].strip()
    if not SHA_RE.fullmatch(commit):
        raise SystemExit("exact_40_hex_commit_required")

    TARGET.mkdir(parents=True, exist_ok=True)
    fetched = []
    for name in FILES:
        content = fetch(commit, name)
        tmp = TARGET / (name + ".tmp")
        tmp.write_bytes(content)
        py_compile.compile(str(tmp), doraise=True)
        target = TARGET / name
        os.replace(tmp, target)
        fetched.append({"file": name, "bytes": len(content)})

    UNIT.parent.mkdir(parents=True, exist_ok=True)
    UNIT.write_text(
        f"""[Unit]
Description=Ci Local AI for Android Ci Point
After=network-online.target

[Service]
Type=simple
WorkingDirectory={TARGET}
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH={TARGET}:/home/kazkar/cit/modules/ci_operator
Environment=CI_LOCAL_AI_HOST=0.0.0.0
Environment=CI_LOCAL_AI_PORT=8791
Environment=CI_LOCAL_AI_LOCATION=Orange
ExecStart=/usr/bin/python3 {TARGET}/ci_local_ai_server.py
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
""",
        encoding="utf-8",
    )

    reload_result = subprocess.run(
        ["systemctl", "--user", "daemon-reload"],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if reload_result.returncode == 0:
        enable_result = subprocess.run(
            ["systemctl", "--user", "enable", "--now", "ci-local-ai.service"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if enable_result.returncode != 0:
            raise RuntimeError("service_enable_failed:" + (enable_result.stderr or "")[-240:])
        restart_result = subprocess.run(
            ["systemctl", "--user", "restart", "ci-local-ai.service"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if restart_result.returncode != 0:
            raise RuntimeError("service_restart_failed:" + (restart_result.stderr or "")[-240:])
        launch_method = "user_systemd"
    else:
        launch_method = install_cron_fallback()

    health = None
    for _ in range(20):
        try:
            _, health = http_json("http://127.0.0.1:8791/health")
            if health.get("ok"):
                break
        except Exception:
            time.sleep(0.5)
    if not health or not health.get("ok"):
        raise RuntimeError("local_ai_health_failed")

    _, intent = http_json(
        "http://127.0.0.1:8791/ci/intent",
        {
            "text": "ping",
            "source": "ci-install-smoke",
            "platform": "android",
            "device": "smoke",
            "surface": "ci-point",
            "locale": "uk-UA",
        },
    )
    if not intent.get("ok"):
        raise RuntimeError("local_ai_intent_failed")

    if launch_method == "user_systemd":
        active = subprocess.run(
            ["systemctl", "--user", "is-active", "ci-local-ai.service"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if active.returncode != 0 or active.stdout.strip() != "active":
            raise RuntimeError("local_ai_service_not_active")

    print(json.dumps({
        "ok": True,
        "commit": commit,
        "service": "ci-local-ai.service",
        "status": "active",
        "launchMethod": launch_method,
        "host": "0.0.0.0",
        "port": 8791,
        "health": health,
        "intent": {
            "ok": intent.get("ok"),
            "action": intent.get("action"),
            "processor": intent.get("processor"),
            "protocol": intent.get("protocol"),
        },
        "files": fetched,
    }, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
