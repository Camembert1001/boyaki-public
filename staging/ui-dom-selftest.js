const output=document.querySelector('#output');
const summary=document.querySelector('#summary');
const results=[];
const lines=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function write(s=''){lines.push(s);output.textContent=lines.join('\n')}
function pass(name,detail=''){results.push({name,status:'PASS',detail});write(`PASS ${name}${detail?` — ${detail}`:''}`)}
function fail(name,detail=''){results.push({name,status:'FAIL',detail});throw new Error(`${name}${detail?`:${detail}`:''}`)}
async function waitFor(fn,label,timeout=4000){const start=Date.now();while(Date.now()-start<timeout){if(fn())return;await sleep(40)}fail(label,'timeout')}
function requestSubmit(form){if(typeof form.requestSubmit==='function')form.requestSubmit();else form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}
async function run(){
  lines.length=0;results.length=0;write('Canonical thread DOM regression self-test');
  try{
    await waitFor(()=>document.querySelector('[data-canonical-role="maker"]'),'thread-controls-render');pass('thread-controls-render');
    const card=document.querySelector('[data-canonical-post-card="1"]');if(!card)fail('detail-card-render');pass('detail-card-render');
    const clarify=card.querySelector('details.clarify'),proposal=card.querySelector('details.proposal');
    if(!clarify?.hidden)fail('initial-role-hidden');pass('initial-role-hidden');
    card.querySelector('[data-canonical-role="maker"]').click();
    if(clarify.hidden||proposal.hidden)fail('maker-role-shows-forms');pass('maker-role-shows-forms');

    clarify.open=true;let form=clarify.querySelector('form[data-canonical-event-type="clarify"]');form.querySelector('input').value='いつ発生しますか？';requestSubmit(form);
    await waitFor(()=>window.__BOYAKI_UI_E2E_EVENTS.some(e=>e.event_type==='clarify'),'clarify-ui-submit');pass('clarify-ui-submit');
    await waitFor(()=>document.querySelector('.thread-item[data-event-type="boyaki-clarify"]'),'clarify-render');pass('clarify-render');

    proposal.open=true;form=proposal.querySelector('form[data-canonical-event-type="proposal"]');form.querySelector('input').value='自動転記にする案';requestSubmit(form);
    await waitFor(()=>window.__BOYAKI_UI_E2E_EVENTS.some(e=>e.event_type==='proposal'),'proposal-ui-submit');pass('proposal-ui-submit');
    await waitFor(()=>document.querySelector('.thread-item[data-event-type="boyaki-proposal"]'),'proposal-render');pass('proposal-render');

    await waitFor(()=>document.querySelector('.poster-clarification-answer form[data-canonical-event-type="poster_response"]'),'nested-poster-form-render');
    const answer=document.querySelector('.poster-clarification-answer');answer.open=true;form=answer.querySelector('form[data-canonical-event-type="poster_response"]');form.querySelector('input').value='毎朝発生します';requestSubmit(form);
    await waitFor(()=>window.__BOYAKI_UI_E2E_EVENTS.some(e=>e.event_type==='poster_response'),'nested-poster-response-submit');pass('nested-poster-response-submit');
    await waitFor(()=>document.querySelector('.thread-item[data-event-type="boyaki-poster-response"]'),'poster-response-render');pass('poster-response-render');

    const chips=card.querySelector('.chips')?.textContent||'';
    if(!['詳しい情報 1','提案 1','投稿者の返答 1'].every(x=>chips.includes(x)))fail('thread-count-chips',chips);pass('thread-count-chips',chips.replace(/\s+/g,' '));

    const before=window.__BOYAKI_UI_E2E_EVENTS.length;const del=document.querySelector('[data-canonical-thread-delete]');if(!del)fail('owner-delete-control');del.click();await waitFor(()=>window.__BOYAKI_UI_E2E_EVENTS.length===before-1,'owner-delete-ui');pass('owner-delete-ui');

    const legacy=document.querySelector('#legacy-thread-form');legacy.querySelector('input').value='must remain blocked';requestSubmit(legacy);await sleep(100);
    if(window.__BOYAKI_UI_E2E_LEGACY_REACHED)fail('legacy-nostr-form-freeze');pass('legacy-nostr-form-freeze');
    if(window.BOYAKI_PLAINTEXT_NOSTR_PUBLICATION_DISABLED!==true)fail('global-nostr-freeze-flag');pass('global-nostr-freeze-flag');

    summary.innerHTML='<span class="pass">UI DOM E2E PASS</span> — clarify / proposal / nested poster response / delete / legacy freeze';
    write();write(JSON.stringify({ok:true,results,calls:window.__BOYAKI_UI_E2E_CALLS},null,2));
  }catch(err){const code=String(err?.message||err);summary.innerHTML=`<span class="fail">UI DOM E2E FAIL</span> — ${code}`;write();write(`FAIL ${code}`);console.error(err)}
}
run();
