#!/usr/bin/env python3
"""Local, read-only CSV audit. Never uploads, sends, or fabricates confirmation."""
import argparse, csv, json, re, hashlib, os
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('csv');p.add_argument('--email-column',required=True)
p.add_argument('--timestamp-column');p.add_argument('--consent-column');p.add_argument('--unsubscribe-column')
p.add_argument('--report',required=True);p.add_argument('--quarantine',required=True)
a=p.parse_args()
source=Path(a.csv);raw=source.read_bytes()
rows=list(csv.DictReader(raw.decode('utf-8-sig').splitlines()))
if rows and a.email_column not in rows[0]:raise SystemExit('Email column not found')
seen={};invalid=[];duplicates=0
for i,r in enumerate(rows,2):
 e=r.get(a.email_column,'').strip().lower();local=e.split('@')[0]
 valid=len(e)<=254 and len(local)<=64 and not local.startswith('.') and not local.endswith('.') and '..' not in local and re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",e)
 if not valid:invalid.append(i);continue
 unsub=(r.get(a.unsubscribe_column,'').strip().lower() not in ('','false','no','0')) if a.unsubscribe_column else False
 evidence={'row':i,'timestamp_raw':r.get(a.timestamp_column) if a.timestamp_column else None,'consent_raw':r.get(a.consent_column) if a.consent_column else None}
 if e in seen:duplicates+=1;seen[e]['evidence'].append(evidence);seen[e]['previous_unsubscribe'] |= unsub
 else:seen[e]={'email':e,'evidence':[evidence],'previous_unsubscribe':unsub,'status':'quarantine','confirmed_at':None}
report={'source_sha256':hashlib.sha256(raw).hexdigest(),'total_rows':len(rows),'valid_rows':len(rows)-len(invalid),'valid_unique':len(seen),'duplicate_rows':duplicates,'invalid_rows':len(invalid),'uncertain_unique':len(seen),'known_unsubscribed_unique':sum(r['previous_unsubscribe'] for r in seen.values()),'eligible_to_send':0,'imported':0,'confirmation_timestamps_fabricated':0,'notes':['All rows require separate review of original wording, timestamp timezone, confirmation evidence, and historical unsubscribe records.','No network calls or email sends. Raw timestamps are preserved; none are inferred.']}
for path,data in [(a.report,report),(a.quarantine,{'invalid_row_numbers':invalid,'records':list(seen.values())})]:
 dest=Path(path);dest.parent.mkdir(parents=True,exist_ok=True)
 fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as out:json.dump(data,out,indent=2)
print(json.dumps(report,indent=2))
