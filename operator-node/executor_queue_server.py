#!/usr/bin/env python3
import json, os, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = '1.0.0'
HOST = '0.0.0.0'
PORT = 8798
STATE = Path('/home/kazkar/cit/state/executor_queue')
CIHUB_IP = '192.168.1.38'
ALLOWED = {'cihub.status','cihub.git.status','cihub.safety_tests'}


def _write_atomic(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(body, separators=(',',':')), encoding='utf-8')
    os.replace(tmp, path)


def _read(path):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except Exception: return None

class Handler(BaseHTTPRequestHandler):
    server_version = 'CiExecutorQueue/1.0'
    def log_message(self, fmt, *args): return
    def _json(self, code, body):
        data=json.dumps(body,separators=(',',':')).encode()
        self.send_response(code); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def _body(self):
        n=min(int(self.headers.get('Content-Length','0')),16384)
        return json.loads(self.rfile.read(n) or b'{}')
    def do_GET(self):
        parsed=urlparse(self.path)
        if parsed.path=='/health': return self._json(200,{'ok':True,'version':VERSION,'pending':len(list(STATE.glob('*.pending.json')))})
        if parsed.path!='/pull': return self._json(404,{'ok':False,'error':'not_found'})
        if self.client_address[0] != CIHUB_IP: return self._json(403,{'ok':False,'error':'peer_denied'})
        node=(parse_qs(parsed.query).get('node') or [''])[0]
        if node!='cihub.rdc': return self._json(400,{'ok':False,'error':'node_invalid'})
        for p in sorted(STATE.glob('*.pending.json')):
            leased=p.with_name(p.name.replace('.pending.json','.leased.json'))
            try: os.replace(p,leased)
            except FileNotFoundError: continue
            return self._json(200,_read(leased) or {'ok':False,'error':'task_corrupt'})
        self.send_response(204); self.end_headers()
    def do_POST(self):
        if self.path=='/execute':
            if self.client_address[0] not in ('127.0.0.1','::1'):
                return self._json(403,{'ok':False,'error':'local_only'})
            body=self._body(); cap=str(body.get('capability',''))
            if cap not in ALLOWED: return self._json(400,{'ok':False,'error':'capability_denied'})
            task={'id':str(uuid.uuid4()),'node':'cihub.rdc','capability':cap,
                  'payload':body.get('payload') or {},'createdAt':time.time()}
            pending=STATE/(task['id']+'.pending.json'); _write_atomic(pending,task)
            result_path=STATE/(task['id']+'.result.json')
            deadline=time.time()+125
            while time.time()<deadline:
                if result_path.exists():
                    result=_read(result_path) or {'ok':False,'error':'result_corrupt'}
                    for suffix in ('.pending.json','.leased.json','.result.json'):
                        try: (STATE/(task['id']+suffix)).unlink()
                        except FileNotFoundError: pass
                    return self._json(200,result)
                time.sleep(0.2)
            return self._json(504,{'ok':False,'error':'executor_timeout','taskId':task['id']})
        if self.path=='/result':
            if self.client_address[0] != CIHUB_IP: return self._json(403,{'ok':False,'error':'peer_denied'})
            body=self._body(); tid=str(body.get('id',''))
            if not tid: return self._json(400,{'ok':False,'error':'id_required'})
            _write_atomic(STATE/(tid+'.result.json'),body)
            return self._json(202,{'ok':True,'accepted':True})
        return self._json(404,{'ok':False,'error':'not_found'})

def main():
    STATE.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever(poll_interval=0.5)


if __name__=='__main__':
    main()
