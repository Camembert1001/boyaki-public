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

function canonicalCard(post,{detail=false}={}){
  const article=document.createElement('article');
  article.className='card problem-card';
  article.dataset.canonicalPostCard='1';
  article.dataset.canonicalPostId=post.id;

  const meta=document.createElement('div');
  meta.className='meta';
  meta.textContent=`${fmt(post.created_at)} · ${short(post.author_pubkey)} · BOYAKI canonical`;
  article.append(meta);

  const raw=document.createElement('p');
  raw.className='raw';
  raw.textContent=post.content||'';
  article.append(raw);

  const chips=document.createElement('div');
  chips.className='chips';
  const canonical=document.createElement('span');
  canonical.className='chip';
  canonical.textContent='Account単位で管理可能';
  chips.append(canonical);
  article.append(chips);

  if(detail){
    const note=document.createElement('p');
    note.className='hint';
    note.textContent='この投稿本文はBOYAKIの管理DBを正本として保存されています。スレッド機能は現在DB経路へ移行中です。';
    article.append(note);
  }else{
    const actions=document.createElement('div');
    actions.className='actions';
    const open=document.createElement('a');
    open.className='button-link';
    open.href=`?problem=${encodeURIComponent(post.id)}`;
    open.textContent='このBOYAKIを開く';
    actions.append(open);
    article.append(actions);
  }

  const permalink=document.createElement('a');
  permalink.className='permalink';
  permalink.rel='nofollow';
  permalink.href=`?problem=${encodeURIComponent(post.id)}`;
  permalink.textContent='この問題のURL';
  article.append(permalink);
  return article;
}

async function applyLegacyControlFilter(client){
  const cards=[...document.querySelectorAll('.problem-card:not([data-canonical-post-card])')];
  const rows=[];
  for(const card of cards){
    const link=card.querySelector('.permalink[href],a[href*="problem="]');
    if(!link)continue;
    let id='';
    try{id=new URL(link.href,location.href).searchParams.get('problem')||''}catch{}
    if(NOSTR_ID_RE.test(id))rows.push({id,card});
  }
  if(!rows.length)return;
  try{
    const result=await client.legacyControls(rows.map(x=>x.id));
    const states=new Map((result.controls||[]).map(x=>[x.nostr_event_id,x.status]));
    for(const row of rows){
      const state=states.get(row.id);
      if(state&&state!=='active')row.card.remove();
    }
  }catch(err){console.warn('legacy control filter unavailable',err)}
}

function renderDetailIfNeeded(){
  const id=new URLSearchParams(location.search).get('problem')||'';
  if(!UUID_RE.test(id))return false;
  const post=lastPosts.find(x=>x.id===id);
  const view=document.querySelector('#problem-view');
  if(!view)return false;
  view.replaceChildren();
  const head=document.createElement('div');
  head.className='section-head';
  const label=document.createElement('div');
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='この問題のページ';
  const title=document.createElement('h2');title.textContent='困りごと';
  label.append(eyebrow,title);
  const back=document.createElement('button');back.type='button';back.textContent='一覧へ';
  back.addEventListener('click',()=>{history.replaceState(null,'',location.pathname);location.reload()});
  head.append(label,back);view.append(head);
  if(post)view.append(canonicalCard(post,{detail:true}));
  else{const missing=document.createElement('div');missing.className='card';missing.textContent='このBOYAKIは削除済みか、公開されていません。';view.append(missing)}
  view.hidden=false;
  const feedView=document.querySelector('#feed-view');if(feedView)feedView.hidden=true;
  const makerView=document.querySelector('#maker-view');if(makerView)makerView.hidden=true;
  const composer=document.querySelector('#composer');if(composer)composer.hidden=true;
  return true;
}

async function renderHybrid(){
  if(rendering)return;
  rendering=true;
  try{
    const client=await api();
    if(window.BOYAKI_CANONICAL_BACKEND_READY!==true)return;
    const result=await client.listPosts(100);
    lastPosts=result.posts||[];
    if(renderDetailIfNeeded())return;
    const feed=document.querySelector('#feed');
    if(feed){
      feed.querySelectorAll('[data-canonical-post-card]').forEach(x=>x.remove());
      for(const post of [...lastPosts].reverse())feed.prepend(canonicalCard(post));
    }
    await applyLegacyControlFilter(client);
  }catch(err){console.warn('canonical feed unavailable',err)}finally{rendering=false}
}

function scheduleHybrid(delay=120){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>renderHybrid(),delay);
}

async function activate(){
  try{
    const client=await api();
    const ready=await client.initialize();
    window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE=ready===true;
    window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE=false;
    if(!ready)return;

    document.addEventListener('click',async e=>{
      const button=e.target?.closest?.('[data-v53-publish="1"]');
      if(!button||window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE!==true)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      let draft=null;
      try{draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')}catch{}
      const text=(draft?.raw||document.querySelector('#raw')?.value||'').trim();
      if(!text)return;
      button.disabled=true;
      button.textContent='公開処理中…';
      status('BOYAKIの管理DBへ公開しています…');
      try{
        const result=await client.createPost(text);
        localStorage.removeItem(DRAFT_KEY);
        const panel=document.querySelector('#private-chat-v53');
        if(panel){panel.hidden=true;panel.replaceChildren()}
        const input=document.querySelector('#raw');if(input)input.value='';
        status('公開しました。Account単位で管理できるBOYAKIとして保存されました。');
        await renderHybrid();
        if(result?.post?.id)history.replaceState(null,'',location.pathname);
      }catch(err){
        console.error('canonical publish failed',err);
        status('公開できませんでした。下書きはこの端末に残っています。');
        button.disabled=false;
        button.textContent='解決候補として公開する';
      }
    },true);

    const feed=document.querySelector('#feed');
    if(feed)new MutationObserver(()=>{
      if(!rendering&&lastPosts.length&&!feed.querySelector('[data-canonical-post-card]'))scheduleHybrid(200);
      else if(!rendering)scheduleHybrid(350);
    }).observe(feed,{childList:true});
    document.querySelector('#refresh')?.addEventListener('click',()=>scheduleHybrid(1200));
    await renderHybrid();
  }catch(err){
    console.error('canonical root cutover activation failed',err);
    window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE=false;
  }
}

activate();
