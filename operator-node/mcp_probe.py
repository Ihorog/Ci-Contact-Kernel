#!/usr/bin/env python3
import json
from urllib.request import Request, urlopen

BASE = 'https://mcp-http.cimeika.com.ua'
HEADERS = {
    'accept': 'application/json, text/event-stream',
    'user-agent': 'Mozilla/5.0 CiOperatorMCPProbe/1.0',
}


def get(path):
    req = Request(BASE + path, headers=HEADERS)
    with urlopen(req, timeout=12) as r:
        return r.status, json.loads(r.read().decode())


def post(path, body):
    raw = json.dumps(body).encode()
    headers = dict(HEADERS)
    headers['content-type'] = 'application/json'
    req = Request(BASE + path, data=raw, method='POST', headers=headers)
    with urlopen(req, timeout=12) as r:
        payload = r.read()
        return r.status, json.loads(payload.decode()) if payload else None


health_status, health = get('/operator/health')
oauth_status, oauth = get('/.well-known/oauth-protected-resource')
init_status, init = post('/mcp', {
    'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
    'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'ci-operator-probe', 'version': '1.0'}}
})
tools_status, tools = post('/mcp', {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
names = sorted(t.get('name') for t in tools.get('result', {}).get('tools', []))
required = {'ci_operator_status', 'ci_resolve', 'ci_dispatch'}

result = {
    'base': BASE,
    'health': {'http': health_status, 'node': health.get('node'), 'version': health.get('version'), 'connections': health.get('registry', {}).get('connections')},
    'oauth': {'http': oauth_status, 'resource': oauth.get('resource'), 'scopes': oauth.get('scopes_supported')},
    'initialize': {'http': init_status, 'serverInfo': init.get('result', {}).get('serverInfo'), 'instructions': init.get('result', {}).get('instructions')},
    'tools': {'http': tools_status, 'count': len(names), 'operatorTools': sorted(required.intersection(names))},
}
print(json.dumps(result, ensure_ascii=False, indent=2))
ok = (
    health_status == 200 and health.get('node') == 'CI.OPERATOR.ORANGE'
    and health.get('registry', {}).get('connections') == 28
    and oauth_status == 200 and oauth.get('resource') == BASE
    and init_status == 200 and init.get('result', {}).get('serverInfo', {}).get('name') == 'ci-operator'
    and tools_status == 200 and required.issubset(names)
)
print('CI_OPERATOR_MCP_PROBE=' + ('PASS' if ok else 'FAIL'))
raise SystemExit(0 if ok else 1)
