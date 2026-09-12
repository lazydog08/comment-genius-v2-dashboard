import {el,card,live,filterForm,timeFields,pagination,table,renderStatus,formatTime,text,code,empty} from '../shared.js';
export function mount(root,ctx){
  let faultQuery={status:'active',page:1,page_size:25},eventQuery={page:1,page_size:25};
  let faultReader,eventReader,notificationPage=1,paused=false;
  const faultRegion=el('div'),eventRegion=el('div');
  root.append(filterForm([{key:'status',label:'故障状态',value:'active',options:[['active','现存故障'],['resolved','已恢复'],['all','全部']]},{key:'scope',label:'作用范围',options:[['','全部范围'],['all','全部业务'],['reader','采集'],['model','模型'],['send','发布']]}],v=>{faultQuery={...v,status:v.status||'active',page:1,page_size:25};faultReader.refresh();}),faultRegion);
  faultReader=live(faultRegion,ctx,{path:'/api/faults',params:()=>faultQuery,render(data,out){
    out.append(card('故障记录',el('p','muted','首次记录为保留事件中同故障的最早记录；缺证据显示未知。最近写入不能当作首次发生。'),table(['故障 / 作用范围','原因 / 安全动作','首次记录','最近发生 / 恢复'],(data.items||[]).map(f=>[
      el('div','stack',code(f.key),code(f.scope),renderStatus(String(f.status).toUpperCase(),f.status==='active'?'现存故障':'已恢复')),
      el('div','stack',text(f.reason_label||f.reason),el('div','muted',text(f.next_safe_action))),
      el('div','stack',formatTime(f.first_observed_at),el('div','muted','保留事件中同故障的最早记录')),
      el('div','stack',`最近发生 / 写入 ${formatTime(f.opened_at)}`,`恢复 ${formatTime(f.resolved_at)}`),
    ])),pagination(data,page=>{faultQuery.page=page;faultReader.refresh();})));
    const meta=data.notifications_meta,items=data.notifications;
    const notification=card('Bark 投递证据',el('p','muted','本次来源保留的全部通知记录，不代表已被来源清理的更早历史。服务端接受不代表手机收到。'),el('p','muted',`通知来源采样 ${formatTime(meta?.sampled_at)} · 已导出 ${text(meta?.exported_total)} / 来源保留 ${text(meta?.source_total)}`));
    if(meta?.stale)notification.append(el('div','notice warning','通知来源过期：以下投递证据不代表当前投递状态。'));
    if(meta?.partial)notification.append(el('div','notice warning','通知来源不完整，未知记录不按未投递或已接受计。'));
    if(!Array.isArray(items))notification.append(empty('投递记录未知','未取得通知来源，不能视为已投递或空队列。'));
    else {
      const pages=Math.max(1,Math.ceil(items.length/25));notificationPage=Math.min(notificationPage,pages);
      const sliced=items.slice((notificationPage-1)*25,notificationPage*25);
      notification.append(table(['记录','真实投递状态','时间 / 重试'],sliced.map(n=>[
        code(n.id),el('div','stack',renderStatus('',n.accepted===true?'Bark 服务端已接受':n.superseded_at?'已被后续状态替代':n.next_at?'待重试':'未投递 / 未确认接受'),code(n.result)),
        el('div','stack',`最近尝试 ${formatTime(n.last_at)}`,`服务端接受 ${formatTime(n.accepted_at)}`,`下次尝试 ${formatTime(n.next_at)}`,`尝试次数 ${text(n.attempts)}`),
      ])),pagination({page:notificationPage,page_size:25,total:items.length,has_next:notificationPage<pages},page=>{notificationPage=page;faultReader.refresh();}));
    }
    out.append(notification);
  }});
  const pause=el('button','','暂停日志自动刷新');pause.type='button';pause.addEventListener('click',()=>{paused=!paused;pause.textContent=paused?'恢复日志自动刷新':'暂停日志自动刷新';pause.setAttribute('aria-pressed',String(paused));if(!paused)eventReader.refresh();});
  root.append(el('div','section-heading',el('h2','','可见事件日志'),pause),filterForm([{key:'level',label:'级别',options:[['','全部级别'],['INFO','信息'],['WARNING','警告'],['ERROR','错误']]},{key:'kind',label:'事件类型',placeholder:'已知事件码'},...timeFields()],v=>{eventQuery={...v,page:1,page_size:25};eventReader.refresh();}),eventRegion);
  eventReader=live(eventRegion,ctx,{path:'/api/events',params:()=>eventQuery,paused:()=>paused,render(data,out){
    const log=el('div','log-container');
    if(!data.items?.length)log.append(empty('暂无符合条件的事件'));
    for(const e of data.items||[]){const row=el('article','log-entry',el('time','',formatTime(e.at)),renderStatus(e.level==='ERROR'?'FAILED':e.level==='WARNING'?'UNKNOWN':'',e.level||'INFO'),el('span','log-message',text(e.message)),el('div','muted',`${text(e.kind)} · 对象 ${text(e.target,'未记录')}`));if(e.details&&Object.keys(e.details).length)row.append(el('div','mono muted',Object.entries(e.details).map(([k,v])=>`${k}: ${text(v)}`).join(' · ')));log.append(row);}
    out.append(card('',el('p','muted','展示全部保留的可见事件；详情仅含获准的白名单字段，不含原始模型响应或凭据。'),log,pagination(data,page=>{eventQuery.page=page;eventReader.refresh();})));
  }});
  return()=>{faultReader.destroy();eventReader.destroy();};
}
