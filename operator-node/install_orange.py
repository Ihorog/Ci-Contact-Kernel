#!/usr/bin/env python3
from pathlib import Path
import shutil
import time

TARGET = Path('/home/kazkar/cit/modules/ci_connector/ci_connector_server.py')
MODULE_DIR = Path('/home/kazkar/cit/modules/ci_operator')


def replace_once(text, old, new, label):
    if new in text:
        return text, False
    if old not in text:
        raise RuntimeError(f'install marker not found: {label}')
    return text.replace(old, new, 1), True


def main():
    source = TARGET.read_text(encoding='utf-8')
    original = source

    source, _ = replace_once(
        source,
        "import ci_unified\n",
        "import ci_unified\nsys.path.insert(0,'/home/kazkar/cit/modules/ci_operator')\nimport ci_operator\n",
        'operator import',
    )

    source, _ = replace_once(
        source,
        "def tooldef(name,title,description,schema,scope='read',read_only=True):",
        "def tooldef(name,title,description,schema,scope='read',read_only=True,open_world=False):",
        'tooldef signature',
    )
    source, _ = replace_once(
        source,
        "'annotations':{'readOnlyHint':read_only,'destructiveHint':False,'openWorldHint':False}}",
        "'annotations':{'readOnlyHint':read_only,'destructiveHint':False,'openWorldHint':open_world}}",
        'tool annotations',
    )

    tools = """
 tooldef('ci_operator_status','Стан Ci Operator','Get the live Orange operator node, registry, acceptance and executor status.',{'type':'object','properties':{}}),
 tooldef('ci_resolve','Маршрут Ci','Resolve a user intent to the canonical Ci coordinate and safest available executor route.',{'type':'object','properties':{'intent':{'type':'string'},'target':{'type':'string'}},'required':['intent']}),
 tooldef('ci_dispatch','Передати Ci','Dispatch an intent through the Orange operator. External provider coordinates return a caller-executable delegation envelope; CI.LINK remains contact/sync fallback. Sensitive writes remain permission-gated downstream.',{'type':'object','properties':{'intent':{'type':'string'},'target':{'type':'string'},'mode':{'type':'string','enum':['resolve','status','contact','sync'],'default':'contact'}},'required':['intent']},scope='act',read_only=False,open_world=True),
"""
    marker = "\n]\ndef db():"
    if "tooldef('ci_operator_status'" not in source:
        if marker not in source:
            raise RuntimeError('tools list marker not found')
        source = source.replace(marker, tools + marker, 1)

    calls = """
    if name=='ci_operator_status': return ci_operator.status()
    if name=='ci_resolve': return ci_operator.resolve(args.get('intent',''),args.get('target'))
    if name=='ci_dispatch': return ci_operator.dispatch(args.get('intent',''),args.get('target'),args.get('mode','contact'))
"""
    marker = "    return {'ok':False,'error':'unknown_tool'}"
    if "if name=='ci_operator_status'" not in source:
        if marker not in source:
            raise RuntimeError('call_tool marker not found')
        source = source.replace(marker, calls + marker, 1)

    source, _ = replace_once(
        source,
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append'} else 'ci:read'",
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch'} else 'ci:read'",
        'scope gate',
    )

    health_old = "s=ci_unit.collect(); return self.send_json(200,{'ok':True,'service':'ci-connector','version':'1.1.1','ci':s})"
    health_new = "s=ci_unit.collect(); return self.send_json(200,{'ok':True,'service':'ci-connector','version':'1.2.0','ci':s,'operator':ci_operator.status()})"
    source, _ = replace_once(source, health_old, health_new, 'health')

    operator_route = """        if path=='/operator/health':
            return self.send_json(200,ci_operator.status())
"""
    health_marker = "        if path=='/health':\n"
    if "if path=='/operator/health':" not in source:
        if health_marker not in source:
            raise RuntimeError('operator health marker not found')
        source = source.replace(health_marker, operator_route + health_marker, 1)

    server_old = "'serverInfo':{'name':'ci','title':'Ci','version':'1.1.1'}"
    server_new = "'serverInfo':{'name':'ci-operator','title':'Ci Operator','version':'1.2.0'},'instructions':'Use ci_resolve before external actions. Use ci_dispatch to pass intent through CI.LINK. Treat registry state as routing metadata and require live evidence for execution.'"
    source, _ = replace_once(source, server_old, server_new, 'server info')

    if source == original:
        print('CI_OPERATOR_INSTALL=ALREADY_CURRENT')
        return

    backup = TARGET.with_suffix(TARGET.suffix + f'.bak.operator.{int(time.time())}')
    shutil.copy2(TARGET, backup)
    TARGET.write_text(source, encoding='utf-8')
    print(f'CI_OPERATOR_INSTALL=UPDATED')
    print(f'BACKUP={backup}')
    print(f'TARGET={TARGET}')


if __name__ == '__main__':
    main()
