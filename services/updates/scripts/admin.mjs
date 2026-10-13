#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [command,...args]=process.argv.slice(2);
const base=process.env.UPDATES_API||'https://updates-api.opencam.app';
if(new URL(base).protocol!=='https:' && !['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('HTTPS required');
const bearer=process.env.ADMIN_TOKEN;
if(!bearer||bearer.length<32)throw new Error('Set ADMIN_TOKEN in the environment');
async function api(path,data) {
 const r=await fetch(`${base}/admin/${path}`,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)}),redirect:'error'});
 if(!r.ok)throw new Error(`${r.status}: ${(await r.json()).error}`);
 return r;
}
let result;
switch(command) {
 case 'counts':result=await (await api('counts')).json();break;
 case 'search':result=await (await api('search',{query:args[0]||''})).json();break;
 case 'unsubscribe':case 'suppress':case 'delete':result=await (await api('subscriber',{email:args[0],action:command})).json();break;
 case 'create':result=await (await api('campaigns',JSON.parse(await readFile(args[0],'utf8')))).json();break;
 case 'preview': {
  const data=await (await api(`campaigns/${args[0]}/preview`)).json();
  if(args[1]) {await writeFile(resolve(args[1]),data.html,{mode:0o600,flag:'wx'});result={written:resolve(args[1]),subject:data.subject,text:data.text};}else result=data;
  break;
 }
 case 'test':result=await (await api(`campaigns/${args[0]}/test`,{email:args[1],request_id:args[2]})).json();break;
 case 'launch':
  if(args[1]!=='--public-version'||!args[2])throw new Error('launch CAMPAIGN_ID --public-version VERSION');
  result=await (await api(`campaigns/${args[0]}/launch`,{confirm_version:args[2]})).json();break;
 case 'status':result=await (await api(`campaigns/${args[0]}/status`)).json();break;
 case 'resolve':result=await (await api('resolve',{id:args[0],status:args[1]})).json();break;
 case 'export': {
  if(!args[0]?.endsWith('.private.csv'))throw new Error('Export destination must end in .private.csv (gitignored)');
  let after='',chunks=[];
  do {const r=await api(`export?after=${encodeURIComponent(after)}`),text=await r.text();chunks.push(chunks.length?text.slice(text.indexOf('\r\n')+2):text);after=r.headers.get('x-next-cursor')||'';}while(after);
  await writeFile(resolve(args[0]),chunks.join('\r\n'),{mode:0o600,flag:'wx'});result={written:resolve(args[0])};break;
 }
 default:throw new Error('Commands: counts | search EMAIL | unsubscribe EMAIL | suppress EMAIL | delete EMAIL | export FILE.private.csv | create campaign.json | preview ID [FILE.html] | test ID EMAIL REQUEST_ID | launch ID --public-version VERSION | status ID | resolve DELIVERY_ID sent|skipped');
}
console.log(JSON.stringify(result,null,2));
