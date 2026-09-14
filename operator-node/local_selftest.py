#!/usr/bin/env python3
import json, sys, urllib.request
sys.path.insert(0,'/home/kazkar/cit/modules/ci_operator')
import ci_operator_runtime as runtime
import ci_orchestrator, self_update, technical_model

checks={}
status=runtime.status()
checks['operator_ok']=status.get('ok') is True
checks['registry_present']=status.get('registry',{}).get('connections',0) >= 1
checks['vault_ok']=status.get('executors',{}).get('vault',{}).get('ok') is True
candidate=ci_orchestrator.status()
checks['orchestrator_ready']=candidate.get('ok') is True
checks['cihub_registered']=any(x.get('id')=='cihub.rdc' for x in (((candidate.get('executors') or {}).get('executors')) or []))
try:
    q=json.loads(urllib.request.urlopen('http://127.0.0.1:8798/health',timeout=3).read().decode())
    checks['executor_queue_ready']=q.get('ok') is True
except Exception:
    checks['executor_queue_ready']=False
model=technical_model.status()
checks['model_ok']=model.get('ok') is True
checks['model_clean']=model.get('dirty') is False
source=self_update.source_status()
checks['local_source']=source.get('source') == 'local'
checks['github_not_required']=source.get('githubRequired') is False
ok=all(checks.values())
print(json.dumps({'ok':ok,'checks':checks,'candidate':candidate,'model':model,'source':source},ensure_ascii=False,indent=2))
print('CI_LOCAL_SELFTEST='+('PASS' if ok else 'FAIL'))
raise SystemExit(0 if ok else 1)