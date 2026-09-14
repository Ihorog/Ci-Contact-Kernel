#!/usr/bin/env python3
import json
import subprocess
import time
import urllib.request
from pathlib import Path

VERSION = "1.1.0"
CIT = Path('/home/kazkar/cit')
LEDGER = CIT / 'modules/ci_ledger/ci_ledger.py'
PIPELINE = CIT / 'modules/ci_operator/ci_pipeline.py'
QUEUE_URL = 'http://127.0.0.1:8798/execute'

EXECUTORS = [
    {'id':'orange.local','driver':'local','trust':100,'locality':100,'cost':1,'latency':1,
     'capabilities':['operator.health','vault.status','pipeline.status','ledger.audit']},
    {'id':'cihub.rdc','driver':'cihub_queue','trust':95,'locality':90,'cost':1,'latency':2,
     'capabilities':['cihub.status','cihub.git.status','cihub.safety_tests']},
    {'id':'ci.link','driver':'ci_link','trust':80,'locality':20,'cost':3,'latency':4,
     'capabilities':['ci.link.contact']},
]

FIXED = {
    'operator.health':['curl','-fsS','http://127.0.0.1:8796/operator/health'],
    'pipeline.status':['python3',str(PIPELINE),'status'],
    'ledger.audit':['python3',str(LEDGER),'audit-full'],
}
def inventory():
    return {'version':VERSION,'executors':EXECUTORS}

def select(capability):
    candidates=[x for x in EXECUTORS if capability in x['capabilities']]
    return sorted(candidates,key=lambda x:(-(x['trust']+x['locality']),x['latency'],x['cost'],x['id']))

def _run(argv, timeout=45):
    p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout,check=False)
    return p.returncode,(p.stdout or '').strip(),(p.stderr or '').strip()

def _json(text):
    try: return json.loads(text)
    except Exception: return {}

def _compact(capability, body):
    if capability=='operator.health':
        su=body.get('selfUpdate') or {}; reg=body.get('registry') or {}; ex=body.get('executors') or {}
        return {'node':body.get('node'),'version':body.get('version'),'registryConnections':reg.get('connections'),
                'vaultOk':((ex.get('vault') or {}).get('ok')),'localHead':((su.get('localModel') or {}).get('head')),
                'githubRequired':su.get('githubRequired')}
    if capability=='pipeline.status':
        return {'ok':body.get('ok'),'localAuthority':body.get('local_authority'),
                'githubRequired':body.get('github_required'),'head':((body.get('model') or {}).get('head')),
                'release':((body.get('current_release') or {}).get('release_id'))}
    if capability=='ledger.audit':
        return {'ok':body.get('ok'),'mode':body.get('mode'),'ciTotal':body.get('ci_total'),
                'headHash':body.get('head_hash'),'problems':body.get('problems')}
    if capability=='vault.status':
        return {'ok':body.get('ok'),'node':body.get('node'),'readable':body.get('readable'),
                'writable':body.get('writable'),'freeBytes':body.get('freeBytes')}
    return body

def _local(capability):
    if capability=='vault.status':
        code="import sys,json;sys.path.insert(0,'/home/kazkar/cit/modules/ci_operator');import vault_node;print(json.dumps(vault_node.status()))"
        rc,out,err=_run(['python3','-c',code])
    else:
        argv=FIXED.get(capability)
        if not argv: return {'ok':False,'error':'unsupported_local_capability'}
        rc,out,err=_run(argv)
    body=_json(out)
    return {'ok':rc==0 and bool(body.get('ok',True)),'evidence':_compact(capability,body),'error':err[:240] or None}

def _cihub_queue(capability, payload=None):
    data=json.dumps({'capability':capability,'payload':payload or {}},separators=(',',':')).encode('utf-8')
    req=urllib.request.Request(QUEUE_URL,data=data,method='POST',
        headers={'Content-Type':'application/json','User-Agent':'ci-orchestrator/1'})
    try:
        with urllib.request.urlopen(req,timeout=130) as response:
            body=json.loads(response.read().decode('utf-8'))
    except Exception as exc:
        return {'ok':False,'error':'cihub_queue:'+str(exc)[:180]}
    evidence=body.get('evidence') or {}
    return {'ok':bool(body.get('ok')),'evidence':evidence,
            'workerVersion':body.get('workerVersion'),
            'error':None if body.get('ok') else evidence.get('error') or body.get('error')}

def _ci_link(payload):
    message=str((payload or {}).get('message') or 'Ci distributed executor verification; contact only, no external write.')[:500]
    code=("import sys,json;sys.path.insert(0,'/home/kazkar/cit/modules/ci_operator');"
          "import ci_operator; r=ci_operator.dispatch("+repr(message)+",'CI.LINK','contact'); print(json.dumps(r))")
    rc,out,err=_run(['python3','-c',code],60)
    body=_json(out); upstream=body.get('upstream') or {}; ub=upstream.get('body') or {}
    task=((ub.get('core') or {}).get('task') or {})
    evidence={'coordinate':((body.get('resolution') or {}).get('coordinate')),
              'executed':body.get('executed'),'upstreamStatus':upstream.get('status'),
              'taskId':task.get('id'),'taskStatus':task.get('status'),
              'verification':((task.get('verification') or {}).get('status'))}
    ok=rc==0 and bool(body.get('ok')) and bool(body.get('executed')) and upstream.get('status') in (200,202)
    return {'ok':ok,'evidence':evidence,'error':err[:240] or body.get('error')}

def execute(executor_id, capability, payload=None):
    started=time.perf_counter()
    meta=next((x for x in EXECUTORS if x['id']==executor_id),None)
    if not meta or capability not in meta['capabilities']:
        return {'ok':False,'executor':executor_id,'capability':capability,'error':'executor_capability_mismatch'}
    try:
        if meta['driver']=='local': result=_local(capability)
        elif meta['driver']=='cihub_queue': result=_cihub_queue(capability,payload)
        elif meta['driver']=='ci_link': result=_ci_link(payload)
        else: result={'ok':False,'error':'driver_unknown'}
    except Exception as exc:
        result={'ok':False,'error':str(exc)[:240]}
    result.update({'executor':executor_id,'capability':capability,
                   'elapsedMs':round((time.perf_counter()-started)*1000,2)})
    return result
