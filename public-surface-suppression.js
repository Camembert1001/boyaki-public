let suppressionRules=[];

async function loadRules(){
  try{
    const res=await fetch('./public-surface-suppressions.json',{cache:'no-store'});
    if(!res.ok)return;
    const data=await res.json();
    suppressionRules=Array.isArray(data.events)?data.events:[];
    scan(document);
  }catch{}
}

function normalized(s=''){return String(s).normalize('NFKC').trim()}
function shouldSuppressCard(card){
  const raw=normalized(card.querySelector('.raw')?.textContent||'');
  const eventId=card.dataset.eventId||card.querySelector('[data-event-id]')?.dataset.eventId||'';
  return suppressionRules.some(rule=>
    (rule.content_exact&&normalized(rule.content_exact)===raw) ||
    (rule.event_id&&eventId&&rule.event_id===eventId)
  );
}
function scan(root=document){
  const cards=[];
  if(root.matches?.('.problem-card'))cards.push(root);
  root.querySelectorAll?.('.problem-card').forEach(card=>cards.push(card));
  for(const card of cards)if(shouldSuppressCard(card))card.remove();
}

new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scan(node);
}).observe(document.documentElement,{childList:true,subtree:true});

loadRules();
