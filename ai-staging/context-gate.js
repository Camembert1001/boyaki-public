(()=>{
  window.BOYAKI_CONTEXT_GATE_VERSION='context-v2-poster-bound';
  const HIGH_RISK=/(医療|診断|治療|薬|服薬|法律|訴訟|裁判|投資|株|暗号資産|借金|融資|銃|武器|爆発|自殺|自傷|パスワード|認証情報|個人情報)/i;
  const RULES=[
    [/(忘れ|失念|漏れ|うっかり|見落と)/i,['reminder','checklist']],
    [/(毎回|手作業|コピペ|転記|入力|繰り返|反復)/i,['template','automation']],
    [/(探す|検索|見つから|見付から|整理|どこに)/i,['search-filter','index']],
    [/(在庫|発注|補充|欠品|ストック)/i,['threshold-alert','checklist']],
    [/(予定|予約|期限|締切|時間|スケジュール)/i,['reminder','scheduler']],
    [/(比較|選べない|迷う|どれがいい|判断)/i,['comparison','decision-guide']],
    [/(管理|記録|集計|一覧|見える化)/i,['template','dashboard']],
    [/(連絡|共有|伝達|通知|知らせ)/i,['notification','shared-log']],
    [/(待つ|混雑|順番|行列|空き)/i,['queue-status','notification']]
  ];
  function contextText(card){
    const raw=card.querySelector('.raw')?.textContent||'';
    const posterAnswers=[...card.querySelectorAll('.thread-item[data-actor-role="original-poster"]')].map(x=>x.textContent).join(' ');
    return `${raw} ${posterAnswers}`.normalize('NFKC');
  }
  function contextState(card){
    const text=contextText(card),forms=new Set();
    for(const [re,names] of RULES)if(re.test(text))for(const name of names)forms.add(name);
    return{risky:HIGH_RISK.test(text),forms:[...forms],sufficient:!HIGH_RISK.test(text)&&forms.size>=2};
  }
  function apply(card){
    const form=card.querySelector('[data-form="proposal"]');if(!form)return;
    const state=contextState(card);
    form.dataset.contextSufficient=state.sufficient?'1':'0';
    form.dataset.solutionForms=state.forms.join(',');
    const input=form.querySelector('input'),button=form.querySelector('button');
    if(input)input.disabled=!state.sufficient;if(button)button.disabled=!state.sufficient;
    let hint=form.querySelector('[data-context-gate-hint]');
    if(!state.sufficient){
      if(!hint){hint=document.createElement('p');hint.className='hint';hint.dataset.contextGateHint='1';form.append(hint)}
      hint.textContent=state.risky
        ?'安全上、この公開情報だけでは解決案を提案できません。'
        :'まだ解決案を決めるには情報が少なめです。必要なら追加質問を最大2つまで使えます。';
    }else if(hint)hint.remove();
  }
  function scan(root=document){
    for(const card of root.querySelectorAll?.('.problem-card')||[])apply(card);
    if(root.matches?.('.problem-card'))apply(root);
  }
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form?.matches?.('[data-form="proposal"]')){
      const card=form.closest('.problem-card');
      if(!card||!contextState(card).sufficient){event.preventDefault();event.stopImmediatePropagation()}
    }
  },true);
  new MutationObserver(mutations=>{
    for(const mutation of mutations)for(const node of mutation.addedNodes)if(node.nodeType===1)scan(node);
  }).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scan());else scan();
})();