import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net'];
const pool=new SimplePool();
const $=(s,r=document)=>r.querySelector(s);
const unix=()=>Math.floor(Date.now()/1000);
const escapeHtml=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt',"'":'&#39;','"':'&quot;'}[c]));
const short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;
const fmt=ts=>new Date(ts*1000).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
function toHex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')}
function fromHex(hex){return new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)))}
function getIdentity(){
  let hex=localStorage.getItem('boyaki-device-sk');
  if(!hex){hex=toHex(generateSecretKey());localStorage.setItem('boyaki-device-sk',hex)}
  const sk=fromHex(hex); return {sk,pk:getPublicKey(sk)};
}
const identity=getIdentity();
$('#device-id').textContent=short(identity.pk);

let registry=[];
let events=[];
let selectedCandidate=null;

function tag(ev,key){return (ev.tags||[]).find(t=>t[0]===key)?.[1]||''}
function signed(template){return finalizeEvent({...template,created_at:template.created_at??unix()},identity.sk)}
async function publish(template){
  const ev=signed(template);
  const out=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!out.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');
  return ev;
}
async function withdraw(ev){
  if(ev.pubkey!==identity.pk)return;
  await publish({kind:5,content:'withdraw BOYAKI Maker Space event',tags:[['e',ev.id],['k',String(ev.kind)],['app','boyaki-web'],['schema','maker-space-withdraw-v1']]});
  await refresh();
}
function parseContent(ev){
  try{return JSON.parse(ev.content||'{}')}catch{return {note:ev.content||''}}
}
function candidateEvents(id){return events.filter(e=>tag(e,'candidate_id')===id)}
function participantEvents(id){return candidateEvents(id).filter(e=>tag(e,'t')==='boyaki-candidate-participation')}
function activityEvents(id){return candidateEvents(id).filter(e=>tag(e,'t')==='boyaki-candidate-activity')}
function latestParticipants(id){
  const map=new Map();
  for(const ev of participantEvents(id).sort((a,b)=>a.created_at-b.created_at)){
    const key=`${ev.pubkey}:${tag(ev,'role')||'contributor'}`; map.set(key,ev);
  }
  return [...map.values()].sort((a,b)=>b.created_at-a.created_at);
}
function roleLabel(role){return ({tester:'Tester',maker:'Maker',contributor:'Contributor','problem-owner':'Problem owner'})[role]||role||'Contributor'}
function activityLabel(type){return ({'test-result':'Test result','build-progress':'Build progress',research:'Research',review:'Review / feedback',blocked:'Blocked / limitation'})[type]||type||'Update'}
function bilingual(ja,en){
  return `${escapeHtml(ja||'')}<br><span class="hint">${escapeHtml(en||'')}</span>`;
}
function caseBlock(title,ja,en,className=''){
  const div=document.createElement('div'); div.className=`candidate-block ${className}`.trim();
  div.innerHTML=`<strong>${escapeHtml(title)}</strong><p>${bilingual(ja,en)}</p>`; return div;
}
function renderTimeline(candidate){
  const wrap=document.createElement('div'); wrap.className='candidate-block case-timeline';
  wrap.innerHTML='<strong>Case history / 案件履歴</strong>';
  const list=document.createElement('div'); list.className='activity-list';
  for(const step of candidate.timeline||[]){
    const item=document.createElement('div'); item.className='activity-item';
    const label=step.url?`<a href="${escapeHtml(step.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(step.label||step.stage)}</a>`:escapeHtml(step.label||step.stage);
    item.innerHTML=`<div class="activity-meta"><span class="chip">${escapeHtml(step.status||'recorded')}</span> ${label}</div>`;
    list.append(item);
  }
  if(!(candidate.timeline||[]).length)list.innerHTML='<p class="hint">No case history recorded yet.</p>';
  wrap.append(list); return wrap;
}
function renderRoleGuide(candidate){
  const wrap=document.createElement('div'); wrap.className='candidate-block';
  wrap.innerHTML='<strong>How you can participate / 参加できる役割</strong>';
  const grid=document.createElement('div'); grid.className='principles-grid';
  for(const [role,desc] of Object.entries(candidate.participation_roles||{})){
    const item=document.createElement('div'); item.innerHTML=`<strong>${escapeHtml(roleLabel(role))}</strong><span>${escapeHtml(desc)}</span>`; grid.append(item);
  }
  if(!grid.children.length)grid.innerHTML='<span class="hint">Choose Tester, Maker, Contributor, or Problem owner when joining.</span>';
  wrap.append(grid); return wrap;
}

async function loadRegistry(){
  const r=await fetch('./solution-candidates.json',{cache:'no-store'});
  if(!r.ok)throw new Error('candidate registry unavailable');
  const data=await r.json(); registry=data.candidates||[];
}
async function loadEvents(){
  const since=unix()-60*60*24*365;
  const [work,deletions]=await Promise.all([
    pool.querySync(RELAYS,{kinds:[1],'#t':['boyaki-candidate-participation','boyaki-candidate-activity'],since,limit:1000}),
    pool.querySync(RELAYS,{kinds:[5],since,limit:1000})
  ]);
  const deletedByOwner=new Map();
  for(const deletion of deletions){
    let ids=deletedByOwner.get(deletion.pubkey);
    if(!ids){ids=new Set();deletedByOwner.set(deletion.pubkey,ids)}
    for(const t of deletion.tags||[])if(t[0]==='e'&&t[1])ids.add(t[1]);
  }
  const dedupe=new Map();
  for(const ev of work){
    const ownerDeletes=deletedByOwner.get(ev.pubkey);
    if(!ownerDeletes?.has(ev.id))dedupe.set(ev.id,ev);
  }
  events=[...dedupe.values()];
}

function renderParticipants(card,candidate){
  const wrap=$('.candidate-people',card),people=latestParticipants(candidate.id);
  const roles=new Map();
  for(const ev of people){const r=roleLabel(tag(ev,'role'));roles.set(r,(roles.get(r)||0)+1)}
  const stats=$('.candidate-stats',card);
  stats.innerHTML=people.length?`<span class="step on">participants ${people.length}</span>${[...roles.entries()].map(([r,n])=>`<span class="step">${escapeHtml(r)} ${n}</span>`).join('')}`:'<span class="step">participants 0</span>';
  if(!people.length){wrap.innerHTML='<p class="hint">まだ公開参加者はいません。Problem owner / Tester / Maker / Contributorとして参加できます。</p>';return}
  wrap.innerHTML='<h3>Participants</h3><div class="participant-list"></div>';
  const list=$('.participant-list',wrap);
  for(const ev of people){
    const c=parseContent(ev),item=document.createElement('div'); item.className='participant-item';
    const name=c.displayName?.trim()||short(ev.pubkey),mine=ev.pubkey===identity.pk;
    item.innerHTML=`<div><strong>${escapeHtml(name)}</strong> <span class="chip">${escapeHtml(roleLabel(tag(ev,'role')))}</span>${mine?' <span class="chip">you</span>':''}<br><span class="hint">${escapeHtml(c.note||'参加')}</span></div>`;
    if(mine){const b=document.createElement('button');b.type='button';b.textContent='取り下げ';b.addEventListener('click',()=>withdraw(ev));item.append(b)}
    list.append(item);
  }
}
function renderActivity(card,candidate){
  const wrap=$('.candidate-activity',card),xs=activityEvents(candidate.id).sort((a,b)=>b.created_at-a.created_at);
  wrap.innerHTML='<h3>Public activity / 公開活動ログ</h3>';
  if(!xs.length){wrap.insertAdjacentHTML('beforeend','<p class="hint">まだ公開活動ログはありません。参加後、検証・調査・制作・レビュー結果をここへ残せます。</p>');return}
  const list=document.createElement('div');list.className='activity-list';
  for(const ev of xs){
    const c=parseContent(ev),name=c.displayName?.trim()||short(ev.pubkey),mine=ev.pubkey===identity.pk,item=document.createElement('div');item.className='activity-item';
    item.innerHTML=`<div class="activity-meta"><strong>${escapeHtml(activityLabel(c.activityType||tag(ev,'activity_type')))}</strong> · ${escapeHtml(name)} · ${escapeHtml(fmt(ev.created_at))}${mine?' · you':''}</div><p>${escapeHtml(c.note||'')}</p>`;
    if(mine){const b=document.createElement('button');b.type='button';b.textContent='取り下げ';b.addEventListener('click',()=>withdraw(ev));item.append(b)}
    list.append(item);
  }
  wrap.append(list);
}
function renderCandidate(candidate){
  const card=$('#candidate-template').content.firstElementChild.cloneNode(true);
  $('.candidate-status',card).textContent=`${candidate.status_label_ja} / ${candidate.status_label_en}`;
  $('.candidate-title',card).textContent=candidate.title;
  $('.candidate-id',card).textContent=candidate.id;
  $('.candidate-summary',card).innerHTML=bilingual(candidate.summary_ja,candidate.summary_en);

  const summary=$('.candidate-summary',card);
  const detailBlocks=[
    caseBlock('Problem / 困っていたこと',candidate.pain_ja||candidate.summary_ja,candidate.pain_en||candidate.summary_en),
    caseBlock('Target / 目指した状態',candidate.target_ja||'',candidate.target_en||''),
    caseBlock('What BOYAKI tried / 試したこと',candidate.tried_ja||'',candidate.tried_en||''),
    renderTimeline(candidate),
    caseBlock('Outcome / 起きた成果',candidate.outcome_ja||'',candidate.outcome_en||'','verified'),
    renderRoleGuide(candidate)
  ];
  let anchor=summary;
  for(const block of detailBlocks){anchor.insertAdjacentElement('afterend',block); anchor=block}

  $('.candidate-current',card).innerHTML=bilingual(candidate.current_candidate_ja,candidate.current_candidate_en);
  $('.candidate-verified',card).innerHTML=bilingual(candidate.verified_ja,candidate.verified_en);
  $('.candidate-limitations',card).innerHTML=bilingual(candidate.limitations_ja,candidate.limitations_en);
  const help=$('.candidate-help',card); for(const h of candidate.help_wanted||[]){const x=document.createElement('span');x.className='chip';x.textContent=h;help.append(x)}
  $('[data-action="source"]',card).href=candidate.source_issue;
  const actions=$('.candidate-actions',card);
  if(candidate.upstream?.primary_pr){const a=document.createElement('a');a.className='button-link';a.target='_blank';a.rel='noopener noreferrer';a.href=candidate.upstream.primary_pr;a.textContent='upstream PR #55';actions.append(a)}
  if(candidate.upstream?.follow_up_pr){const a=document.createElement('a');a.className='button-link';a.target='_blank';a.rel='noopener noreferrer';a.href=candidate.upstream.follow_up_pr;a.textContent='follow-up PR #58';actions.append(a)}
  $('[data-action="join"]',card).addEventListener('click',()=>openJoin(candidate));
  $('[data-action="activity"]',card).addEventListener('click',()=>openActivity(candidate));
  renderParticipants(card,candidate); renderActivity(card,candidate); return card;
}
function render(){
  const list=$('#candidate-list'); list.innerHTML='';
  if(!registry.length){list.innerHTML='<div class="card">公開中のSolution Candidateはまだありません。</div>';return}
  for(const c of registry)list.append(renderCandidate(c));
}
function revealPanel(panel){
  panel.hidden=false;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      panel.scrollIntoView({behavior:'smooth',block:'center'});
      const focusable=panel.querySelector('textarea,input:not([type="hidden"]),select');
      if(focusable)focusable.focus({preventScroll:true});
    });
  });
}
function openJoin(candidate){
  selectedCandidate=candidate; $('#join-title').textContent=`${candidate.title} に参加`; $('#activity-panel').hidden=true; $('#join-status').textContent=''; revealPanel($('#join-panel'));
}
function openActivity(candidate){
  selectedCandidate=candidate; $('#activity-title').textContent=`${candidate.title} — 活動を記録`; $('#join-panel').hidden=true; $('#activity-status').textContent=''; revealPanel($('#activity-panel'));
}
$('#join-cancel').addEventListener('click',()=>{$('#join-panel').hidden=true});
$('#activity-cancel').addEventListener('click',()=>{$('#activity-panel').hidden=true});
$('#join-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(!selectedCandidate)return;
  const button=e.submitter,role=$('#join-role').value,displayName=$('#join-name').value.trim(),note=$('#join-note').value.trim();
  button.disabled=true; $('#join-status').textContent='公開しています…';
  try{
    await publish({kind:1,content:JSON.stringify({displayName,note}),tags:[['t','boyaki-candidate-participation'],['candidate_id',selectedCandidate.id],['role',role],['app','boyaki-web'],['schema','candidate-participant-v1']]});
    localStorage.setItem('boyaki-maker-display-name',displayName); $('#join-note').value=''; $('#join-status').textContent='参加を公開しました。このcaseのParticipantsに残ります。'; await refresh();
  }catch{$('#join-status').textContent='公開できませんでした。少し後で再試行してください。'}finally{button.disabled=false}
});
$('#activity-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(!selectedCandidate)return;
  const button=e.submitter,activityType=$('#activity-type').value,displayName=$('#activity-name').value.trim(),note=$('#activity-note').value.trim(); if(!note){$('#activity-status').textContent='公開メモを書いてから送ってください。進捗・検証・詰まりのどれかを一言で。';return;}
  button.disabled=true; $('#activity-status').textContent='公開しています…';
  try{
    await publish({kind:1,content:JSON.stringify({displayName,activityType,note}),tags:[['t','boyaki-candidate-activity'],['candidate_id',selectedCandidate.id],['activity_type',activityType],['app','boyaki-web'],['schema','candidate-activity-v1']]});
    localStorage.setItem('boyaki-maker-display-name',displayName); $('#activity-note').value=''; $('#activity-status').textContent='活動を公開しました。このcaseの公開履歴に残ります。'; await refresh();
  }catch{$('#activity-status').textContent='公開できませんでした。少し後で再試行してください。'}finally{button.disabled=false}
});
async function refresh(){await Promise.all([loadRegistry(),loadEvents()]);render()}
const savedName=localStorage.getItem('boyaki-maker-display-name')||''; $('#join-name').value=savedName; $('#activity-name').value=savedName;
$('#maker-refresh').addEventListener('click',()=>refresh().catch(()=>{}));
refresh().catch(err=>{$('#candidate-list').innerHTML=`<div class="card">Maker Spaceを読み込めませんでした。${escapeHtml(err.message||'')}</div>`});
