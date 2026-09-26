#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import py_compile
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import self_update as updater

VERSION = "1.3.0"
CONNECTOR = Path('/home/kazkar/cit/modules/ci_connector/ci_connector_server.py')
REGISTRY_REPO_PATH = "public/ci-registry/v1.1.0/ci-registry.json"
ACCEPTANCE_REPO_DIR = "public/ci-registry/v1.1.0/acceptance"
REGISTRY_TARGET = Path("/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/ci-registry.json")
ACCEPTANCE_TARGET_DIR = REGISTRY_TARGET.parent / "acceptance"
INSTALLER_NAME = 'install_provider_layer.py'
SERVICE = 'ci_mcp_server.service'
QUEUE_SCRIPT = updater.TARGET / 'executor_queue_server.py'
QUEUE_LOG = Path('/home/kazkar/cit/logs/executor_queue.log')
QUEUE_PATTERN = r'^python3 /home/kazkar/cit/modules/ci_operator/executor_queue_server.py$'


def _fetch_repo_file(repo_path, commit):
    return updater._fetch_repo_path(repo_path, commit)


def _fetch_acceptance_bundle(commit):
    pointer_path = f"{ACCEPTANCE_REPO_DIR}/current.json"
    pointer_content, pointer_blob = _fetch_repo_file(pointer_path, commit)
    pointer = json.loads(pointer_content.decode("utf-8"))
    if pointer.get("kind") != "CI_REGISTRY_ACCEPTANCE_POINTER":
        raise RuntimeError("acceptance_pointer_kind_invalid")
    current = str(pointer.get("current") or "")
    if not current or current != Path(current).name or not current.endswith(".json"):
        raise RuntimeError("acceptance_pointer_target_invalid")
    snapshot_path = f"{ACCEPTANCE_REPO_DIR}/{current}"
    snapshot_content, snapshot_blob = _fetch_repo_file(snapshot_path, commit)
    expected = str(pointer.get("sha256") or "").lower()
    actual = hashlib.sha256(snapshot_content).hexdigest()
    if expected != actual:
        raise RuntimeError("acceptance_snapshot_sha256_mismatch")
    snapshot = json.loads(snapshot_content.decode("utf-8"))
    if snapshot.get("kind") != "CI_REGISTRY_ACCEPTANCE_SNAPSHOT":
        raise RuntimeError("acceptance_snapshot_kind_invalid")
    return {
        "pointer_content": pointer_content,
        "pointer_blob": pointer_blob,
        "pointer": pointer,
        "snapshot_content": snapshot_content,
        "snapshot_blob": snapshot_blob,
        "snapshot_name": current,
        "snapshot_sha256": actual,
    }


def _restore_runtime(backup):
    backup = Path(backup)
    restored = []
    for name in updater.ALLOWED:
        src = backup / name
        target = updater.TARGET / name
        if src.exists():
            shutil.copy2(src, target)
            restored.append(name)
        elif target.exists():
            target.unlink()
    return restored


def _service_main_pid():
    proc = subprocess.run(
        ['systemctl', 'show', '-p', 'MainPID', '--value', SERVICE],
        capture_output=True, text=True, timeout=8, check=False,
    )
    value = (proc.stdout or '').strip()
    if proc.returncode != 0 or not value.isdigit() or int(value) <= 1:
        return None
    pid = int(value)
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    return pid


def _schedule_restart():
    pid = _service_main_pid()
    if not pid:
        return {'scheduled': False, 'error': 'service_main_pid_unavailable'}
    subprocess.Popen(
        ['sh', '-c', f'sleep 2; kill -TERM {pid}'],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return {'scheduled': True, 'pid': pid, 'method': 'systemd_supervised_term'}


def _schedule_queue_state(present):
    QUEUE_LOG.parent.mkdir(parents=True, exist_ok=True)
    if present:
        cmd=(f"sleep 2; pkill -f '{QUEUE_PATTERN}' || true; "
             f"nohup python3 {QUEUE_SCRIPT} >>{QUEUE_LOG} 2>&1 </dev/null &")
        desired='running'
    else:
        cmd=f"sleep 2; pkill -f '{QUEUE_PATTERN}' || true"
        desired='stopped'
    subprocess.Popen(['sh','-c',cmd],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return {'scheduled':True,'desired':desired,'method':'fixed_local_auxiliary'}


def deploy(commit, activate=False):
    if not updater.SHA_RE.fullmatch(str(commit or '')):
        return {'ok': False, 'executed': False, 'error': 'exact_40_hex_commit_required'}
    if not isinstance(activate, bool):
        return {'ok': False, 'executed': False, 'error': 'activate_must_be_boolean'}

    installer_content = None
    installer_blob = None
    registry_content = None
    registry_blob = None
    acceptance_bundle = None
    try:
        installer_content, installer_blob = updater._fetch_file(INSTALLER_NAME, commit)
        registry_content, registry_blob = _fetch_repo_file(REGISTRY_REPO_PATH, commit)
        registry_doc = json.loads(registry_content.decode('utf-8'))
        if registry_doc.get('kind') != 'CI_CONNECTION_REGISTRY_RUNTIME':
            raise RuntimeError('registry_kind_invalid')
        acceptance_bundle = _fetch_acceptance_bundle(commit)
    except Exception as exc:
        return {'ok': False, 'executed': False, 'error': 'release_asset_fetch_failed', 'message': str(exc)[:240]}

    stage_dir = Path(tempfile.mkdtemp(prefix='ci-release-installer-', dir=str(updater.TARGET)))
    installer_path = stage_dir / INSTALLER_NAME
    connector_backup = None
    registry_backup = None
    registry_written = False
    acceptance_pointer_backup = None
    acceptance_pointer_written = False
    acceptance_snapshot_target = None
    acceptance_snapshot_preexisting = False
    runtime_result = None
    try:
        installer_path.write_bytes(installer_content)
        py_compile.compile(str(installer_path), doraise=True)
        if not CONNECTOR.exists():
            raise RuntimeError('connector_missing')
        stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        connector_backup = CONNECTOR.with_suffix(CONNECTOR.suffix + f'.release.{stamp}.{commit[:12]}.bak')
        shutil.copy2(CONNECTOR, connector_backup)
        REGISTRY_TARGET.parent.mkdir(parents=True, exist_ok=True)
        ACCEPTANCE_TARGET_DIR.mkdir(parents=True, exist_ok=True)
        if REGISTRY_TARGET.exists():
            registry_backup = REGISTRY_TARGET.with_suffix(REGISTRY_TARGET.suffix + f'.release.{stamp}.{commit[:12]}.bak')
            shutil.copy2(REGISTRY_TARGET, registry_backup)
        acceptance_pointer_target = ACCEPTANCE_TARGET_DIR / "current.json"
        if acceptance_pointer_target.exists():
            acceptance_pointer_backup = acceptance_pointer_target.with_suffix(
                acceptance_pointer_target.suffix + f'.release.{stamp}.{commit[:12]}.bak'
            )
            shutil.copy2(acceptance_pointer_target, acceptance_pointer_backup)

        runtime_result = updater.apply(commit, activate=False)
        if not runtime_result.get('ok') or not runtime_result.get('executed'):
            raise RuntimeError('runtime_update_failed:' + str(runtime_result.get('error') or 'unknown'))

        registry_tmp = REGISTRY_TARGET.with_suffix(REGISTRY_TARGET.suffix + f'.tmp.{commit[:12]}')
        registry_tmp.write_bytes(registry_content)
        os.replace(registry_tmp, REGISTRY_TARGET)
        registry_written = True

        acceptance_snapshot_target = ACCEPTANCE_TARGET_DIR / acceptance_bundle["snapshot_name"]
        acceptance_snapshot_preexisting = acceptance_snapshot_target.exists()
        snapshot_tmp = acceptance_snapshot_target.with_suffix(
            acceptance_snapshot_target.suffix + f'.tmp.{commit[:12]}'
        )
        snapshot_tmp.write_bytes(acceptance_bundle["snapshot_content"])
        if hashlib.sha256(snapshot_tmp.read_bytes()).hexdigest() != acceptance_bundle["snapshot_sha256"]:
            raise RuntimeError("acceptance_snapshot_postwrite_sha256_mismatch")
        os.replace(snapshot_tmp, acceptance_snapshot_target)

        pointer_tmp = (ACCEPTANCE_TARGET_DIR / "current.json").with_suffix(
            f'.json.tmp.{commit[:12]}'
        )
        pointer_tmp.write_bytes(acceptance_bundle["pointer_content"])
        os.replace(pointer_tmp, ACCEPTANCE_TARGET_DIR / "current.json")
        acceptance_pointer_written = True

        proc = subprocess.run(
            ['python3', str(installer_path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError('connector_patch_failed:' + (proc.stderr or proc.stdout or '')[:180])
        py_compile.compile(str(CONNECTOR), doraise=True)

        queue_present = 'executor_queue_server.py' not in set(runtime_result.get('absent') or []) and QUEUE_SCRIPT.exists()
        restart = _schedule_restart() if activate else {'scheduled': False}
        queue_state = _schedule_queue_state(queue_present) if activate else {'scheduled': False, 'desired': 'running' if queue_present else 'stopped'}
        return {
            'ok': True,
            'executed': True,
            'commit': commit,
            'runtimeBackup': runtime_result.get('backup'),
            'connectorBackup': str(connector_backup),
            'registryBackup': str(registry_backup) if registry_backup else None,
            'runtimeFiles': runtime_result.get('files', []),
            'installer': {'file': INSTALLER_NAME, 'gitBlobSha': installer_blob, 'bytes': len(installer_content)},
            'registry': {'file': REGISTRY_REPO_PATH, 'gitBlobSha': registry_blob, 'bytes': len(registry_content)},
            'acceptance': {
                'pointer': f'{ACCEPTANCE_REPO_DIR}/current.json',
                'pointerGitBlobSha': acceptance_bundle['pointer_blob'],
                'snapshot': f"{ACCEPTANCE_REPO_DIR}/{acceptance_bundle['snapshot_name']}",
                'snapshotGitBlobSha': acceptance_bundle['snapshot_blob'],
                'snapshotSha256': acceptance_bundle['snapshot_sha256'],
                'synced': True,
            },
            'connectorCompile': 'PASS',
            'restart': restart,
            'auxiliaryRuntime': {'executorQueue': queue_state},
            'evidence': {
                'canonicalRepository': updater.REPO,
                'source': updater.SOURCE,
                'githubRequired': False,
                'exactCommit': commit,
                'runtimePreparedAndApplied': True,
                'registrySynced': True,
                'acceptanceSynced': True,
                'acceptanceSnapshotSha256Verified': True,
                'connectorPatched': True,
                'connectorCompiled': True,
                'executorQueueTargetPresent': queue_present,
            },
        }
    except Exception as exc:
        restored_runtime = []
        if runtime_result and runtime_result.get('backup'):
            try:
                restored_runtime = _restore_runtime(runtime_result['backup'])
            except Exception:
                restored_runtime = []
        registry_restored = False
        if registry_written and registry_backup and registry_backup.exists():
            try:
                shutil.copy2(registry_backup, REGISTRY_TARGET)
                registry_restored = True
            except Exception:
                registry_restored = False
        acceptance_restored = False
        if acceptance_pointer_written:
            try:
                pointer_target = ACCEPTANCE_TARGET_DIR / "current.json"
                if acceptance_pointer_backup and acceptance_pointer_backup.exists():
                    shutil.copy2(acceptance_pointer_backup, pointer_target)
                elif pointer_target.exists():
                    pointer_target.unlink()
                if acceptance_snapshot_target and acceptance_snapshot_target.exists() and not acceptance_snapshot_preexisting:
                    acceptance_snapshot_target.unlink()
                acceptance_restored = True
            except Exception:
                acceptance_restored = False
        connector_restored = False
        if connector_backup and connector_backup.exists():
            try:
                shutil.copy2(connector_backup, CONNECTOR)
                py_compile.compile(str(CONNECTOR), doraise=True)
                connector_restored = True
            except Exception:
                connector_restored = False
        return {
            'ok': False,
            'executed': False,
            'error': 'release_failed',
            'message': str(exc)[:240],
            'rollback': {
                'runtimeFiles': restored_runtime,
                'registryRestored': registry_restored,
                'acceptanceRestored': acceptance_restored,
                'connectorRestored': connector_restored,
            },
            'connectorBackup': str(connector_backup) if connector_backup else None,
            'registryBackup': str(registry_backup) if registry_backup else None,
        }
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)
