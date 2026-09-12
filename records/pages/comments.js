import {el,card,kv,live,table,pagination,filterForm,timeFields,stateLabels,stageLabels,labelledState,renderStatus,formatTime,text,code,linkComment,origin,empty} from '../shared.js';

export function mount(root,ctx) {
  if(ctx.commentId)return detail(root,ctx);
  const selected=ctx.ledger||'comments',tabs=el('div','ledger-tabs');
  for(const [name,label]of [['comments','评论'],['attempts','提交尝试'],['model-requests','模型请求']]){
    const button=el('button',selected===name?'active':'',label);button.type='button';button.setAttribute('aria-pressed',String(selected===name));
    button.addEventListener('click',()=>ctx.navigate(name==='comments'?'comments':`comments?ledger=${name}`));tabs.append(button);
  }
  root.append(tabs);
  return selected==='comments'?mountComments(root,ctx):mountLedger(root,ctx,selected);
}
function mountLedger(root,ctx,kind) {
  const attempts=kind==='attempts';let query={page:1,page_size:25},reader;const region=el('div');
  root.append(el('p','ledger-note','按快照中全部保存账本查询，包括关联评论缺失的记录。登记、平台接受和独立确认分别展示。'),filterForm([
    {key:'id',label:attempts?'尝试 ID':'模型请求 ID'},
    {key:'comment_id',label:'关联评论 ID'},
    {key:'state',label:'状态码',placeholder:'精确原始状态码'},
    {key:'association_status',label:'关联状态',options:[['','全部记录'],['LINKED','已关联评论'],['COMMENT_MISSING','关联评论未保存']]},
    ...timeFields(),
  ],values=>{query={...values,page:1,page_size:25};reader.refresh();}),region);
  const association=row=>el('div','stack',row.association_status==='LINKED'?linkComment(row.comment_id):code(row.comment_id),el('span','muted',row.association_status==='LINKED'?'已关联评论':'关联评论未保存'));
  reader=live(region,ctx,{path:'/api/'+kind,params:()=>query,render(data,out){
    const rows=(data.items||[]).map(row=>{
      if(!attempts)return [code(row.id),association(row),el('div','stack',renderStatus(row.state),code(row.state),row.error?code(row.error):null),el('div','stack',formatTime(row.started_at),formatTime(row.finished_at)),el('div','stack',text(row.model),row.cost===null?'费用未知（不能按 0 计）':`USD ${text(row.cost)}`)];
      const body=el('details','',el('summary','',row.origin_kind==='legacy'?'查看历史草稿（非实际回复证明）':'查看保存的完整发送正文'),el('div','prose',text(row.wire,'未保存')));
      return [el('div','stack',code(row.id),origin(row)),association(row),el('div','stack',renderStatus(row.state),code(row.state),el('div','muted',`回复 ID ${text(row.reply_id)}`)),el('div','stack',`登记 ${formatTime(row.registered_at)}`,`实际调用 ${formatTime(row.click_at)}`,`请求 ${formatTime(row.request_at)}`,`接受 ${formatTime(row.accepted_at)}`,`确认 ${formatTime(row.confirmed_at)}`),el('div','stack',code(row.video),el('div','muted',`发布 UID ${text(row.publisher)}`),body)];
    });
    out.append(card(attempts?'全部提交尝试':'全部模型请求',table(attempts?['尝试 / 来源','关联评论','账本状态','已保存阶段时间','视频 / 保存正文']:['请求 ID','关联评论','状态 / 错误码','开始 / 结束','模型 / 费用'],rows),pagination(data,page=>{query.page=page;reader.refresh();})));
  }});
  return()=>reader.destroy();
}

function mountComments(root,ctx){if(ctx.commentId)return detail(root,ctx);let query={page:1,page_size:25};const region=el('div');let reader;root.append(filterForm([{key:'comment_id',label:'评论 ID',placeholder:'完整 ID，不做数值转换'},{key:'state',label:'实际状态',options:[['','全部状态'],...Object.entries(stateLabels).filter(([k])=>['NEW','DRAFT','MODEL_INFLIGHT','MODEL_RETRY','READ_RETRY','SKIP','REVIEW','CONTRACT_REVIEW','UNKNOWN','CONFIRMED','ALREADY_REPLIED','ISOLATED','HISTORICAL_HOLD','TECHNICAL_EXHAUSTED'].includes(k))]},{key:'decision',label:'模型决定',options:[['','全部决定'],['reply','回复'],['skip','跳过'],['review','待审']]},{key:'video',label:'视频 ID',placeholder:'BV 号或数字 oid'},...timeFields()],values=>{query={...values,page:1,page_size:25};reader.refresh();}),el('p','muted','时间范围按原评论发布时间筛选。筛选结果数量不是全局汇总。'),region);reader=live(region,ctx,{path:'/api/comments',params:()=>query,render(data,out){out.append(card('',table(['原评论 / ID','状态 / 原因','模型决定','视频 / 来源','时间'],(data.items||[]).map(row=>[el('div','stack',linkComment(row.comment_id),el('div','comment-preview',text(row.text,'原评论未保存'))),el('div','stack',labelledState(row),el('div','muted',text(row.reason_label||row.reason,'未记录原因')),el('div','muted',text(row.next_safe_action))),el('div','stack',renderStatus(row.decision?.decision),el('span','muted',row.has_draft?'已有草稿，尚不能据此视为回复':'没有保存的草稿')),el('div','stack',code(row.video),origin(row)),el('div','stack nowrap',el('div','',`发布 ${formatTime(row.ctime)}`),el('div','muted',`首次发现 ${formatTime(row.first_seen)}`))])),pagination(data,page=>{query.page=page;reader.refresh();})));}});return()=>reader.destroy();}
function detail(root,ctx) {
  let attemptPage=1,requestPage=1,timelinePage=1,reader;
  const back=el('a','back-link','← 返回评论工作台');back.href='#comments';root.append(back);
  const region=el('div');root.append(region);
  const slice=(items,page,size)=>{const selected=Math.min(page,Math.max(1,Math.ceil(items.length/size)));return {items:items.slice((selected-1)*size,selected*size),page:selected,page_size:size,total:items.length,has_next:selected*size<items.length};};
  reader=live(region,ctx,{path:'/api/comments/'+ctx.commentId,render(d,out){
    out.append(card('原评论',el('div','section-heading',linkComment(d.comment_id),labelledState(d)),el('div','prose',text(d.text,'原评论未保存')),el('hr','subtle-divider'),kv([
      ['视频 ID',code(d.video)],['作者 UID',code(d.author_uid)],['原评论发布',formatTime(d.ctime)],['首次发现',formatTime(d.first_seen)],['最近发现',formatTime(d.last_seen)],['来源',origin(d)],
      ['未回复 / 状态原因',text(d.reason_label||d.reason,'未记录')],['下一步安全动作',text(d.next_safe_action)],
      ['发布门禁',d.send_block?`${d.send_block.blocked===true?'阻塞':d.send_block.blocked===false?'未阻塞':'未知'} · ${(d.send_block.reasons||[]).join('；')||'无已记录原因'}`:'未知'],
    ])));
    if(d.state==='UNKNOWN'||d.attempts?.some(a=>a.state==='UNKNOWN'))out.append(el('div','notice warning','结果待核实，仅沿原动作只读确认，禁止重发。平台接受也不能替代独立确认。'));
    out.append(el('div','columns',card('保存的模型结果',kv([
      ['决定',renderStatus(d.decision?.decision)],['决定原因',text(d.decision?.reason,'未保存')],['模型尝试数',d.model_tries],['读取尝试数',d.read_tries],['下次安全时刻',Number.isFinite(d.next_at)&&d.next_at<=0?'未设置等待时刻':formatTime(d.next_at)],
    ])),card('草稿（不是已回复）',el('div','prose',text(d.draft,'草稿未保存')))));
    const events=slice(d.timeline||[],timelinePage,50);timelinePage=events.page;
    const timeline=el('ol','timeline');
    for(const event of events.items)timeline.append(el('li','',el('strong','',stageLabels[event.stage]||event.stage),el('time','',formatTime(event.at)),el('span','muted',text(event.status,'已记录'))));
    out.append(card('证据时间线',el('p','muted','只显示保存的阶段时间。登记、调用、请求、平台接受和独立确认是不同证据；完整时间线分页查看。'),timeline.childNodes.length?timeline:empty('暂无阶段时间'),pagination(events,page=>{timelinePage=page;reader.refresh();})));
    const attempts=slice(d.attempts||[],attemptPage,10);attemptPage=attempts.page;
    out.append(card('提交尝试账本',...(attempts.items.length?attempts.items.map(a=>el('section','history-item',el('div','history-meta',code(a.id),renderStatus(a.state),origin(a)),kv([
      ['登记尝试',formatTime(a.registered_at)],['实际提交调用',formatTime(a.click_at)],['观察到请求',formatTime(a.request_at)],['平台接受',formatTime(a.accepted_at)],['独立确认',formatTime(a.confirmed_at)],['平台返回码',text(a.platform_code)],['发布 UID',code(a.publisher)],['回复 ID',code(a.reply_id)],['确认核查次数',a.confirm_tries],
    ]),el('h3','',a.origin_kind==='legacy'?'历史草稿 / 非实际回复证明':'登记的完整发送正文'),el('div','prose',text(a.wire,'未保存')))):[empty('暂无提交尝试','保存草稿不代表发生提交。')]),pagination(attempts,page=>{attemptPage=page;reader.refresh();})));
    const requests=slice(d.model_requests||[],requestPage,25);requestPage=requests.page;
    out.append(card('模型请求账本',table(['请求 ID','开始 / 结束','状态 / 模型','已记录费用（USD）'],requests.items.map(r=>[
      code(r.id),el('div','stack',formatTime(r.started_at),formatTime(r.finished_at)),el('div','stack',renderStatus(r.state),el('span','muted',text(r.model)),r.error?code(r.error):null),r.cost===null||r.cost===undefined?'未知，不能按 0 计':String(r.cost),
    ])),pagination(requests,page=>{requestPage=page;reader.refresh();})));
  }});
  return()=>reader.destroy();
}
