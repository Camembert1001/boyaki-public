const $=s=>document.querySelector(s);
const room=String(new URLSearchParams(location.search).get('room')||'').trim();
if(/^[1-9]$/.test(room))$('#back-room').href=`./solution-room.html?room=${encodeURIComponent(room)}`;
const form=$('#case-form'),status=$('#case-status'),button=$('#case-submit');
form.addEventListener('submit',e=>{
  e.preventDefault();
  const title=$('#case-title').value.trim();
  const contribution=$('#case-contribution').value.trim();
  if(!title||!contribution)return;
  button.disabled=true;
  const key='boyaki-maker-solution-cases-v1';
  let cases=[];
  try{cases=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
  cases.unshift({id:`local-${Date.now()}`,title,contribution,room_id:room,created_at:Math.floor(Date.now()/1000)});
  localStorage.setItem(key,JSON.stringify(cases.slice(0,200)));
  status.textContent='作成しました。Maker Contribution Historyへ移動します。';
  setTimeout(()=>location.href='./mypage.html#maker',250);
});