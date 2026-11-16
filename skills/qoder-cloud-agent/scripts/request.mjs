#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { QoderClient } from './qoder-client.mjs';
export const BASE = 'https://api.qoder.com.cn/api/v1/cloud';
const roots = new Set(['models','agents','environments','sessions','memory_stores','dreams']);
export function prepareRequest({ method = 'GET', path, body }) {
  method = method.toUpperCase();
  if (!['GET','POST','DELETE'].includes(method)) throw new Error('Unsupported method; check current API');
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#\r\n]/.test(path)) throw new Error('Use a relative Managed API path');
  const raw = path.split('?')[0];
  if (raw.includes('%') || raw.split('/').some(p => p === '.' || p === '..') || !/^\/[a-zA-Z0-9_/-]+$/.test(raw)) throw new Error('Invalid resource path');
  if (!roots.has(raw.split('/')[1])) throw new Error('Unsupported Managed resource family');
  if (method === 'GET' && body !== undefined) throw new Error('GET does not accept a body');
  if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body))) throw new Error('JSON body must be an object');
  return { method, url:new URL(BASE + path).href, ...(body !== undefined ? {body} : {}) };
}
export async function performRequest(plan, { token, fetchImpl = fetch, signal = AbortSignal.timeout(30_000) }) {
  if (!token) throw new Error('Set QODER_ACCESS_TOKEN in server environment, not CLI arguments');
  if (!plan.url.startsWith(BASE + '/')) throw new Error('Invalid API destination');
  const p=prepareRequest({method:plan.method,path:plan.url.slice(BASE.length),body:plan.body});
  let response;
  try {
    response=await fetchImpl(p.url,{method:p.method,redirect:'error',signal,
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(p.body?{'Content-Type':'application/json'}:{})},
      ...(p.body?{body:JSON.stringify(p.body)}:{})});
  } catch {const e=new Error(p.method==='GET'?'Connection failed':'Write unconfirmed: reconcile before retry');e.uncertain=p.method!=='GET';throw e;}
  const requestId=response.headers.get('x-request-id');
  if(!response.ok) {
    await response.body?.cancel().catch(()=>{});
    const e=new Error(`Qoder HTTP ${response.status}`);e.status=response.status;e.requestId=requestId;
    e.uncertain=p.method!=='GET'&&![400,401,403,404,409].includes(response.status);throw e;
  }
  if(response.status===204)return {status:204,request_id:requestId};
  try{return await response.json();}catch{const e=new Error('Invalid response; reconcile writes before retry');e.uncertain=p.method!=='GET';throw e;}
}
export async function main(argv,deps={}) {
  const output=deps.output??(v=>process.stdout.write(JSON.stringify(v,null,2)+'\n'));
  if(!argv.length||argv.includes('--help')) {output({usage:[
    'request --method GET --path /agents?limit=20 [--execute]',
    'request --method POST --path /sessions --body assets/session.json [--execute]',
    'stream --session sess_ID [--last-event-id evt_ID] [--timeout-ms 60000] [--max-events 100] [--execute]'
  ],default:'Local plan only; --execute enables network',credential:'Server QODER_ACCESS_TOKEN (PAT or SAT)',retry:'No auto retry/pagination/tool execution'});return;}
  const [command,...rest]=argv, options={};
  for(let i=0;i<rest.length;i++) {
    const key=rest[i];if(key==='--execute'){options.execute=true;continue;}
    if(!['--method','--path','--body','--session','--last-event-id','--timeout-ms','--max-events'].includes(key)||!rest[i+1]||rest[i+1].startsWith('--'))throw new Error('Unknown option or missing value');
    options[key.slice(2)]=rest[++i];
  }
  if(command==='request') {
    const body=options.body?JSON.parse(await readFile(options.body,'utf8')):undefined;
    const plan=prepareRequest({method:options.method,path:options.path,body});
    if(!options.execute){output({mode:'preview',...plan});return;}
    output(await performRequest(plan,{token:(deps.env??process.env).QODER_ACCESS_TOKEN,fetchImpl:deps.fetchImpl}));return;
  }
  if(command==='stream') {
    if(!/^sess_[a-zA-Z0-9_-]+$/.test(options.session??''))throw new Error('Session ID required');
    if(options['last-event-id']&&!/^evt_[a-zA-Z0-9_-]+$/.test(options['last-event-id']))throw new Error('Invalid cursor');
    const timeout=Number(options['timeout-ms']??60000),max=Number(options['max-events']??100);
    if(!Number.isInteger(timeout)||timeout<1||timeout>3600000||!Number.isInteger(max)||max<1||max>10000)throw new Error('Invalid stream bounds');
    if(!options.execute){output({mode:'preview',url:`${BASE}/sessions/${options.session}/events/stream`,last_event_id:options['last-event-id'],timeout_ms:timeout,max_events:max});return;}
    const client=new QoderClient({accessToken:(deps.env??process.env).QODER_ACCESS_TOKEN,...(deps.fetchImpl?{fetchImpl:deps.fetchImpl}:{})});
    const stream=await client.connectEvents(options.session,{lastEventId:options['last-event-id'],signal:AbortSignal.timeout(timeout)});
    try{let n=0;for await(const frame of stream.events){output(frame);if(++n>=max)break;}}finally{stream.close();}return;
  }
  throw new Error('Use request or stream; see --help');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(e=>{
  process.stderr.write(JSON.stringify({error:e.message,status:e.status,request_id:e.requestId,uncertain:e.uncertain??false})+'\n');process.exitCode=1;
});
