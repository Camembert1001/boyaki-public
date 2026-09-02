import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';

const RELAYS=['wss://nos.lol','wss://relay.primal.net'];
const pool=new SimplePool();
const $=s=>document.querySelector(s);
const unix=()=>Math.floor(Date.now()/1000);
const toHex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));
const short=pk=>`${pk.slice(0,8)}…${pk.slice(-6)}`;

function getIdentity(){
  let hex=localStorage.getItem('boyaki-device-sk');
  if(!hex){
    hex=toHex(generateSecretKey());
    localStorage.setItem('boyaki-device-sk',hex);
  }
  const sk=fromHex(hex);
  return {sk,pk:getPublicKey(sk)};
}

const identity=getIdentity();
$('#device-id').textContent=short(identity.pk);

function signed(template){
  return finalizeEvent({...template,created_at:template.created_at??unix()},identity.sk);
}

async function publishProfile(profile){
  const ev=signed({
    kind:0,
    content:JSON.stringify({
      name:profile.displayName,
      display_name:profile.displayName,
      about:profile.about,
      boyaki_interest:profile.interest,
      boyaki_schema:'profile-v1'
    }),
    tags:[['app','boyaki-web'],['schema','boyaki-profile-v1']]
  });
  const out=await Promise.allSettled(pool.publish(RELAYS,ev));
  if(!out.some(x=>x.status==='fulfilled'))throw new Error('relay publish failed');
  return ev;
}

async function loadExisting(){
  const localName=localStorage.getItem('boyaki-profile-display-name')||localStorage.getItem('boyaki-maker-display-name')||'';
  const localInterest=localStorage.getItem('boyaki-profile-interest')||'both';
  const localAbout=localStorage.getItem('boyaki-profile-about')||'';
  $('#register-name').value=localName;
  $('#register-interest').value=['voice','maker','both'].includes(localInterest)?localInterest:'both';
  $('#register-about').value=localAbout;

  try{
    const rows=await pool.querySync(RELAYS,{kinds:[0],authors:[identity.pk],limit:20});
    const latest=rows.sort((a,b)=>b.created_at-a.created_at)[0];
    if(!latest)return;
    const p=JSON.parse(latest.content||'{}');
    if(p.boyaki_schema!=='profile-v1')return;
    if(typeof p.display_name==='string'&&p.display_name)$('#register-name').value=p.display_name;
    if(['voice','maker','both'].includes(p.boyaki_interest))$('#register-interest').value=p.boyaki_interest;
    if(typeof p.about==='string')$('#register-about').value=p.about;
    $('#register-status').textContent='このブラウザIDには、すでにBOYAKIプロフィールがあります。変更して再登録できます。';
  }catch{}
}

$('#register-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.submitter;
  const displayName=$('#register-name').value.trim();
  const interest=$('#register-interest').value;
  const about=$('#register-about').value.trim();
  if(!displayName){$('#register-status').textContent='表示名を入力してください。';return;}
  button.disabled=true;
  $('#register-status').textContent='プロフィールを署名して登録しています…';
  try{
    await publishProfile({displayName,interest,about});
    localStorage.setItem('boyaki-profile-display-name',displayName);
    localStorage.setItem('boyaki-profile-interest',interest);
    localStorage.setItem('boyaki-profile-about',about);
    localStorage.setItem('boyaki-profile-registered-at',String(Date.now()));
    localStorage.setItem('boyaki-maker-display-name',displayName);
    $('#register-status').textContent='登録しました。このプロフィールは現在のブラウザIDに紐づいています。匿名利用は引き続き可能です。';
  }catch{
    $('#register-status').textContent='登録できませんでした。通信状態を確認して、少し後で再試行してください。';
  }finally{
    button.disabled=false;
  }
});

loadExisting();
