#!/usr/bin/env python3
import json
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import executor_mesh
import evidence_aggregator

VERSION='1.1.0'
CIT=Path('/home/kazkar/cit')
STATE_DIR=CIT/'state/orchestration'
LAST=CIT/'state/ci_orchestrator_last.json'
LEDGER=CIT/'modules/ci_ledger/ci_ledger.py'

READ_CAPS={'operator.health','vault.status','pipeline.status','ledger.audit','ci.link.contact','cihub.status','cihub.git.status','cihub.safety_tests'}

TEMPLATES={
 'distributed_acceptance':[
   {'id':'operator','capability':'operator.health','depends':[]},
   {'id':'vault','capability':'vault.status','depends':[]},
   {'id':'cihub','capability':'cihub.status','depends':[]},
   {'id':'cihub_tests','capability':'cihub.safety_tests','depends':['cihub']},
   {'id':'remote','capability':'ci.link.contact','depends':[],
    'payload':{'message':'Ci distributed orchestration acceptance; contact only, no external write.'}},
   {'id':'pipeline','capability':'pipeline.status','depends':['operator']},
   {'id':'ledger','capability':'ledger.audit','depends':['operator','vault']},
 ]
}
def _validate(graph):
    ids=[x.get('id') for x in graph]
    if not ids or len(ids)!=len(set(ids)) or any(not x for x in ids):
        raise ValueError('invalid_step_ids')
    known=set(ids)
    for step in graph:
        if step.get('capability') not in READ_CAPS: raise ValueError('capability_not_allowed')
        deps=step.get('depends') or []
        if any(d not in known or d==step['id'] for d in deps): raise ValueError('invalid_dependency')
    pending={x['id']:set(x.get('depends') or []) for x in graph}; done=set()
    while pending:
        ready=[sid for sid,deps in pending.items() if deps<=done]
        if not ready: raise ValueError('dependency_cycle')
        for sid in ready: pending.pop(sid); done.add(sid)
    return True

def _append_ledger(run_id, before_state, after_state, envelope):
    if not LEDGER.exists(): return {'ok':False,'error':'ledger_missing'}
    import subprocess
    fact={'event_id':'ci.orchestration-'+run_id,'scope':'ci.orange.orchestration.cycle',
          'before_state':before_state,'after_state':after_state,
          'evidence':{'runId':run_id,'evidenceSha256':envelope['evidenceSha256'],
                      'graphSha256':envelope['graphSha256'],'distributed':envelope['distributed']},
          'provenance':{'executor':'ci_orchestrator','host':'orangepi3-lts','source':'local'}}
    p=subprocess.run(['python3',str(LEDGER),'append','--json',json.dumps(fact,separators=(',',':'))],
                     capture_output=True,text=True,timeout=60,check=False)
    try: body=json.loads((p.stdout or '').strip() or '{}')
    except Exception: body={}
    return {'ok':p.returncode==0 and bool(body.get('ok')),'rc':p.returncode,'body':body,'error':(p.stderr or '')[:240] or None}
def _execute_step(step):
    attempts=[]
    for candidate in executor_mesh.select(step['capability']):
        result=executor_mesh.execute(candidate['id'],step['capability'],step.get('payload'))
        attempts.append({'executor':candidate['id'],'ok':result.get('ok'),'error':result.get('error')})
        if result.get('ok'):
            result['attempts']=attempts
            return result
    return {'ok':False,'capability':step['capability'],'executor':None,'attempts':attempts,'error':'all_executors_failed'}

def _write_state(result):
    STATE_DIR.mkdir(parents=True,exist_ok=True)
    path=STATE_DIR/(result['runId']+'.json')
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    path.write_text(text,encoding='utf-8'); LAST.write_text(text,encoding='utf-8')
    return str(path)

def run_graph(graph, intent='distributed orchestration acceptance'):
    _validate(graph)
    run_id='orch-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:8]
    started=time.time(); pending={x['id']:dict(x) for x in graph}; results={}; order=[]
    before={'state':'requested','intentClass':'orchestration','steps':len(graph)}
    while pending:
        ready=[s for s in pending.values() if all(d in results and results[d].get('ok') for d in (s.get('depends') or []))]
        blocked=[s for s in pending.values() if any(d in results and not results[d].get('ok') for d in (s.get('depends') or []))]
        for s in blocked:
            results[s['id']]={'ok':False,'executor':None,'capability':s['capability'],'error':'dependency_failed','evidence':{}}
            order.append(s['id']); pending.pop(s['id'],None)
        if not ready:
            if pending: raise RuntimeError('orchestration_deadlock')
            break
        with ThreadPoolExecutor(max_workers=min(4,len(ready))) as pool:
            futures={pool.submit(_execute_step,s):s for s in ready}
            for fut in as_completed(futures):
                s=futures[fut]
                try: results[s['id']]=fut.result()
                except Exception as exc: results[s['id']]={'ok':False,'executor':None,'capability':s['capability'],'error':str(exc)[:240],'evidence':{}}
                order.append(s['id']); pending.pop(s['id'],None)
    envelope=evidence_aggregator.aggregate(run_id,graph,results)
    ok=bool(envelope['complete'])
    after={'state':'verified' if ok else 'failed','distributed':envelope['distributed'],
           'executors':envelope['executors'],'evidenceSha256':envelope['evidenceSha256']}
    ledger=_append_ledger(run_id,before,after,envelope) if ok else {'ok':False,'skipped':True}
    result={'ok':ok and ledger.get('ok',False),'schema':'ci.orchestration.run/v1','version':VERSION,
            'runId':run_id,'intentClass':'orchestration','graph':graph,'order':order,'results':results,
            'evidence':envelope,'ledger':ledger,'elapsedMs':round((time.time()-started)*1000,2)}
    result['statePath']=_write_state(result)
    return result

def run_template(name='distributed_acceptance'):
    graph=TEMPLATES.get(name)
    if not graph: return {'ok':False,'error':'template_not_found','template':name}
    return run_graph(graph,name)

def status():
    last={}
    if LAST.exists():
        try: last=json.loads(LAST.read_text(encoding='utf-8'))
        except Exception: last={}
    return {'ok':True,'version':VERSION,'executors':executor_mesh.inventory(),
            'templates':sorted(TEMPLATES),'lastRun':{'runId':last.get('runId'),'ok':last.get('ok'),
            'distributed':((last.get('evidence') or {}).get('distributed')),
            'evidenceSha256':((last.get('evidence') or {}).get('evidenceSha256'))}}
if __name__=='__main__':
    cmd=sys.argv[1] if len(sys.argv)>1 else 'status'
    if cmd=='run': result=run_template(sys.argv[2] if len(sys.argv)>2 else 'distributed_acceptance')
    else: result=status()
    print(json.dumps(result,ensure_ascii=False,indent=2))
    sys.exit(0 if result.get('ok') else 2)
