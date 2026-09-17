(()=>{
  // Do not reopen legacy plaintext publication just because the backend is healthy.
  // Each surface must explicitly declare that its write path has been rewired.
  window.BOYAKI_PLAINTEXT_NOSTR_PUBLICATION_DISABLED=true;
  const blocked='削除可能なAccount単位の保存基盤へ移行中です。この公開操作は現在停止しています。';
  document.addEventListener('submit',e=>{
    const form=e.target;
    if(!(form instanceof HTMLFormElement))return;
    if(!form.matches('#join-form,#activity-form'))return;
    if(window.BOYAKI_MAKERSPACE_CANONICAL_WRITE_ACTIVE===true)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const status=form.id==='join-form'?document.querySelector('#join-status'):document.querySelector('#activity-status');
    if(status)status.textContent=blocked;
    const button=form.querySelector('button[type="submit"]');
    if(button){button.disabled=true;button.textContent='公開基盤を移行中'}
  },true);
})();
