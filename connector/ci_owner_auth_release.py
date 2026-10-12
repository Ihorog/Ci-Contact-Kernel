#!/usr/bin/env python3
"""One-time guarded Ci OAuth connector release; never installs a daemon.

Preflight reports the current digest and blocks capability loss. Applying
requires an exact source commit, an unchanged current-file digest, and the
pinned cryptographic verifier. It does not restart any running service.
"""
import argparse
import ast
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import py_compile
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

TARGET = Path("/home/kazkar/cit/modules/ci_connector/ci_connector_server.py")
EXPECTED_DEPENDENCY = "2.8.0"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tools_in(path):
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    return {
        node.args[0].value for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name) and node.func.id == "tooldef"
        and node.args and isinstance(node.args[0], ast.Constant)
        and isinstance(node.args[0].value, str)
    }


def source_verified(repo, expected):
    if not re.fullmatch(r"[0-9a-f]{40}", expected or ""):
        raise ValueError("exact_commit_sha_required")
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True, timeout=10
    )
    if result.stdout.strip() != expected:
        raise ValueError("source_commit_mismatch")
    for args in (["diff", "--quiet"], ["diff", "--cached", "--quiet"]):
        p = subprocess.run(["git", "-C", str(repo), *args], timeout=10)
        if p.returncode != 0:
            raise ValueError("source_tree_not_clean")


def prepare(repo, target, stage):
    source = repo / "connector" / "ci_connector_server.py"
    passkey = repo / "connector" / "ci_owner_webauthn.py"
    installer = repo / "operator-node" / "install_provider_layer.py"
    if not all(f.is_file() for f in (source, passkey, installer)):
        raise ValueError("required_source_files_missing")
    candidate = stage / "ci_connector_server.py"
    candidate_passkey = stage / "ci_owner_webauthn.py"
    shutil.copyfile(source, candidate)
    shutil.copyfile(passkey, candidate_passkey)
    env = dict(os.environ, CI_CONNECTOR_TARGET=str(candidate))
    result = subprocess.run(
        [sys.executable, str(installer)],
        env=env, capture_output=True, text=True, timeout=20, check=False
    )
    if result.returncode != 0:
        raise ValueError("provider_overlay_failed:" + result.stderr[:180])
    py_compile.compile(str(candidate), doraise=True)
    py_compile.compile(str(candidate_passkey), doraise=True)
    current_tools = tools_in(target)
    desired_tools = tools_in(candidate)
    missing = sorted(current_tools - desired_tools)
    if missing:
        raise ValueError("connector_capability_loss:" + ",".join(missing))
    return candidate, candidate_passkey, sorted(desired_tools - current_tools)


def run(repo, target, commit, expected_sha=None, apply=False):
    source_verified(repo, commit)
    if not target.exists():
        raise ValueError("installed_connector_missing")
    lock_path = target.with_suffix(".authrelease.lock")
    with open(lock_path, "a+", encoding="ascii") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = sha256(target)
        if apply and current != expected_sha:
            raise ValueError("connector_revision_conflict")
        with tempfile.TemporaryDirectory(prefix="ci-auth-stage-", dir=str(target.parent)) as folder:
            candidate, helper, extras = prepare(repo, target, Path(folder))
            result = {
                "verified_source_commit": commit,
                "before_sha256": current,
                "candidate_sha256": sha256(candidate),
                "retained_tool_count": len(tools_in(target)),
                "new_tools": extras,
                "service_restarted": False,
                "applied": False,
            }
            if not apply:
                return result
            try:
                version = importlib.metadata.version("webauthn")
            except importlib.metadata.PackageNotFoundError as exc:
                raise ValueError("webauthn_dependency_not_installed") from exc
            if version != EXPECTED_DEPENDENCY:
                raise ValueError("webauthn_dependency_version_mismatch")
            stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            back = target.with_name(target.name + ".authbackup." + stamp)
            helper_target = target.parent / "ci_owner_webauthn.py"
            helper_backup = helper_target.with_name(helper_target.name + ".authbackup." + stamp)
            original_stat = target.stat()
            shutil.copy2(target, back)
            had_helper = helper_target.exists()
            if had_helper:
                shutil.copy2(helper_target, helper_backup)
            try:
                for path in (candidate, helper):
                    os.chown(path, original_stat.st_uid, original_stat.st_gid)
                    os.chmod(path, stat.S_IMODE(original_stat.st_mode))
                # Atomic per file, under lock. This does not touch running Python.
                os.replace(helper, helper_target)
                os.replace(candidate, target)
                py_compile.compile(str(target), doraise=True)
                py_compile.compile(str(helper_target), doraise=True)
            except Exception:
                shutil.copy2(back, target)
                if had_helper:
                    shutil.copy2(helper_backup, helper_target)
                elif helper_target.exists():
                    helper_target.unlink()
                raise
            result.update({
                "applied": True,
                "after_sha256": sha256(target),
                "backup": str(back),
                "passkey_backup": str(helper_backup) if had_helper else None,
                "requires_supervised_restart": True,
            })
            return result


def main():
    parser = argparse.ArgumentParser(description="Ci one-time owner OAuth release")
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--target", type=Path, default=TARGET)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-sha256")
    a = parser.parse_args()
    if a.apply and (not a.expected_sha256 or not re.fullmatch(r"[0-9a-f]{64}", a.expected_sha256)):
        parser.error("--apply requires --expected-sha256 from a fresh preflight")
    try:
        print(json.dumps(run(a.repository.resolve(), a.target, a.commit, a.expected_sha256, a.apply),
                         ensure_ascii=False, indent=2))
    except Exception as exc:
        print(json.dumps({"applied": False, "blocked": str(exc)[:240]}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
