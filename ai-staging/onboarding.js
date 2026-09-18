(()=>{
  const button=document.querySelector('[data-onboarding-open]');if(!button)return;
  const dialog=document.createElement('dialog');dialog.className='card';
  const title=document.createElement('h2');title.textContent='BOYAKIとは？';
  const text=document.createElement('p');text.textContent='困りごとを一言で書き、公開するか決めます。公開したBOYAKIのスレッドでは、VoiceまたはMakerとして会話できます。';
  const close=document.createElement('button');close.textContent='閉じる';close.type='button';close.addEventListener('click',()=>dialog.close());dialog.append(title,text,close);document.body.append(dialog);button.addEventListener('click',()=>dialog.showModal());
})();
