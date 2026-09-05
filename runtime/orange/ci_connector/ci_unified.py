#!/usr/bin/env python3
import json
import ci_unit as u

SCHEMA_VERSION='1.1.0'
STATE_PRECEDENCE=['ACTUAL','PREDICTED','TARGET']
COMPONENTS=[
 {'id':'ci://component/home/activity','key':'activity','role':'tasks_events_routines_execution_progress'},
 {'id':'ci://component/home/context','key':'context','role':'signals_context_current_state_transitions'},
 {'id':'ci://component/home/care','key':'care','role':'needs_profiles_care_dependent_processes'},
 {'id':'ci://component/home/calendar','key':'calendar','role':'time_events_planning'},
 {'id':'ci://component/home/gallery','key':'gallery','role':'media_visual_memory'},
 {'id':'ci://component/home/narrative','key':'narrative','role':'explanation_history_language_projection'},
]
BINDING_RELATIONS={'runs_on','uses','accesses','stored_in','belongs_to'}
DEPENDENCY_RELATIONS=set(BINDING_RELATIONS)
CLASS_CAPABILITIES={
 'system':['structure.read','state.read'],
 'user':['identity.read'],
 'network':['network.observe'],
 'network.interface':['network.interface.observe'],
 'traffic':['traffic.observe'],
 'device':['device.observe'],
 'device.compute':['device.observe','local.execution.host'],
 'service':['service.observe'],
 'storage':['storage.observe'],
 'memory':['memory.read'],
 'issue':['issue.read'],
 'action':['action.read'],
 'verification':['verification.read'],
}

def _cid(c,source_id,class_code=None):
    if isinstance(source_id,str) and source_id.startswith('ci://'):
        return source_id
    if not isinstance(source_id,str) or ':' not in source_id:
        return source_id
    if class_code is None:
        row=c.execute('SELECT class_code FROM entities WHERE id=?',(source_id,)).fetchone()
        class_code=row['class_code'] if row else source_id.split(':',1)[0]
    _,name=source_id.split(':',1)
    safe=''.join(ch.lower() if ch.isalnum() or ch in '._-' else '-' for ch in name)
    return f'ci://{class_code}/home/{safe}'

def _source_id(c,identifier):
    if not identifier:
        return None
    if not str(identifier).startswith('ci://'):
        return str(identifier)
    for row in c.execute('SELECT id,class_code FROM entities WHERE active=1').fetchall():
        if _cid(c,row['id'],row['class_code'])==identifier:
            return row['id']
    return None

def _version(c):
    row=c.execute('SELECT COALESCE(MAX(id),0) AS n FROM events').fetchone()
    return f"event:{int(row['n'] or 0)}"

def _actual_at(c):
    row=c.execute('SELECT MAX(observed_at) AS t FROM current_facts').fetchone()
    return row['t'] if row else None

def _caps(class_code,source_id):
    caps=list(CLASS_CAPABILITIES.get(class_code,[]))
    if source_id=='service:ci_mcp_server':
        caps.extend(['mcp.serve','structure.gateway'])
    if source_id=='system:home':
        caps.extend(['refresh','verify'])
    return sorted(set(caps))

def _entity(c,row,with_facts=True):
    item={
      'id':_cid(c,row['id'],row['class_code']),
      'source_id':row['id'],'type':row['class_code'],'role':row['role'],
      'scope':'home','label':row['label'],'owner':row['owner'],'trust':row['trust'],
      'status':'active' if row['active'] else 'inactive','last_seen':row['last_seen'],
      'capabilities':_caps(row['class_code'],row['id']),
    }
    if with_facts:
        facts=c.execute('SELECT key,value_json,observed_at,source,confidence,evidence FROM current_facts WHERE entity_id=? ORDER BY key',(row['id'],)).fetchall()
        item['facts']={f['key']:{
          'value':u._decode(f['value_json']),'state':'ACTUAL','observed_at':f['observed_at'],
          'source':f['source'],'confidence':f['confidence'],'evidence':f['evidence']
        } for f in facts}
    return item

def _relation(c,row):
    return {'from':_cid(c,row['src_id']),'predicate':row['relation'],'to':_cid(c,row['dst_id']),
      'state':row['status'],'observed_at':row['observed_at'],'source':row['source'],
      'source_from':row['src_id'],'source_to':row['dst_id']}

def ci_structure(scope='home',depth=2,include_history=False):
    c=u.connect(); u.init_db(c)
    entities=[_entity(c,r,True) for r in c.execute('SELECT * FROM entities WHERE active=1 ORDER BY class_code,id').fetchall()]
    rels=[_relation(c,r) for r in c.execute("SELECT src_id,relation,dst_id,status,observed_at,source FROM relations WHERE status='active' ORDER BY src_id,relation,dst_id").fetchall()]
    bindings=[{'component_id':r['from'],'binding_type':r['predicate'],'target':r['to'],
      'enabled':r['state']=='active','verified_at':r['observed_at'],'source':r['source']}
      for r in rels if r['predicate'] in BINDING_RELATIONS]
    deps=[{'component_id':r['from'],'depends_on':r['to'],'via':r['predicate'],
      'state':r['state'],'verified_at':r['observed_at'],'source':r['source']}
      for r in rels if r['predicate'] in DEPENDENCY_RELATIONS]
    capabilities=[]
    for e in entities:
        capabilities.extend({'component_id':e['id'],'capability':cap,'mode':'READ' if cap not in ('refresh','verify') else 'ACTION'} for cap in e['capabilities'])
    capabilities.extend({'component_id':x['id'],'capability':x['key']+'.project','mode':'READ'} for x in COMPONENTS)
    sources=sorted({f['source'] for e in entities for f in e.get('facts',{}).values() if f.get('source')})
    out={'schema_version':SCHEMA_VERSION,'structure_version':_version(c),'generated_at':u.now(),
      'actual_at':_actual_at(c),'state_precedence':STATE_PRECEDENCE,'scope':scope,
      'components':[dict(x,scope='home',status='active',source='ci.contract.v1.1') for x in COMPONENTS],
      'entities':entities,'relations':rels,'bindings':bindings,'dependencies':deps,
      'capabilities':capabilities,'issues':u.summary(c).get('issues',[]),'sources':sources}
    if include_history:
        out['history']=ci_history(None,50,_connection=c)
    c.close()
    return out

def ci_get(identifier):
    if identifier in {x['id'] for x in COMPONENTS}:
        s=ci_structure()
        comp=next(x for x in COMPONENTS if x['id']==identifier)
        return {'component':dict(comp,scope='home',status='active',source='ci.contract.v1.1'),
          'relations':[r for r in s['relations'] if identifier in (r['from'],r['to'])],
          'bindings':[b for b in s['bindings'] if identifier in (b['component_id'],b['target'])],
          'dependencies':[d for d in s['dependencies'] if identifier in (d['component_id'],d['depends_on'])],
          'capabilities':[x for x in s['capabilities'] if x['component_id']==identifier]}
    c=u.connect(); u.init_db(c)
    sid=_source_id(c,identifier)
    row=c.execute('SELECT * FROM entities WHERE id=?',(sid,)).fetchone() if sid else None
    if not row:
        c.close(); return None
    item=_entity(c,row,True)
    item['relations']=[_relation(c,r) for r in c.execute("SELECT src_id,relation,dst_id,status,observed_at,source FROM relations WHERE status='active' AND (src_id=? OR dst_id=?) ORDER BY relation,dst_id",(sid,sid)).fetchall()]
    c.close(); return item

def ci_query(filters=None,limit=100):
    filters=filters if isinstance(filters,dict) else {}
    text=str(filters.get('text','')).strip().lower()
    kind=str(filters.get('type') or filters.get('class') or '').strip().lower()
    capability=str(filters.get('capability','')).strip().lower()
    limit=max(1,min(int(limit or filters.get('limit',100)),500))
    s=ci_structure(); items=s['entities']+s['components']
    if text: items=[x for x in items if text in json.dumps(x,ensure_ascii=False).lower()]
    if kind: items=[x for x in items if str(x.get('type',x.get('key',''))).lower().startswith(kind)]
    if capability:
        ids={x['component_id'] for x in s['capabilities'] if x['capability'].lower()==capability}
        items=[x for x in items if x.get('id') in ids]
    return {'filters':filters,'items':items[:limit],'count':min(len(items),limit),'total_matches':len(items),'structure_version':s['structure_version']}

def ci_state(scope='home'):
    c=u.connect(); u.init_db(c)
    out=u.summary(c)
    out.update({'scope':scope,'schema_version':SCHEMA_VERSION,'structure_version':_version(c),'actual_at':_actual_at(c),'state_precedence':STATE_PRECEDENCE})
    c.close(); return out

def ci_relations(identifier=None):
    c=u.connect(); u.init_db(c)
    sid=_source_id(c,identifier) if identifier else None
    sql="SELECT src_id,relation,dst_id,status,observed_at,source FROM relations WHERE status='active'"
    args=[]
    if sid: sql+=' AND (src_id=? OR dst_id=?)'; args=[sid,sid]
    sql+=' ORDER BY src_id,relation,dst_id'
    rows=[_relation(c,r) for r in c.execute(sql,args).fetchall()]
    c.close(); return {'relations':rows,'count':len(rows)}

def ci_bindings(identifier=None):
    rows=ci_relations(identifier)['relations']
    out=[{'component_id':r['from'],'binding_type':r['predicate'],'target':r['to'],'enabled':r['state']=='active','verified_at':r['observed_at'],'source':r['source']} for r in rows if r['predicate'] in BINDING_RELATIONS]
    return {'bindings':out,'count':len(out)}

def ci_dependencies(identifier=None):
    rows=ci_relations(identifier)['relations']
    out=[{'component_id':r['from'],'depends_on':r['to'],'via':r['predicate'],'state':r['state'],'verified_at':r['observed_at'],'source':r['source']} for r in rows if r['predicate'] in DEPENDENCY_RELATIONS]
    return {'dependencies':out,'count':len(out)}

def ci_capabilities(identifier=None):
    s=ci_structure(); rows=s['capabilities']
    if identifier: rows=[x for x in rows if x['component_id']==identifier]
    return {'capabilities':rows,'count':len(rows)}

def ci_facts(identifier=None,limit=500):
    c=u.connect(); u.init_db(c); sid=_source_id(c,identifier) if identifier else None
    sql='''SELECT f.entity_id,e.class_code,f.key,f.value_json,f.value_type,f.observed_at,f.source,f.confidence,f.evidence
      FROM current_facts f JOIN entities e ON e.id=f.entity_id WHERE e.active=1'''
    args=[]
    if sid: sql+=' AND f.entity_id=?'; args=[sid]
    sql+=' ORDER BY f.entity_id,f.key LIMIT ?'; args.append(max(1,min(int(limit),2000)))
    rows=[{'entity_id':_cid(c,r['entity_id'],r['class_code']),'source_id':r['entity_id'],'key':r['key'],
      'value':u._decode(r['value_json']),'value_type':r['value_type'],'state':'ACTUAL','observed_at':r['observed_at'],
      'source':r['source'],'confidence':r['confidence'],'evidence':r['evidence']} for r in c.execute(sql,args).fetchall()]
    c.close(); return {'facts':rows,'count':len(rows)}

def ci_history(identifier=None,limit=100,_connection=None):
    own=_connection is None; c=_connection or u.connect(); u.init_db(c)
    sid=_source_id(c,identifier) if identifier else None; args=[]; where=''
    if sid: where=' WHERE entity_id=?'; args=[sid]
    rows=[dict(r) for r in c.execute(f'SELECT id,event_type,entity_id,before_json,after_json,occurred_at,source FROM events{where} ORDER BY id DESC LIMIT ?',args+[max(1,min(int(limit),1000))]).fetchall()]
    for e in rows:
        if e.get('entity_id'): e['entity_ci_id']=_cid(c,e['entity_id'])
        for k in ('before_json','after_json'):
            if e.get(k) is not None: e[k.replace('_json','')]=u._decode(e.pop(k))
    out={'events':rows,'count':len(rows),'structure_version':_version(c)}
    if own: c.close()
    return out

def _parse_version(value,current):
    if value in (None,'','current'): return current
    text=str(value)
    if text.startswith('event:'): text=text.split(':',1)[1]
    return max(0,int(text))

def ci_diff(from_version,to_version='current',limit=500):
    c=u.connect(); u.init_db(c); current=int(_version(c).split(':',1)[1])
    start=_parse_version(from_version,current); end=_parse_version(to_version,current)
    if end<start: start,end=end,start
    rows=[dict(r) for r in c.execute('SELECT id,event_type,entity_id,before_json,after_json,occurred_at,source FROM events WHERE id>? AND id<=? ORDER BY id LIMIT ?',(start,end,max(1,min(int(limit),2000)))).fetchall()]
    for e in rows:
        if e.get('entity_id'): e['entity_ci_id']=_cid(c,e['entity_id'])
        for k in ('before_json','after_json'):
            if e.get(k) is not None: e[k.replace('_json','')]=u._decode(e.pop(k))
    c.close(); return {'from_version':f'event:{start}','to_version':f'event:{end}','events':rows,'count':len(rows)}

def ci_plan(intent,target=None,requested_by='ci_connector'):
    text=(intent or '').strip(); low=text.lower(); proposed=None
    if 'refresh' in low or 'онов' in low or 'актуал' in low: proposed='refresh'
    elif 'verify' in low or 'перев' in low: proposed='verify'
    decision='ALLOW' if proposed else 'DEFER'
    plan={'intent':text,'target':target,'proposed_action':proposed,'policy_decision':decision,
      'risk':'low' if proposed else 'unknown','requires_verification':True}
    c=u.connect(); u.init_db(c)
    cur=c.execute('INSERT INTO actions(action_type,target_id,requested_by,risk,status,created_at,result_json) VALUES(?,?,?,?,?,?,?)',
      ('plan',target,requested_by,plan['risk'],'PLANNED' if proposed else 'DEFERRED',u.now(),json.dumps(plan,ensure_ascii=False)))
    aid=cur.lastrowid; c.commit(); c.close()
    return {'plan_id':aid,**plan}

def _ensure_memory(c):
    c.execute('''CREATE TABLE IF NOT EXISTS memory_records(
      id INTEGER PRIMARY KEY AUTOINCREMENT,content_json TEXT NOT NULL,refs_json TEXT NOT NULL,
      source TEXT NOT NULL,provenance TEXT,created_at TEXT NOT NULL)'''); c.commit()

def ci_memory_append(content,refs=None,source='gpt.ci',provenance=None):
    if content is None: return {'ok':False,'status':'DENY','reason':'content_required'}
    encoded=json.dumps(content,ensure_ascii=False,sort_keys=True)
    if len(encoded)>16000: return {'ok':False,'status':'DENY','reason':'content_too_large'}
    lowered=encoded.lower()
    if 'begin private key' in lowered or 'bearer ' in lowered or 'sk-proj-' in lowered:
        return {'ok':False,'status':'DENY','reason':'sensitive_material_not_allowed'}
    refs=refs if isinstance(refs,list) else []
    c=u.connect(); u.init_db(c); _ensure_memory(c)
    t=u.now(); cur=c.execute('INSERT INTO memory_records(content_json,refs_json,source,provenance,created_at) VALUES(?,?,?,?,?)',
      (encoded,json.dumps(refs,ensure_ascii=False),source,provenance,t))
    mid=cur.lastrowid; c.commit(); c.close()
    return {'ok':True,'memory_id':mid,'refs':refs,'created_at':t}

def ci_memory_get(limit=100):
    c=u.connect(); u.init_db(c); _ensure_memory(c)
    rows=[dict(r) for r in c.execute('SELECT id,content_json,refs_json,source,provenance,created_at FROM memory_records ORDER BY id DESC LIMIT ?',(max(1,min(int(limit),500)),)).fetchall()]
    for r in rows:
        r['content']=u._decode(r.pop('content_json')); r['refs']=u._decode(r.pop('refs_json'))
    c.close(); return {'records':rows,'count':len(rows)}
