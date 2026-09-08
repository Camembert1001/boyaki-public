import { finalizeEvent, generateSecretKey, getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';

const STAGING_REF='vbqitqjhobzpdlaraglc';
const PRODUCTION_REF='uvjyponltgoytjzwkfrh';
const API_BASE=`https://${STAGING_REF}.supabase.co/functions/v1/boyaki-api`;
if(!API_BASE.includes(STAGING_REF)||API_BASE.includes(PRODUCTION_REF))throw new Error('unsafe_e2e_target');

const runButton=document.querySelector('#run');
const output=document.querySelector('#output');
const summary=document.querySelector('#summary');
const lines=[];
const results=[];

function write(line=''){lines.push(line);output.textContent=lines.join('\n');output.scrollTop=output.scrollHeight}
function pass(name,detail=''){results.push({name,status:'PASS',detail});write(`PASS ${name}${detail?` — ${detail}`:''}`)}
function skip(name,detail=''){results.push({name,status:'SKIP',detail});write(`SKIP ${name}${detail?` — ${detail}`:''}`)}
function identity(sk=generateSecretKey(),kind='account'){return{sk,pk:getPublicKey(sk),kind}}
async function sha256Hex(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function b64(text){const bytes=new TextEncoder().encode(text);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary)}
async function signedHeaders(id,url,method,raw=''){const tags=[['u',url],['method',method.toUpperCase()]];if(raw)tags.push(['payload',await sha256Hex(raw)]);const ev=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags},id.sk);return{Authorization:`Nostr ${b64(JSON.stringify(ev))}`,'Content-Type':'application/json'}}
async function request(path,{method='GET',body=null,id=null,expected=[200]}={}){const url=`${API_BASE}${path.startsWith('/')?path:`/${path}`}`;const raw=body===null?'':JSON.stringify(body);const headers=id?await signedHeaders(id,url,method,raw):{'Content-Type':'application/json'};const response=await fetch(url,{method,headers,body:raw||undefined,cache:'no-store'});let payload={};try{payload=await response.json()}catch{}if(!expected.includes(response.status))throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);return{status:response.status,payload}}
async function createPost(id,text,kind=id.kind){const{payload}=await request('/posts',{method:'POST',id,expected:[201],body:{content:text,identity_kind:kind}});if(!payload.post?.id)throw new Error('post_id_missing');return payload.post}
async function listMine(id){return(await request('/me/posts',{id})).payload}
async function deletePost(id,postId,expected=[200]){return request(`/posts/${encodeURIComponent(postId)}`,{method:'DELETE',id,expected})}
async function feedIds(){const{payload}=await request('/posts?limit=100');return new Set((payload.posts||[]).map(p=>p.id))}
function linkPair(account,legacy){const tags=[['schema','boyaki-account-link-v1'],['account',account.pk],['legacy',legacy.pk]],created_at=Math.floor(Date.now()/1000);return{legacy_claim:finalizeEvent({kind:30078,created_at,content:'',tags:[...tags,['direction','legacy-claims-account']]},legacy.sk),account_acceptance:finalizeEvent({kind:30078,created_at,content:'',tags:[...tags,['direction','account-accepts-legacy']]},account.sk)}}
async function verifyLink(account,legacy){const pair=linkPair(account,legacy);const{payload}=await request('/identity-links/verify',{method:'POST',body:pair});if(payload.ok!==true||payload.account_pubkey!==account.pk||payload.legacy_pubkey!==legacy.pk)throw new Error('identity_link_verify_failed')}

async function run(){
  lines.length=0;results.length=0;summary.textContent='';runButton.disabled=true;runButton.textContent='実行中…';
  const runId=`${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
  try{
    write(`target: ${API_BASE}`);write(`run: ${runId}`);write();
    const health=await request('/health');if(health.payload.ok!==true||health.payload.canonical_storage!==true)throw new Error('health_not_ready');pass('staging-health',health.payload.version||health.payload.service||'ok');

    const account=identity(generateSecretKey(),'account');
    const deviceA=identity(account.sk,'account');
    const deviceB=identity(account.sk,'account');
    const attacker=identity(generateSecretKey(),'account');

    const direct=await createPost(deviceA,`Browser selftest Account ${runId}`);
    if(direct.owner_account_pubkey!==account.pk)throw new Error('account_owner_not_set');
    const fromB=(await listMine(deviceB)).posts?.find(p=>p.id===direct.id);if(!fromB)throw new Error('device_b_missing_account_post');pass('account-cross-device-read',direct.id);

    const denied=await deletePost(attacker,direct.id,[403]);if(denied.payload.error!=='not_post_owner')throw new Error('non_owner_delete_not_rejected');pass('non-owner-delete-denied');

    await deletePost(deviceB,direct.id);
    const deleted=(await listMine(deviceA)).posts?.find(p=>p.id===direct.id);if(!deleted||deleted.status!=='deleted'||deleted.content!==null)throw new Error('cross_device_delete_not_purged');if((await feedIds()).has(direct.id))throw new Error('deleted_post_still_in_feed');pass('account-cross-device-delete-and-purge',direct.id);

    const legacy=identity(generateSecretKey(),'legacy_browser');
    const legacyPost=await createPost(legacy,`Browser selftest legacy ${runId}`,'legacy_browser');if(legacyPost.owner_account_pubkey!==null)throw new Error('legacy_should_be_unclaimed');pass('legacy-unclaimed-create',legacyPost.id);

    await verifyLink(account,legacy);
    const inherited=(await listMine(deviceB)).posts?.find(p=>p.id===legacyPost.id);if(!inherited||inherited.owner_account_pubkey!==account.pk)throw new Error('legacy_backfill_failed');pass('legacy-to-account-backfill',legacyPost.id);

    await deletePost(deviceB,legacyPost.id);
    const inheritedDeleted=(await listMine(deviceA)).posts?.find(p=>p.id===legacyPost.id);if(!inheritedDeleted||inheritedDeleted.status!=='deleted'||inheritedDeleted.content!==null)throw new Error('linked_legacy_delete_failed');pass('linked-legacy-account-delete',legacyPost.id);

    const reportTarget=await createPost(deviceA,`Browser selftest report target ${runId}`);
    const reporter=identity(generateSecretKey(),'legacy_browser');
    const report=await request('/reports',{method:'POST',id:reporter,expected:[201],body:{target_type:'post',target_id:reportTarget.id,reason_code:'e2e',detail:`browser selftest ${runId}`}});if(!report.payload.report_id)throw new Error('report_id_missing');pass('report-create',report.payload.report_id);await deletePost(deviceA,reportTarget.id);

    skip('moderation-matrix','operator secret is intentionally not exposed to this public self-test page');
    summary.innerHTML='<span class="pass">BASE E2E PASS</span> — Account ownership / linked legacy backfill / delete purge / report create';
    write();write(JSON.stringify({runId,results},null,2));
  }catch(err){
    const code=String(err?.message||err||'unknown_error');results.push({name:'run',status:'FAIL',detail:code});summary.innerHTML=`<span class="fail">E2E FAIL</span> — ${code}`;write();write(`FAIL ${code}`);console.error(err);
  }finally{runButton.disabled=false;runButton.textContent='もう一度E2Eを実行'}
}

runButton.addEventListener('click',run);
if(new URLSearchParams(location.search).get('autorun')==='1')run();
