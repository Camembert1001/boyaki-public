import { demandFeedChips, hydrateDemandEvidence } from './demand-ui.js?v=20260920-consolidated-v2';
import { hydrateCanonicalThread } from './thread-ui.js?v=20260920-consolidated-v2';
const DRAFT_KEY='boyaki-private-draft-v53';
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOSTR_ID_RE=/^[0-9a-f]{64}$/i;
let lastPosts=[];
let ownedIds=new Set();
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

const hydrateThread=(article,post)=>hydrateCanonicalThread(article,post,{getClient:api,setStatus:status,shorten:short});

function canonicalCard(post,{detail=false}={}){
  const article=document.createElement('article');
  article.className='card problem-card';
  article.dataset.canonicalPostCard='1';
  article.dataset.canonicalPostId=post.id;
  const meta=document.createElement('div');meta.className='meta';
  meta.textContent=post.source_withdrawn
    ?`${fmt(post.created_at)} · みんなで解く困りごと · 元BOYAKIは取り下げ済み`
    :`${fmt(post.created_at)} · ${short(post.author_pubkey)}`;
  article.append(meta);

  const raw=document.createElement('p');raw.className='raw';raw.textContent=post.content||'';article.append(raw);

  if(post.shared_problem&&!post.source_withdrawn&&post.problem_statement){
    const problem=document.createElement('div');problem.className='candidate-block';problem.dataset.sharedProblemSummary='1';
    const heading=document.createElement('strong');heading.textContent='みんなで残す困りごと';
    const statement=document.createElement('p');statement.textContent=post.problem_statement;
    const note=document.createElement('p');note.className='hint';note.textContent='元のBOYAKI本文は投稿者が取り下げられます。この困りごとは、同じことで困る人が集まる入口として残ります。';
    problem.append(heading,statement,note);article.append(problem);
  }

  const chips=document.createElement('div');chips.className='chips';
  if(post.shared_problem){const shared=document.createElement('span');shared.className='chip';shared.textContent='一緒に解決中';chips.append(shared)}
  if(post.source_withdrawn){const withdrawn=document.createElement('span');withdrawn.className='chip';withdrawn.textContent='元文取り下げ済み';chips.append(withdrawn)}
  demandFeedChips(chips,post.demand_summary);article.append(chips);

  if(detail){
    const note=document.createElement('p');note.className='hint';
    note.textContent=post.source_withdrawn
      ?'元の個人的なBOYAKI本文は取り下げ済みです。残した困りごとと、そこでの会話・解決・Productは続いています。'
      :'このBOYAKIについて話し合えます。';
    article.append(note);
    const mount=document.createElement('div');mount.dataset.canonicalThreadMount='1';article.append(mount);
    queueMicrotask(()=>hydrateDemandEvidence(article,post,api).catch(err=>console.warn('demand evidence hydrate failed',err)));
    queueMicrotask(()=>hydrateThread(article,post).catch(err=>console.warn('canonical thread hydrate failed',err)));
  }else{
    const actions=document.createElement('div');actions.className='actions';
    const open=document.createElement('a');open.className='button-link';open.href=`?problem=${encodeURIComponent(post.id)}`;open.textContent=post.source_withdrawn?'この困りごとを開く':'このBOYAKIを開く';actions.append(open);article.append(actions);
  }

  if(ownedIds.has(post.id)){
    const actions=document.createElement('div');actions.className='actions';
    const del=document.createElement('button');del.type='button';
    del.textContent=post.shared_problem?'元のBOYAKI文を取り下げる':'自分の投稿を削除';
    del.dataset.canonicalPostDelete=post.id;
    del.addEventListener('click',async()=>{
      del.disabled=true;
      try{
        const result=await(await api()).deletePost(post.id);
        status(result.thread_preserved
          ?'元のBOYAKI本文を取り下げました。みんなで残した困りごと・他の参加者の会話・解決・Productは残ります。'
          :'BOYAKIと話し合いを削除しました。');
        await renderHybrid();
      }catch(err){status(`削除できませんでした: ${String(err.message)}`);del.disabled=false}
    });
    actions.append(del);article.append(actions);
  }
  const permalink=document.createElement('a');permalink.className='permalink';permalink.rel='nofollow';permalink.href=`?problem=${encodeURIComponent(post.id)}`;permalink.textContent=post.shared_problem?'この困りごとのURL':'この問題のURL';article.append(permalink);
  return article;
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
    const [result,mine]=await Promise.all([client.listPosts(100),client.listMine()]);lastPosts=result.posts||[];ownedIds=new Set((mine.posts||[]).filter(p=>p.status==='active').map(p=>p.id));
    if(renderDetailIfNeeded())return;
    const feed=document.querySelector('#feed');if(feed){feed.replaceChildren();for(const post of lastPosts)feed.append(canonicalCard(post));if(!lastPosts.length)feed.textContent='まだBOYAKIがありません。'}
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
      let draft=null;try{draft=JSON.parse(window.BOYAKI_STORAGE.local.getItem(DRAFT_KEY)||'null')}catch{}
      const text=(draft?.raw||document.querySelector('#raw')?.value||'').trim();if(!text)return;
      button.disabled=true;button.textContent='公開処理中…';status('BOYAKIを公開しています…');
      try{
        const result=await client.createPost(text);window.BOYAKI_STORAGE.local.removeItem(DRAFT_KEY);
        const panel=document.querySelector('#private-chat-v53');if(panel){panel.hidden=true;panel.replaceChildren()}
        const input=document.querySelector('#raw');if(input)input.value='';window.BOYAKI_AI_STAGING_LAST_PUBLISH_ERROR='';status('公開しました。自分の投稿は画面から削除できます。');await renderHybrid();if(result?.post?.id)history.replaceState(null,'',location.pathname);
      }catch(err){const code=String(err?.message||err||'unknown_error');window.BOYAKI_AI_STAGING_LAST_PUBLISH_ERROR=code;console.error('canonical publish failed',err);status('公開できませんでした。下書きはこの端末に残っています。');button.disabled=false;button.textContent='このBOYAKIを公開する'}
    },true);
    const feed=document.querySelector('#feed');if(feed)new MutationObserver(()=>{if(!rendering&&lastPosts.length&&!feed.querySelector('[data-canonical-post-card]'))scheduleHybrid(200)}).observe(feed,{childList:true});
    window.addEventListener('boyaki-feed-refresh',()=>scheduleHybrid(0));
    document.querySelector('#refresh')?.addEventListener('click',()=>scheduleHybrid(1200));
    await renderHybrid();
  }catch(err){
    console.error('canonical cutover activation failed',err);
    window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE=false;
    window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE=false;
  }
}
activate();