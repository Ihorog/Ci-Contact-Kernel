#!/usr/bin/env python3
import argparse, hashlib, json, os, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(os.getenv('CI_LEDGER_BASE', '/home/kazkar/cit'))
DB = Path(os.getenv('CI_LEDGER_DB', str(BASE / 'db/ci_ledger.db')))
STATUS = Path(os.getenv('CI_LEDGER_STATUS', str(BASE / 'logs/ci_ledger_status.json')))
BACKUP = Path(os.getenv('CI_LEDGER_BACKUP', '/mnt/cimeika_vault/92482E5D482E3FF9/ci/backups/orangepi3-lts'))
ZERO = '0' * 64

def now():
    return datetime.now(timezone.utc).isoformat()

def canon(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    cx = sqlite3.connect(DB)
    cx.row_factory = sqlite3.Row
    cx.execute('PRAGMA foreign_keys=ON')
    cx.execute('PRAGMA journal_mode=WAL')
    cx.execute('PRAGMA synchronous=FULL')
    return cx

SCHEMA = '''
CREATE TABLE IF NOT EXISTS events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 ts_utc TEXT NOT NULL,
 scope TEXT NOT NULL,
 before_state TEXT NOT NULL,
 after_state TEXT NOT NULL,
 evidence_json TEXT NOT NULL,
 provenance_json TEXT NOT NULL,
 prev_hash TEXT NOT NULL,
 event_hash TEXT NOT NULL UNIQUE,
 ci_units INTEGER NOT NULL CHECK(ci_units=1)
);
CREATE TABLE IF NOT EXISTS postings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL REFERENCES events(event_id),
 account TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount IN(-1,1))
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER IF NOT EXISTS postings_no_update BEFORE UPDATE ON postings BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER IF NOT EXISTS postings_no_delete BEFORE DELETE ON postings BEGIN SELECT RAISE(ABORT,'append_only'); END;
'''

def init():
    cx = connect(); cx.executescript(SCHEMA); cx.commit(); cx.close()

def head_hash(cx):
    row = cx.execute('SELECT event_hash FROM events ORDER BY seq DESC LIMIT 1').fetchone()
    return row['event_hash'] if row else ZERO

def event_hash(prev, payload):
    return hashlib.sha256((prev + canon(payload)).encode()).hexdigest()

def append_fact(data):
    for key in ('event_id','scope','before_state','after_state','evidence','provenance'):
        if key not in data or data[key] in (None,'',{},[]):
            raise ValueError('missing_required:' + key)
    if data['before_state'] == data['after_state']:
        raise ValueError('no_state_change')
    cx = connect(); cx.executescript(SCHEMA)
    prev = head_hash(cx)
    payload = {
      'event_id': str(data['event_id']), 'ts_utc': str(data.get('ts_utc') or now()),
      'scope': str(data['scope']), 'before_state': canon(data['before_state']),
      'after_state': canon(data['after_state']), 'evidence_json': canon(data['evidence']),
      'provenance_json': canon(data['provenance']), 'ci_units': 1}
    digest = event_hash(prev, payload)
    with cx:
        cx.execute('INSERT INTO events(event_id,ts_utc,scope,before_state,after_state,evidence_json,provenance_json,prev_hash,event_hash,ci_units) VALUES(?,?,?,?,?,?,?,?,?,1)',
          (payload['event_id'],payload['ts_utc'],payload['scope'],payload['before_state'],payload['after_state'],payload['evidence_json'],payload['provenance_json'],prev,digest))
        cx.execute('INSERT INTO postings(event_id,account,amount) VALUES(?,?,?)',(payload['event_id'],'control:observed',-1))
        cx.execute('INSERT INTO postings(event_id,account,amount) VALUES(?,?,?)',(payload['event_id'],'verified:'+payload['scope'],1))
    cx.close(); return {'ok':True,'ci':1,'event_id':payload['event_id'],'hash':digest}

def audit(full=False):
    init(); cx = connect(); problems=[]
    check = 'PRAGMA integrity_check' if full else 'PRAGMA quick_check'
    values = [r[0] for r in cx.execute(check).fetchall()]
    if values != ['ok']:
        problems += ['sqlite:' + x for x in values]
    fk = cx.execute('PRAGMA foreign_key_check').fetchall()
    if fk: problems.append('foreign_keys:' + str(len(fk)))
    unbalanced = cx.execute('SELECT event_id,SUM(amount) s,COUNT(*) c FROM postings GROUP BY event_id HAVING s<>0 OR c<>2').fetchall()
    if unbalanced: problems.append('unbalanced:' + str(len(unbalanced)))
    prev=ZERO; count=0
    for row in cx.execute('SELECT * FROM events ORDER BY seq'):
        payload={'event_id':row['event_id'],'ts_utc':row['ts_utc'],'scope':row['scope'],
          'before_state':row['before_state'],'after_state':row['after_state'],
          'evidence_json':row['evidence_json'],'provenance_json':row['provenance_json'],'ci_units':row['ci_units']}
        expected=event_hash(prev,payload)
        if row['prev_hash'] != prev or row['event_hash'] != expected:
            problems.append('hash_chain:seq=' + str(row['seq'])); break
        prev=row['event_hash']; count += row['ci_units']
    cx.close()
    state={'ok':not problems,'checked_at':now(),'mode':'full' if full else 'quick',
      'ci_total':count,'head_hash':prev,'problems':problems}
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
    return state

def backup():
    init(); BACKUP.mkdir(parents=True, exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out=BACKUP / ('ci-ledger-' + stamp + '.db')
    src=sqlite3.connect(DB); dst=sqlite3.connect(out)
    with dst: src.backup(dst)
    src.close(); dst.close()
    digest=hashlib.sha256(out.read_bytes()).hexdigest()
    sha=out.with_suffix(out.suffix + '.sha256')
    sha.write_text(digest + '  ' + out.name + '\n', encoding='utf-8')
    return {'ok':True,'backup':str(out),'sha256':digest,'size':out.stat().st_size}

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    sub.add_parser('init'); sub.add_parser('audit'); sub.add_parser('audit-full'); sub.add_parser('backup')
    add=sub.add_parser('append'); add.add_argument('--json',required=True)
    args=ap.parse_args()
    try:
        if args.cmd=='init': init(); result={'ok':True,'db':str(DB)}
        elif args.cmd=='audit': result=audit(False)
        elif args.cmd=='audit-full': result=audit(True)
        elif args.cmd=='backup': result=backup()
        else: result=append_fact(json.loads(args.json))
        print(json.dumps(result,ensure_ascii=False,indent=2))
        if not result.get('ok',False): sys.exit(2)
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False)); sys.exit(1)

if __name__ == '__main__':
    main()
