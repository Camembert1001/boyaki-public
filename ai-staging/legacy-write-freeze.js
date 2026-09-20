(()=>{
  // Do not reopen legacy plaintext publication just because the backend is healthy.
  // Each surface must explicitly declare that its write path has been rewired.
  window.BOYAKI_PLAINTEXT_NOSTR_PUBLICATION_DISABLED=true;
  const blocked='この操作は現在使えません。元の困りごとの話し合いから続けてください。';
  document.addEventListener('submit',e=>{
    const form=e.target;
    if(!(form instanceof HTMLFormElement))return;
    if(!form.matches('#join-form,#activity-form,#room-form'))return;
    if(window.BOYAKI_MAKERSPACE_CANONICAL_WRITE_ACTIVE===true)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const status=form.id==='join-form'?document.querySelector('#join-status'):document.querySelector(form.id==='room-form'?'#room-status':'#activity-status');
    if(status)status.textContent=blocked;
    const button=form.querySelector('button[type="submit"]');
    if(button){button.disabled=true;button.textContent='この操作は使えません'}
  },true);
})();
