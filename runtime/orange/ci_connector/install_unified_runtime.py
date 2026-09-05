#!/usr/bin/env python3
from pathlib import Path
import py_compile
import shutil
import time

BASE=Path('/home/kazkar/cit')
DIR=BASE/'modules'/'ci_connector'
SERVER=DIR/'ci_connector_server.py'
UNIFIED=DIR/'ci_unified.py'

if not SERVER.exists() or not UNIFIED.exists():
    raise SystemExit('required runtime files missing')

stamp=time.strftime('%Y%m%d-%H%M%S')
backup=BASE/'backups'/f'ci-unified-install-{stamp}'
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(SERVER,backup/'ci_connector_server.py.pre')
print('BACKUP='+str(backup))

s=SERVER.read_text(encoding='utf-8-sig')
if 'import ci_unified' not in s:
    s=s.replace('import ci_unit\n','import ci_unit\nimport ci_unified\n',1)

tools_start=s.index('TOOLS=[')
tools_end=s.index('\n]\n',tools_start)+3
new_tools="""TOOLS=[
 tooldef('search','Пошук Ci','Find Ci entities or facts by text.',{'type':'object','properties':{'query':{'type':'string'},'limit':{'type':'integer','minimum':1,'maximum':50}},'required':['query']}),
 tooldef('fetch','Отримати вузол Ci','Get one current Ci record by canonical Ci ID.',{'type':'object','properties':{'id':{'type':'string'}},'required':['id']}),
 tooldef('ci_structure','Структура Ci','Get the centralized current Ci structure: components, entities, relations, bindings, dependencies, capabilities and issues.',{'type':'object','properties':{'scope':{'type':'string','default':'home'},'depth':{'type':'integer','minimum':1,'maximum':5,'default':2},'include_history':{'type':'boolean','default':False}}}),
 tooldef('ci_get','Вузол Ci','Get one component or entity by canonical Ci ID.',{'type':'object','properties':{'id':{'type':'string'}},'required':['id']}),
 tooldef('ci_query','Запит Ci','Query the unified structure without direct database access.',{'type':'object','properties':{'filter':{'type':'object','properties':{'text':{'type':'string'},'type':{'type':'string'},'capability':{'type':'string'}},'additionalProperties':False},'limit':{'type':'integer','minimum':1,'maximum':500,'default':100}}}),
 tooldef('ci_state','ACTUAL Ci','Get the current verified Ci state summary and structure version.',{'type':'object','properties':{'scope':{'type':'string','default':'home'}}}),
 tooldef('ci_facts','Факти Ci','Get current facts with provenance and evidence.',{'type':'object','properties':{'id':{'type':'string'},'limit':{'type':'integer','minimum':1,'maximum':2000,'default':500}}}),
 tooldef('ci_relations','Зв’язки Ci','Get semantic relations for all Ci or one Ci ID.',{'type':'object','properties':{'id':{'type':'string'}}}),
 tooldef('ci_bindings','Прив’язки Ci','Get physical or logical bindings for all Ci or one Ci ID.',{'type':'object','properties':{'id':{'type':'string'}}}),
 tooldef('ci_dependencies','Залежності Ci','Get dependency edges for all Ci or one Ci ID.',{'type':'object','properties':{'id':{'type':'string'}}}),
 tooldef('ci_capabilities','Можливості Ci','Get declared capabilities for all Ci or one Ci ID.',{'type':'object','properties':{'id':{'type':'string'}}}),
 tooldef('ci_history','Історія Ci','Get append-only event history for all Ci or one Ci ID.',{'type':'object','properties':{'id':{'type':'string'},'limit':{'type':'integer','minimum':1,'maximum':1000,'default':100}}}),
 tooldef('ci_diff','Зміни Ci','Get changes between Ci event versions.',{'type':'object','properties':{'from_version':{'type':'string'},'to_version':{'type':'string','default':'current'},'limit':{'type':'integer','minimum':1,'maximum':2000,'default':500}},'required':['from_version']}),
 tooldef('ci_memory_get','Пам’ять Ci','Get structured Ci memory records.',{'type':'object','properties':{'limit':{'type':'integer','minimum':1,'maximum':500,'default':100}}}),
 tooldef('ci_status','Стан системи','Compatibility projection of current Ci state.',{'type':'object','properties':{}}),
 tooldef('ci_devices','Пристрої','Compatibility projection for device entities.',{'type':'object','properties':{}}),
 tooldef('ci_network','Мережа','Compatibility projection for network entities.',{'type':'object','properties':{}}),
 tooldef('ci_storage','Сховища','Compatibility projection for storage and memory entities.',{'type':'object','properties':{}}),
 tooldef('ci_verify','Перевірити Ci','Run the existing safe local verification and record evidence.',{'type':'object','properties':{}}),
 tooldef('ci_plan','План Ci','Resolve intent into a low-risk semantic Ci plan without external execution.',{'type':'object','properties':{'intent':{'type':'string'},'target':{'type':'string'}},'required':['intent']},scope='act',read_only=False),
 tooldef('ci_action','Безпечна дія Ci','Execute only an allowlisted low-risk action: refresh or verify.',{'type':'object','properties':{'action':{'type':'string','enum':['refresh','verify']},'target':{'type':'string'}},'required':['action']},scope='act',read_only=False),
 tooldef('ci_memory_append','Запис пам’яті Ci','Append durable Ci context; sensitive material is rejected.',{'type':'object','properties':{'content':{},'refs':{'type':'array','items':{'type':'string'}},'provenance':{'type':'string'}},'required':['content']},scope='act',read_only=False),
]"""
s=s[:tools_start]+new_tools+s[tools_end:]

call_start=s.index('def call_tool(name,args):')
call_end=s.index('\ndef required_scope(name):',call_start)
new_call="""def call_tool(name,args):
    if name=='search': return ci_unit.search(args.get('query',''),args.get('limit',20))
    if name=='fetch': return ci_unified.ci_get(args.get('id',''))
    if name=='ci_structure': return ci_unified.ci_structure(args.get('scope','home'),args.get('depth',2),args.get('include_history',False))
    if name=='ci_get': return ci_unified.ci_get(args.get('id',''))
    if name=='ci_query': return ci_unified.ci_query(args.get('filter',{}),args.get('limit',100))
    if name=='ci_state': return ci_unified.ci_state(args.get('scope','home'))
    if name=='ci_facts': return ci_unified.ci_facts(args.get('id'),args.get('limit',500))
    if name=='ci_relations': return ci_unified.ci_relations(args.get('id'))
    if name=='ci_bindings': return ci_unified.ci_bindings(args.get('id'))
    if name=='ci_dependencies': return ci_unified.ci_dependencies(args.get('id'))
    if name=='ci_capabilities': return ci_unified.ci_capabilities(args.get('id'))
    if name=='ci_history': return ci_unified.ci_history(args.get('id'),args.get('limit',100))
    if name=='ci_diff': return ci_unified.ci_diff(args.get('from_version'),args.get('to_version','current'),args.get('limit',500))
    if name=='ci_memory_get': return ci_unified.ci_memory_get(args.get('limit',100))
    if name=='ci_status': return ci_unified.ci_state('home')
    if name=='ci_devices': return ci_unified.ci_query({'type':'device'},100)
    if name=='ci_network': return ci_unified.ci_query({'type':'network'},100)
    if name=='ci_storage': return {'storage':ci_unified.ci_query({'type':'storage'},100),'memory':ci_unified.ci_query({'type':'memory'},100)}
    if name=='ci_verify': return ci_unit.verify()
    if name=='ci_plan': return ci_unified.ci_plan(args.get('intent',''),args.get('target'),requested_by='ci_connector')
    if name=='ci_action': return ci_unit.action(args.get('action',''),args.get('target'),requested_by='ci_connector')
    if name=='ci_memory_append': return ci_unified.ci_memory_append(args.get('content'),args.get('refs'),source='gpt.ci',provenance=args.get('provenance'))
    return {'ok':False,'error':'unknown_tool'}
"""
s=s[:call_start]+new_call+s[call_end:]

scope_start=s.index('def required_scope(name):')
scope_end=s.index('\n\nPENDING=',scope_start)
s=s[:scope_start]+"def required_scope(name):\n    return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append'} else 'ci:read'\n"+s[scope_end:]
s=s.replace("'serverInfo':{'name':'ci-connector','version':'1.0.0'}","'serverInfo':{'name':'ci','title':'Ci','version':'1.1.0'}")

SERVER.write_text(s,encoding='utf-8')
py_compile.compile(str(UNIFIED),doraise=True)
py_compile.compile(str(SERVER),doraise=True)
print('SERVER_PATCHED=1')
print('PY_COMPILE=PASS')
