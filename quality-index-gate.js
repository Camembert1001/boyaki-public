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
  function exposeMakerSpace(){
    const nav=document.querySelector('.topbar nav');
    if(!nav||nav.querySelector('[data-maker-space-link]'))return;
    const link=document.createElement('a');
    link.href='./makers.html';
    link.className='nav-link';
    link.dataset.makerSpaceLink='1';
    link.textContent='活動する';
    link.setAttribute('aria-label','BOYAKI Maker Space');
    nav.append(link);
    const makerView=document.querySelector('#maker-view .hint');
    if(makerView&&!document.querySelector('[data-maker-space-cta]')){
      const p=document.createElement('p');p.className='hint';p.dataset.makerSpaceCta='1';
      p.innerHTML='<strong>実際に参加する:</strong> <a href="./makers.html">Maker SpaceでSolution Candidate・Tester・Makerの活動を見る</a>';
      makerView.after(p);
    }
  }
  function loadPublicSuppression(){
    if(document.querySelector('script[data-public-suppression-loader]'))return;
    const script=document.createElement('script');
    script.src='./public-surface-suppression.js?v=20260903-owner-cleanup';
    script.defer=true;
    script.dataset.publicSuppressionLoader='1';
    document.head.append(script);
  }
  window.BOYAKI_PROBLEM_INDEX_GATE={version:VERSION,evaluate,apply};
  new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)scan(n)}).observe(document.documentElement,{childList:true,subtree:true});
  loadPublicSuppression();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{scan();exposeMakerSpace()});else{scan();exposeMakerSpace()}
})();
