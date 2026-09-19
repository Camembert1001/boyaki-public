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
  let access={can_post_as_poster:false,deletable_event_ids:[],room_invitations:[],my_invitation:null};
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
    item.dataset.eventId=ev.id;item.dataset.eventType=`boyaki-${ev.event_type.replace('_','-')}`;item.dataset.actorRole=ev.participant_role||eventRole(ev.event_type);
    const strong=document.createElement('strong');strong.textContent=eventLabel(ev.event_type);
    const roleText=ev.participant_role?` · ${ev.participant_role==='voice'?'Voice':'Maker'}`:'';
    item.append(strong,document.createTextNode(`${roleText} · ${short(ev.author_pubkey)}`),document.createElement('br'),document.createTextNode(ev.content||''));
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

  try{
    const published=await client.listPostProducts(post.id),products=published.products||[];
    if(products.length){
      const productSection=document.createElement('section');productSection.className='participation-panel thread-products';productSection.dataset.threadProducts='1';
      const heading=document.createElement('h3');heading.textContent='この話し合いから生まれたプロダクト';
      const intro=document.createElement('p');intro.className='hint';intro.textContent='MakerがこのスレッドのSolution Roomで作り、元の会話へ掲載したプロダクトです。';
      productSection.append(heading,intro);
      for(const product of products){
        const card=document.createElement('div');card.className='candidate-block';
        const title=document.createElement('strong');title.textContent=product.title;
        const desc=document.createElement('p');desc.textContent=product.description||'';
        const meta=document.createElement('p');meta.className='hint';meta.textContent=`${yen(product.price_yen)} · Maker: ${product.maker?.display_name||short(product.maker_account_pubkey)} · ${product.sold_count||0}件購入`;
        const productActions=document.createElement('div');productActions.className='actions';
        const open=document.createElement('a');open.className='button-link';open.href=`./product.html?id=${encodeURIComponent(product.id)}`;open.textContent='プロダクトを見る';
        productActions.append(open);card.append(title,desc,meta,productActions);productSection.append(card);
      }
      mount.append(productSection);
    }
  }catch(err){console.warn('thread product hydrate failed',err)}

  if(access.current_role==='maker'){
    const voiceMap=new Map();
    for(const ev of events){
      if(ev.participant_role!=='voice'||!ev.owner_account_pubkey||ev.owner_account_pubkey===access.actor_pubkey)continue;
      if(!voiceMap.has(ev.owner_account_pubkey))voiceMap.set(ev.owner_account_pubkey,ev);
    }
    const invitePanel=document.createElement('div');invitePanel.className='participation-panel';invitePanel.dataset.roomInvitePanel='1';
    const h=document.createElement('h3');h.textContent='VoiceをSolution Roomへ招待';
    const hint=document.createElement('p');hint.className='hint';
    hint.textContent=access.problem_statement
      ?'共有Problemができています。スレッドで話したVoiceの中から、一緒に解決を具体化したい人を招待できます。'
      :'まず元のBOYAKI投稿者に招待を送り、共同解決フェーズへ進む同意を取ります。ここでは投稿者自身の原文と、残る共有Problemを分けます。';
    invitePanel.append(h,hint);
    const inviteByVoice=new Map((access.room_invitations||[]).map(x=>[x.invitee_account_pubkey,x]));
    const sourceInvite=(access.room_invitations||[]).find(x=>x.invitee_context==='source_owner');

    if(!access.problem_statement){
      const sourceRow=document.createElement('div');sourceRow.className='thread-item';
      const label=document.createElement('strong');label.textContent='元のBOYAKI投稿者';
      const invite=document.createElement('button');invite.type='button';
      if(sourceInvite){
        invite.disabled=true;invite.textContent=sourceInvite.status==='accepted'?'同意済み':'招待済み';
      }else if(!access.source_owner_has_account){
        invite.disabled=true;invite.textContent='Account連携待ち';
      }else if(!access.source_owner_invitable){
        invite.disabled=true;invite.textContent='招待できません';
      }else{
        invite.textContent='共同解決へ招待';
        invite.addEventListener('click',async()=>{
          invite.disabled=true;invite.textContent='招待中…';
          try{
            await client.inviteSourceOwnerToSolutionRoom(post.id);
            status('元のBOYAKI投稿者へSolution Room招待を送りました。');
            await hydrateCanonicalThread(article,post);
          }catch(err){
            console.error('source owner room invite failed',err);
            status(`招待できませんでした: ${String(err?.message||err)}`);
            invite.disabled=false;invite.textContent='共同解決へ招待';
          }
        });
      }
      sourceRow.append(label,document.createTextNode(' '),invite);invitePanel.append(sourceRow);
      if(!access.source_owner_has_account){
        const note=document.createElement('p');note.className='hint';
        note.textContent='元投稿者が匿名/端末だけの状態では共同資産化しません。Accountに紐づいてから初めて同意を取れます。';
        invitePanel.append(note);
      }
    }

    for(const [pubkey,ev] of voiceMap){
      const row=document.createElement('div');row.className='thread-item';
      const name=document.createElement('strong');name.textContent=ev.display_name||`Voice ${short(pubkey)}`;
      const current=inviteByVoice.get(pubkey);
      const invite=document.createElement('button');invite.type='button';
      if(current){
        invite.disabled=true;invite.textContent=current.status==='accepted'?'参加済み':'招待済み';
      }else if(!access.problem_statement){
        invite.disabled=true;invite.textContent='元投稿者の同意後に招待';
      }else{
        invite.textContent='Solution Roomへ招待';
        invite.addEventListener('click',async()=>{
          invite.disabled=true;invite.textContent='招待中…';
          try{
            await client.inviteVoiceToSolutionRoom(post.id,ev.id);
            status('VoiceをSolution Roomへ招待しました。');
            await hydrateCanonicalThread(article,post);
          }catch(err){
            console.error('room invite failed',err);
            status(`招待できませんでした: ${String(err?.message||err)}`);
            invite.disabled=false;invite.textContent='Solution Roomへ招待';
          }
        });
      }
      row.append(name,document.createTextNode(' '),invite);invitePanel.append(row);
    }
    mount.append(invitePanel);
  }

  if(access.problem_statement){
    const shared=document.createElement('div');shared.className='participation-panel';shared.dataset.sharedProblem='1';
    const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent='Shared Problem';
    const title=document.createElement('h3');title.textContent='共同解決の対象';
    const statement=document.createElement('p');statement.className='raw';statement.textContent=access.problem_statement.statement;
    const note=document.createElement('p');note.className='hint';note.textContent='元のBOYAKI本文が取り下げられても、この一般化Problemを入口に同じ痛みを持つVoiceが後から参加できます。';
    shared.append(eyebrow,title,statement,note);mount.append(shared);
  }

  const solutionStep=document.createElement('div');
  solutionStep.className='participation-panel';
  solutionStep.dataset.solutionRoomTransition='1';
  const solutionTitle=document.createElement('p');solutionTitle.className='hint';solutionTitle.innerHTML='<strong>Solution Room</strong>';
  const solutionHint=document.createElement('p');solutionHint.className='hint';
  const solutionActions=document.createElement('div');solutionActions.className='actions';

  if(access.my_invitation?.status==='pending'){
    const isSourceOwnerInvite=access.my_invitation.invitee_context==='source_owner';
    if(isSourceOwnerInvite&&!access.problem_statement){
      solutionHint.textContent='ここから共同解決フェーズです。あなたの元のBOYAKI文は後から取り下げられますが、個人情報を除いて一般化した「Problem」、他の参加者の発言、Solution、Productは残る場合があります。';
      const consent=document.createElement('div');consent.className='candidate-block';consent.dataset.problemConsent='1';
      const label=document.createElement('label');label.textContent='残してよい「困りごと」だけを、個人名・会社名・固有事情を外して1文にしてください';
      const textarea=document.createElement('textarea');textarea.rows=3;textarea.minLength=10;textarea.maxLength=300;textarea.placeholder='例: 複数システム間の定型的な手動転記に毎日時間を取られる';
      label.append(textarea);
      const checkLabel=document.createElement('label');checkLabel.className='hint';
      const check=document.createElement('input');check.type='checkbox';
      checkLabel.append(check,document.createTextNode(' 元のBOYAKI本文は取り下げ可能だが、この一般化Problemと共同成果は残ることを理解した'));
      const accept=document.createElement('button');accept.type='button';accept.disabled=true;accept.textContent='同意してSolution Roomへ入る';
      const sync=()=>{accept.disabled=textarea.value.trim().length<10||!check.checked};
      textarea.addEventListener('input',sync);check.addEventListener('change',sync);
      accept.addEventListener('click',async()=>{
        accept.disabled=true;accept.textContent='共同解決フェーズへ移行中…';
        try{
          const result=await client.acceptSolutionRoomInvitation(access.my_invitation.id,textarea.value.trim(),true);
          const roomId=result?.invitation?.room_id||access.solution_room_id;if(!roomId)throw Error('solution_room_id_missing');
          location.href=`./solution-room.html?room=${encodeURIComponent(roomId)}`;
        }catch(err){
          console.error('accept source owner invite failed',err);
          status(`移行できませんでした: ${String(err?.message||err)}`);
          accept.textContent='同意してSolution Roomへ入る';sync();
        }
      });
      consent.append(label,checkLabel,accept);solutionActions.append(consent);
    }else if(!access.problem_statement){
      solutionHint.textContent='Makerから招待されています。元のBOYAKI投稿者が共有Problemへの移行に同意すると参加できます。';
    }else{
      solutionHint.textContent=`Makerから、この共有Problemの解決を一緒に詰めるSolution Roomへ招待されています。\nProblem: ${access.problem_statement.statement}`;
      const accept=document.createElement('button');accept.type='button';accept.textContent='招待を受けてSolution Roomへ入る';
      accept.addEventListener('click',async()=>{
        accept.disabled=true;accept.textContent='参加中…';
        try{
          const result=await client.acceptSolutionRoomInvitation(access.my_invitation.id);
          const roomId=result?.invitation?.room_id||access.solution_room_id;if(!roomId)throw Error('solution_room_id_missing');
          location.href=`./solution-room.html?room=${encodeURIComponent(roomId)}`;
        }catch(err){
          console.error('accept room invite failed',err);
          status(`招待を受けられませんでした: ${String(err?.message||err)}`);
          accept.disabled=false;accept.textContent='招待を受けてSolution Roomへ入る';
        }
      });
      solutionActions.append(accept);
    }
  }else if(access.my_invitation?.status==='accepted'&&access.solution_room_id){
    solutionHint.textContent='このスレッドから招待されたSolution Roomに参加中です。';
    const open=document.createElement('a');open.className='button-link';open.href=`./solution-room.html?room=${encodeURIComponent(access.solution_room_id)}`;open.textContent='Solution Roomへ戻る';solutionActions.append(open);
  }else if(access.current_role==='maker'){
    solutionHint.textContent='スレッドで話したVoiceを招待し、ここから具体的な解決づくりへ進めます。';
    if(access.solution_room_id){
      const open=document.createElement('a');open.className='button-link';open.href=`./solution-room.html?room=${encodeURIComponent(access.solution_room_id)}`;open.textContent='Solution Roomを開く';solutionActions.append(open);
    }else{
      const create=document.createElement('button');create.type='button';create.textContent='Solution Roomを作る';
      create.addEventListener('click',async()=>{
        create.disabled=true;create.textContent='作成中…';
        try{
          const result=await client.ensureSolutionRoom(post.id),roomId=result?.room?.id;if(!roomId)throw Error('solution_room_id_missing');
          location.href=`./solution-room.html?room=${encodeURIComponent(roomId)}`;
        }catch(err){console.error('solution room create failed',err);status(`Roomを作成できませんでした: ${String(err?.message||err)}`);create.disabled=false;create.textContent='Solution Roomを作る'}
      });
      solutionActions.append(create);
    }
  }else if(client.identity()){
    solutionHint.textContent='Voiceとしてスレッドで話したあと、Makerから招待されるとSolution Roomへ参加できます。';
  }else{
    solutionHint.textContent='ログインしてVoice / Makerとしてスレッドに参加できます。';
    const login=document.createElement('a');login.className='button-link';login.href='./mypage.html';login.textContent='ログイン';solutionActions.append(login);
  }
  solutionStep.append(solutionTitle,solutionHint,solutionActions);
  mount.append(solutionStep);

  const roleKey=`boyaki-thread-role:${post.id}`;
  const applyRole=role=>{
    window.BOYAKI_STORAGE.local.setItem(roleKey,role);
    roleStatus.textContent=role==='voice'?'Voiceとして参加中です。困りごとの補足・検証に参加できます。':role==='maker'?'Makerとして参加中です。質問・解決案の提案に参加できます。':'参加する役割を選んでください。';
    clarifyDetails.hidden=!role;
    proposalDetails.hidden=role!=='maker';
  };
  voice.addEventListener('click',()=>applyRole('voice'));maker.addEventListener('click',()=>applyRole('maker'));
  applyRole(window.BOYAKI_STORAGE.local.getItem(roleKey)||access.current_role||'');

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
        const selectedRole=window.BOYAKI_STORAGE.local.getItem(roleKey)||access.current_role||'';
        const extra=type==='poster_response'?{}:(['voice','maker'].includes(selectedRole)?{participant_role:selectedRole}:{});
        await client.createThread(post.id,type,text,parent,extra);
        input.value='';status(`${eventLabel(type)}を管理DBへ保存しました。`);await hydrateCanonicalThread(article,post);
      }catch(err){status(`スレッドへ保存できませんでした: ${String(err?.message||err)}（Nostr Relayへは送信していません）`);button.disabled=false}
    });
  }
}

function yen(value){const n=Number(value);return Number.isFinite(n)&&n>0?new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n):''}
function demandFeedChips(chips,summary){
 if(!chips)return;
 chips.querySelectorAll('[data-demand-feed-chip]').forEach(x=>x.remove());
 const s=summary?.signals?{
  same_problem:summary.signals.same_problem?.count||0,
  would_try:summary.signals.would_try?.count||0,
  would_pay:summary.signals.would_pay?.count||0,
  median_yen:summary.signals.would_pay?.median_yen||null
 }:(summary||{});
 for(const [label,value] of [['同じ悩み',s.same_problem],['試したい',s.would_try],['払ってもいい',s.would_pay]]){
  if(Number(value)>0){const node=document.createElement('span');node.className='chip';node.dataset.demandFeedChip='1';node.textContent=`${label} ${value}`;chips.append(node)}
 }
 if(Number(s.median_yen)>0){const node=document.createElement('span');node.className='chip';node.dataset.demandFeedChip='1';node.textContent=`支払中央値 ${yen(s.median_yen)}`;chips.append(node)}
}
async function hydrateDemandEvidence(article,post){
 const client=await api();
 const host=document.createElement('section');host.className='participation-panel demand-evidence';host.dataset.demandEvidence='1';
 const title=document.createElement('h3');title.textContent='需要の証拠';
 const intro=document.createElement('p');intro.className='hint';intro.textContent='「同じ悩み」「試したい」「この条件なら払える」を集めます。購入予約や決済ではなく、Makerが解く価値を判断するための需要シグナルです。';
 const stats=document.createElement('div');stats.className='demand-ladder';
 const statusNode=document.createElement('p');statusNode.className='hint';statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');
 host.append(title,intro,stats,statusNode);
 const threadMount=article.querySelector('[data-canonical-thread-mount]');
 if(threadMount)article.insertBefore(host,threadMount);else article.append(host);

 let aggregate=null,mine=null;
 const renderStats=()=>{
  stats.replaceChildren();
  const signals=aggregate?.signals||{};
  const items=[
   ['同じことで困ってる',signals.same_problem?.count||0],
   ['解決したら試したい',signals.would_try?.count||0],
   ['この条件なら払える',signals.would_pay?.count||0]
  ];
  for(const [label,count] of items){const chip=document.createElement('span');chip.className=`step${count?' on':''}`;chip.textContent=`${label} ${count}`;stats.append(chip)}
  const pay=signals.would_pay||{};
  if(pay.count>0&&pay.median_yen){const chip=document.createElement('span');chip.className='step on';chip.textContent=`支払中央値 ${yen(pay.median_yen)}`;stats.append(chip)}
 };
 const reload=async()=>{
  const jobs=[client.getDemand(post.id)];
  const id=client.identity();
  if(id)jobs.push(client.getMyDemand(post.id));
  const out=await Promise.all(jobs);
  aggregate=out[0];mine=out[1]||{signals:[],is_source_author:false};
  renderStats();
 };
 try{await reload()}catch(err){console.error('demand evidence load failed',err);statusNode.textContent='需要シグナルを読み込めませんでした。';return}

 if(mine?.is_source_author){
  statusNode.textContent='投稿者本人のシグナルは需要数に含めません。外部の需要だけを観測します。';
 }else{
  const mineMap=new Map((mine?.signals||[]).map(x=>[x.signal,x]));
  const actionBox=document.createElement('div');actionBox.className='actions';
  const toggle=async(signal,label,button)=>{
    button.disabled=true;statusNode.textContent='需要シグナルを更新しています…';
    try{
      if(mineMap.has(signal))await client.deleteDemand(post.id,signal);
      else await client.saveDemand(post.id,signal);
      await reload();mineMap.clear();for(const x of mine.signals||[])mineMap.set(x.signal,x);
      button.textContent=mineMap.has(signal)?`${label} ✓ 取り消す`:label;
      statusNode.textContent='需要シグナルを更新しました。';
      demandFeedChips(article.querySelector('.chips'),aggregate);
    }catch(err){console.error('demand signal update failed',err);statusNode.textContent='更新できませんでした。再試行してください。'}
    finally{button.disabled=false}
  };
  for(const [signal,label] of [['same_problem','同じことで困ってる'],['would_try','解決したら試したい']]){
    const button=document.createElement('button');button.type='button';button.textContent=mineMap.has(signal)?`${label} ✓ 取り消す`:label;
    button.addEventListener('click',()=>toggle(signal,label,button));actionBox.append(button);
  }
  host.append(actionBox);

  const payTitle=document.createElement('p');payTitle.className='hint';payTitle.innerHTML='<strong>支払意思を条件つきで残す</strong><br>「何が実現したら」「1回いくらまで」をセットで残します。条件と金額は匿名の需要証拠として表示されます。';
  const payForm=document.createElement('form');payForm.className='maker-form';payForm.dataset.demandPayForm='1';
  const amountLabel=document.createElement('label');amountLabel.textContent='上限金額（円）';
  const amount=document.createElement('input');amount.type='number';amount.min='1';amount.max='1000000';amount.step='1';amount.inputMode='numeric';amount.required=true;amount.placeholder='例: 500';
  const conditionLabel=document.createElement('label');conditionLabel.textContent='成立条件';
  const condition=document.createElement('input');condition.maxLength=160;condition.required=true;condition.placeholder='例: 二重入力が完全になくなるなら';
  const payActions=document.createElement('div');payActions.className='actions';
  const save=document.createElement('button');save.type='submit';
  const remove=document.createElement('button');remove.type='button';remove.textContent='支払意思を取り消す';
  const refreshPayState=()=>{
    const row=(mine?.signals||[]).find(x=>x.signal==='would_pay');
    if(row){amount.value=row.amount_yen||'';condition.value=row.condition_text||'';save.textContent='支払条件を更新';remove.hidden=false}
    else{amount.value='';condition.value='';save.textContent='この条件なら払える';remove.hidden=true}
  };
  refreshPayState();
  payActions.append(save,remove);amountLabel.append(amount);conditionLabel.append(condition);payForm.append(amountLabel,conditionLabel,payActions);
  payForm.addEventListener('submit',async e=>{
    e.preventDefault();const value=Number(amount.value),text=condition.value.trim();
    if(!Number.isInteger(value)||value<1||value>1000000){statusNode.textContent='金額は1〜1,000,000円の整数で入力してください。';return}
    if(!text){statusNode.textContent='「何が実現したら払えるか」を入力してください。';return}
    save.disabled=true;statusNode.textContent='支払意思を保存しています…';
    try{await client.saveDemand(post.id,'would_pay',{amount_yen:value,condition_text:text});await reload();demandFeedChips(article.querySelector('.chips'),aggregate);statusNode.textContent='支払意思を保存しました。購入予約ではありません。';refreshPayState();renderConditions()}
    catch(err){console.error('payment demand save failed',err);statusNode.textContent='支払意思を保存できませんでした。'}
    finally{save.disabled=false}
  });
  remove.addEventListener('click',async()=>{
    remove.disabled=true;statusNode.textContent='支払意思を取り消しています…';
    try{await client.deleteDemand(post.id,'would_pay');await reload();demandFeedChips(article.querySelector('.chips'),aggregate);statusNode.textContent='支払意思を取り消しました。';refreshPayState();renderConditions()}
    catch(err){console.error('payment demand delete failed',err);statusNode.textContent='取り消せませんでした。'}
    finally{remove.disabled=false}
  });
  host.append(payTitle,payForm);
 }

 const conditions=document.createElement('div');conditions.className='stack';conditions.dataset.demandConditions='1';host.append(conditions);
 function renderConditions(){
  conditions.replaceChildren();
  const rows=aggregate?.pay_conditions||[];
  if(!rows.length)return;
  const head=document.createElement('p');head.className='hint';head.innerHTML='<strong>匿名の成立条件</strong>';conditions.append(head);
  for(const row of rows){
    const item=document.createElement('div');item.className='thread-item';
    const strong=document.createElement('strong');strong.textContent=yen(row.amount_yen);
    item.append(strong,document.createTextNode(` — ${row.condition_text}`));conditions.append(item);
  }
 }
 renderConditions();
}

function canonicalCard(post,{detail=false}={}){
  const article=document.createElement('article');
  article.className='card problem-card';
  article.dataset.canonicalPostCard='1';
  article.dataset.canonicalPostId=post.id;
  const meta=document.createElement('div');meta.className='meta';
  meta.textContent=post.source_withdrawn
    ?`${fmt(post.created_at)} · 共有Problem · 元BOYAKIは取り下げ済み`
    :`${fmt(post.created_at)} · ${short(post.author_pubkey)} · BOYAKI canonical`;
  article.append(meta);

  const raw=document.createElement('p');raw.className='raw';raw.textContent=post.content||'';article.append(raw);

  if(post.shared_problem&&!post.source_withdrawn&&post.problem_statement){
    const problem=document.createElement('div');problem.className='candidate-block';problem.dataset.sharedProblemSummary='1';
    const heading=document.createElement('strong');heading.textContent='共同解決で残るProblem';
    const statement=document.createElement('p');statement.textContent=post.problem_statement;
    const note=document.createElement('p');note.className='hint';note.textContent='元のBOYAKI本文は投稿者が取り下げられます。この一般化Problemは共同解決の入口として残ります。';
    problem.append(heading,statement,note);article.append(problem);
  }

  const chips=document.createElement('div');chips.className='chips';
  const canonical=document.createElement('span');canonical.className='chip';canonical.textContent='AI-STAGING';chips.append(canonical);
  if(post.shared_problem){const shared=document.createElement('span');shared.className='chip';shared.textContent='共同解決フェーズ';chips.append(shared)}
  if(post.source_withdrawn){const withdrawn=document.createElement('span');withdrawn.className='chip';withdrawn.textContent='元文取り下げ済み';chips.append(withdrawn)}
  demandFeedChips(chips,post.demand_summary);article.append(chips);

  if(detail){
    const note=document.createElement('p');note.className='hint';
    note.textContent=post.source_withdrawn
      ?'元の個人的なBOYAKI本文は取り下げ済みです。一般化されたProblemと共同の会話・Solution・Productは継続しています。'
      :'このBOYAKIのスレッドで会話できます。';
    article.append(note);
    const mount=document.createElement('div');mount.dataset.canonicalThreadMount='1';article.append(mount);
    queueMicrotask(()=>hydrateDemandEvidence(article,post).catch(err=>console.warn('demand evidence hydrate failed',err)));
    queueMicrotask(()=>hydrateCanonicalThread(article,post).catch(err=>console.warn('canonical thread hydrate failed',err)));
  }else{
    const actions=document.createElement('div');actions.className='actions';
    const open=document.createElement('a');open.className='button-link';open.href=`?problem=${encodeURIComponent(post.id)}`;open.textContent=post.source_withdrawn?'このProblemを開く':'このBOYAKIを開く';actions.append(open);article.append(actions);
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
          ?'元のBOYAKI本文を取り下げました。共有Problem・他の参加者の会話・Solution・Productは残ります。'
          :'投稿とスレッドを削除しました。');
        await renderHybrid();
      }catch(err){status(`削除できませんでした: ${String(err.message)}`);del.disabled=false}
    });
    actions.append(del);article.append(actions);
  }
  const permalink=document.createElement('a');permalink.className='permalink';permalink.rel='nofollow';permalink.href=`?problem=${encodeURIComponent(post.id)}`;permalink.textContent=post.shared_problem?'このProblemのURL':'この問題のURL';article.append(permalink);
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
    const makers=document.querySelector('#maker-list');if(makers){makers.replaceChildren();const q=document.querySelector('#maker-search')?.value?.trim().toLowerCase()||'';for(const p of lastPosts.filter(p=>p.content.toLowerCase().includes(q)))makers.append(canonicalCard(p))}
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
      button.disabled=true;button.textContent='公開処理中…';status('BOYAKIの管理DBへ公開しています…');
      try{
        const result=await client.createPost(text);window.BOYAKI_STORAGE.local.removeItem(DRAFT_KEY);
        const panel=document.querySelector('#private-chat-v53');if(panel){panel.hidden=true;panel.replaceChildren()}
        const input=document.querySelector('#raw');if(input)input.value='';window.BOYAKI_AI_STAGING_LAST_PUBLISH_ERROR='';status('公開しました。自分の投稿は画面から削除できます。');await renderHybrid();if(result?.post?.id)history.replaceState(null,'',location.pathname);
      }catch(err){const code=String(err?.message||err||'unknown_error');window.BOYAKI_AI_STAGING_LAST_PUBLISH_ERROR=code;console.error('canonical publish failed',err);status(`公開できませんでした。E2E診断: ${code}（下書きはこの端末に残っています）`);button.disabled=false;button.textContent='解決候補として公開する'}
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