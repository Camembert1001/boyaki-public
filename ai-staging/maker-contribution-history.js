const box=document.querySelector('[data-contribution-role="maker"]');
if(box){
  let cases=[];
  try{cases=JSON.parse(localStorage.getItem('boyaki-maker-solution-cases-v1')||'[]')}catch{}
  if(cases.length){
    box.innerHTML='';
    for(const c of cases){
      const item=document.createElement('div');
      item.className='participation-panel';
      const title=document.createElement('h3');title.textContent=c.title||'Solution Case';item.append(title);
      const contribution=document.createElement('p');contribution.textContent=c.contribution||'';item.append(contribution);
      const meta=document.createElement('p');meta.className='hint';meta.textContent=`${new Date((c.created_at||0)*1000).toLocaleString('ja-JP')} · Solution Case`;item.append(meta);
      if(c.room_id){const actions=document.createElement('div');actions.className='actions';const link=document.createElement('a');link.className='button-link';link.href=`./solution-room.html?room=${encodeURIComponent(c.room_id)}&mode=view`;link.textContent='Solution Logを見る';actions.append(link);item.append(actions)}
      box.append(item);
    }
  }
}