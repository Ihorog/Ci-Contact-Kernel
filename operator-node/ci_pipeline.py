#!/usr/bin/env python3
import fcntl, hashlib, json, os, py_compile, shutil, subprocess, sys, time
from pathlib import Path
import technical_model
import organism_biology

CIT=Path('/home/kazkar/cit')
STATE=CIT/'state/ci_pipeline_status.json'
CURRENT=CIT/'state/ci_pipeline_release.json'
HISTORY=CIT/'state/ci_pipeline_releases.jsonl'
LOCK=CIT/'state/ci_pipeline.lock'
LEDGER=CIT/'modules/ci_ledger/ci_ledger.py'
LOCAL_SELFTEST=CIT/'modules/ci_operator/local_selftest.py'
INTEGRATION_SELFTEST=CIT/'modules/ci_operator/selftest.py'

def run(args,timeout=60,cwd=None):
    p=subprocess.run(args,capture_output=True,text=True,timeout=timeout,cwd=cwd)
    return {'ok':p.returncode==0,'rc':p.returncode,'out':p.stdout[-5000:].strip(),'err':p.stderr[-2500:].strip()}

def acquire_lock():
    LOCK.parent.mkdir(parents=True,exist_ok=True)
    f=open(LOCK,'w')
    try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: f.close(); return None
    f.write(json.dumps({'pid':os.getpid(),'started_at':time.time()})); f.flush()
    return f
def test(commit=None):
    commit=commit or technical_model.head(); root=technical_model.ROOT
    if not commit: return {'ok':False,'error':'no_commit'}
    checks=[]
    checks.append({'name':'git_fsck','blocking':True,**run(['git','fsck','--no-dangling',commit],30,cwd=root)})
    for p in sorted((root/'operator-node').glob('*.py')):
        try:
            py_compile.compile(str(p),doraise=True)
            checks.append({'name':'compile:'+p.name,'blocking':True,'ok':True})
        except Exception as e:
            checks.append({'name':'compile:'+p.name,'blocking':True,'ok':False,'err':str(e)[:300]})
    if LOCAL_SELFTEST.exists():
        checks.append({'name':'local_selftest','blocking':True,**run(['python3',str(LOCAL_SELFTEST)],90)})
    if LEDGER.exists():
        checks.append({'name':'ledger_audit','blocking':True,**run(['python3',str(LEDGER),'audit-full'],60)})
    if INTEGRATION_SELFTEST.exists():
        checks.append({'name':'integration_selftest','blocking':False,**run(['python3',str(INTEGRATION_SELFTEST)],90)})
    ok=all(x.get('ok') for x in checks if x.get('blocking'))
    return {'ok':ok,'commit':commit,'checks':checks}

def _last_release():
    if not CURRENT.exists(): return {}
    try: return json.loads(CURRENT.read_text(encoding='utf-8'))
    except Exception: return {}
def _append_ledger(scope,before_state,after_state,evidence):
    if not LEDGER.exists(): return {'ok':False,'error':'ledger_missing'}
    fact={'event_id':scope+'-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()),
          'scope':scope,'before_state':before_state,'after_state':after_state,
          'evidence':evidence,'provenance':{'executor':'ci_pipeline','host':'orangepi3-lts','source':'local'}}
    return run(['python3',str(LEDGER),'append','--json',json.dumps(fact,separators=(',',':'))],60)

def _write_release(manifest):
    CURRENT.parent.mkdir(parents=True,exist_ok=True)
    CURRENT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    with HISTORY.open('a',encoding='utf-8') as f: f.write(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
    vp=Path(manifest['artifact']['vault']+'.release.json')
    vp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    digest=hashlib.sha256(vp.read_bytes()).hexdigest()
    Path(str(vp)+'.sha256').write_text(digest+'  '+vp.name+'\n',encoding='utf-8')
    return {'path':str(vp),'sha256':digest}

def release():
    lock=acquire_lock()
    if not lock: return {'ok':False,'stage':'concurrency','error':'pipeline_busy'}
    try:
        previous=_last_release(); sync=technical_model.sync_runtime(); commit=sync['commit']
        if previous.get('commit') == commit:
            organism=organism_biology.observe('orange:release',{'baselineWork':4,'actualWork':0,'functionPreserved':True,'evidenceComplete':True,'authorityPreserved':True,'invariantBroken':False,'repeatedEquivalentWork':True})
            result={'ok':True,'stage':'sleep','commit':commit,'organism':organism,'prevented_release':True}
            _write(result); return result
        tests=test(commit)
        if not tests['ok']:
            organism=organism_biology.observe('orange:release',{'baselineWork':4,'actualWork':1,'functionPreserved':False,'evidenceComplete':True,'authorityPreserved':True,'invariantBroken':False,'immediateFailure':True})
            result={'ok':False,'stage':'test','commit':commit,'tests':tests,'organism':organism}; _write(result); return result
        artifact=technical_model.export_bundle(commit)
        stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
        release_id=f'ci-release-{stamp}-{commit[:12]}'
        provenance={'schema':'ci.pipeline.provenance/v2','release_id':release_id,
          'commit':commit,'created_at':stamp,'source':'local-orange','github_required':False,
          'tests':[{'name':x['name'],'blocking':x.get('blocking',True),'ok':x.get('ok',False)} for x in tests['checks']],
          'artifact':artifact}
        pp=Path(artifact['artifact']+'.provenance.json')
        pp.write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        prov_sha=hashlib.sha256(pp.read_bytes()).hexdigest()
        vp=Path(artifact['vault']+'.provenance.json'); vp.write_bytes(pp.read_bytes())
        Path(str(vp)+'.sha256').write_text(prov_sha+'  '+vp.name+'\n',encoding='utf-8')

        deploy=run(['python3','-c',
          'import sys,json;sys.path.insert(0,"/home/kazkar/cit/modules/ci_operator");import release_manager;print(json.dumps(release_manager.deploy("'+commit+'",True)))'],120)
        deploy_body={}
        try: deploy_body=json.loads(deploy.get('out') or '{}')
        except Exception: deploy_body={'ok':False,'error':'deploy_output_invalid'}
        if not deploy.get('ok') or not deploy_body.get('ok'):
            result={'ok':False,'stage':'deploy','commit':commit,'tests':tests,'artifact':artifact,'deploy':deploy_body}
            _write(result); return result
        run(['git','tag',release_id,commit],30,cwd=technical_model.ROOT)
        before={'release_id':previous.get('release_id'),'commit':previous.get('commit')} if previous else {'state':'unreleased'}
        after={'release_id':release_id,'commit':commit}
        manifest={'ok':True,'schema':'ci.pipeline.release/v2','release_id':release_id,
          'released_at':stamp,'commit':commit,'previous':before,'source':'local-orange',
          'github_required':False,'artifact':artifact,'provenance':str(vp),
          'provenance_sha256':prov_sha,'deploy':deploy_body,
          'tests':{'blocking_pass':True,'integration_advisory':next((x.get('ok') for x in tests['checks'] if x['name']=='integration_selftest'),None)}}
        ledger=_append_ledger('ci.orange.local_cicd.release',before,after,
          {'release_id':release_id,'commit':commit,'artifact_sha256':artifact['sha256'],
           'provenance_sha256':prov_sha,'deploy_ok':True})
        manifest['ledger']=ledger
        manifest_ref=_write_release(manifest); manifest['release_manifest']=manifest_ref
        CURRENT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        _write(manifest)
        return manifest
    finally:
        try: fcntl.flock(lock,fcntl.LOCK_UN); lock.close()
        except Exception: pass

def verify_rollback(commit=None):
    current=technical_model.head(); target=commit or (_last_release().get('previous') or {}).get('commit')
    if not target: return {'ok':False,'error':'rollback_target_missing','current':current}
    prep=run(['python3','-c',
      'import sys,json;sys.path.insert(0,"/home/kazkar/cit/modules/ci_operator");import self_update;print(json.dumps(self_update.prepare("'+target+'")))'],120)
    body={}
    try: body=json.loads(prep.get('out') or '{}')
    except Exception: body={'ok':False,'error':'prepare_output_invalid'}
    ok=bool(prep.get('ok') and body.get('ok') and body.get('prepared'))
    stage=body.get('stage') if isinstance(body,dict) else None
    if stage: shutil.rmtree(stage,ignore_errors=True)
    if isinstance(body,dict): body['stage_cleaned']=bool(stage)
    return {'ok':ok,'current':current,'rollback_target':target,'prepare':body,'executed':False}
def _write(result):
    STATE.parent.mkdir(parents=True,exist_ok=True)
    STATE.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def status():
    model=technical_model.status(); current={}; last={}
    if CURRENT.exists():
        try: current=json.loads(CURRENT.read_text(encoding='utf-8'))
        except Exception: current={}
    if STATE.exists():
        try: last=json.loads(STATE.read_text(encoding='utf-8'))
        except Exception: last={}
    return {'ok':model.get('ok',False),'model':model,'current_release':current,
            'last_pipeline':last,'github_required':False,'local_authority':True}

if __name__=='__main__':
    cmd=sys.argv[1] if len(sys.argv)>1 else 'status'
    if cmd=='sync': result=technical_model.sync_runtime()
    elif cmd=='test': result=test()
    elif cmd=='release': result=release()
    elif cmd=='rollback-verify': result=verify_rollback(sys.argv[2] if len(sys.argv)>2 else None)
    else: result=status()
    print(json.dumps(result,ensure_ascii=False,indent=2))
    sys.exit(0 if result.get('ok') else 2)
