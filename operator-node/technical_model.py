#!/usr/bin/env python3
import hashlib, json, os, re, shutil, subprocess, time
from pathlib import Path

CIT = Path('/home/kazkar/cit')
ROOT = CIT / 'technical-model'
OP = CIT / 'modules/ci_operator'
CON = CIT / 'modules/ci_connector/ci_connector_server.py'
LEDGER = CIT / 'modules/ci_ledger/ci_ledger.py'
REGISTRY = Path('/home/kazkar/cimeika/cit/registry/ci-registry/v1.1.0/ci-registry.json')
VAULT = Path('/mnt/cimeika_vault/92482E5D482E3FF9/ci/backups/orangepi3-lts')

DENY_NAMES = {'.env','.mcp.env','.mcp_token','.orange_internal_key','.ci.env','keenetic_admin','keenetic_user'}
SECRET_PATTERNS = (
    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(r'\bsk-proj-[A-Za-z0-9_-]{16,}'),
    re.compile(r'\bBearer\s+[A-Za-z0-9._~+/=-]{20,}'),
)

def run(args, cwd=None, check=True):
    p=subprocess.run(args,cwd=cwd,capture_output=True,text=True,timeout=60)
    if check and p.returncode: raise RuntimeError((p.stderr or p.stdout).strip()[:500])
    return p

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def _safe_bytes(data, name):
    if Path(name).name in DENY_NAMES: raise RuntimeError('sensitive_name:'+name)
    text=data.decode('utf-8',errors='ignore')
    for pattern in SECRET_PATTERNS:
        if pattern.search(text): raise RuntimeError('sensitive_content:'+name)
    return data

def init_repo():
    ROOT.mkdir(parents=True,exist_ok=True)
    if not (ROOT/'.git').exists():
        run(['git','init','-b','main'],ROOT)
        run(['git','config','user.name','Ci Local Operator'],ROOT)
        run(['git','config','user.email','ci-local@localhost'],ROOT)
    (ROOT/'.gitignore').write_text('.cache/\n*.pyc\n__pycache__/\n.env\n*.key\n*.pem\nsecrets/\n',encoding='utf-8')
    return ROOT

def _copy(src,dst):
    data=_safe_bytes(Path(src).read_bytes(),str(dst))
    target=ROOT/dst; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
    return {'path':str(dst),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}

def sync_runtime():
    init_repo(); files=[]
    for src in sorted(OP.glob('*.py')): files.append(_copy(src,Path('operator-node')/src.name))
    for name in ('CI_UNIVERSAL_AI_BINDING.md','SHA256SUMS.txt'):
        p=OP/name
        if p.exists(): files.append(_copy(p,Path('operator-node')/name))
    if CON.exists(): files.append(_copy(CON,Path('connector')/CON.name))
    if LEDGER.exists(): files.append(_copy(LEDGER,Path('local-runtime')/LEDGER.name))
    if REGISTRY.exists(): files.append(_copy(REGISTRY,Path('public/ci-registry/v1.1.0/ci-registry.json')))
    meta={'kind':'CI_LOCAL_TECHNICAL_MODEL','version':'1.0.0','source':'Orange runtime','files':files}
    (ROOT/'MODEL.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    run(['git','add','-A'],ROOT)
    diff=run(['git','diff','--cached','--quiet'],ROOT,check=False)
    committed=False
    if diff.returncode:
        msg='ci: sync verified technical model '+time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        run(['git','commit','-m',msg],ROOT); committed=True
    head=run(['git','rev-parse','HEAD'],ROOT).stdout.strip()
    return {'ok':True,'root':str(ROOT),'commit':head,'committed':committed,'files':len(files)}

def head():
    init_repo()
    p=run(['git','rev-parse','HEAD'],ROOT,check=False)
    return p.stdout.strip() if p.returncode==0 else None

def read_blob(commit, repo_path):
    init_repo(); spec=f'{commit}:{repo_path}'
    p=subprocess.run(['git','show',spec],cwd=ROOT,capture_output=True,timeout=30)
    if p.returncode: raise RuntimeError('local_model_missing:'+repo_path)
    data=_safe_bytes(p.stdout,repo_path)
    blob=run(['git','rev-parse',f'{commit}:{repo_path}'],ROOT).stdout.strip()
    return data,blob

def status():
    init_repo(); h=head()
    dirty=run(['git','status','--porcelain'],ROOT).stdout.strip()
    count=run(['git','rev-list','--count','HEAD'],ROOT,check=False).stdout.strip() if h else '0'
    return {'ok':bool(h),'root':str(ROOT),'head':h,'dirty':bool(dirty),'commits':int(count or 0),'runtimeIndependent':True}

def export_bundle(commit=None):
    init_repo(); commit=commit or head()
    if not commit: raise RuntimeError('no_commit')
    stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
    out=CIT/'artifacts'/f'ci-technical-model-{stamp}-{commit[:12]}.tar.gz'
    out.parent.mkdir(parents=True,exist_ok=True)
    with open(out,'wb') as f:
        p=subprocess.run(['git','archive','--format=tar.gz',commit],cwd=ROOT,stdout=f,stderr=subprocess.PIPE)
    if p.returncode: raise RuntimeError(p.stderr.decode(errors='replace')[:300])
    digest=sha256(out); VAULT.mkdir(parents=True,exist_ok=True)
    v=VAULT/out.name; shutil.copy2(out,v)
    side=Path(str(v)+'.sha256'); side.write_text(digest+'  '+v.name+'\n',encoding='utf-8')
    return {'ok':True,'commit':commit,'artifact':str(out),'vault':str(v),'sha256':digest,'bytes':out.stat().st_size}

if __name__=='__main__':
    import sys
    cmd=sys.argv[1] if len(sys.argv)>1 else 'status'
    result=sync_runtime() if cmd=='sync' else export_bundle(sys.argv[2] if len(sys.argv)>2 else None) if cmd=='export' else status()
    print(json.dumps(result,ensure_ascii=False,indent=2))
