#!/usr/bin/env python3
import ci_operator as base
import provider_adapters
import self_update as updater

VERSION = "1.2.0"
NODE_ID = base.NODE_ID


def status():
    value = base.status()
    value = dict(value)
    value["version"] = VERSION
    value["providerAdapters"] = provider_adapters.probe_all()
    value["selfUpdate"] = {
        "repository": updater.REPO,
        "exactCommitRequired": True,
        "allowlistedFiles": list(updater.ALLOWED),
    }
    return value


def resolve(intent: str, target=None):
    value = dict(base.resolve(intent, target))
    adapter = provider_adapters.probe(value.get("coordinate"))
    value["providerAdapter"] = adapter
    if value.get("execution") == "DELEGATE_CONNECTOR" and adapter.get("directRead"):
        value["execution"] = "ORANGE_PROVIDER_READ"
        value["delegateFallback"] = "DELEGATE_CONNECTOR"
    return value


def dispatch(intent: str, target=None, mode="contact"):
    result = base.dispatch(intent, target, mode)
    if isinstance(result, dict):
        result["operatorRuntimeVersion"] = VERSION
    return result


def executor_status():
    return {
        "ok": True,
        "node": NODE_ID,
        "operatorRuntimeVersion": VERSION,
        "adapters": provider_adapters.probe_all(),
    }


def execute_read(coordinate: str, operation: str):
    result = provider_adapters.execute_read(coordinate, operation)
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    return result


def operator_update(commit: str, activate=False):
    result = updater.apply(commit, bool(activate))
    result["node"] = NODE_ID
    result["operatorRuntimeVersion"] = VERSION
    return result
