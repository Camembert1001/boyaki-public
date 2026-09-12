(()=>{
  const NS='yn0-jpui-a4c19f72e63b';
  const BASE='https://abacus.jasoncameron.dev/hit/'+NS+'/';
  window.metric=(name)=>{
    try{
      fetch(BASE+encodeURIComponent(name),{method:'GET',mode:'cors',cache:'no-store',keepalive:true}).catch(()=>{});
    }catch(e){}
  };
  const p=location.pathname;
  if(p.endsWith('/yn0-jp-ui-preflight/')||p.endsWith('/yn0-jp-ui-preflight/index.html')) window.metric('landing-view');
  else if(p.endsWith('/yn0-jp-ui-preflight/jp-game-ui-kit.html')) window.metric('product-view');
})();
