(()=>{
  window.BOYAKI_CHAT_FIRST_VERSION='v53-local-stage-persist-or-no-publish-risk-bilingual';

  const STORAGE_KEY='boyaki-private-draft-v53';
  const form=document.querySelector('#raw-form');
  const rawInput=document.querySelector('#raw');
  const submitButton=document.querySelector('#submit-btn');
  const pageStatus=document.querySelector('#status');
  if(!form||!rawInput||!submitButton)return;

  let allowPublicOnce=false;
  const HIGH_RISK=/(医療|診断|治療|薬|服薬|法律|訴訟|裁判|投資|株|暗号資産|借金|融資|銃|武器|爆発|自殺|自傷|パスワード|認証情報|個人情報|秘密鍵|API\s*キー|medical|diagnos(?:is|e)|treatment|medication|prescription|legal|lawsuit|court|investment|stocks?|crypto(?:currency)?|debt|loan|guns?|weapons?|explosives?|suicid(?:e|al)|self[-\s]?harm|passwords?|credentials?|personal\s+(?:data|information)|private\s+key|api\s*key|access\s*token|secret\s*key)/i;

  const panel=document.createElement('section');
  panel.id='private-chat-v53';
  panel.className='card';
  panel.hidden=true;
  panel.setAttribute('aria-live','polite');
  form.after(panel);

  function setStatus(text){if(pageStatus)pageStatus.textContent=text}
  function loadDraft(){
    try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{return null}
  }
  function saveDraft(draft){
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(draft));
      return true;
    }catch{
      setStatus('このブラウザでは下書きを保存できません。内容は公開されていません。');
      return false;
    }
  }
  function clearDraft(){
    try{localStorage.removeItem(STORAGE_KEY)}catch{}
    panel.hidden=true;
    panel.replaceChildren();
    rawInput.value='';
    rawInput.focus();
    setStatus('下書きを削除しました。公開はされていません。');
  }
  function questionFor(text){
    const t=(text||'').normalize('NFKC');
    if(/毎回|手作業|コピペ|転記|入力|繰り返|反復|時間がかか/.test(t))return 'その中で、いちばん時間を取られているのはどの部分？';
    if(/スマホ|アプリ|画面|表示|ボタン|操作|ブラウザ|UI|UX/.test(t))return '理想なら、そこでどう動いてくれると一番ラク？';
    if(/エラー|落ちる|失敗|動かない|壊れ|バグ|不具合/.test(t))return '今いちばん困るのは「何ができないこと」？';
    if(/探す|見つから|検索|整理|どこ/.test(t))return '見つからないせいで、次にどんな手間が増えてる？';
    return 'それが起きるとき、いちばん「なんとかして」と思う瞬間はどこ？';
  }
  function addText(tag,text,className){
    const el=document.createElement(tag);if(className)el.className=className;el.textContent=text;return el;
  }
  function render(draft,{publishAllowed=true}={}){
    panel.hidden=false;
    panel.replaceChildren();

    const head=document.createElement('div');
    head.className='section-head';
    const headText=document.createElement('div');
    headText.append(addText('p','BOYAKI整理アシスト','eyebrow'));
    headText.append(addText('h2','まず、ここで少し話す'));
    head.append(headText);
    const badge=addText('span','まだ公開されていません','chip');
    head.append(badge);
    panel.append(head);

    panel.append(addText('p','この下書きはこのブラウザ内に保存され、まだBOYAKIの公開フィードには送られていません。','hint'));

    const user=document.createElement('div');
    user.className='thread-item';
    user.dataset.actorRole='original-poster';
    user.append(addText('strong','あなた'));
    user.append(document.createElement('br'));
    user.append(document.createTextNode(draft.raw));
    panel.append(user);

    const assist=document.createElement('div');
    assist.className='thread-item';
    assist.dataset.actorRole='organizer';
    assist.append(addText('strong','BOYAKI整理アシスト'));
    assist.append(document.createElement('br'));
    assist.append(document.createTextNode(draft.question));
    panel.append(assist);

    if(!draft.clarification){
      const answerForm=document.createElement('form');
      answerForm.className='submit-row';
      const answer=document.createElement('input');
      answer.maxLength=240;
      answer.placeholder='一言でOK';
      answer.setAttribute('aria-label','追加の一言');
      const send=document.createElement('button');
      send.type='submit';send.textContent='答える';
      answerForm.append(answer,send);
      answerForm.addEventListener('submit',e=>{
        e.preventDefault();
        const text=answer.value.trim();if(!text)return;
        draft.clarification=text;
        draft.updated_at=new Date().toISOString();
        const persisted=saveDraft(draft);
        render(draft,{publishAllowed:persisted});
        if(!persisted)setStatus('補足を保存できませんでした。内容は公開されておらず、この状態から公開することもできません。');
      });
      panel.append(answerForm);
    }else{
      const reply=document.createElement('div');
      reply.className='thread-item';
      reply.dataset.actorRole='original-poster';
      reply.append(addText('strong','あなた'));
      reply.append(document.createElement('br'));
      reply.append(document.createTextNode(draft.clarification));
      panel.append(reply);
      panel.append(addText('p','ここまでで問題の輪郭が少し見えました。公開するかどうかは、あなたが決められます。','hint'));
    }

    const actions=document.createElement('div');
    actions.className='actions';

    const publish=document.createElement('button');
    publish.type='button';
    publish.dataset.v53Publish='1';
    publish.textContent='解決候補として公開する';
    if(!publishAllowed){
      publish.disabled=true;
      panel.append(addText('p','下書きをこのブラウザに保存できないため、この状態からは公開できません。','hint'));
    }else if(HIGH_RISK.test(`${draft.raw} ${draft.clarification||''}`)){
      publish.disabled=true;
      panel.append(addText('p','安全上、この内容はこの画面から自動公開できません。','hint'));
    }
    publish.addEventListener('click',()=>{
      if(!publishAllowed)return;
      allowPublicOnce=true;
      rawInput.value=draft.raw;
      publish.disabled=true;
      publish.textContent='公開処理中…';
      setStatus('明示的な公開操作を受け付けました。既存のBOYAKI公開経路へ送信しています。');
      try{
        form.requestSubmit();
      }catch{
        allowPublicOnce=false;
        publish.disabled=false;
        publish.textContent='解決候補として公開する';
        setStatus('公開処理を開始できませんでした。内容は公開されていません。');
        return;
      }
      setTimeout(()=>{publish.disabled=false;publish.textContent='解決候補として公開する'},2500);
    });

    const keep=document.createElement('button');
    keep.type='button';keep.textContent='まだ公開しない';
    keep.addEventListener('click',()=>{panel.hidden=true;rawInput.focus();setStatus('下書きはこのブラウザ内だけに残っています。公開はされていません。')});

    const discard=document.createElement('button');
    discard.type='button';discard.textContent='下書きを削除';
    discard.addEventListener('click',clearDraft);

    actions.append(publish,keep,discard);
    panel.append(actions);
    panel.append(addText('p','公開すると、最初に書いた一言だけが元のBOYAKIとして公開されます。ここで答えた補足は勝手に公開しません。','hint'));
  }

  document.addEventListener('submit',e=>{
    if(e.target!==form)return;
    if(allowPublicOnce){allowPublicOnce=false;return}
    e.preventDefault();
    e.stopImmediatePropagation();
    const raw=rawInput.value.trim();if(!raw)return;
    const draft={
      schema:'boyaki-private-draft-v53',
      raw,
      question:questionFor(raw),
      clarification:'',
      created_at:new Date().toISOString(),
      public_status:'NOT_PUBLISHED'
    };
    const persisted=saveDraft(draft);
    render(draft,{publishAllowed:persisted});
    if(persisted)setStatus('下書きを作りました。まだ公開されていません。');
    else setStatus('下書きを保存できませんでした。内容は公開されておらず、この状態から公開することもできません。');
    submitButton.disabled=false;
  },true);

  const existing=loadDraft();
  if(existing?.raw)render(existing);
})();
