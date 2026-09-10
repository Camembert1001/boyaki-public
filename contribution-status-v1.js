import { getPublicKey } from 'https://esm.sh/nostr-tools@2.17.0';

const $=s=>document.querySelector(s);
const fromHex=hex=>new Uint8Array((hex.match(/.{1,2}/g)||[]).map(b=>parseInt(b,16)));

const METRICS={
  'voice-useful-input':{selector:'#voice-useful-inputs',history:'#voice-history',label:'Useful Input',dedupe:'case_id'},
  'voice-verified-validation':{selector:'#voice-verified-validations',history:'#voice-history',label:'Verified Validation',dedupe:'case_id'},
  'voice-resolved-case':{selector:'#voice-resolved-cases',history:'#voice-history',label:'Resolved Case',dedupe:'case_id'},
  'maker-applied-contribution':{selector:'#maker-applied-contributions',history:'#maker-history',label:'Applied Contribution',dedupe:'case_id'},
  'maker-resolved-case':{selector:'#maker-resolved-cases',history:'#maker-history',label:'Resolved Case',dedupe:'case_id'},
  'maker-proven-reuse':{selector:'#maker-proven-reuse',history:'#maker-history',label:'Proven Reuse',dedupe:'solution_id'}
};

function currentAccountPk(){
  const hex=localStorage.getItem('boyaki-account-sk')||sessionStorage.getItem('boyaki-account-sk');
  if(!hex)return null;
  try{return getPublicKey(fromHex(hex))}catch{return null}
}

function validVerifiedEntry(entry,metricId,actorPk){
  if(!entry||entry.state!=='verified'||entry.metric!==metricId||entry.actor_id!==actorPk)return false;
  if(!entry.case_id&&metricId!=='maker-proven-reuse')return false;
  if(metricId==='voice-verified-validation')return !!entry.solution_id&&entry.independence_verified===true&&!!entry.evidence_id;
  if(metricId==='voice-useful-input')return !!entry.evidence_id;
  if(metricId==='voice-resolved-case')return !!entry.resolution_evidence_id;
  if(metricId==='maker-applied-contribution')return !!entry.solution_id&&!!entry.evidence_id;
  if(metricId==='maker-resolved-case')return !!entry.solution_id&&entry.independence_verified===true&&!!entry.resolution_evidence_id;
  if(metricId==='maker-proven-reuse')return !!entry.solution_id&&Number(entry.independent_resolved_case_count)>=2;
  return false;
}

function canonicalEntries(entries,metricId,actorPk){
  const cfg=METRICS[metricId];
  const seen=new Map();
  for(const entry of entries){
    if(!validVerifiedEntry(entry,metricId,actorPk))continue;
    const key=entry[cfg.dedupe];
    if(!key)continue;
    const prev=seen.get(key);
    const ts=Date.parse(entry.verified_at||entry.updated_at||entry.created_at||0)||0;
    const prevTs=prev?(Date.parse(prev.verified_at||prev.updated_at||prev.created_at||0)||0):-1;
    if(!prev||ts>=prevTs)seen.set(key,entry);
  }
  return [...seen.values()];
}

function row(metricId,entry){
  const p=document.createElement('p');
  p.className='hint';
  p.dataset.statusV1='1';
  const cfg=METRICS[metricId];
  const ref=metricId==='maker-proven-reuse'?entry.solution_id:entry.case_id;
  const date=entry.verified_at?new Date(entry.verified_at).toLocaleDateString('ja-JP'):'';
  p.textContent=`${cfg.label}${date?` · ${date}`:''}${ref?` · ${String(ref).slice(0,18)}${String(ref).length>18?'…':''}`:''}`;
  return p;
}

function protectHistory(container){
  if(!container)return;
  const scrub=()=>{
    for(const child of [...container.children])if(child.dataset.statusV1!=='1')child.remove();
  };
  scrub();
  new MutationObserver(scrub).observe(container,{childList:true});
}

async function loadLedger(){
  const res=await fetch(`./contribution-ledger-v1.json?v=${Date.now()}`,{cache:'no-store'});
  if(!res.ok)throw new Error(`contribution_ledger_${res.status}`);
  const data=await res.json();
  if(data?.schema!=='boyaki-contribution-ledger-v1'||!Array.isArray(data.entries))throw new Error('contribution_ledger_schema');
  return data.entries;
}

async function render(){
  const actorPk=currentAccountPk();
  if(!actorPk)return;
  const voiceHistory=$('#voice-history');
  const makerHistory=$('#maker-history');
  protectHistory(voiceHistory);protectHistory(makerHistory);
  voiceHistory.innerHTML='';makerHistory.innerHTML='';
  try{
    const entries=await loadLedger();
    const rendered={voice:[],maker:[]};
    for(const [metricId,cfg] of Object.entries(METRICS)){
      const xs=canonicalEntries(entries,metricId,actorPk);
      const node=$(cfg.selector);if(node)node.textContent=String(xs.length);
      const bucket=metricId.startsWith('voice-')?'voice':'maker';
      for(const entry of xs)rendered[bucket].push({metricId,entry});
    }
    rendered.voice.sort((a,b)=>String(b.entry.verified_at||'').localeCompare(String(a.entry.verified_at||''))).slice(0,8).forEach(x=>voiceHistory.append(row(x.metricId,x.entry)));
    rendered.maker.sort((a,b)=>String(b.entry.verified_at||'').localeCompare(String(a.entry.verified_at||''))).slice(0,8).forEach(x=>makerHistory.append(row(x.metricId,x.entry)));
    if(!voiceHistory.children.length){const p=document.createElement('p');p.className='hint';p.dataset.statusV1='1';p.textContent='まだVerified Voice contributionはありません。';voiceHistory.append(p)}
    if(!makerHistory.children.length){const p=document.createElement('p');p.className='hint';p.dataset.statusV1='1';p.textContent='まだVerified Maker contributionはありません。';makerHistory.append(p)}
    const note=$('#contribution-status-state');
    if(note)note.textContent='Verified contributionのみ表示しています。Candidate / Pendingは証拠が揃うまでカウンターへ反映されません。';
  }catch(err){
    console.error('contribution status v1 failed',err);
    const note=$('#contribution-status-state');
    if(note)note.textContent='Contribution Statusを読み込めませんでした。カウンターは未確認状態です。';
  }
}

render();
