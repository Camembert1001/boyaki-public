(()=>{
  const VERSION='quality-index-v1';
  const parseCount=(card,label)=>{
    for(const chip of card.querySelectorAll('.chip')){
      const text=(chip.textContent||'').trim();
      if(text.startsWith(label+' ')){
        const n=Number(text.slice(label.length+1));
        return Number.isFinite(n)?n:0;
      }
    }
    return 0;
  };
  function evaluate(card){
    const proposal=card?.querySelector?.('[data-form="proposal"]');
    const contextSufficient=proposal?.dataset?.contextSufficient==='1';
    const solutionForms=(proposal?.dataset?.solutionForms||'').split(',').filter(Boolean);
    const same=parseCount(card,'自分も');
    const clarification=parseCount(card,'詳しい情報');
    const proposals=parseCount(card,'提案');
    const posterResponses=parseCount(card,'投稿者の返答');
    const sharedPainLift=same>=2;
    const dialogueLift=clarification>=1&&proposals>=1&&posterResponses>=1;
    const demandLift=same>=1&&proposals>=1&&posterResponses>=1;
    const eligible=contextSufficient&&solutionForms.length>=2&&(sharedPainLift||dialogueLift||demandLift);
    return {version:VERSION,eligible,contextSufficient,solutionForms,same,clarification,proposals,posterResponses,sharedPainLift,dialogueLift,demandLift};
  }
  function apply(card){
    const meta=document.querySelector('meta[name="robots"]');
    if(!meta||!new URLSearchParams(location.search).has('problem')) return null;
    const state=evaluate(card);
    meta.setAttribute('content',state.eligible?'index,follow':'noindex,follow');
    document.documentElement.dataset.problemIndexEligible=state.eligible?'1':'0';
    document.documentElement.dataset.problemIndexGateVersion=VERSION;
    return state;
  }
  function scan(root=document){
    if(!new URLSearchParams(location.search).has('problem')) return;
    const card=root.matches?.('.problem-card')?root:root.querySelector?.('.problem-card');
    if(card) apply(card);
  }
  function suppressLegacyMakerSpaceNav(){
    document.querySelectorAll('[data-maker-space-link]').forEach(el=>el.remove());
    document.querySelectorAll('.topbar nav a,.topbar nav button').forEach(el=>{
      if(el.textContent?.trim()==='活動する')el.remove();
    });
  }
  function loadPublicSuppression(){
    if(document.querySelector('script[data-public-suppression-loader]'))return;
    const script=document.createElement('script');
    script.src='./public-surface-suppression.js?v=20260903-owner-cleanup';
    script.defer=true;
    script.dataset.publicSuppressionLoader='1';
    document.head.append(script);
  }
  function installCanonicalStorageCutoverGuard(){
    // Safety invariant: backend health alone must NEVER reopen the old plaintext Relay path.
    // The guard is released only after the actual frontend write path is switched to canonical API.
    window.BOYAKI_PLAINTEXT_NOSTR_PUBLICATION_DISABLED=true;
    const canonicalWriteActive=()=>window.BOYAKI_CANONICAL_BACKEND_READY===true&&window.BOYAKI_CANONICAL_WRITE_CUTOVER_ACTIVE===true;
    const blockedMessage='削除可能なAccount単位の保存基盤へ移行中です。下書きはこの端末に残り、Nostr Relayへは送信していません。';
    const setBlockedStatus=(button)=>{
      const status=document.querySelector('#status');
      if(status)status.textContent=blockedMessage;
      if(button){button.disabled=true;button.textContent='公開基盤を移行中'}
    };
    document.addEventListener('click',e=>{
      const button=e.target?.closest?.('[data-v53-publish="1"]');
      if(!button)return;
      if(canonicalWriteActive())return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlockedStatus(button);
    },true);
    document.addEventListener('submit',e=>{
      if(canonicalWriteActive())return;
      const form=e.target;
      if(!(form instanceof HTMLFormElement))return;
      const isThreadPlaintext=form.matches('[data-form="clarify"],[data-form="proposal"],[data-form="poster-response"]')||!!form.closest('.poster-clarification-answer');
      if(!isThreadPlaintext)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlockedStatus(form.querySelector('button[type="submit"],button:not([type])'));
    },true);
  }
  window.BOYAKI_PROBLEM_INDEX_GATE={version:VERSION,evaluate,apply};
  new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)scan(n)}).observe(document.documentElement,{childList:true,subtree:true});
  loadPublicSuppression();
  installCanonicalStorageCutoverGuard();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{scan();suppressLegacyMakerSpaceNav()});else{scan();suppressLegacyMakerSpaceNav()}
})();
