#!/usr/bin/env python3
import time

import ci_operator as base
import operator_telemetry as telemetry
import provider_adapters
import release_manager
import self_update as updater

VERSION = "1.4.0"
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
    value["selfUpdate"] = {
        "repository": updater.REPO,
        "exactCommitRequired": True,
        "allowlistedFiles": list(updater.ALLOWED),
    }
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


def dispatch(intent: str, target=None, mode="contact"):
    started = time.perf_counter()
    result = base.dispatch(intent, target, mode)
    if isinstance(result, dict):
        result["operatorRuntimeVersion"] = VERSION
    _record("dispatch", started, result, route="CI.LINK")
    return result


def executor_status():
    return {"ok": True, "node": NODE_ID, "operatorRuntimeVersion": VERSION, "adapters": provider_adapters.probe_all()}


def execute_read(coordinate: str, operation: str):
    started = time.perf_counter()
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
    _record("operator_update", started, result, coordinate="CI.ORANGE", route="PINNED_GITHUB_UPDATE")
    return result


def operator_release(commit: str, activate=False):
    started = time.perf_counter()
    result = release_manager.deploy(commit, activate)
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    _record("operator_release", started, result, coordinate="CI.ORANGE", route="PINNED_GITHUB_RELEASE")
    return result


def metrics(limit=500):
    value = telemetry.summary(limit)
    value["node"] = NODE_ID
    value["operatorRuntimeVersion"] = VERSION
    return value
