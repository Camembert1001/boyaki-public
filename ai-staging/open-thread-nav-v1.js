const VERSION='20260909-open-thread-nav-v1';
window.BOYAKI_STAGING_OPEN_THREAD_NAV_VERSION=VERSION;

function problemUrlFromCard(card){
  const link=card?.querySelector?.('.permalink[href],a[href*="problem="]');
  if(!link)return null;
  try{
    const url=new URL(link.href,location.href);
    const id=url.searchParams.get('problem');
    return id?url:null;
  }catch{return null}
}

document.addEventListener('click',e=>{
  const legacyButton=e.target?.closest?.('button[data-action="open-thread"]');
  if(legacyButton){
    const card=legacyButton.closest('.problem-card');
    const url=problemUrlFromCard(card);
    if(!url)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(url.toString());
    return;
  }

  const canonicalLink=e.target?.closest?.('[data-canonical-post-card] a[href*="problem="]');
  if(canonicalLink){
    let url=null;
    try{url=new URL(canonicalLink.href,location.href)}catch{}
    if(!url?.searchParams.get('problem'))return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.assign(url.toString());
  }
},true);
