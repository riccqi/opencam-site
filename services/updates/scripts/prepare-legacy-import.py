#!/usr/bin/env python3
"""Prepare an insert-only legacy import after owner consent/opt-out review. Never sends."""
import argparse, csv, hashlib, hmac, json, os, re, secrets, time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

CONSENT_VERSION = 'legacy-form-updates-owner-reviewed-2026-10-13'
def prepare(source, token_key, timezone, evidence):
    raw=Path(source).read_bytes(); digest=hashlib.sha256(raw).hexdigest()
    rows=list(csv.DictReader(raw.decode('utf-8-sig').splitlines()))
    unique={}; invalid=[]; duplicates=0
    for number,row in enumerate(rows,2):
        address=row['Email'].strip().lower(); local=address.split('@')[0]
        valid=len(address)<=254 and len(local)<=64 and not local.startswith('.') and not local.endswith('.') and '..' not in local and re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",address)
        if not valid: invalid.append(number);continue
        stamp=int(datetime.strptime(row['Timestamp'],'%m/%d/%Y %H:%M:%S').replace(tzinfo=ZoneInfo(timezone)).timestamp())
        item={'row':number,'timestamp_raw':row['Timestamp'],'timestamp_utc':stamp}
        if address in unique:duplicates+=1;unique[address]['rows'].append(item);unique[address]['signup_at']=min(unique[address]['signup_at'],stamp)
        else:unique[address]={'signup_at':stamp,'rows':[item]}
    reviewed=int(time.time()); statements=[]
    quote=lambda value: 'NULL' if value is None else str(value) if isinstance(value,int) else "'"+str(value).replace("'","''")+"'"
    for address,record in unique.items():
        ident=secrets.token_urlsafe(32)
        unsubscribe=hmac.new(bytes.fromhex(token_key),f'unsubscribe:{ident}'.encode(),hashlib.sha256).hexdigest()
        proof={**evidence,'source_sha256':digest,'timezone':timezone,'rows':record['rows'],'reviewed_at':reviewed,'import_prepared_at':reviewed,'method':'legacy_form_single_opt_in','mailbox_confirmed':False}
        values=[ident,address,'subscribed','legacy-google-form',record['signup_at'],None,CONSENT_VERSION,hashlib.sha256(unsubscribe.encode()).hexdigest(),0,json.dumps(proof,separators=(',',':'))]
        statements.append('INSERT INTO subscribers(id,email,status,source,signup_at,confirmed_at,consent_version,unsubscribe_hash,last_confirmation_at,consent_evidence) VALUES('+','.join(map(quote,values))+') ON CONFLICT(email) DO NOTHING;')
    statements.append("INSERT OR IGNORE INTO admin_audit(id,action,target_id,created_at) VALUES("+','.join(map(quote,['legacy-import-'+digest,'legacy-import',digest,reviewed]))+");")
    return '\n'.join(statements)+'\n',{'source_sha256':digest,'source_rows':len(rows),'unique_valid':len(unique),'duplicate_rows':duplicates,'invalid_rows':len(invalid),'invalid_row_numbers':invalid,'confirmed_timestamps_created':0,'emails_queued':0,'conflict_policy':'Preserve every existing subscriber unchanged, including opt-outs and suppressions.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('csv');p.add_argument('--secrets-file',required=True);p.add_argument('--evidence-file',required=True);p.add_argument('--timezone',required=True);p.add_argument('--output',required=True);p.add_argument('--report',required=True);a=p.parse_args()
    evidence=json.loads(Path(a.evidence_file).read_text())
    if evidence.get('owner_confirmed_original_wording') is not True or evidence.get('known_opt_outs') is not False:raise SystemExit('This reviewed import requires confirmed original wording and no known opt-outs; otherwise reconcile an exclusion list first.')
    key=json.loads(Path(a.secrets_file).read_text())['TOKEN_KEY']
    if not re.fullmatch('[a-fA-F0-9]{64}',key):raise SystemExit('Invalid token key')
    sql,report=prepare(a.csv,key,a.timezone,evidence)
    for name,data in [(a.output,sql),(a.report,json.dumps(report,indent=2))]:
        if not name.endswith(('.private.sql','.private.json')):raise SystemExit('Use a private output suffix')
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:f.write(data)
    print(json.dumps(report,indent=2))
if __name__=='__main__': main()
