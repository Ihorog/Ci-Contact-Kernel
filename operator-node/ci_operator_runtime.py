#!/usr/bin/env python3
import ci_operator as base
import provider_adapters

VERSION = "1.1.0"
NODE_ID = base.NODE_ID


def status():
    value = base.status()
    value = dict(value)
    value["version"] = VERSION
    value["providerAdapters"] = provider_adapters.probe_all()
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
    # Contact/sync semantics remain in the verified base operator and CI.LINK.
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
