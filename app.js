import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent, nip44 } from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net','wss://relay.damus.io','wss://relay.nostr.band'];
const RECOVERY_PUBKEY='1ba668198fc73341765d7dc8d51e7f669d04b613e56e43bba0fc0d7b5e313250';
const pool=new SimplePool();
const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
function showBoyakiAlert(message,title='お知らせ'){
  const overlay=document.querySelector('#boyaki-alert');
  if(!overlay){alert(message);return}
  overlay.querySelector('[data-alert-title]').textContent=title;
  overlay.querySelector('[data-alert-message]').textContent=message;
  overlay.hidden=false;
  requestAnimationFrame(()=>overlay.classList.add('show'));
}
function hideBoyakiAlert(){
  const overlay=document.querySelector('#boyaki-alert');if(!overlay)return;
  overlay.classList.remove('show');setTimeout(()=>overlay.hidden=true,160);
}
document.addEventListener('click',e=>{if(e.target.matches?.('[data-alert-close]')||e.target.id==='boyaki-alert')hideBoyakiAlert()});
const status=$('#status'),feed=$('#feed'),makerList=$('#maker-list'),problemView=$('#problem-view'); let roots=[],related=[];
function toHex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')}
function fromHex(hex){return new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)))}
function getIdentity(){let hex=localStorage.getItem('boyaki-device-sk');if(!hex){hex=toHex(generateSecretKey());localStorage.setItem('boyaki-device-sk',hex)}const sk=fromHex(hex);return{sk,pk:getPublicKey(sk)}}
const identity=getIdentity(); const unix=()=>Math.floor(Date.now()/1000);
function eTags(ev){return (ev.tags||[]).filter(t=>t[0]==='e')}
function rootTag(ev){return eTags(ev).find(t=>t[3]==='root')?.[1]||eTags(ev).find(t=>t.length===2)?.[1]}
function replyTag(ev){return eTags(ev).find(t=>t[3]==='reply')?.[1]}
function tag(ev,k){return ev.tags.find(t=>t[0]===k)?.[1]}
function short(pk){return `${pk.slice(0,6)}…${pk.slice(-4)}`}
function fmt(ts){return new Date(ts*1000).toLocaleString('ja-JP',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function signed(template){return finalizeEvent({...template,created_at:template.created_at??unix()},identity.sk)}
async function publishExact(ev){
  const attempts=pool.publish(RELAYS,ev);
  const wrapped=attempts.map((p,i)=>Promise.resolve(p).then(()=>RELAYS[i]));
  try{
    const relay=await Promise.race([
      Promise.any(wrapped),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('relay publish timeout')),9000))
    ]);
    console.info('published via',relay);
    return ev;
  }catch(err){
    console.error('all relay publishes failed',err);
    throw err;
  }
}
async function publish(template){return publishExact(signed(template))}
const ACQUISITION_CAMPAIGNS={
 'train-ticketing':{contentId:'cs-train-ticketing-v12',campaignId:'owned-bdf-train-v12',vertical:'travel_mobility',theme:'jp_train_ticketing_friction'},
 'work-admin':{contentId:'cs-work-admin-v12',campaignId:'owned-bdf-work-v12',vertical:'work_admin',theme:'jp_work_process_overhead'}
};
function acquisitionTags(){const key=new URLSearchParams(location.search).get('discover'),c=key&&ACQUISITION_CAMPAIGNS[key];if(!c)return[];return[['acq_content_id',c.contentId],['acq_campaign_id',c.campaignId],['acq_vertical',c.vertical],['acq_theme',c.theme],['acq_schema','holdings-frontier-v12'],['acq_authenticity','unqualified']]}
async function createRaw(text){
 const raw=signed({kind:1,content:text,tags:[['t','boyaki-raw'],['app','boyaki-web'],['schema','raw-v1'],['source','deliberate-web-submission'],...acquisitionTags()]});
 const deletion=signed({kind:5,content:'withdraw raw source',tags:[['e',raw.id],['k','1'],['app','boyaki-web'],['schema','presigned-withdrawal-v1']]});
 // First preserve the local withdrawal proof, then publish the user's BOYAKI.
 // Recovery-capsule failure must not silently prevent the BOYAKI itself from being posted.
 localStorage.setItem(`boyaki-withdrawal:${raw.id}`,JSON.stringify(deletion));
 await publishExact(raw);
 try{
   const conversationKey=nip44.v2.utils.getConversationKey(identity.sk,RECOVERY_PUBKEY);
   const encrypted=nip44.v2.encrypt(JSON.stringify(deletion),conversationKey);
   const capsule=signed({kind:1,content:encrypted,tags:[['t','boyaki-recovery-capsule'],['e',raw.id,RELAYS[0],'root'],['p',RECOVERY_PUBKEY],['app','boyaki-web'],['schema','encrypted-revocation-capsule-v1']]});
   await publishExact(capsule);
   localStorage.removeItem(`boyaki-recovery-pending:${raw.id}`);
 }catch(err){
   console.warn('recovery capsule pending',err);
   localStorage.setItem(`boyaki-recovery-pending:${raw.id}`,'1');
 }
 return raw;
}
async function createReply(root,type,text,parent=null){const tags=[['e',root.id,RELAYS[0],'root'],['p',root.pubkey],['t',`boyaki-${type}`],['app','boyaki-web'],['problem_id',root.id]];if(parent){tags.splice(1,0,['e',parent.id,RELAYS[0],'reply']);tags.push(['parent_id',parent.id]);if(parent.pubkey!==root.pubkey)tags.push(['p',parent.pubkey])}return publish({kind:1,content:text,tags})}
async function rootReact(root,type){return publish({kind:7,content:type,tags:[['e',root.id,RELAYS[0],'root'],['p',root.pubkey],['t','boyaki-demand-ladder'],['action',type],['scope','problem'],['app','boyaki-web']]})}
async function reactProposal(root,proposal,type){return publish({kind:7,content:type,tags:[['e',root.id,RELAYS[0],'root'],['e',proposal.id,RELAYS[0],'reply'],['p',root.pubkey],['p',proposal.pubkey],['t','boyaki-demand-ladder'],['action',type],['scope','proposal-specific'],['proposal_id',proposal.id],['problem_id',root.id],['app','boyaki-web']]})}
async function report(root,type='other'){return publish({kind:1984,content:'BOYAKI public safety report',tags:[['e',root.id,RELAYS[0],type],['p',root.pubkey],['app','boyaki-web'],['schema','public-report-v1']]})}
async function withdraw(root){if(root.pubkey!==identity.pk)return;const stored=localStorage.getItem(`boyaki-withdrawal:${root.id}`);const ev=stored?JSON.parse(stored):signed({kind:5,content:'withdrawn by original browser identity',tags:[['e',root.id],['k','1'],['app','boyaki-web']]});await publishExact(ev);localStorage.setItem(`boyaki-withdrawn:${root.id}`,'1');await refresh()}
async function queryAll(){const since=unix()-60*60*24*30;const [raw,threads,reactions,deletions]=await Promise.all([pool.querySync(RELAYS,{kinds:[1],'#t':['boyaki-raw'],since,limit:200}),pool.querySync(RELAYS,{kinds:[1],'#t':['boyaki-clarify','boyaki-proposal','boyaki-poster-response'],since,limit:500}),pool.querySync(RELAYS,{kinds:[7],'#t':['boyaki-demand-ladder'],since,limit:1000}),pool.querySync(RELAYS,{kinds:[5],since,limit:1000})]);const deleted=new Set(deletions.flatMap(e=>e.tags.filter(t=>t[0]==='e').map(t=>t[1])));roots=dedupe(raw).filter(e=>!deleted.has(e.id)).sort((a,b)=>b.created_at-a.created_at);related=[...dedupe(threads),...dedupe(reactions)].filter(e=>!deleted.has(e.id))}
function dedupe(xs){const m=new Map();for(const x of xs)m.set(x.id,x);return [...m.values()]}
function relatedTo(id){return related.filter(e=>rootTag(e)===id)}
function validPosterResponse(root,e){return e.kind===1&&tag(e,'t')==='boyaki-poster-response'&&e.pubkey===root.pubkey&&rootTag(e)===root.id}
function proposalById(root,id){return relatedTo(root.id).find(e=>e.id===id&&e.kind===1&&tag(e,'t')==='boyaki-proposal')}
function validProposalReaction(root,e){if(e.kind!==7||e.pubkey!==root.pubkey||tag(e,'scope')!=='proposal-specific'||tag(e,'problem_id')!==root.id)return false;const pid=tag(e,'proposal_id');return !!pid&&replyTag(e)===pid&&!!proposalById(root,pid)}
function validRootPosterReaction(root,e){return e.kind===7&&e.pubkey===root.pubkey&&tag(e,'scope')==='problem'&&rootTag(e)===root.id}
function validSharedPainReaction(root,e){return e.kind===7&&e.content==='same'&&e.pubkey!==root.pubkey&&tag(e,'scope')==='problem'&&rootTag(e)===root.id}
function sharedPainActorCount(root){return new Set(relatedTo(root.id).filter(e=>validSharedPainReaction(root,e)).map(e=>e.pubkey)).size}
function clarificationAnsweredByPoster(root,q){return relatedTo(root.id).some(e=>validPosterResponse(root,e)&&(replyTag(e)===q.id||tag(e,'parent_id')===q.id))}
function stats(root){const xs=relatedTo(root.id),actions=xs.filter(x=>x.kind===7),posterRoot=actions.filter(x=>validRootPosterReaction(root,x)),proposalActions=actions.filter(x=>validProposalReaction(root,x));return{same:sharedPainActorCount(root),understood:posterRoot.filter(x=>x.content==='understood').length,different:proposalActions.filter(x=>x.content==='different').length,near:proposalActions.filter(x=>x.content==='near').length,canbuild:actions.filter(x=>x.content==='canbuild').length,interest:proposalActions.filter(x=>x.content==='interest').length,trial:proposalActions.filter(x=>x.content==='trial').length,pay:proposalActions.filter(x=>x.content==='payment-intent').length,clarify:xs.filter(x=>tag(x,'t')==='boyaki-clarify').length,proposal:xs.filter(x=>tag(x,'t')==='boyaki-proposal').length,poster:xs.filter(x=>validPosterResponse(root,x)).length}}
function normalizeQuestion(s=''){return s.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'')}
function preProposalQuestionState(root){const xs=relatedTo(root.id).filter(e=>e.kind===1).sort((a,b)=>a.created_at-b.created_at);const firstProposal=xs.find(e=>tag(e,'t')==='boyaki-proposal');const questions=xs.filter(e=>tag(e,'t')==='boyaki-clarify'&&(!firstProposal||e.created_at<firstProposal.created_at));const clarificationCount=questions.length,questionLimit=2;return{clarificationCount,questionLimit,allowed:clarificationCount<2,normalized:new Set(questions.map(e=>normalizeQuestion(e.content)))}}
function usefulMakerContribution(text=''){const x=text.trim().normalize('NFKC');if(x.length<8)return false;const generic=/^(連絡(して)?ください|dm(して)?ください|contact\s*me|詳しくは(dm|連絡)|https?:\/\/\S+)$/i;return!generic.test(x)}
function ensureThreadRoleTabs(node,root){
  if(node.querySelector('[data-thread-role-tabs]'))return;
  const block=document.createElement('div');
  block.className='thread-role-tabs';
  block.dataset.threadRoleTabs='1';
  block.innerHTML='<p class="hint"><strong>このBOYAKIに参加する</strong></p><div class="actions"><button type="button" data-thread-role="voice">Voiceとして入る</button><button type="button" data-thread-role="maker">Makerとして入る</button></div><p class="hint" data-entry-role-status></p>';
  const raw=node.querySelector('.raw');
  raw?.after(block);
  block.querySelectorAll('[data-thread-role]').forEach(b=>b.addEventListener('click',()=>{
    const role=b.dataset.threadRole;
    localStorage.setItem(`boyaki-thread-role:${root.id}`,role);
    applyEntryRole(node,root,role);
  }));
}
function applyEntryRole(node,root,role){
  const status=node.querySelector('[data-entry-role-status]');
  const clarify=node.querySelector('.clarify');
  const proposal=node.querySelector('.proposal');
  const tabs=node.querySelector('[data-thread-role-tabs]');
  if(tabs)tabs.querySelectorAll('[data-thread-role]').forEach(b=>b.classList.toggle('active',b.dataset.threadRole===role));
  if(status)status.textContent=role==='voice'?'Voiceとして参加中です。困りごとの補足・検証に参加できます。':role==='maker'?'Makerとして参加中です。質問・解決案の提案に参加できます。':'参加する役割を選んでください。';
  if(clarify)clarify.hidden=!role;
  if(proposal)proposal.hidden=role!=='maker';
}
function addPosterControls(node,root){if(root.pubkey!==identity.pk)return;const actions=$('.actions',node);const understood=document.createElement('button');understood.dataset.action='understood';understood.textContent='そう、それが言いたかった';actions.append(understood);const d=document.createElement('details');d.className='poster-response';d.innerHTML='<summary>解決する人や、この問題に返事する</summary><form data-form="poster-response"><input maxlength="240" placeholder="どこが良い？違う？何なら試せる？" /><button>返事</button></form>';$('.thread',node).before(d);const del=document.createElement('button');del.textContent='自分の投稿を取り下げ';del.addEventListener('click',()=>withdraw(root));node.append(del)}
function addClarificationAnswerControl(item,root,question){if(root.pubkey!==identity.pk||clarificationAnsweredByPoster(root,question))return;const d=document.createElement('details');d.className='poster-clarification-answer';d.innerHTML='<summary>この質問に答える</summary><form><input maxlength="240" placeholder="質問への答えを一言で" /><button>答える</button></form>';d.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const i=e.currentTarget.querySelector('input'),text=i.value.trim();if(!text)return;await createReply(root,'poster-response',text,question);i.value='';await refresh()});item.append(d)}
function addProposalPosterControls(item,root,proposal){if(root.pubkey!==identity.pk)return;const wrap=document.createElement('div');wrap.className='actions proposal-reactions';for(const [action,label] of [['interest','それ'],['near','近い'],['different','違う'],['trial','試したい'],['payment-intent','支払ってもいい']]){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',async()=>{b.disabled=true;try{await reactProposal(root,proposal,action);await refresh()}finally{b.disabled=false}});wrap.append(b)}item.append(wrap)}
function card(root,{maker=false,detail=false}={}){const node=$('#problem-template').content.firstElementChild.cloneNode(true),s=stats(root);$('.meta',node).textContent=`${fmt(root.created_at)} · ${short(root.pubkey)} · 元のボヤキ`;$('.raw',node).textContent=root.content;const chips=$('.chips',node);for(const [name,n] of [['自分も',s.same],['詳しい情報',s.clarify],['解決できそう',s.canbuild],['提案',s.proposal],['投稿者の返答',s.poster]]){const c=document.createElement('span');c.className='chip';c.textContent=`${name} ${n}`;chips.append(c)}const dl=$('.demand-ladder',node);for(const [name,n] of [['問題の理解',s.understood],['同じ困りごと',s.same],['解決策への興味',s.interest],['試したい',s.trial],['支払い意向',s.pay]]){const e=document.createElement('span');e.className=`step ${n?'on':''}`;e.textContent=`${name}${n?` ${n}`:''}`;dl.append(e)}if(s.near){const e=document.createElement('span');e.className='step on';e.textContent=`近い提案 ${s.near}`;dl.append(e)}if(s.different){const e=document.createElement('span');e.className='step';e.textContent=`違う提案 ${s.different}`;dl.append(e)}const thread=$('.thread',node);for(const ev of relatedTo(root.id).filter(e=>e.kind===1).sort((a,b)=>a.created_at-b.created_at)){const type=tag(ev,'t');if(type==='boyaki-poster-response'&&!validPosterResponse(root,ev))continue;const label=type==='boyaki-proposal'?'解決案':type==='boyaki-poster-response'?'投稿者の返答':'追加の質問',item=document.createElement('div');item.className=`thread-item ${type==='boyaki-proposal'?'proposal-item':type==='boyaki-clarify'?(clarificationAnsweredByPoster(root,ev)?'clarification-answered':'clarification-unanswered'):''}`;item.dataset.eventId=ev.id;item.dataset.eventType=type||'';item.dataset.actorRole=type==='boyaki-poster-response'?'original-poster':type==='boyaki-proposal'?'maker':'questioner';item.innerHTML=`<strong>${label}</strong> · ${escapeHtml(short(ev.pubkey))}<br>${escapeHtml(ev.content)}`;if(type==='boyaki-proposal')addProposalPosterControls(item,root,ev);if(type==='boyaki-clarify')addClarificationAnswerControl(item,root,ev);thread.append(item)}addPosterControls(node,root);$('.actions button[data-action]',node).forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{const role=b.dataset.entryRole;if(role){localStorage.setItem(`boyaki-thread-role:${root.id}`,role);applyEntryRole(node,root,role)}await rootReact(root,b.dataset.action);await refresh()}finally{b.disabled=false}}));
  applyEntryRole(node,root,localStorage.getItem(`boyaki-thread-role:${root.id}`)||'');const clarifyForm=$('[data-form="clarify"]',node),clarifyState=preProposalQuestionState(root);if(!clarifyState.allowed){clarifyForm.innerHTML='<p class="hint">提案前の追加質問は2つまでです。今ある情報から解決案を考えます。</p>'}else clarifyForm.addEventListener('submit',async e=>{e.preventDefault();const i=$('input',e.currentTarget),text=i.value.trim();if(!text)return;const state=preProposalQuestionState(root);if(!state.allowed){e.currentTarget.innerHTML='<p class="hint">提案前の追加質問は2つまでです。</p>';return}if(state.normalized.has(normalizeQuestion(text))){status.textContent='同じ内容の質問はすでにあります。';return}await createReply(root,'clarify',text);i.value='';await refresh()});$('[data-form="proposal"]',node).addEventListener('submit',async e=>{e.preventDefault();const i=$('input',e.currentTarget),text=i.value.trim();if(!text)return;if(!usefulMakerContribution(text)){status.textContent='提案には、解決方法・できること・試し方のどれかを具体的に書いてください。';return}await createReply(root,'proposal',text);i.value='';await refresh()});const posterForm=$('[data-form="poster-response"]',node);if(posterForm)posterForm.addEventListener('submit',async e=>{e.preventDefault();const i=$('input',e.currentTarget);if(i.value.trim()){await createReply(root,'poster-response',i.value.trim());i.value='';await refresh()}});const reportBtn=document.createElement('button');reportBtn.className='report';reportBtn.textContent='問題を報告';reportBtn.addEventListener('click',async()=>{reportBtn.disabled=true;try{await report(root,'other');reportBtn.textContent='報告済み'}catch{reportBtn.textContent='報告失敗'}finally{reportBtn.disabled=false}});node.append(reportBtn);$('.permalink',node).href=`?problem=${root.id}`;return node}
function renderFeed(){feed.innerHTML='';if(!roots.length)feed.innerHTML='<div class="card">まだBOYAKIがありません。</div>';for(const r of roots)feed.append(card(r,{detail:false}))}
function renderMaker(q=''){makerList.innerHTML='';const items=roots.filter(r=>!q||r.content.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>{const A=stats(a),B=stats(b);return(B.same+B.clarify+B.canbuild+B.proposal)-(A.same+A.clarify+A.canbuild+A.proposal)||b.created_at-a.created_at});for(const r of items)makerList.append(card(r,{maker:true,detail:false}));if(!items.length)makerList.innerHTML='<div class="card">該当する困りごとはありません。</div>'}
function showHome(){history.replaceState(null,'',location.pathname);problemView.hidden=true;$('#feed-view').hidden=false;$('#maker-view').hidden=true;$('#composer').hidden=false;$$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view==='feed'));renderFeed()}
function renderProblem(id){const r=roots.find(x=>x.id===id);if(!r)return false;problemView.innerHTML='<div class="section-head"><div><p class="eyebrow">この問題のページ</p><h2>困りごと</h2></div><button id="problem-back">一覧へ</button></div>';problemView.append(card(r,{detail:true}));problemView.hidden=false;$('#feed-view').hidden=true;$('#maker-view').hidden=true;$('#composer').hidden=true;$('#problem-back').addEventListener('click',showHome);return true}
async function refresh(){status.textContent='';await queryAll();const id=new URLSearchParams(location.search).get('problem');if(id&&renderProblem(id))return;renderFeed();renderMaker($('#maker-search').value)}
$('#raw-form').addEventListener('submit',async e=>{e.preventDefault();const input=$('#raw'),text=input.value.trim();if(!text)return;$('#submit-btn').disabled=true;status.textContent='公開しています…';try{const ev=await createRaw(text);input.value='';status.innerHTML=`公開しました。<a href="?problem=${ev.id}">この問題を見る</a>`;await refresh()}catch(err){console.error(err);status.textContent='公開できませんでした。';showBoyakiAlert('BOYAKIを公開できませんでした。Relayへの接続に失敗しました。通信状態を確認して再試行してください。','公開できませんでした');}finally{$('#submit-btn').disabled=false}});
$('#brand-home').addEventListener('click',e=>{e.preventDefault();showHome()});
$('#refresh').addEventListener('click',refresh);$('#maker-search').addEventListener('input',e=>renderMaker(e.target.value));$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{$$('[data-view]').forEach(x=>x.classList.toggle('active',x===b));$('#feed-view').hidden=b.dataset.view!=='feed';$('#maker-view').hidden=b.dataset.view!=='maker';problemView.hidden=true;$('#composer').hidden=false}));
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});refresh().catch(()=>{status.textContent='読み込めませんでした。更新してください。'});
