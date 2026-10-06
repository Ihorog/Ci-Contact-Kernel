#!/usr/bin/env python3
from pathlib import Path
import re
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
        " tooldef('ci_delegate','Делегувати вузлу Ci','Bind a registered Ci operation to its already-known external node without searching again. Safe/read operations are marked automatic; gated operations keep the same executor and request only permission.',{'type':'object','properties':{'intent':{'type':'string'},'operation':{'type':'string'},'target':{'type':'string'}},'required':['intent','operation']},read_only=True,open_world=True),",
        " tooldef('ci_executor_status','Виконавці Ci','Probe Orange-local provider adapters without exposing credentials.',{'type':'object','properties':{}}),",
        " tooldef('ci_execute_read','Пряме читання Ci','Run one allowlisted read-only provider operation directly on Orange when a local authenticated adapter is ready.',{'type':'object','properties':{'coordinate':{'type':'string','enum':['CI.GITHUB','CI.VERCEL','CI.SUPABASE','CI.CLOUDFLARE']},'operation':{'type':'string','enum':['identity','inventory']}},'required':['coordinate','operation']},read_only=True,open_world=True),",
        " tooldef('ci_vault_read','Читати Vault','Read/list/stat/download chunks from the live CI.VAULT node.',{'type':'object','properties':{'action':{'type':'string','enum':['status','list','stat','download']},'path':{'type':'string'},'offset':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':4194304}},'required':['action']},read_only=True,open_world=False),",
        " tooldef('ci_vault_write','Змінювати Vault','Upload chunks, create folders, move, rename or explicitly confirmed delete inside CI.VAULT.',{'type':'object','properties':{'action':{'type':'string','enum':['upload','mkdir','move','rename','delete']},'path':{'type':'string'},'destination':{'type':'string'},'name':{'type':'string'},'contentBase64':{'type':'string'},'offset':{'type':'integer','minimum':0},'truncate':{'type':'boolean'},'confirmDelete':{'type':'boolean'}},'required':['action']},scope='act',read_only=False,open_world=False),",
        " tooldef('ci_operator_update','Оновити runtime Ci Operator','Update only allowlisted Orange runtime modules from an exact 40-character commit SHA in Ihorog/Ci-Contact-Kernel.',{'type':'object','properties':{'commit':{'type':'string','pattern':'^[0-9a-f]{40}$'},'activate':{'type':'boolean','default':False}},'required':['commit']},scope='act',read_only=False,open_world=True),",
        " tooldef('ci_operator_release','Реліз Ci Operator','Atomically deploy an exact canonical Git commit to Orange runtime and MCP connector with compile checks, rollback backups and optional supervised restart.',{'type':'object','properties':{'commit':{'type':'string','pattern':'^[0-9a-f]{40}$'},'activate':{'type':'boolean','default':False}},'required':['commit']},scope='act',read_only=False,open_world=True),",
        " tooldef('ci_operator_metrics','Метрики Ci Operator','Return PII-safe execution KPIs from Orange telemetry: success, evidence completeness, fallback, executed rate and latency percentiles.',{'type':'object','properties':{'limit':{'type':'integer','minimum':1,'maximum':5000,'default':500}}},read_only=True,open_world=False),",
        " tooldef('ci_home_status','Стан HOME.CI','Read live end0 and CI.VAULT state directly on Orange.',{'type':'object','properties':{}},read_only=True,open_world=False),",
        " tooldef('ci_home_repair','Відновити HOME.CI','Execute one narrowly allowlisted HOME repair action with idempotency and live verification.',{'type':'object','properties':{'action':{'type':'string','enum':['network.ensure_end0','vault.ensure_rw','acceptance.refresh','resource_trust.refresh']},'idempotency_key':{'type':'string','minLength':8,'maxLength':200}},'required':['action','idempotency_key']},scope='act',read_only=False,open_world=False),",
        " tooldef('ci_secret_keygen','Ключ секрету Ci','Generate a one-time RSA-OAEP-3072 public key on Orange for sealed transfer of one named secret (15 min TTL, single use). Returns only the public key and request id.',{'type':'object','properties':{'name':{'type':'string','pattern':'^[A-Za-z0-9_]{1,64}$'}},'required':['name']},scope='act',read_only=False,open_world=False),",
        " tooldef('ci_secret_set','Записати секрет Ci','Decrypt a sealed secret on Orange with a pending ci_secret_keygen request and store it as a mode-600 file. Returns only name, path, mode, length and sha256 prefix.',{'type':'object','properties':{'request_id':{'type':'string'},'name':{'type':'string','pattern':'^[A-Za-z0-9_]{1,64}$'},'ciphertext_b64':{'type':'string'}},'required':['request_id','name','ciphertext_b64']},scope='act',read_only=False,open_world=False),",
        " tooldef('ci_groq_health','Перевірка Groq','Check the Orange-stored Groq API key against the Groq API. Returns only HTTP status codes, model count and the model used.',{'type':'object','properties':{}},read_only=True,open_world=True),",
    ]
    for tool in tools:
        name = tool.split("tooldef('", 1)[1].split("'", 1)[0]
        if f"tooldef('{name}'" not in source:
            if marker not in source:
                raise RuntimeError(f'tool marker not found for {name}')
            source = source.replace(marker, "\n" + tool + marker, 1)

    call_marker = "    return {'ok':False,'error':'unknown_tool'}"
    calls = [
        ("ci_delegate", "    if name=='ci_delegate': return ci_operator.delegate(args.get('intent',''),args.get('operation',''),args.get('target'))"),
        ("ci_executor_status", "    if name=='ci_executor_status': return ci_operator.executor_status()"),
        ("ci_execute_read", "    if name=='ci_execute_read': return ci_operator.execute_read(args.get('coordinate',''),args.get('operation',''))"),
        ("ci_vault_read", "    if name=='ci_vault_read': return ci_operator.vault(**args)"),
        ("ci_vault_write", "    if name=='ci_vault_write': return ci_operator.vault(**args)"),
        ("ci_operator_update", "    if name=='ci_operator_update': return ci_operator.operator_update(args.get('commit',''),args.get('activate',False))"),
        ("ci_operator_release", "    if name=='ci_operator_release': return ci_operator.operator_release(args.get('commit',''),args.get('activate',False))"),
        ("ci_operator_metrics", "    if name=='ci_operator_metrics': return ci_operator.metrics(args.get('limit',500))"),
        ("ci_home_status", "    if name=='ci_home_status': return ci_operator.home_status()"),
        ("ci_home_repair", "    if name=='ci_home_repair': return ci_operator.home_repair_action(args.get('action',''),args.get('idempotency_key',''))"),
        ("ci_secret_keygen", "    if name=='ci_secret_keygen': return ci_operator.secret_keygen(args.get('name',''))"),
        ("ci_secret_set", "    if name=='ci_secret_set': return ci_operator.secret_set(args.get('request_id',''),args.get('name',''),args.get('ciphertext_b64',''))"),
        ("ci_groq_health", "    if name=='ci_groq_health': return ci_operator.groq_health()"),
    ]
    for name, call in calls:
        if f"if name=='{name}'" not in source:
            if call_marker not in source:
                raise RuntimeError(f'call marker not found for {name}')
            source = source.replace(call_marker, call + "\n" + call_marker, 1)

    for old in [
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch'} else 'ci:read'",
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update'} else 'ci:read'",
        "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update','ci_operator_release'} else 'ci:read'",
    ]:
        source = source.replace(
            old,
            "return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update','ci_operator_release','ci_vault_write','ci_home_repair'} else 'ci:read'",
        )

    scope_re = re.compile(r"return 'ci:act' if name in \{([^}]*)\} else 'ci:read'")
    match = scope_re.search(source)
    if not match:
        raise RuntimeError('provider install marker not found: required scope')
    names = [x.strip() for x in match.group(1).split(',') if x.strip()]
    for extra in ("'ci_secret_keygen'", "'ci_secret_set'"):
        if extra not in names:
            names.append(extra)
    source = source[:match.start()] + "return 'ci:act' if name in {" + ','.join(names) + "} else 'ci:read'" + source[match.end():]

    for old in ('1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0'):
        source = source.replace(
            f"'serverInfo':{{'name':'ci-operator','title':'Ci Operator','version':'{old}'}}",
            "'serverInfo':{'name':'ci-operator','title':'Ci Operator','version':'1.8.0'}",
        )

    instruction_candidates = [
        'Use ci_resolve for routing and ci_delegate for already-known operation-to-node binding. The user device is a thin surface; execution happens on external Ci nodes. Safe registered operations may proceed automatically with evidence; gated operations keep the bound executor and request only permission. Use ci_operator_release for a complete pinned Orange release; ci_operator_update is runtime-only. Use ci_operator_metrics for PII-safe operational KPI evidence. Require live evidence for execution.',
        "Use ci_resolve before external actions. Use ci_dispatch to pass intent through CI.LINK. Treat registry state as routing metadata and require live evidence for execution.",
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. Require live evidence for execution.",
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. ci_operator_update is a gated self-update and requires an exact canonical Git commit SHA. Require live evidence for execution.",
        "Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. ci_operator_update is a gated self-update and requires an exact canonical Git commit SHA. Use ci_vault_read/ci_vault_write for CI.VAULT operations; delete requires explicit confirmDelete. Use ci_operator_metrics for PII-safe operational KPI evidence. Require live evidence for execution.",
    ]
    new_instructions = (
        "Use ci_resolve for routing and ci_delegate for already-known operation-to-node binding. The user device is a thin surface; execution happens on external Ci nodes. "
        "Safe registered operations may proceed automatically with evidence; gated operations keep the bound executor and request only permission. Use ci_home_status before HOME repair and ci_home_repair only for the four allowlisted idempotent HOME actions; never substitute arbitrary shell. "
        "Use ci_operator_release for a complete pinned Orange release; ci_operator_update is runtime-only. Use ci_vault_read/ci_vault_write for normal CI.VAULT content operations; delete requires explicit confirmDelete. "
        "Use ci_operator_metrics for PII-safe operational KPI evidence. Require live evidence for execution."
    )
    for old in instruction_candidates:
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
