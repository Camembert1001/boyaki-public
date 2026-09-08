const DRAFT_KEY='boyaki-private-draft-v53';
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOSTR_ID_RE=/^[0-9a-f]{64}$/i;
let lastPosts=[];
let rendering=false;
let refreshTimer=null;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const short=value=>value?`${value.slice(0,8)}…${value.slice(-6)}`:'';
const fmt=value=>new Date(value).toLocaleString('ja-JP');

async function api(){
  for(let i=0;i<30;i++){
    if(window.BOYAKI_CANONICAL)return window.BOYAKI_CANONICAL;
    await sleep(100);
  }
  throw new Error('canonical_client_missing');
}

function status(text){
  const node=document.querySelector('#status');
  if(node)node.textContent=text;
}
function setChip(chips,label,count){
  let node=[...chips.querySelectorAll('.chip')].find(x=>(x.textContent||'').startsWith(`${label} `));
  if(!node){node=document.createElement('span');node.className='chip';chips.append(node)}
  node.textContent=`${label} ${count}`;
}
function eventLabel(type){return type==='proposal'?'解決案':type==='poster_response'?'投稿者の返答':'追加の質問'}
function eventRole(type){return type==='poster_response'?'original-poster':type==='proposal'?'maker':'questioner'}

function makeThreadForm(type,placeholder,label){
  const form=document.createElement('form');
  form.dataset.form=type==='poster_response'?'poster-response':type;
  form.dataset.canonicalThreadForm='1';
  form.dataset.canonicalEventType=type;
  const input=document.createElement('input');
  input.maxLength=240;
  input.placeholder=placeholder;
  const button=document.createElement('button');
  button.type='submit';button.textContent=label;
  form.append(input,button);
  return form;
}

async function hydrateCanonicalThread(article,post){
  if(!article?.isConnected)return;
  const client=await api();
  const mount=article.querySelector('[data-canonical-thread-mount]');
  if(!mount)return;
  if(window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE!==true){
    mount.replaceChildren();
    const p=document.createElement('p');p.className='hint';p.textContent='スレッド保存経路を確認中です。Nostr Relayには送信しません。';mount.append(p);return;
  }

  let thread={events:[]};
  let access={can_post_as_poster:false,deletable_event_ids:[]};
  try{
    thread=await client.listThread(post.id);
    if(client.identity()){
      try{access=await client.threadAccess(post.id)}catch(err){console.warn('canonical thread access unavailable',err)}
    }
  }catch(err){
    mount.replaceChildren();
    const p=document.createElement('p');p.className='hint';p.textContent=`スレッドを読み込めませんでした: ${String(err?.message||err)}`;mount.append(p);return;
  }

  const events=thread.events||[];
  const deletable=new Set(access.deletable_event_ids||[]);
  const chips=article.querySelector('.chips');
  if(chips){
    setChip(chips,'詳しい情報',events.filter(e=>e.event_type==='clarify').length);
    setChip(chips,'提案',events.filter(e=>e.event_type==='proposal').length);
    setChip(chips,'投稿者の返答',events.filter(e=>e.event_type==='poster_response').length);
  }

  mount.replaceChildren();
  const entry=document.createElement('div');entry.className='thread-role-tabs';entry.dataset.canonicalThreadControls='1';
  const entryHint=document.createElement('p');entryHint.className='hint';entryHint.innerHTML='<strong>このBOYAKIに参加する</strong>';
  const actions=document.createElement('div');actions.className='actions';
  const voice=document.createElement('button');voice.type='button';voice.textContent='Voiceとして入る';voice.dataset.canonicalRole='voice';
  const maker=document.createElement('button');maker.type='button';maker.textContent='Makerとして入る';maker.dataset.canonicalRole='maker';
  const roleStatus=document.createElement('p');roleStatus.className='hint';roleStatus.dataset.canonicalRoleStatus='1';
  actions.append(voice,maker);entry.append(entryHint,actions,roleStatus);mount.append(entry);

  const controls=document.createElement('div');controls.dataset.canonicalThreadForms='1';mount.append(controls);
  const clarifyDetails=document.createElement('details');clarifyDetails.className='clarify';
  const clarifySummary=document.createElement('summary');clarifySummary.textContent='少しだけ詳しくする';
  const clarifyForm=makeThreadForm('clarify','いつ/どこで困る？ 今はどう回避してる？','送る');
  clarifyDetails.append(clarifySummary,clarifyForm);controls.append(clarifyDetails);
  const proposalDetails=document.createElement('details');proposalDetails.className='proposal';
  const proposalSummary=document.createElement('summary');proposalSummary.textContent='解決案を提案する';
  const proposalForm=makeThreadForm('proposal','解決案を短く。勝手に要件を決めない。','提案');
  proposalDetails.append(proposalSummary,proposalForm);controls.append(proposalDetails);

  if(access.can_post_as_poster){
    const posterDetails=document.createElement('details');posterDetails.className='poster-response';
    const summary=document.createElement('summary');summary.textContent='解決する人や、この問題に返事する';
    const form=makeThreadForm('poster_response','どこが良い？違う？何なら試せる？','返事');
    posterDetails.append(summary,form);controls.append(posterDetails);
  }

  const list=document.createElement('div');list.className='thread';list.dataset.canonicalThreadList='1';mount.append(list);
  for(const ev of events){
    const item=document.createElement('div');item.className=`thread-item ${ev.event_type==='proposal'?'proposal-item':ev.event_type==='clarify'?'clarification-unanswered':''}`;
    item.dataset.eventId=ev.id;item.dataset.eventType=`boyaki-${ev.event_type.replace('_','-')}`;item.dataset.actorRole=eventRole(ev.event_type);
    const strong=document.createElement('strong');strong.textContent=eventLabel(ev.event_type);
    item.append(strong,document.createTextNode(` · ${short(ev.author_pubkey)}`),document.createElement('br'),document.createTextNode(ev.content||''));
    if(ev.event_type==='clarify'&&access.can_post_as_poster){
      const answered=events.some(x=>x.event_type==='poster_response'&&x.parent_event_id===ev.id);
      if(!answered){
        const answer=document.createElement('details');answer.className='poster-clarification-answer';
        const s=document.createElement('summary');s.textContent='この質問に答える';
        const form=makeThreadForm('poster_response','質問への答えを一言で','答える');form.dataset.parentEventId=ev.id;
        answer.append(s,form);item.append(answer);
      }else item.classList.add('clarification-answered');
    }
    if(deletable.has(ev.id)){
      const del=document.createElement('button');del.type='button';del.textContent='取り下げ';del.dataset.canonicalThreadDelete=ev.id;
      del.addEventListener('click',async()=>{del.disabled=true;try{await client.deleteThread(ev.id);status('スレッド投稿を取り下げました。');await hydrateCanonicalThread(article,post)}catch(err){status(`取り下げできませんでした: ${String(err?.message||err)}`);del.disabled=false}});
      item.append(del);
    }
    list.append(item);
  }
  if(!events.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='まだ追加質問・解決案・投稿者の返答はありません。';list.append(empty)}

  const roleKey=`boyaki-thread-role:${post.id}`;
  const applyRole=role=>{
    localStorage.setItem(roleKey,role);
    roleStatus.textContent=role==='voice'?'Voiceとして参加中です。困りごとの補足・検証に参加できます。':role==='maker'?'Makerとして参加中です。質問・解決案の提案に参加できます。':'参加する役割を選んでください。';
    clarifyDetails.hidden=!role;
    proposalDetails.hidden=role!=='maker';
  };
  voice.addEventListener('click',()=>applyRole('voice'));maker.addEventListener('click',()=>applyRole('maker'));
  applyRole(localStorage.getItem(roleKey)||'');

  if(mount.dataset.canonicalThreadSubmitBound!=='1'){
    mount.dataset.canonicalThreadSubmitBound='1';
    mount.addEventListener('submit',async e=>{
      const form=e.target;
      if(!(form instanceof HTMLFormElement)||form.dataset.canonicalThreadForm!=='1')return;
      e.preventDefault();e.stopPropagation();
      const input=form.querySelector('input'),text=(input?.value||'').trim();if(!text)return;
      const type=form.dataset.canonicalEventType,parent=form.dataset.parentEventId||null,button=form.querySelector('button');
      button.disabled=true;
      try{
        await client.createThread(post.id,type,text,parent);
        input.value='';status(`${eventLabel(type)}を管理DBへ保存しました。`);await hydrateCanonicalThread(article,post);
      }catch(err){status(`スレッドへ保存できませんでした: ${String(err?.message||err)}（Nostr Relayへは送信していません）`);button.disabled=false}
    });
  }
}

function canonicalCard(post,{detail=false}={}){
  const article=document.createElement('article');
  article.className='card problem-card';
  article.dataset.canonicalPostCard='1';
  article.dataset.canonicalPostId=post.id;
  const meta=document.createElement('div');meta.className='meta';meta.textContent=`${fmt(post.created_at)} · ${short(post.author_pubkey)} · BOYAKI canonical`;article.append(meta);
  const raw=document.createElement('p');raw.className='raw';raw.textContent=post.content||'';article.append(raw);
  const chips=document.createElement('div');chips.className='chips';
  const canonical=document.createElement('span');canonical.className='chip';canonical.textContent='Account単位で管理可能';chips.append(canonical);article.append(chips);
  if(detail){
    const note=document.createElement('p');note.className='hint';note.textContent='この投稿本文と新しいスレッド本文はBOYAKIの管理DBを正本として保存します。Nostr plaintextには新規送信しません。';article.append(note);
    const mount=document.createElement('div');mount.dataset.canonicalThreadMount='1';article.append(mount);
    queueMicrotask(()=>hydrateCanonicalThread(article,post).catch(err=>console.warn('canonical thread hydrate failed',err)));
  }else{
    const actions=document.createElement('div');actions.className='actions';
    const open=document.createElement('a');open.className='button-link';open.href=`?problem=${encodeURIComponent(post.id)}`;open.textContent='このBOYAKIを開く';actions.append(open);article.append(actions);
  }
  const permalink=document.createElement('a');permalink.className='permalink';permalink.rel='nofollow';permalink.href=`?problem=${encodeURIComponent(post.id)}`;permalink.textContent='この問題のURL';article.append(permalink);
  return article;
}

async function applyLegacyControlFilter(client){
  const cards=[...document.querySelectorAll('.problem-card:not([data-canonical-post-card])')];
  const rows=[];
  for(const card of cards){
    const link=card.querySelector('.permalink[href],a[href*="problem="]');if(!link)continue;
    let id='';try{id=new URL(link.href,location.href).searchParams.get('problem')||''}catch{}
    if(NOSTR_ID_RE.test(id))rows.push({id,card});
  }
  if(!rows.length)return;
  try{
    const result=await client.legacyControls(rows.map(x=>x.id));
    const states=new Map((result.controls||[]).map(x=>[x.nostr_event_id,x.status]));
    for(const row of rows){const state=states.get(row.id);if(state&&state!=='active')row.card.remove()}
  }catch(err){console.warn('legacy control filter unavailable',err)}
}

function renderDetailIfNeeded(){
  const id=new URLSearchParams(location.search).get('problem')||'';if(!UUID_RE.test(id))return false;
  const post=lastPosts.find(x=>x.id===id),view=document.querySelector('#problem-view');if(!view)return false;
  view.replaceChildren();
  const head=document.createElement('div');head.className='section-head';
  const label=document.createElement('div');const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='この問題のページ';const title=document.createElement('h2');title.textContent='困りごと';label.append(eyebrow,title);
  const back=document.createElement('button');back.type='button';back.textContent='一覧へ';back.addEventListener('click',()=>{history.replaceState(null,'',location.pathname);location.reload()});
  head.append(label,back);view.append(head);
  if(post)view.append(canonicalCard(post,{detail:true}));else{const missing=document.createElement('div');missing.className='card';missing.textContent='このBOYAKIは削除済みか、公開されていません。';view.append(missing)}
  view.hidden=false;const feedView=document.querySelector('#feed-view');if(feedView)feedView.hidden=true;const makerView=document.querySelector('#maker-view');if(makerView)makerView.hidden=true;const composer=document.querySelector('#composer');if(composer)composer.hidden=true;return true;
}

async function renderHybrid(){
  if(rendering)return;rendering=true;
  try{
    const client=await api();if(window.BOYAKI_CANONICAL_BACKEND_READY!==true)return;
    const result=await client.listPosts(100);lastPosts=result.posts||[];
    if(renderDetailIfNeeded())return;
    const feed=document.querySelector('#feed');if(feed){feed.querySelectorAll('[data-canonical-post-card]').forEach(x=>x.remove());for(const post of [...lastPosts].reverse())feed.prepend(canonicalCard(post))}
    await applyLegacyControlFilter(client);
  }catch(err){console.warn('canonical feed unavailable',err)}finally{rendering=false}
}
function scheduleHybrid(delay=120){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>renderHybrid(),delay)}

async function activate(){
  try{
    const client=await api();
    const ready=await client.initialize();
    window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE=ready===true;
    if(!ready){window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE=false;return}
    const threadReady=await client.initializeThreads();
    window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE=threadReady===true;
    document.addEventListener('click',async e=>{
      const button=e.target?.closest?.('[data-v53-publish="1"]');if(!button||window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE!==true)return;
      e.preventDefault();e.stopImmediatePropagation();
      let draft=null;try{draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')}catch{}
      const text=(draft?.raw||document.querySelector('#raw')?.value||'').trim();if(!text)return;
      button.disabled=true;button.textContent='公開処理中…';status('BOYAKIの管理DBへ公開しています…');
      try{
        const result=await client.createPost(text);localStorage.removeItem(DRAFT_KEY);
        const panel=document.querySelector('#private-chat-v53');if(panel){panel.hidden=true;panel.replaceChildren()}
        const input=document.querySelector('#raw');if(input)input.value='';window.BOYAKI_STAGING_LAST_PUBLISH_ERROR='';status('公開しました。Account単位で管理できるBOYAKIとして保存されました。');await renderHybrid();if(result?.post?.id)history.replaceState(null,'',location.pathname);
      }catch(err){const code=String(err?.message||err||'unknown_error');window.BOYAKI_STAGING_LAST_PUBLISH_ERROR=code;console.error('canonical publish failed',err);status(`公開できませんでした。E2E診断: ${code}（下書きはこの端末に残っています）`);button.disabled=false;button.textContent='解決候補として公開する'}
    },true);
    const feed=document.querySelector('#feed');if(feed)new MutationObserver(()=>{if(!rendering&&lastPosts.length&&!feed.querySelector('[data-canonical-post-card]'))scheduleHybrid(200)}).observe(feed,{childList:true});
    document.querySelector('#refresh')?.addEventListener('click',()=>scheduleHybrid(1200));
    await renderHybrid();
  }catch(err){
    console.error('canonical cutover activation failed',err);
    window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE=false;
    window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE=false;
  }
}
activate();