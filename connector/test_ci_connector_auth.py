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
                            self.assertIn('error_description=',response.headers['WWW-Authenticate'])
                            self.assertEqual(body['_meta']['mcp/www_authenticate'][0],response.headers['WWW-Authenticate'])
                self.assertEqual(called,['ci_verify'])
            finally:
                http.shutdown(); http.server_close(); thread.join()
    def test_streamable_http_transport_and_oauth_discovery(self):
        http=server.HTTPServer(('127.0.0.1',0),server.H)
        thread=threading.Thread(target=http.serve_forever,daemon=True)
        thread.start()
        root='http://127.0.0.1:%d'%http.server_port
        try:
            for method in ('GET','DELETE'):
                with self.subTest(method=method):
                    req=urllib.request.Request(root+'/mcp',method=method)
                    with self.assertRaises(urllib.error.HTTPError) as ctx:
                        urllib.request.urlopen(req,timeout=5)
                    self.assertEqual(ctx.exception.code,405)
                    self.assertIn('POST',ctx.exception.headers['Allow'])
            with urllib.request.urlopen(root+'/.well-known/oauth-protected-resource',timeout=5) as response:
                resource=json.load(response)
            self.assertEqual(resource['resource'],server.BASE_URL)
            self.assertIn(server.BASE_URL,resource['authorization_servers'])
            with urllib.request.urlopen(root+'/.well-known/oauth-authorization-server',timeout=5) as response:
                auth=json.load(response)
            self.assertEqual(auth['issuer'],server.BASE_URL)
            self.assertIn('S256',auth['code_challenge_methods_supported'])
            self.assertEqual(auth['registration_endpoint'],server.BASE_URL+'/oauth/register')
        finally:
            http.shutdown();http.server_close();thread.join()

    def test_owner_approval_requires_bound_strong_verification(self):
        from urllib.parse import urlencode
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener=urllib.request.build_opener(NoRedirect())
        previous=getattr(server.ci_operator,'verify_oauth_owner_approval',None)
        had_verifier=hasattr(server.ci_operator,'verify_oauth_owner_approval')
        state_dir=server.STATE; auth_db=server.AUTH_DB
        with tempfile.TemporaryDirectory() as tmp:
            server.STATE=pathlib.Path(tmp);server.AUTH_DB=server.STATE/'auth.db'
            ticket='unguessable-test-ticket'
            pending={'client_id':'ci-client','redirect_uri':'https://chatgpt.com/callback',
                'state':'state-1','scope':'ci:read','resource':server.BASE_URL,
                'challenge':'pkce-challenge','expires':time.time()+90}
            server.PENDING[ticket]=pending
            if had_verifier:
                delattr(server.ci_operator,'verify_oauth_owner_approval')
            http=server.HTTPServer(('127.0.0.1',0),server.H)
            thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
            url='http://127.0.0.1:%d/oauth/approve'%http.server_port
            def approve():
                req=urllib.request.Request(url,
                    data=urlencode({'ticket':ticket}).encode(),
                    headers={'Content-Type':'application/x-www-form-urlencoded'})
                try: return opener.open(req,timeout=5)
                except urllib.error.HTTPError as exc: return exc
            try:
                denied=approve()
                self.assertEqual(denied.status,403)
                self.assertEqual(json.load(denied)['error'],'owner_verification_required')
                self.assertIn(ticket,server.PENDING)
                self.assertEqual(server.db().execute('SELECT COUNT(*) FROM codes').fetchone()[0],0)
                def proof(binding):
                    return {**binding,'verified':True,'authority':'CI.AUTH.GATEWAY',
                        'user_verified':True,'verification_method':'webauthn',
                        'expires_at':time.time()+30,'evidence_ref':'gateway:test'}
                server.ci_operator.verify_oauth_owner_approval=lambda binding: {**proof(binding),'client_id':'different'}
                self.assertEqual(approve().status,403)
                server.ci_operator.verify_oauth_owner_approval=lambda binding: {**proof(binding),'user_verified':False}
                self.assertEqual(approve().status,403)
                server.ci_operator.verify_oauth_owner_approval=proof
                granted=approve()
                self.assertEqual(granted.status,302)
                self.assertTrue(granted.headers['Location'].startswith(pending['redirect_uri']+'?'))
                self.assertNotIn(ticket,server.PENDING)
                self.assertEqual(approve().status,400)
                connection=server.db()
                try: self.assertEqual(connection.execute('SELECT COUNT(*) FROM codes').fetchone()[0],1)
                finally:connection.close()
            finally:
                server.PENDING.pop(ticket,None)
                if had_verifier:
                    server.ci_operator.verify_oauth_owner_approval=previous
                elif hasattr(server.ci_operator,'verify_oauth_owner_approval'):
                    delattr(server.ci_operator,'verify_oauth_owner_approval')
                http.shutdown();http.server_close();thread.join()
                server.STATE=state_dir;server.AUTH_DB=auth_db

if __name__=='__main__': unittest.main()
