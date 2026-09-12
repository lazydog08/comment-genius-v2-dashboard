/* Fixed public artifact reader. /api names below are in-memory operations only. */
const FILE = new URL('../records.json', import.meta.url);
const MAX_BYTES = 16 * 1024 * 1024;
const SECTIONS = ['overview','comments','attempts','model_requests','history','runs','faults','events','notifications','statistics','config'];
const LISTS = ['comments','attempts','model_requests','history','runs','faults','events'];
const TOP = ['schema','source','generation','as_of','started_at','finished_at','available','stale','partial','complete','business_version','dashboard_version','consistency','sampled_at','totals','exported','section_meta','overview','comments','attempts','model_requests','history','runs','faults','events','notifications','notifications_meta','statistics','config','warnings','error'];
const MESSAGES = {
  MALFORMED_RECORD:'部分已保存字段异常，按原记录展示未知', OPTIONAL_DATA_MISSING:'部分历史可选字段未保存',
  ASSOCIATION_MISSING:'存在未关联到保存评论的账本记录，可在提交尝试或模型请求中查看', METADATA_INCOMPLETE:'部分状态依据缺失',
  SCHEDULE_EVIDENCE_INCOMPLETE:'连续运行证据尚不完整', AUXILIARY_UNAVAILABLE:'部分辅助来源未取得',
  HEALTH_SOURCE_STALE:'健康来源已过期', NOTIFICATION_SOURCE_STALE:'通知来源已过期', NOTIFICATION_SAMPLE_PARTIAL:'通知来源记录不完整',
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 253402300799;
let current = null, indexes = null, inflight = null, controller = null, failure = null;
let lastCheck = 0, etag = null, modified = null;
const subscribers = new Set();
export class ApiError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
function invalid(){throw new ApiError('PUBLIC_RECORDS_INVALID','完整记录快照格式不正确');}
function aborted(signal){if(signal?.aborted)throw new DOMException('Aborted','AbortError');}
function validate(d){
  if(!object(d)||Object.keys(d).length!==TOP.length||TOP.some(k=>!Object.hasOwn(d,k)))invalid();
  if(d.schema!==1||d.source!=='V2_READ_ONLY_VISIBLE_RECORDS'||!/^([a-f0-9]{32})$/.test(d.generation)||!timestamp(d.as_of)||d.as_of===null)invalid();
  if(d.available!==true||d.complete!==true||d.error!==null||typeof d.stale!=='boolean'||typeof d.partial!=='boolean')invalid();
  if(!object(d.consistency)||d.consistency.mode!=='UNCHANGED_DATABASE_GENERATION'||!object(d.sampled_at)||!object(d.section_meta)||!object(d.totals)||!object(d.exported))invalid();
  for(const name of SECTIONS){const meta=d.section_meta[name];if(!object(meta)||!timestamp(meta.as_of)||!Array.isArray(meta.source)||meta.source.some(s=>!['business.sqlite3','auxiliary'].includes(s))||['stale','partial','complete'].some(k=>typeof meta[k]!=='boolean')||!Array.isArray(meta.warnings))invalid();}
  for(const warning of [...(Array.isArray(d.warnings)?d.warnings:[null]),...SECTIONS.flatMap(k=>d.section_meta[k].warnings)])if(!object(warning)||!Object.hasOwn(MESSAGES,warning.code)||!['all',...SECTIONS].includes(warning.section))invalid();
  let businessRows=0;
  const idKeys={comments:'comment_id',attempts:'id',model_requests:'id',history:'attempt_id',runs:'run_id',faults:'key',events:'id'};
  for(const name of LISTS){const list=d[name];if(!Array.isArray(list)||!Number.isSafeInteger(d.totals[name])||d.totals[name]!==list.length||d.exported[name]!==list.length)invalid();if(name!=='history')businessRows+=list.length;const seen=new Set();for(const row of list){if(!object(row)||typeof row[idKeys[name]]!=='string'||!row[idKeys[name]]||seen.has(row[idKeys[name]]))invalid();seen.add(row[idKeys[name]]);}}
  if(businessRows>100000)invalid();
  if(d.notifications!==null&&(!Array.isArray(d.notifications)||d.notifications.length>10000||d.totals.notifications!==d.notifications.length||d.exported.notifications!==d.notifications.length))invalid();
  if(!object(d.overview)||!object(d.config)||!object(d.statistics)||['1','24','168'].some(k=>!object(d.statistics[k])))invalid();
  for(const c of d.comments){if(!/^[0-9]{1,32}$/.test(c.comment_id)||!timestamp(c.ctime)||![null,'string'].includes(c.text===null?null:typeof c.text)||c.draft!==null&&typeof c.draft!=='string'||c.decision!==null&&!object(c.decision))invalid();}
  for(const name of ['attempts','model_requests'])for(const row of d[name])if(typeof row.comment_id!=='string'||!['LINKED','COMMENT_MISSING'].includes(row.association_status))invalid();
  for(const e of d.events)if(!/^[0-9]+$/.test(e.id)||!object(e.details))invalid();
  return d;
}
function binary(a,b){return a===b?0:a<b?-1:1;}
function sortRows(rows,timeKey,idKey,numericId=false){
  return [...rows].sort((a,b)=>{
    const ta=Number.isFinite(a[timeKey])?a[timeKey]:-Infinity,tb=Number.isFinite(b[timeKey])?b[timeKey]:-Infinity;
    if(ta!==tb)return tb>ta?1:-1;
    if(numericId){const x=BigInt(a[idKey]),y=BigInt(b[idKey]);return x===y?0:x<y?1:-1;}
    return -binary(a[idKey],b[idKey]);
  });
}
function buildIndexes(d){
  const rows={comments:sortRows(d.comments,'ctime','comment_id'),attempts:sortRows(d.attempts,'registered_at','id'),model_requests:sortRows(d.model_requests,'started_at','id'),history:sortRows(d.history,'confirmed_at','attempt_id'),runs:sortRows(d.runs,'started_at','run_id'),faults:sortRows(d.faults,'opened_at','key'),events:sortRows(d.events,'at','id',true)};
  const comments=new Map(rows.comments.map(r=>[r.comment_id,r]));
  const group=items=>{const map=new Map();for(const row of items){if(!map.has(row.comment_id))map.set(row.comment_id,[]);map.get(row.comment_id).push(row);}return map;};
  return {rows,comments,attempts:group(rows.attempts),requests:group(rows.model_requests)};
}
function notify(){for(const listener of [...subscribers])listener();}
export function subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);}
export function status(){
  const age=current?Date.now()/1000-current.as_of:null;
  return {document:current,loading:!!inflight,failure,checked_at:lastCheck,stale:!!failure||!!current&&(current.stale||age>900||age< -60),age};
}
export function cancelLoad(){controller?.abort();}
export function load({force=false}={}){
  if(inflight)return inflight;
  if(current&&!force&&Date.now()-lastCheck<60000)return Promise.resolve(current);
  controller=new AbortController();let timeout=false;
  inflight=(async()=>{
    const timer=setTimeout(()=>{timeout=true;controller.abort();},20000);
    try{
      const headers={Accept:'application/json'};
      if(etag)headers['If-None-Match']=etag;else if(modified)headers['If-Modified-Since']=modified;
      const response=await fetch(FILE,{cache:'no-cache',credentials:'omit',headers,signal:controller.signal});
      if(response.status===304&&current){failure=null;lastCheck=Date.now();return current;}
      if(!response.ok)throw new ApiError('SOURCE_UNAVAILABLE','暂时无法读取公开完整记录');
      const declared=Number(response.headers.get('Content-Length'));
      if(Number.isFinite(declared)&&declared>MAX_BYTES)throw new ApiError('EXPORT_LIMIT','完整快照超过 16 MiB 安全读取上限');
      if(!response.body)throw new ApiError('SOURCE_UNAVAILABLE','完整快照响应内容不可用');
      const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
      const chunks=[];let bytes=0;
      try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw new ApiError('EXPORT_LIMIT','完整快照超过 16 MiB 安全读取上限');}chunks.push(decoder.decode(part.value,{stream:true}));}chunks.push(decoder.decode());}
      finally{reader.releaseLock();}
      let candidate;try{candidate=validate(JSON.parse(chunks.join('')));}catch(error){if(error instanceof ApiError)throw error;invalid();}
      chunks.length=0;
      const candidateIndexes=buildIndexes(candidate);
      current=candidate;indexes=candidateIndexes;failure=null;lastCheck=Date.now();
      etag=response.headers.get('ETag');modified=response.headers.get('Last-Modified');return current;
    }catch(error){
      if(error.name==='AbortError'&&!timeout)throw error;
      failure=error instanceof ApiError?error:new ApiError(timeout?'QUERY_TIMEOUT':'SOURCE_UNAVAILABLE',timeout?'完整快照读取超时':'无法读取公开快照，请稍后刷新');
      lastCheck=Date.now();throw failure;
    }finally{clearTimeout(timer);inflight=null;controller=null;notify();}
  })();
  notify();return inflight;
}
function query(params,allowed){
  const out={};for(const [key,value]of Object.entries(params)){if(!allowed.includes(key))throw new ApiError('INVALID_QUERY','不支持此筛选条件');if(value===undefined||value===null||value==='')continue;if(String(value).length>128)throw new ApiError('INVALID_QUERY','筛选内容过长');out[key]=value;}
  for(const k of ['page','page_size'])if(out[k]!==undefined){if(!/^[0-9]+$/.test(String(out[k])))throw new ApiError('INVALID_QUERY','页码不正确');out[k]=Number(out[k]);if(!Number.isSafeInteger(out[k])||out[k]<1||out[k]>(k==='page'?10000:100))throw new ApiError('INVALID_QUERY','页码不正确');}
  for(const k of ['since','until'])if(out[k]!==undefined){out[k]=Number(out[k]);if(!Number.isFinite(out[k])||out[k]<0)throw new ApiError('INVALID_QUERY','时间范围不正确');}
  if(out.since!==undefined&&out.until!==undefined&&!(out.until>out.since&&out.until-out.since<=31*86400))throw new ApiError('INVALID_QUERY','时间范围不正确');
  for(const k of ['comment_id'])if(out[k]!==undefined&&!/^[0-9]{1,32}$/.test(out[k]))throw new ApiError('INVALID_QUERY','评论 ID 格式不正确');
  return out;
}
function range(row,p,key){return (p.since===undefined||Number.isFinite(row[key])&&row[key]>=p.since)&&(p.until===undefined||Number.isFinite(row[key])&&row[key]<p.until);}
function equal(row,p,keys){return keys.every(k=>p[k]===undefined||row[k]===p[k]);}
function page(rows,p){const size=p.page_size||25,requested=p.page||1,total=rows.length,last=Math.max(1,Math.ceil(total/size)),selected=Math.min(requested,last);return {items:rows.slice((selected-1)*size,selected*size),page:selected,page_size:size,total,has_next:selected<last,page_adjusted:selected!==requested};}
function envelope(section,data,extra=[]){
  const meta=current.section_meta[section],s=status();
  const warningRows=[...meta.warnings,...extra];
  return {ok:true,data,as_of:meta.as_of,source:meta.source.map(v=>`公开记录快照：${v}`),stale:s.stale||meta.stale,partial:current.partial||meta.partial,warnings:warningRows.map(w=>({code:w.code,message:MESSAGES[w.code]||w.message||'快照存在未完整记录的依据'})),error:null};
}
function detail(id){
  const comment=indexes.comments.get(id);if(!comment)throw new ApiError('NOT_FOUND','这份快照没有保存该评论');
  const attempts=indexes.attempts.get(id)||[],requests=indexes.requests.get(id)||[],timeline=[];
  const add=(stage,at,status)=>{if(Number.isFinite(at))timeline.push({stage,at,status});};
  add('discovery',comment.first_seen,'RECORDED');for(const r of [...requests].reverse())add('model_result',r.finished_at,r.state);
  for(const a of [...attempts].reverse())for(const [field,stage]of [['registered_at','registered'],['click_at','click_call'],['request_at','request_observed'],['accepted_at','platform_accepted'],['confirmed_at','independently_confirmed']])if(field!=='confirmed_at'||a.state==='CONFIRMED')add(stage,a[field],'RECORDED');
  timeline.sort((a,b)=>a.at-b.at);
  return {...comment,attempts,model_requests:requests,timeline,send_block:current.overview.capabilities?.publish||null};
}
export async function get(path,params={},signal){
  aborted(signal);if(!current){if(failure)throw failure;try{await load();}catch(error){aborted(signal);throw error;}}aborted(signal);
  if(!current)throw failure||new ApiError('SOURCE_UNAVAILABLE','尚未取得完整快照');
  if(!/^\/api\/(overview|comments(?:\/[0-9]{1,32})?|attempts|model-requests|history|runs|faults|events|statistics|config)$/.test(path))throw new ApiError('INVALID_ROUTE','无法打开此记录视图');
  if(path.startsWith('/api/comments/'))return envelope('comments',detail(path.slice('/api/comments/'.length)));
  const name=path.slice(5).replace('model-requests','model_requests');
  if(['overview','config'].includes(name)){query(params,[]);return envelope(name,current[name]);}
  if(name==='statistics'){const p=query(params,['hours']),hours=String(p.hours||24);if(!['1','24','168'].includes(hours))throw new ApiError('INVALID_QUERY','不支持此统计时间窗');return envelope(name,current.statistics[hours]);}
  const common=['page','page_size','since','until'];
  const extras={comments:['state','decision','video','comment_id'],attempts:['state','video','comment_id','id','association_status'],model_requests:['state','comment_id','id','association_status'],history:['origin','video'],runs:['trigger','state'],faults:['status','scope'],events:['level','kind']};
  const p=query(params,[...common,...extras[name]]);let rows=indexes.rows[name];
  if(name==='comments')rows=rows.filter(r=>equal(r,p,['state','video','comment_id'])&&(p.decision===undefined||r.decision?.decision===p.decision)&&range(r,p,'ctime'));
  if(name==='attempts')rows=rows.filter(r=>equal(r,p,['state','video','comment_id','id','association_status'])&&range(r,p,'registered_at'));
  if(name==='model_requests')rows=rows.filter(r=>equal(r,p,['state','comment_id','id','association_status'])&&range(r,p,'started_at'));
  if(name==='history')rows=rows.filter(r=>equal(r,p,['video'])&&range(r,p,'confirmed_at')&&(!p.origin||p.origin==='all'||p.origin==='current'&&r.current_version===true||r.origin_kind===p.origin));
  if(name==='runs')rows=rows.filter(r=>equal(r,p,['trigger','state'])&&range(r,p,'started_at'));
  if(name==='faults')rows=rows.filter(r=>equal(r,p,['scope'])&&((p.status||'active')==='all'||r.status===(p.status||'active')));
  if(name==='events')rows=rows.filter(r=>equal(r,p,['level','kind'])&&range(r,p,'at'));
  const data=page(rows,p);if(data.page_adjusted)params.page=data.page;
  if(name==='faults'){data.notifications=current.notifications;data.notifications_meta=current.notifications_meta;}
  return envelope(name,data,data.page_adjusted?[{code:'PAGE_ADJUSTED',message:'记录数量变化，已显示现有末页'}]:[]);
}
