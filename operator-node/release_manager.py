#!/usr/bin/env python3
import os
import py_compile
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

import self_update as updater

VERSION = "1.0.0"
CONNECTOR = Path('/home/kazkar/cit/modules/ci_connector/ci_connector_server.py')
INSTALLER_NAME = 'install_provider_layer.py'
SERVICE = 'ci_mcp_server.service'


def _restore_runtime(backup):
    backup = Path(backup)
    restored = []
    for name in updater.ALLOWED:
        src = backup / name
        if src.exists():
            shutil.copy2(src, updater.TARGET / name)
            restored.append(name)
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


def deploy(commit, activate=False):
    if not updater.SHA_RE.fullmatch(str(commit or '')):
        return {'ok': False, 'executed': False, 'error': 'exact_40_hex_commit_required'}
    if not isinstance(activate, bool):
        return {'ok': False, 'executed': False, 'error': 'activate_must_be_boolean'}

    installer_content = None
    installer_blob = None
    try:
        installer_content, installer_blob = updater._fetch_file(INSTALLER_NAME, commit)
    except Exception as exc:
        return {'ok': False, 'executed': False, 'error': 'installer_fetch_failed', 'message': str(exc)[:240]}

    stage_dir = Path(tempfile.mkdtemp(prefix='ci-release-installer-', dir=str(updater.TARGET)))
    installer_path = stage_dir / INSTALLER_NAME
    connector_backup = None
    runtime_result = None
    try:
        installer_path.write_bytes(installer_content)
        py_compile.compile(str(installer_path), doraise=True)
        if not CONNECTOR.exists():
            raise RuntimeError('connector_missing')
        stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        connector_backup = CONNECTOR.with_suffix(CONNECTOR.suffix + f'.release.{stamp}.{commit[:12]}.bak')
        shutil.copy2(CONNECTOR, connector_backup)

        runtime_result = updater.apply(commit, activate=False)
        if not runtime_result.get('ok') or not runtime_result.get('executed'):
            raise RuntimeError('runtime_update_failed:' + str(runtime_result.get('error') or 'unknown'))

        proc = subprocess.run(
            ['python3', str(installer_path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError('connector_patch_failed:' + (proc.stderr or proc.stdout or '')[:180])
        py_compile.compile(str(CONNECTOR), doraise=True)

        restart = _schedule_restart() if activate else {'scheduled': False}
        return {
            'ok': True,
            'executed': True,
            'commit': commit,
            'runtimeBackup': runtime_result.get('backup'),
            'connectorBackup': str(connector_backup),
            'runtimeFiles': runtime_result.get('files', []),
            'installer': {'file': INSTALLER_NAME, 'gitBlobSha': installer_blob, 'bytes': len(installer_content)},
            'connectorCompile': 'PASS',
            'restart': restart,
            'evidence': {
                'canonicalRepository': updater.REPO,
                'exactCommit': commit,
                'runtimePreparedAndApplied': True,
                'connectorPatched': True,
                'connectorCompiled': True,
            },
        }
    except Exception as exc:
        restored_runtime = []
        if runtime_result and runtime_result.get('backup'):
            try:
                restored_runtime = _restore_runtime(runtime_result['backup'])
            except Exception:
                restored_runtime = []
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
            'rollback': {'runtimeFiles': restored_runtime, 'connectorRestored': connector_restored},
            'connectorBackup': str(connector_backup) if connector_backup else None,
        }
    finally:
        shutil.rmtree(stage_dir, ignore_errors=True)
