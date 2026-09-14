#!/usr/bin/env python3
import base64, hashlib, json, os, secrets, sqlite3, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

PORT=int(os.getenv('CI_CONNECTOR_PORT','8796'))
BASE_URL=os.getenv('CI_CONNECTOR_BASE_URL','https://mcp-http.cimeika.com.ua').rstrip('/')
STATE=Path('/home/kazkar/cit/state')
AUTH_DB=STATE/'ci_connector_auth.db'
sys.path.insert(0,'/home/kazkar/cit/modules/ci_connector')
import ci_unit
import ci_unified
sys.path.insert(0,'/home/kazkar/cit/modules/ci_operator')
import ci_operator_runtime as ci_operator

SCOPES=['ci:read','ci:act']
READ_SCHEME=[{'type':'oauth2','scopes':['ci:read']}]
ACT_SCHEME=[{'type':'oauth2','scopes':['ci:act']}]

def tooldef(name,title,description,schema,scope='read',read_only=True,open_world=False):
    return {'name':name,'title':title,'description':description,'inputSchema':schema,
      'securitySchemes':READ_SCHEME if scope=='read' else ACT_SCHEME,
      'annotations':{'readOnlyHint':read_only,'destructiveHint':False,'openWorldHint':open_world}}

TOOLS=[
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
 tooldef('ci_operator_status','Стан Ci Operator','Get the live Orange operator node, registry, acceptance and executor status.',{'type':'object','properties':{}}),
 tooldef('ci_resolve','Маршрут Ci','Resolve a user intent to the canonical Ci coordinate and safest available executor route.',{'type':'object','properties':{'intent':{'type':'string'},'target':{'type':'string'}},'required':['intent']}),
 tooldef('ci_dispatch','Передати Ci','Dispatch an intent through the Orange operator and CI.LINK. Sensitive external writes remain permission-gated downstream.',{'type':'object','properties':{'intent':{'type':'string'},'target':{'type':'string'},'mode':{'type':'string','enum':['resolve','status','contact','sync'],'default':'contact'}},'required':['intent']},scope='act',read_only=False,open_world=True),

 tooldef('ci_executor_status','Виконавці Ci','Probe Orange-local provider adapters without exposing credentials.',{'type':'object','properties':{}}),
 tooldef('ci_execute_read','Пряме читання Ci','Run one allowlisted read-only provider operation directly on Orange when a local authenticated adapter is ready.',{'type':'object','properties':{'coordinate':{'type':'string','enum':['CI.GITHUB','CI.VERCEL','CI.SUPABASE','CI.CLOUDFLARE']},'operation':{'type':'string','enum':['identity','inventory']}},'required':['coordinate','operation']},read_only=True,open_world=True),
 tooldef('ci_operator_update','Оновити Ci Operator','Update only allowlisted Orange operator modules from an exact 40-character commit SHA in Ihorog/Ci-Contact-Kernel. The updater verifies Git blob SHAs, compiles staged files and keeps a rollback backup.',{'type':'object','properties':{'commit':{'type':'string','pattern':'^[0-9a-f]{40}$'},'activate':{'type':'boolean','default':False}},'required':['commit']},scope='act',read_only=False,open_world=True),

 tooldef('ci_operator_release','Реліз Ci Operator','Atomically deploy an exact canonical Git commit to Orange runtime and MCP connector with compile checks, rollback backups and optional supervised restart.',{'type':'object','properties':{'commit':{'type':'string','pattern':'^[0-9a-f]{40}$'},'activate':{'type':'boolean','default':False}},'required':['commit']},scope='act',read_only=False,open_world=True),
 tooldef('ci_operator_metrics','Метрики Ci Operator','Return PII-safe execution KPIs from Orange telemetry: success, evidence completeness, fallback, executed rate and latency percentiles.',{'type':'object','properties':{'limit':{'type':'integer','minimum':1,'maximum':5000,'default':500}}},read_only=True,open_world=False),
 tooldef('ci_delegate','Делегувати вузлу Ci','Bind a registered Ci operation to its already-known external node without searching again. Safe/read operations are marked automatic; gated operations keep the same executor and request only permission.',{'type':'object','properties':{'intent':{'type':'string'},'operation':{'type':'string'},'target':{'type':'string'}},'required':['intent','operation']},read_only=True,open_world=True),
 tooldef('ci_vault_read','Читати Vault','Read/list/stat/download chunks from the live CI.VAULT node.',{'type':'object','properties':{'action':{'type':'string','enum':['status','list','stat','download']},'path':{'type':'string'},'offset':{'type':'integer','minimum':0},'limit':{'type':'integer','minimum':1,'maximum':4194304}},'required':['action']},read_only=True,open_world=False),
 tooldef('ci_vault_write','Змінювати Vault','Upload chunks, create folders, move, rename or explicitly confirmed delete inside CI.VAULT.',{'type':'object','properties':{'action':{'type':'string','enum':['upload','mkdir','move','rename','delete']},'path':{'type':'string'},'destination':{'type':'string'},'name':{'type':'string'},'contentBase64':{'type':'string'},'offset':{'type':'integer','minimum':0},'truncate':{'type':'boolean'},'confirmDelete':{'type':'boolean'}},'required':['action']},scope='act',read_only=False,open_world=False),
]
def db():
    STATE.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(AUTH_DB); c.row_factory=sqlite3.Row
    c.executescript('''
      CREATE TABLE IF NOT EXISTS clients(client_id TEXT PRIMARY KEY,redirect_uris TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS codes(code_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,scope TEXT NOT NULL,resource TEXT NOT NULL,challenge TEXT,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,scope TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL,created_at INTEGER NOT NULL);
    '''); c.commit(); return c

def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def b64url(raw): return base64.urlsafe_b64encode(raw).decode().rstrip('=')
def json_body(h):
    n=int(h.headers.get('Content-Length','0') or 0)
    raw=h.rfile.read(n) if n else b''
    try:return json.loads(raw or b'{}')
    except:return {}

def token_info(header):
    if not header or not header.startswith('Bearer '): return None
    raw=header[7:].strip(); c=db()
    row=c.execute('SELECT * FROM tokens WHERE token_hash=?',(digest(raw),)).fetchone(); c.close()
    if not row or row['resource']!=BASE_URL or row['expires']<int(time.time()): return None
    return dict(row)

def has_scope(info,scope):
    return bool(info) and scope in (info.get('scope') or '').split()

def call_tool(name,args):
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

    if name=='ci_operator_status': return ci_operator.status()
    if name=='ci_resolve': return ci_operator.resolve(args.get('intent',''),args.get('target'))
    if name=='ci_dispatch': return ci_operator.dispatch(args.get('intent',''),args.get('target'),args.get('mode','contact'))

    if name=='ci_executor_status': return ci_operator.executor_status()
    if name=='ci_execute_read': return ci_operator.execute_read(args.get('coordinate',''),args.get('operation',''))
    if name=='ci_operator_update': return ci_operator.operator_update(args.get('commit',''),args.get('activate',False))
    if name=='ci_operator_release': return ci_operator.operator_release(args.get('commit',''),args.get('activate',False))
    if name=='ci_operator_metrics': return ci_operator.metrics(args.get('limit',500))
    if name=='ci_delegate': return ci_operator.delegate(args.get('intent',''),args.get('operation',''),args.get('target'))
    if name=='ci_vault_read': return ci_operator.vault(**args)
    if name=='ci_vault_write': return ci_operator.vault(**args)
    return {'ok':False,'error':'unknown_tool'}

def required_scope(name):
    return 'ci:act' if name in {'ci_plan','ci_action','ci_memory_append','ci_dispatch','ci_operator_update','ci_operator_release','ci_vault_write'} else 'ci:read'


PENDING={}
AUTH_PAGE='''<!doctype html><html lang="uk"><meta charset="utf-8"><title>Ci Connector</title>
<style>body{background:#0b0d12;color:#eee;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0}.b{padding:32px;border:1px solid #333;border-radius:16px;max-width:430px}button{padding:12px 22px;font-weight:700}</style>
<div class="b"><h1>Ci Connector</h1><p>ChatGPT запитує доступ до локального Ci: факти, зв’язки, пам’ять і безпечні перевірені дії.</p><form method="post" action="/oauth/approve"><input type="hidden" name="ticket" value="{ticket}"><button>Дозволити</button></form></div></html>'''

def request_data(h):
    n=int(h.headers.get('Content-Length','0') or 0); raw=h.rfile.read(n) if n else b''
    ctype=h.headers.get('Content-Type','')
    if 'application/json' in ctype:
        try:return json.loads(raw or b'{}')
        except:return {}
    q=parse_qs(raw.decode(errors='ignore'))
    return {k:(v[-1] if isinstance(v,list) and v else '') for k,v in q.items()}

class H(BaseHTTPRequestHandler):
    server_version='CiConnector/1.0'
    def log_message(self,fmt,*args): print(time.strftime('%F %T'),fmt%args)
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Authorization,Content-Type,mcp-session-id')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS,DELETE')
    def send_json(self,code,obj,headers=None):
        raw=json.dumps(obj,ensure_ascii=False,default=str).encode()
        self.send_response(code); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.cors()
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)
    def send_html(self,html):
        raw=html.encode(); self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def redirect(self,url):
        self.send_response(302); self.send_header('Location',url); self.end_headers()
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_DELETE(self): self.send_response(204); self.end_headers()
    def do_GET(self):
        p=urlparse(self.path); path=p.path; qs=parse_qs(p.query)
        if path in ('/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'):
            return self.send_json(200,{'resource':BASE_URL,'authorization_servers':[BASE_URL],'scopes_supported':SCOPES,'resource_documentation':BASE_URL+'/health'})
        if path in ('/.well-known/oauth-authorization-server','/.well-known/openid-configuration'):
            return self.send_json(200,{'issuer':BASE_URL,'authorization_response_iss_parameter_supported':True,'authorization_endpoint':BASE_URL+'/oauth/authorize','token_endpoint':BASE_URL+'/oauth/token','registration_endpoint':BASE_URL+'/oauth/register','response_types_supported':['code'],'grant_types_supported':['authorization_code'],'code_challenge_methods_supported':['S256'],'token_endpoint_auth_methods_supported':['none'],'scopes_supported':SCOPES})
        if path=='/oauth/authorize':
            cid=qs.get('client_id',[''])[0]; ruri=qs.get('redirect_uri',[''])[0]; state=qs.get('state',[''])[0]
            scope=qs.get('scope',['ci:read'])[0]; resource=qs.get('resource',[BASE_URL])[0]
            challenge=qs.get('code_challenge',[''])[0]; method=qs.get('code_challenge_method',[''])[0]
            c=db(); row=c.execute('SELECT redirect_uris FROM clients WHERE client_id=?',(cid,)).fetchone(); c.close()
            allowed=json.loads(row['redirect_uris']) if row else []
            if not row or ruri not in allowed or resource!=BASE_URL or method!='S256' or not challenge:
                return self.send_json(400,{'error':'invalid_request'})
            requested=' '.join(s for s in scope.split() if s in SCOPES) or 'ci:read'
            ticket=secrets.token_urlsafe(24); PENDING[ticket]={'client_id':cid,'redirect_uri':ruri,'state':state,'scope':requested,'resource':resource,'challenge':challenge,'expires':time.time()+300}
            return self.send_html(AUTH_PAGE.replace('{ticket}',ticket))
        if path=='/operator/health':
            return self.send_json(200,ci_operator.status())
        if path=='/health':
            s=ci_unit.collect(); return self.send_json(200,{'ok':True,'service':'ci-connector','version':'1.2.0','ci':s,'operator':ci_operator.status()})
        return self.send_json(404,{'error':'not_found'})
    def do_POST(self):
        path=urlparse(self.path).path
        if path=='/oauth/register':
            b=request_data(self); ruris=b.get('redirect_uris',[])
            if isinstance(ruris,str): ruris=[ruris]
            if not isinstance(ruris,list) or not ruris: return self.send_json(400,{'error':'invalid_redirect_uris'})
            cid='ci_'+secrets.token_hex(12); c=db(); c.execute('INSERT INTO clients(client_id,redirect_uris,created_at) VALUES(?,?,?)',(cid,json.dumps(ruris),int(time.time()))); c.commit(); c.close()
            return self.send_json(201,{'client_id':cid,'client_id_issued_at':int(time.time()),'client_secret_expires_at':0,'redirect_uris':ruris,'grant_types':['authorization_code'],'response_types':['code'],'token_endpoint_auth_method':'none'})
        if path=='/oauth/approve':
            b=request_data(self); ticket=b.get('ticket',''); pr=PENDING.pop(ticket,None)
            if not pr or pr['expires']<time.time(): return self.send_json(400,{'error':'expired_approval'})
            code=secrets.token_urlsafe(32); c=db(); c.execute('INSERT INTO codes(code_hash,client_id,redirect_uri,scope,resource,challenge,expires) VALUES(?,?,?,?,?,?,?)',(digest(code),pr['client_id'],pr['redirect_uri'],pr['scope'],pr['resource'],pr['challenge'],int(time.time())+300)); c.commit(); c.close()
            q={'code':code,'iss':BASE_URL};
            if pr['state']: q['state']=pr['state']
            return self.redirect(pr['redirect_uri']+('?' if '?' not in pr['redirect_uri'] else '&')+urlencode(q))
        if path=='/oauth/token':
            b=request_data(self); code=b.get('code',''); cid=b.get('client_id',''); verifier=b.get('code_verifier',''); ruri=b.get('redirect_uri',''); resource=b.get('resource',BASE_URL)
            c=db(); row=c.execute('SELECT * FROM codes WHERE code_hash=?',(digest(code),)).fetchone()
            if not row or row['expires']<int(time.time()) or row['client_id']!=cid or row['redirect_uri']!=ruri or row['resource']!=resource:
                c.close(); return self.send_json(400,{'error':'invalid_grant'})
            if not verifier or b64url(hashlib.sha256(verifier.encode()).digest())!=row['challenge']:
                c.close(); return self.send_json(400,{'error':'invalid_grant','error_description':'PKCE verification failed'})
            token=secrets.token_urlsafe(48); exp=int(time.time())+2592000
            c.execute('DELETE FROM codes WHERE code_hash=?',(digest(code),)); c.execute('INSERT INTO tokens(token_hash,client_id,scope,resource,expires,created_at) VALUES(?,?,?,?,?,?)',(digest(token),cid,row['scope'],resource,exp,int(time.time()))); c.commit(); c.close()
            return self.send_json(200,{'access_token':token,'token_type':'Bearer','expires_in':2592000,'scope':row['scope']})
        if path=='/mcp':
            b=request_data(self); method=b.get('method',''); mid=b.get('id')
            if method=='initialize':
                requested=(b.get('params') or {}).get('protocolVersion') or '2024-11-05'
                return self.send_json(200,{'jsonrpc':'2.0','id':mid,'result':{'protocolVersion':requested,'capabilities':{'tools':{'listChanged':False}},'serverInfo':{'name':'ci-operator','title':'Ci Operator','version':'1.8.0'},'instructions':'Use ci_resolve before external actions. Prefer ci_execute_read only when ci_executor_status shows a ready Orange-local adapter. Otherwise delegate to the named ChatGPT connector or CI.LINK. Use ci_operator_release for a complete pinned Orange release; ci_operator_update is runtime-only. Use ci_operator_metrics for PII-safe operational KPI evidence. Require live evidence for execution.'}})
            if method=='notifications/initialized':
                self.send_response(204); self.end_headers(); return
            if method=='tools/list':
                return self.send_json(200,{'jsonrpc':'2.0','id':mid,'result':{'tools':TOOLS}})
            if method=='tools/call':
                params=b.get('params') or {}; name=params.get('name',''); args=params.get('arguments') or {}
                scope=required_scope(name); info=token_info(self.headers.get('Authorization',''))
                if not has_scope(info,scope):
                    challenge=f'Bearer resource_metadata="{BASE_URL}/.well-known/oauth-protected-resource", scope="{scope}", error="insufficient_scope", error_description="Ci authorization required"'
                    return self.send_json(200,{'jsonrpc':'2.0','id':mid,'result':{'content':[{'type':'text','text':'Потрібна авторизація Ci Connector.'}],'isError':True,'_meta':{'mcp/www_authenticate':[challenge]}}})
                try:
                    res=call_tool(name,args)
                    text=json.dumps(res,ensure_ascii=False,default=str)
                    return self.send_json(200,{'jsonrpc':'2.0','id':mid,'result':{'content':[{'type':'text','text':text}],'structuredContent':res}})
                except Exception as e:
                    return self.send_json(200,{'jsonrpc':'2.0','id':mid,'result':{'content':[{'type':'text','text':'Ci tool error: '+str(e)}],'isError':True}})
            return self.send_json(200,{'jsonrpc':'2.0','id':mid,'result':{}})
        return self.send_json(404,{'error':'not_found'})

if __name__=='__main__':
    ci_unit.collect()
    print(f'Ci Connector listening on 127.0.0.1:{PORT} -> {BASE_URL}',flush=True)
    HTTPServer(('127.0.0.1',PORT),H).serve_forever()
