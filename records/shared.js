export const stateLabels = {NEW:'新发现',DRAFT:'草稿已保存',MODEL_INFLIGHT:'模型请求中',MODEL_RETRY:'模型技术重试待处理',READ_RETRY:'读取重试待处理',SKIP:'规则跳过',REVIEW:'安全待审',CONTRACT_REVIEW:'输出合同待审',UNKNOWN:'结果待核实（禁止重发）',CONFIRMED:'独立确认',ALREADY_REPLIED:'已有回复',ISOLATED:'隔离',HISTORICAL_HOLD:'历史保留',TECHNICAL_EXHAUSTED:'技术重试已耗尽',EMPTY:'正常空轮',COMPLETED:'完成',YIELDED:'预算让出',RUNNING:'运行中',BLOCKED:'保护阻塞',FAILED:'技术失败',SUCCEEDED:'成功',ACTIVE:'现存故障',RESOLVED:'已恢复',reply:'回复',skip:'跳过',review:'待审',SCHEDULED:'已计划',OVERDUE:'已过期 / 待检查',STOPPED:'调度已停止'};
export const stageLabels={discovery:'已发现',model_result:'模型结果',registered:'登记尝试',click_call:'实际提交调用',request_observed:'观察到请求',platform_accepted:'平台接受',independently_confirmed:'独立确认'};
export function el(tag, className, ...children) {
  const node=document.createElement(tag); if(className) node.className=className;
  for(const child of children.flat(Infinity)) { if(child!==undefined&&child!==null) node.append(child instanceof Node?child:document.createTextNode(String(child))); }
  return node;
}
export const text = (value, fallback='未知') => value===null||value===undefined||value==='' ? fallback : String(value);
export function formatTime(value) { if(value===null||value===undefined||!Number.isFinite(Number(value))) return '未知'; return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(Number(value)*1000)); }
export const duration = value => Number.isFinite(value) ? (value<60 ? `${value.toFixed(1)} 秒` : value<3600 ? `${(value/60).toFixed(1)} 分钟` : `${(value/3600).toFixed(1)} 小时`) : '未知';
export function renderStatus(code, label) { const good=['CONFIRMED','COMPLETED','EMPTY','SUCCEEDED','RESOLVED'];const bad=['FAILED','TECHNICAL_EXHAUSTED'];const warn=['UNKNOWN','REVIEW','CONTRACT_REVIEW','BLOCKED','OVERDUE','STOPPED','ACTIVE'];return el('span',`pill ${good.includes(code)?'good':bad.includes(code)?'bad':warn.includes(code)?'warn':'neutral'}`,label||stateLabels[code]||text(code)); }
export const code = value => el('span','mono',text(value));
export function labelledState(row) { return el('div','stack',renderStatus(row.state,row.state_label),el('div','mono muted',text(row.state))); }
export function card(title,...children){return el('section','card',title?el('h2','',title):null,...children);}
export function kv(items){const list=el('dl','kv');for(const [label,value]of items)list.append(el('dt','',label),el('dd','',value instanceof Node?value:text(value)));return list;}
export function metrics(items){return el('div','metrics',items.map(([label,value,note])=>el('div','metric',el('div','metric-value',text(value)),el('div','metric-label',label),note?el('div','metric-note',note):null)));}
export const empty=(title='暂无符合条件的记录',note='当前查询已完成，可以调整筛选条件。')=>el('div','empty',el('strong','',title),note);
export function table(headers,rows){if(!rows.length)return empty();const body=el('tbody');for(const row of rows)body.append(el('tr','',row.map(cell=>el('td','',cell))));return el('div','table-wrap',el('table','',el('thead','',el('tr','',headers.map(v=>el('th','',v)))),body));}
export function linkComment(id,label){if(!/^[0-9]{1,32}$/.test(String(id)))return code(id);const a=el('a','mono',label||id);a.href='#comments/'+id;return a;}
export function origin(row){return el('div','stack',renderStatus('',row.origin_kind==='legacy'?'历史迁移':'V2 记录'),row.origin_kind==='legacy'?null:el('span','muted',row.current_version===true?'当前业务版本':row.current_version===false?'旧业务版本':'版本归属未知'),row.business_version?code(row.business_version):null);}
export function pagination(data,onPage){const total=Number.isFinite(data.total)?data.total:0;const page=Number.isInteger(data.page)?data.page:1;const pages=Math.max(1,Math.ceil(total/(data.page_size||25)));const bar=el('div','pagination',el('span','',`筛选结果 ${total} 条 · 第 ${page} / ${pages} 页`));const add=(label,to,disabled,current=false)=>{const b=el('button',current?'current':'',label);b.type='button';b.disabled=disabled;b.addEventListener('click',()=>onPage(to));bar.append(b);};add('上一页',page-1,page<=1);for(let n=Math.max(1,page-1);n<=Math.min(pages,page+1);n++)add(n,n,n===page,n===page);add('下一页',page+1,!data.has_next);return bar;}
export function filterForm(fields,onSubmit){const form=el('form','filters');const controls={};for(const field of fields){const input=field.options?el('select'):el('input');input.name=field.key;input.setAttribute('aria-label',field.label);if(field.options){for(const [value,label]of field.options){const option=el('option','',label);option.value=value;input.append(option);}}else{input.type=field.type||'text';input.maxLength=128;if(field.placeholder)input.placeholder=field.placeholder;}input.value=field.value||'';controls[field.key]=input;form.append(el('label',field.type==='datetime-local'?'date-filter':'',field.label,input));}const actions=el('div','filters-actions');const apply=el('button','primary','查询');apply.type='submit';const clear=el('button','','重置');clear.type='button';actions.append(apply,clear);form.append(actions);const error=el('div','filter-error');const submit=()=>{error.textContent='';const values={};for(const field of fields){const v=controls[field.key].value.trim();if(!v)continue;if(field.type==='datetime-local'){const seconds=new Date(v).getTime()/1000;if(!Number.isFinite(seconds)||seconds<0){error.textContent='请填写有效时间';return;}values[field.key]=seconds;}else values[field.key]=v;}if(values.since!==undefined&&values.until!==undefined&&(values.since>=values.until||values.until-values.since>31*86400)){error.textContent='结束时间须晚于开始时间，完整区间不超过 31 天';return;}onSubmit(values);};form.addEventListener('submit',event=>{event.preventDefault();submit();});clear.addEventListener('click',()=>{for(const control of Object.values(controls))control.value='';submit();});return el('div','card',form,error);}
export const timeFields=()=>[{key:'since',label:'起始时间（设备时区）',type:'datetime-local'},{key:'until',label:'结束时间（设备时区）',type:'datetime-local'}];
export function countMap(values,labels=stateLabels){if(!values||!Object.keys(values).length)return el('span','muted','暂无记录');return el('div','compact-counts',Object.entries(values).map(([name,n])=>renderStatus('',`${labels[name]||name} · ${text(n)}`)));}
export function live(root,ctx,{path,params=()=>({}),render,paused=()=>false}) {
  const banner=el('div'),content=el('div');root.append(banner,content);
  let stopped=false,sequence=0,last=null;
  async function refresh(force=true) {
    if(stopped||ctx.signal.aborted||document.hidden||paused()&&!force)return;
    const request=++sequence;
    if(!last)content.replaceChildren(el('div','loading','正在读取公开记录快照…'));
    try {
      const result=await ctx.api.get(path,params(),ctx.signal);
      if(stopped||request!==sequence)return;
      last=result;root.classList.toggle('is-stale',result.stale);
      banner.replaceChildren(el('div','snapshot',el('span','',`来源采样 ${formatTime(result.as_of)} · 北京时间`),el('span','source',(result.source||[]).join('；'))));
      if(result.stale)banner.append(el('div','notice warning','过期或读取失败：以下保留原快照，不能视为当前状态。'));
      if(result.partial)banner.append(el('div','notice warning','部分历史或辅助依据缺失；导出记录完整不代表业务证据完整。'));
      for(const warning of result.warnings||[])banner.append(el('div','notice warning',`${warning.message}（${warning.code}）`));
      content.replaceChildren();render(result.data,content,result);
    } catch(error) {
      if(stopped||request!==sequence||error.name==='AbortError')return;
      root.classList.add('is-stale');
      banner.replaceChildren(el('div','notice danger',`${error.message}（${error.code||'SOURCE_UNAVAILABLE'}）`));
      if(!last)content.replaceChildren(empty('暂时无法读取完整记录','用右上角“刷新快照”重试。查询不会触发业务执行。'));
    }
  }
  const unregister=ctx.onRefresh(()=>refresh(false));
  const destroy=()=>{stopped=true;sequence++;unregister();};
  ctx.signal.addEventListener('abort',destroy,{once:true});refresh();
  return {refresh,destroy};
}
