import importlib.util, sys, types, tempfile, pathlib, threading, urllib.request, urllib.error, json, time, unittest
for name in ('ci_unit','ci_unified','ci_operator_runtime'):
    sys.modules[name]=types.ModuleType(name)
spec=importlib.util.spec_from_file_location('server',pathlib.Path(__file__).with_name('ci_connector_server.py'))
server=importlib.util.module_from_spec(spec); spec.loader.exec_module(server)

class AuthorizationTests(unittest.TestCase):
    def test_http_authentication_and_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            server.STATE=pathlib.Path(tmp); server.AUTH_DB=server.STATE/'auth.db'
            c=server.db()
            for token, scope, resource, expires in [
                ('read','ci:read',server.BASE_URL,int(time.time())+60),
                ('expired','ci:read',server.BASE_URL,int(time.time())-1),
                ('wrong','ci:read','https://other.invalid',int(time.time())+60)]:
                c.execute('INSERT INTO tokens VALUES(?,?,?,?,?,?)',(server.digest(token),'test',scope,resource,expires,0))
            c.commit(); c.close()
            http=server.HTTPServer(('127.0.0.1',0),server.H)
            thread=threading.Thread(target=http.serve_forever,daemon=True); thread.start()
            called=[]; server.call_tool=lambda name,args: called.append(name) or {'ok':True}
            try:
                cases=[(None,'ci_verify',401,'missing_token'),('Bearer unknown','ci_verify',401,'unknown_token'),
                       ('Basic invalid','ci_verify',401,'invalid_authorization_header'),('Bearer expired','ci_verify',401,'expired_token'),
                       ('Bearer wrong','ci_verify',401,'resource_mismatch'),('Bearer read','ci_action',403,'insufficient_scope'),
                       ('Bearer read','ci_verify',200,None)]
                for header,name,status,reason in cases:
                    with self.subTest(reason=reason):
                        req=urllib.request.Request('http://127.0.0.1:%d/mcp'%http.server_port,
                            data=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':{}}}).encode(),
                            headers={'Content-Type':'application/json',**({'Authorization':header} if header else {})})
                        try: response=urllib.request.urlopen(req)
                        except urllib.error.HTTPError as exc: response=exc
                        self.assertEqual(response.status,status)
                        body=json.load(response)['result']
                        if reason:
                            self.assertEqual(body['structuredContent']['reason'],reason)
                            self.assertIn('resource_metadata=',response.headers['WWW-Authenticate'])
                            self.assertEqual(body['_meta']['mcp/www_authenticate'][0],response.headers['WWW-Authenticate'])
                self.assertEqual(called,['ci_verify'])
            finally:
                http.shutdown(); http.server_close(); thread.join()
if __name__=='__main__': unittest.main()
