import { client } from './canonical-api.js?v=20260919-solution-flow-v3';
export async function loadOwnedPosts(){
  const box=document.querySelector('#own-posts');if(!box)return;
  const result=await client.listMine(),posts=(result.posts||[]).filter(p=>p.status==='active');box.replaceChildren();
  document.querySelector('#ownership-status').textContent='AI-STAGINGに保存した自分のBOYAKIを管理できます。';
  if(!posts.length){box.textContent='公開中のBOYAKIはありません。';return}
  for(const post of posts){
    const card=document.createElement('article');card.className='participation-panel';card.dataset.ownedPostId=post.id;
    const text=document.createElement('p');text.textContent=post.content;
    const open=document.createElement('a');open.href=`./?problem=${post.id}`;open.className='button-link';open.textContent='投稿を見る';
    const del=document.createElement('button');del.type='button';del.textContent='自分の投稿を削除';
    del.addEventListener('click',async()=>{del.disabled=true;try{await client.deletePost(post.id);await loadOwnedPosts()}catch{del.disabled=false;document.querySelector('#ownership-status').textContent='削除できませんでした。再試行してください。'}});
    card.append(text,open,del);box.append(card);
  }
}
