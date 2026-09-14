#!/usr/bin/env python3
import hashlib
import json
import time

VERSION='1.0.0'

def _canon(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def sha256(value):
    return hashlib.sha256(_canon(value).encode('utf-8')).hexdigest()

def aggregate(run_id, graph, results):
    ordered=[]; executors=set(); complete=True
    for step in graph:
        sid=step['id']; r=results.get(sid) or {'ok':False,'error':'missing_result'}
        evidence=r.get('evidence') or {}
        executors.add(str(r.get('executor') or 'none'))
        if not r.get('ok'): complete=False
        ordered.append({'step':sid,'capability':step['capability'],'executor':r.get('executor'),
                        'ok':bool(r.get('ok')),'evidence':evidence,'evidenceSha256':sha256(evidence),
                        'elapsedMs':r.get('elapsedMs'),'error':r.get('error')})
    envelope={'schema':'ci.evidence-envelope/v1','version':VERSION,'runId':run_id,
              'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
              'complete':complete,'distributed':len(executors-{'none'})>1,
              'executors':sorted(executors-{'none'}),'steps':ordered}
    envelope['graphSha256']=sha256(graph)
    envelope['evidenceSha256']=sha256(ordered)
    return envelope
