#!/usr/bin/env python3
import base64, hashlib, json, os, py_compile, re, shutil, subprocess, tempfile, time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
import technical_model

REPO='Ihorog/Ci-Contact-Kernel'
API=f'https://api.github.com/repos/{REPO}/contents'
TARGET=Path('/home/kazkar/cit/modules/ci_operator')
BACKUPS=TARGET/'.backups'
SOURCE=os.getenv('CI_OPERATOR_UPDATE_SOURCE','local').strip().lower()
ALLOWED=['ci_operator.py','provider_adapters.py','ci_operator_runtime.py','operator_telemetry.py',
         'queue_contract.py','vault_node.py','release_manager.py','self_update.py','mcp_probe.py',
         'technical_model.py','ci_pipeline.py','organism_biology.py','local_selftest.py']
SHA_RE=re.compile(r'^[0-9a-f]{40}$')

def _git_blob_sha(content:bytes):
    return hashlib.sha1(f'blob {len(content)}\0'.encode()+content).hexdigest()

def _fetch_json(url):
    req=Request(url,headers={'accept':'application/vnd.github+json','user-agent':'ci-operator-self-update/2'})
    with urlopen(req,timeout=15) as response:
        return json.loads(response.read().decode('utf-8'))

def _fetch_github(repo_path,commit):
    meta=_fetch_json(f'{API}/{quote(repo_path,safe="/")}?ref={commit}')
    encoded=meta.get('content')
    if not encoded or meta.get('encoding')!='base64': raise RuntimeError('missing_base64_content:'+repo_path)
    content=base64.b64decode(encoded); actual=_git_blob_sha(content); expected=meta.get('sha')
    if actual!=expected: raise RuntimeError('blob_sha_mismatch:'+repo_path)
    return content,expected

def _fetch_repo_path(repo_path,commit):
    if SOURCE=='local': return technical_model.read_blob(commit,repo_path)
    return _fetch_github(repo_path,commit)

def _fetch_file(name,commit):
    return _fetch_repo_path('operator-node/'+name,commit)

def source_status():
    return {'source':SOURCE,'localModel':technical_model.status(),'githubRepository':REPO,
            'githubRequired':False,'githubFallbackAvailable':True}

def prepare(commit):
    if not SHA_RE.fullmatch(str(commit or '')):
        return {'ok':False,'error':'exact_40_hex_commit_required','executed':False}
    TARGET.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='ci-operator-stage-',dir=str(TARGET)))
    evidence=[]
    try:
        for name in ALLOWED:
            content,blob=_fetch_file(name,commit)
            path=stage/name; path.write_bytes(content); py_compile.compile(str(path),doraise=True)
            evidence.append({'file':name,'blobSha':blob,'bytes':len(content),'source':SOURCE})
        return {'ok':True,'executed':False,'prepared':True,'commit':commit,
                'stage':str(stage),'files':evidence,'source':SOURCE}
    except Exception as exc:
        shutil.rmtree(stage,ignore_errors=True)
        return {'ok':False,'executed':False,'error':str(exc)[:300],'source':SOURCE}

def apply(commit,activate=False):
    prepared=prepare(commit)
    if not prepared.get('ok'): return prepared
    stage=Path(prepared['stage']); stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
    backup=BACKUPS/f'{stamp}-{commit[:12]}'; backup.mkdir(parents=True,exist_ok=True)
    try:
        for name in ALLOWED:
            current=TARGET/name
            if current.exists(): shutil.copy2(current,backup/name)
        for name in ALLOWED: os.replace(stage/name,TARGET/name)
        shutil.rmtree(stage,ignore_errors=True)
    except Exception as exc:
        return {'ok':False,'executed':False,'error':'apply_failed','message':str(exc)[:300],
                'backup':str(backup),'source':SOURCE}
    result={'ok':True,'executed':True,'commit':commit,'backup':str(backup),
            'files':prepared['files'],'activationScheduled':False,'source':SOURCE,
            'evidence':{'exactCommit':commit,'source':SOURCE,'githubRequired':False}}
    if activate:
        subprocess.Popen(['sh','-c',f'sleep 2; kill -TERM {os.getpid()}'],
                         stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        result['activationScheduled']=True
    return result

def sync_model():
    return technical_model.sync_runtime()
