(()=>{
  const VERSION='quality-index-v1';
  window.BOYAKI_AI_STAGING=true;

  function installAiStagingSurface(){document.documentElement.dataset.boyakiEnvironment='ai-staging'}

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
    meta.setAttribute('content','noindex,nofollow');
    document.documentElement.dataset.problemIndexEligible=state.eligible?'1':'0';
    document.documentElement.dataset.problemIndexGateVersion=VERSION;
    return state;
  }
  function scan(root=document){
    if(!new URLSearchParams(location.search).has('problem')) return;
    const card=root.matches?.('.problem-card')?root:root.querySelector?.('.problem-card');
    if(card) apply(card);
  }
  function installCanonicalStorageCutoverGuard(){
    window.BOYAKI_PLAINTEXT_NOSTR_PUBLICATION_DISABLED=true;
    const backendReady=()=>window.BOYAKI_CANONICAL_BACKEND_READY===true;
    const rootWriteActive=()=>backendReady()&&window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE===true;
    const threadWriteActive=()=>backendReady()&&window.BOYAKI_CANONICAL_THREAD_BACKEND_READY===true&&window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE===true;
    const diagnostic=()=>{
      const backend=backendReady()?'1':'0';
      const root=window.BOYAKI_CANONICAL_ROOT_WRITE_CUTOVER_ACTIVE===true?'1':'0';
      const thread=window.BOYAKI_CANONICAL_THREAD_WRITE_CUTOVER_ACTIVE===true?'1':'0';
      const threadBackend=window.BOYAKI_CANONICAL_THREAD_BACKEND_READY===true?'1':'0';
      const init=String(window.BOYAKI_AI_STAGING_LAST_INIT_ERROR||'none');
      const threadInit=String(window.BOYAKI_AI_STAGING_LAST_THREAD_INIT_ERROR||'none');
      const client=String(window.BOYAKI_AI_STAGING_CLIENT_VERSION||'unknown');
      return `guard_backend=${backend};root=${root};thread_backend=${threadBackend};thread=${thread};init=${init};thread_init=${threadInit};client=${client}`;
    };
    const setBlockedStatus=(button,isThread=false)=>{
      const status=document.querySelector('#status');
      console.warn('BOYAKI write path not ready',diagnostic());
      if(status)status.textContent='保存の準備が完了していません。少し待ってからもう一度試してください。';
      if(button){button.disabled=false;if(isThread&&button.dataset.boyakiOriginalLabel)button.textContent=button.dataset.boyakiOriginalLabel;else if(!isThread)button.textContent='解決候補として公開する'}
    };
    document.addEventListener('click',e=>{
      const button=e.target?.closest?.('[data-v53-publish="1"]');
      if(!button)return;
      if(rootWriteActive())return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setBlockedStatus(button,false);
    },true);
    document.addEventListener('submit',e=>{
      const form=e.target;
      if(!(form instanceof HTMLFormElement))return;
      const isThreadPlaintext=form.matches('[data-form="clarify"],[data-form="proposal"],[data-form="poster-response"]')||!!form.closest('.poster-clarification-answer');
      if(!isThreadPlaintext)return;
      const canonicalThread=form.dataset.canonicalThreadForm==='1';
      // Only canonical DB-backed thread forms may pass. Legacy forms remain frozen
      // even after the thread backend is ready, preventing accidental plaintext Nostr writes.
      if(canonicalThread&&threadWriteActive())return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const button=form.querySelector('button[type="submit"],button:not([type])');
      if(button&&!button.dataset.boyakiOriginalLabel)button.dataset.boyakiOriginalLabel=button.textContent||'';
      setBlockedStatus(button,true);
    },true);
  }
  window.BOYAKI_PROBLEM_INDEX_GATE={version:VERSION,evaluate,apply};
  new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)scan(n)}).observe(document.documentElement,{childList:true,subtree:true});
  installCanonicalStorageCutoverGuard();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{installAiStagingSurface();scan()});else{installAiStagingSurface();scan()}
})();
