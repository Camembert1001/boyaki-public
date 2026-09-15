(()=>{
  const WITHDRAW_LABEL='自分の投稿を取り下げ';
  function removeImmediateWithdraw(root=document){
    const candidates=root.querySelectorAll?.('button')||[];
    for(const button of candidates){
      if(button.textContent?.trim()===WITHDRAW_LABEL){
        button.remove();
      }
    }
    if(root.matches?.('button')&&root.textContent?.trim()===WITHDRAW_LABEL){
      root.remove();
    }
  }
  const scan=()=>removeImmediateWithdraw(document);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(records=>{
    for(const record of records){
      for(const node of record.addedNodes){
        if(node.nodeType===1)removeImmediateWithdraw(node);
      }
    }
  }).observe(document.documentElement,{childList:true,subtree:true});
  window.BOYAKI_WITHDRAW_UI_POLICY='report-only-v1';
})();
