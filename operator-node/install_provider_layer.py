#!/usr/bin/env python3
from pathlib import Path
import shutil
import time

TARGET = Path('/home/kazkar/cit/modules/ci_connector/ci_connector_server.py')


def replace_once(text, old, new, label):
    if new in text:
        return text, False
    if old not in text:
        raise RuntimeError(f'provider install marker not found: {label}')
    return text.replace(old, new, 1), True


def main():
    source = TARGET.read_text(encoding='utf-8')
    original = source

    source, _ = replace_once(
        source,
        'import ci_operator\n',
        'import ci_operator_runtime as ci_operator\n',
        'operator runtime import',
    )

    marker = "\n]\ndef db():"
    tools = [
        " tooldef('ci_executor_status','Виконавці Ci','Probe Orange-local provider adapters without exposing credentials.',{'type':'object','properties':{}}),",
        " tooldef('ci_execute_read','Пряме читання Ci','Run one allowlisted read-only provider operation directly on Orange when a local authenticated adapter is ready.',{'type':'object','properties':{'coordinate':{'type':'string','enum':['CI.GITHUB','CI.VERCEL','CI.SUPABASE','CI.CLOUDFLARE']},'operation':{'type':'string','enum':['identity','inventory']}},'required':['coordinate']},read_only=True,open_world=True),",
        " tooldef('ci_operator_update','Оновити Ci Operator','Update only allowlisted Orange operator modules from an exact 40-character commit SHA in Ihorog/Ci-Contact-Kernel. The updater verifies Git blob SHAs, compiles staged files and keeps a rollback backup.',{'type':'object','properties':{'commit':{'type':'string','pattern':'^[0-9a-f]{40}$'},'activate':{'type':'boolean','default':False}},'required':['commit']},scope='act',read_only=False,open_world=True),",
        " tooldef('ci_operator_metrics','Метрики Ci Operator','Return PII-safe execution KPIs from Orange telemetry: success, evidence completeness, fallback, executed rate and latency percentiles.',{'type':'object','properties':{'limit':{'type':'integer','minimum':1,'maximum':5000,'default':500}}},read_only=True,open_world=False),",
    ]
    for tool in tools:
        name = tool.split("tooldef('", 1)[1].split("'", 1)[0]
        if f"tooldef('{name}'" not in source:
            if marker not in source:
                raise RuntimeError(f'tool marker not found for {name}')
            source = source.replace(marker, "\n" + tool + marker, 1)

    call_marker = "    return {'ok':False,'error':'unknown_tool'}"
    calls = [
        ("ci_executor_status", "    if name=='ci_executor_status': return ci_operator.executor_status()"),
        ("ci_execute_read", "    if name=='ci_execute_read': return ci_operator.execute_read(args.get('coordinate',''),args.get('operation',''))"),
        ("ci_operator_update", "    if name=='ci_operator_update': return ci_operator.operator_update(args.get('commit',''),args.get('activate',False))"),
        ("ci_operator_metrics", "    if name=='ci_operator_metrics': return ci_operator.metrics(args.get('limit',500))"),
    ]
    for name, call in calls:
        if f"if name=='{name}'" not in source:
            if call_marker not in source:
                raise RuntimeError(f'call marker not found for {name}')
            source = source.replace(call_marker, call + "\n" + call_marker, 1)

    source = source.replace(
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch'} else 'ci:read'",
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update'} else 'ci:read'",
    )
    source = source.replace(
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update'} else 'ci:read'",
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update'} else 'ci:read'",
    )
    for old in ('1.2.0', '1.3.0', '1.4.0'):
        source = source.replace(
            f"'serverInfo':{{'name':'ci-operator','title':'Ci Operator','version':'{old}'}}",
            "'serverInfo':{'name':'ci-operator','title':'Ci Operator','version':'1.5.0'}",
        )

    old_instructions = [
        "Use ci_resolve before external actions. Use ci_dispatch to pass intent through CI.LINK. Treat registry state as routing metadata and require live evidence for execution.",
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. Require live evidence for execution.",
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. ci_operator_update is a gated self-update and requires an exact canonical Git commit SHA. Require live evidence for execution.",
    ]
    new_instructions = (
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. "
        "Otherwise delegate to the named ChatGPT connector or CI.LINK. ci_operator_update is a gated self-update and requires an exact canonical Git commit SHA. "
        "Use ci_operator_metrics for PII-safe operational KPI evidence. Require live evidence for execution."
    )
    for old in old_instructions:
        source = source.replace(old, new_instructions)

    if source == original:
        print('CI_PROVIDER_INSTALL=ALREADY_CURRENT')
        return
    backup = TARGET.with_suffix(TARGET.suffix + f'.bak.provider.{int(time.time())}')
    shutil.copy2(TARGET, backup)
    TARGET.write_text(source, encoding='utf-8')
    print('CI_PROVIDER_INSTALL=UPDATED')
    print(f'BACKUP={backup}')
    print(f'TARGET={TARGET}')


if __name__ == '__main__':
    main()
