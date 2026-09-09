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

    tools = """
 tooldef('ci_executor_status','Виконавці Ci','Probe Orange-local provider adapters without exposing credentials.',{'type':'object','properties':{}}),
 tooldef('ci_execute_read','Пряме читання Ci','Run one allowlisted read-only provider operation directly on Orange when a local authenticated adapter is ready.',{'type':'object','properties':{'coordinate':{'type':'string','enum':['CI.GITHUB','CI.VERCEL','CI.SUPABASE','CI.CLOUDFLARE']},'operation':{'type':'string','enum':['identity','inventory']}},'required':['coordinate','operation']},read_only=True,open_world=True),
"""
    marker = "\n]\ndef db():"
    if "tooldef('ci_executor_status'" not in source:
        if marker not in source:
            raise RuntimeError('provider tools marker not found')
        source = source.replace(marker, tools + marker, 1)

    calls = """
    if name=='ci_executor_status': return ci_operator.executor_status()
    if name=='ci_execute_read': return ci_operator.execute_read(args.get('coordinate',''),args.get('operation',''))
"""
    marker = "    return {'ok':False,'error':'unknown_tool'}"
    if "if name=='ci_executor_status'" not in source:
        if marker not in source:
            raise RuntimeError('provider call marker not found')
        source = source.replace(marker, calls + marker, 1)

    source = source.replace(
        "'serverInfo':{'name':'ci-operator','title':'Ci Operator','version':'1.2.0'}",
        "'serverInfo':{'name':'ci-operator','title':'Ci Operator','version':'1.3.0'}",
    )
    source = source.replace(
        "Use ci_resolve before external actions. Use ci_dispatch to pass intent through CI.LINK. Treat registry state as routing metadata and require live evidence for execution.",
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. Require live evidence for execution.",
    )

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
