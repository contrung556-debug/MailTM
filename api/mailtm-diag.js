// Mail.tm Diagnostic v1.1.0
const BASE='https://api.mail.tm';

async function upstream(path, options={}){
  const started=Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(BASE+path,{...options,signal:controller.signal,headers:{'accept':'application/ld+json, application/json;q=0.9, */*;q=0.8',...(options.headers||{})}});
    const text=await r.text();
    let body=text; try{body=JSON.parse(text)}catch{}
    const headers={};
    for(const [k,v] of r.headers.entries()){
      if(['content-type','server','via','cf-ray','x-vercel-id','date','retry-after','access-control-allow-origin'].includes(k.toLowerCase())) headers[k]=v;
    }
    return {ok:r.ok,status:r.status,statusText:r.statusText,elapsed_ms:Date.now()-started,headers,body};
  }catch(e){
    return {ok:false,status:null,elapsed_ms:Date.now()-started,error:String(e?.message||e),name:e?.name||'Error',cause:e?.cause?String(e.cause):undefined};
  }finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({ok:false,error:'POST only',version:'1.1.0'});
  const {action,address,password}=req.body||{};
  let result;
  if(action==='domains'){
    result=await upstream('/domains');
  } else if(action==='account'){
    if(!address||!password) return res.status(400).json({ok:false,error:'address/password required'});
    result=await upstream('/accounts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address,password})});
  } else if(action==='token'){
    if(!address||!password) return res.status(400).json({ok:false,error:'address/password required'});
    result=await upstream('/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address,password})});
  } else {
    return res.status(400).json({ok:false,error:'unknown action'});
  }
  // Diagnostic endpoint: preserve upstream status when available so browser shows it clearly.
  const code = result.status && result.status>=100 && result.status<=599 ? result.status : (result.ok?200:502);
  return res.status(code).json({version:'1.1.0',mode:'vercel-server-diagnostic',action,...result});
}
