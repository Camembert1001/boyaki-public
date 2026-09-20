(()=>{
  const triggers=[...document.querySelectorAll('[data-onboarding-open]')];
  if(!triggers.length)return;

  const add=(tag,text,className)=>{
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(text)el.textContent=text;
    return el;
  };
  const dialog=document.createElement('dialog');
  dialog.className='boyaki-onboarding';
  dialog.setAttribute('aria-labelledby','boyaki-onboarding-title');

  const shell=add('div','', 'boyaki-onboarding-shell');
  const head=add('div','', 'boyaki-onboarding-head');
  const headText=add('div');
  headText.append(
    add('p','BOYAKI in 30 seconds','eyebrow'),
    Object.assign(add('h2','困りごとから、解決とProductが生まれる場所。'),{id:'boyaki-onboarding-title'}),
    add('p','最初は一言ボヤくだけでOK。必要になった段階でだけ、会話・共同解決・Productへ進みます。','lead')
  );
  const close=add('button','閉じる','onboarding-close');
  close.type='button';
  close.addEventListener('click',()=>dialog.close());
  head.append(headText,close);
  shell.append(head);

  const flow=add('div','', 'onboarding-flow');
  const steps=[
    ['1','ボヤく','最初は非公開。タイトル・仕様・予算はいりません。困ったことを一言だけ。'],
    ['2','公開する','自分で公開を選んだBOYAKIだけがみんなに見えるようになります。同じ痛みを持つVoiceや、解けるMakerが集まります。'],
    ['3','話し合う','Voiceは「自分も困る・試したい」を伝え、Makerは質問や解決案を出します。'],
    ['4','一緒に解決する','Makerが必要なVoiceをSolution Roomへ招待。元Voiceが同意したときだけ、個人の投稿とは別のShared Problemへ進みます。'],
    ['5','Productになる','Makerが解決をまとめてProductにします。完成したProductは、元の困りごとに掲載できます。'],
    ['6','必要な人に届く','最初から困っていたVoiceも、後から同じProblemを見つけたVoiceもProductを購入できます。']
  ];
  for(const [no,title,body] of steps){
    const row=add('div','', 'onboarding-step');
    row.append(add('span',no,'onboarding-step-no'));
    const copy=add('div');
    copy.append(add('strong',title),add('span',body));
    row.append(copy);flow.append(row);
  }
  shell.append(flow);

  const roles=add('section','', 'onboarding-section');
  roles.append(add('p','Voice / Maker','eyebrow'),add('h3','役割は「立場」ではなく、そのProblemで何をするか。'));
  const roleGrid=add('div','', 'onboarding-role-grid');
  const voice=add('div','', 'onboarding-role');
  voice.append(add('strong','Voice'),add('span','困っている人、試す人、条件を伝える人。どんな解決が必要かを具体化します。'));
  const maker=add('div','', 'onboarding-role');
  maker.append(add('strong','Maker'),add('span','質問し、解決を作り、Productとして届ける人。個人でも企業でも構いません。'));
  roleGrid.append(voice,maker);roles.append(roleGrid);shell.append(roles);

  const boundary=add('section','', 'onboarding-section onboarding-boundary');
  boundary.append(add('p','消せるもの / 残るもの','eyebrow'),add('h3','ただボヤく段階と、共同解決に進んだ後は扱いが違います。'));
  const boundaryGrid=add('div','', 'onboarding-boundary-grid');
  const casual=add('div','', 'onboarding-boundary-card');
  casual.append(add('strong','まだ「一緒に解決」に進んでいない'),add('span','あなたのBOYAKIです。削除できます。Makerが準備を始めていても、あなたが同意する前なら「みんなで解く困りごと」として残りません。'));
  const shared=add('div','', 'onboarding-boundary-card');
  shared.append(add('strong','「一緒に解決」へ進むことに同意した後'),add('span','元のBOYAKI本文は後から取り下げられます。一方、あなたが確認した「残る困りごと」、他の人の発言、そこで作られた解決やProductは残る場合があります。'));
  boundaryGrid.append(casual,shared);boundary.append(boundaryGrid);shell.append(boundary);

  const footer=add('div','', 'onboarding-footer');
  const note=add('p','全部覚える必要はありません。難しい境界に来たときだけ、その画面で必要な説明を出します。','hint');
  const start=add('button','まず一言ボヤいてみる');
  start.type='button';
  start.addEventListener('click',()=>{
    dialog.close();
    const input=document.querySelector('#raw');
    input?.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>input?.focus(),250);
  });
  footer.append(note,start);shell.append(footer);

  dialog.append(shell);
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
  document.body.append(dialog);

  const open=()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')};
  triggers.forEach(button=>button.addEventListener('click',open));
  const linked=new URLSearchParams(location.search).get('about')==='1'||location.hash==='#about';
  if(linked)queueMicrotask(open);

  const composer=document.querySelector('#composer');
  if(composer&&!composer.querySelector('[data-onboarding-inline]')){
    const inline=add('button','BOYAKIで何が起きる？ 30秒で見る','onboarding-inline');
    inline.type='button';inline.dataset.onboardingInline='1';inline.addEventListener('click',open);
    const actions=add('div','', 'onboarding-inline-row');actions.append(inline);composer.append(actions);
  }
})();