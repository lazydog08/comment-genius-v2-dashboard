import * as api from './api.js';
import {el,formatTime,renderStatus} from './shared.js';
import * as overview from './pages/overview.js';
import * as comments from './pages/comments.js';
import * as history from './pages/history.js';
import * as runs from './pages/runs.js';
import * as faults from './pages/faults.js';
import * as statistics from './pages/statistics.js';
import * as config from './pages/config.js';
const pages={overview:{label:'概览',icon:'◈',description:'公开快照中的业务状态与进展。',module:overview},comments:{label:'评论工作台',icon:'☷',description:'原评论、保存回复与完整提交 / 模型账本。',module:comments},history:{label:'确认历史',icon:'✓',description:'仅独立确认记录；迁移草稿不冒充实际回复。',module:history},runs:{label:'运行记录',icon:'◷',description:'自然调度、手动触发、覆盖与阶段计数。',module:runs},faults:{label:'故障与日志',icon:'≋',description:'已保存故障、可见事件与保留通知记录。',module:faults},statistics:{label:'统计',icon:'▥',description:'快照中预计算的 1 / 24 / 168 小时统计。',module:statistics},config:{label:'只读配置',icon:'⚙',description:'公开白名单配置和已有核验状态。',module:config}};
const root=document.querySelector('#page-root'),title=document.querySelector('#page-title'),description=document.querySelector('#page-description'),button=document.querySelector('#refresh-button'),refreshStatus=document.querySelector('#refresh-status'),dataset=document.querySelector('#dataset-status');
const callbacks=new Set();let cleanup=()=>{},pageController=null,timer=null,lastFreshness='';
for(const [name,page]of Object.entries(pages)){const a=el('a','',el('span','nav-icon',page.icon),el('span','',page.label));a.href='#'+name;a.dataset.page=name;document.querySelector('#navigation').append(a);}
function paintDataset(){
  const state=api.status(),d=state.document;
  root.classList.toggle('is-stale',state.stale);button.disabled=state.loading;
  refreshStatus.textContent=document.hidden?'页面隐藏，已暂停更新':state.loading?'正在检查完整快照…':'可见时每 60 秒检查更新';
  dataset.replaceChildren();
  if(!d){dataset.append(el('div',state.failure?'notice danger':'notice',state.failure?`${state.failure.message}。没有可显示的记录快照，请稍后刷新。`:'正在读取完整记录快照…'));return;}
  const message=state.failure?'读取失败：下方保留上次完整快照，已失效，不能视为当前状态。':state.stale?'快照或辅助来源已过期：下方是旧采样，不代表当前状态。':d.partial?'保留的业务记录已全部导出；部分历史或辅助依据缺失。':'保留的业务记录已全部导出。导出完整不等于业务健康或历史证据完整。';
  const countLabels={comments:'评论',attempts:'提交尝试',model_requests:'模型请求',history:'确认历史',runs:'运行',faults:'故障',events:'事件',notifications:'通知'};
  dataset.append(el('section','card dataset-status-card',el('div',state.failure?'notice danger':state.stale||d.partial?'notice warning':'notice',message),el('div','dataset-meta',`业务采样 ${formatTime(d.as_of)} · 北京时间`,el('br'),`来源：公开完整记录快照 · 代号 ${d.generation}`),el('div','dataset-counts',Object.entries(countLabels).map(([key,label])=>el('span','',`${label} ${d.exported[key]===null?'未知':d.exported[key]} / ${d.totals[key]===null?'未知':d.totals[key]}`))),el('p','muted','以上为已导出 / 来源保留条数。原文按已保存内容展示；未保存字段保持未知。')));
}
function refreshMounted(){for(const fn of [...callbacks])fn();}
function route(){
  pageController?.abort();cleanup();callbacks.clear();pageController=new AbortController();
  const hash=location.hash.slice(1)||'overview',split=hash.split('?'),parts=split[0].split('/');let name=parts[0],id=parts[1];
  if(name==='main')name='overview';
  if(!pages[name]||parts.length>2||id&&!(name==='comments'&&/^[0-9]{1,32}$/.test(id))){name='overview';id=null;window.history.replaceState(null,'','#overview');}
  const options=new URLSearchParams(split[1]||''),ledger=['attempts','model-requests'].includes(options.get('ledger'))?options.get('ledger'):'comments';
  const page=pages[name];title.textContent=id?'评论详情':page.label;description.textContent=page.description;document.title=`${id?'评论详情':page.label} · 评论天才 V2 完整记录`;
  for(const a of document.querySelectorAll('nav a')){const active=a.dataset.page===name;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  root.replaceChildren();
  const ctx={api,signal:pageController.signal,navigate:hash=>{location.hash=hash;},formatTime,renderStatus,commentId:id,ledger,onRefresh:fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);}};
  cleanup=page.module.mount(root,ctx)||(()=>{});paintDataset();
}
function schedule(){clearTimeout(timer);if(!document.hidden)timer=setTimeout(()=>refresh(false),60000);}
async function refresh(force){
  if(document.hidden)return;
  clearTimeout(timer);
  try{await api.load({force});}catch(_){/* safe fixed errors are rendered by dataset and page envelopes */}
  finally{paintDataset();refreshMounted();schedule();}
}
api.subscribe(paintDataset);
button.addEventListener('click',()=>refresh(true));window.addEventListener('hashchange',route);
document.addEventListener('visibilitychange',()=>{paintDataset();if(document.hidden){clearTimeout(timer);api.cancelLoad();}else refresh(false);});
setInterval(()=>{if(document.hidden)return;const s=api.status(),key=`${s.document?.generation}:${s.stale}:${s.failure?.code||''}`;paintDataset();if(key!==lastFreshness){lastFreshness=key;refreshMounted();}},5000);
route();refresh(false);
