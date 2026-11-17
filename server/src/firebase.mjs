import {HttpError,requireValue} from './domain.mjs';
const encoder=new TextEncoder();
const unbase64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const base64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encode=x=>base64(encoder.encode(JSON.stringify(x)));
let googleKeys={until:0,keys:[]}, serviceToken={until:0,value:'',identity:''};
export function normalizeFirebase(value,key='') {
  if(!value||typeof value!=='object')return value;
  const isQuestionMap=['mcqKeys','tfKeys','saKeys','mcq','tf','sa','keys'].includes(key);
  if(Array.isArray(value)&&!isQuestionMap)return value.map(v=>normalizeFirebase(v));
  return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,normalizeFirebase(v,k)]));
}
export async function verifyIdentity(token, project, fetcher=fetch) {
  try {
    requireValue(typeof token==='string' && token.length<12000,'Phiên đăng nhập không hợp lệ.',401);
    const parts=token.split('.');requireValue(parts.length===3,'Phiên đăng nhập không hợp lệ.',401);
    const h=JSON.parse(new TextDecoder().decode(unbase64(parts[0]))),p=JSON.parse(new TextDecoder().decode(unbase64(parts[1])));
    const now=Math.floor(Date.now()/1000);
    requireValue(h.alg==='RS256' && typeof h.kid==='string' && p.aud===project && p.iss===`https://securetoken.google.com/${project}` && typeof p.sub==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(p.sub) && p.exp>now && p.iat<=now+30 && p.auth_time<=now+30,'Phiên đăng nhập đã hết hạn.',401);
    requireValue(p.firebase?.sign_in_provider==='google.com' && p.email_verified===true,'Hãy đăng nhập bằng tài khoản Google đã xác minh.',401);
    if(googleKeys.until<Date.now()) {
      const r=await fetcher('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
      if(!r.ok)throw new HttpError(503,'Chưa xác minh được phiên đăng nhập.');
      const body=await r.json();googleKeys={keys:body.keys,until:Date.now()+3600000};
    }
    const jwk=googleKeys.keys.find(k=>k.kid===h.kid);requireValue(jwk,'Phiên đăng nhập không hợp lệ.',401);
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    requireValue(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unbase64(parts[2]),encoder.encode(parts[0]+'.'+parts[1])),'Phiên đăng nhập không hợp lệ.',401);
    return {...p,uid:p.sub};
  } catch(e) { if(e instanceof HttpError)throw e;throw new HttpError(401,'Phiên đăng nhập không hợp lệ.'); }
}
async function accessToken(env) {
  const sa=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if(serviceToken.until>Date.now() && serviceToken.identity===sa.client_email)return serviceToken.value;
  const now=Math.floor(Date.now()/1000),header=encode({alg:'RS256',typ:'JWT'}),payload=encode({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const key=await crypto.subtle.importKey('pkcs8',unbase64(sa.private_key.replace(/-----[^-]+-----|\s/g,'')),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const assertion=header+'.'+payload+'.'+base64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(header+'.'+payload)));
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!r.ok)throw new HttpError(503,'Dịch vụ dữ liệu chưa sẵn sàng.');
  const t=await r.json();serviceToken={until:Date.now()+(t.expires_in-120)*1000,value:t.access_token,identity:sa.client_email};return t.access_token;
}
export class Store {
  constructor(env){this.env=env;}
  async request(path,method='GET',body,etag) {
    const token=await accessToken(this.env);
    const r=await fetch(`${this.env.FIREBASE_DATABASE}/secure/${path}.json`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(method==='GET'?{'X-Firebase-ETag':'true'}:{}),...(etag?{'if-match':etag}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(r.status===412)throw new HttpError(409,'Dữ liệu đã thay đổi, hãy tải lại và thử lại.');
    if(!r.ok)throw new HttpError(503,'Không thể đồng bộ dữ liệu.');
    return {value:normalizeFirebase(await r.json()),etag:r.headers.get('etag')};
  }
  async get(path){return (await this.request(path)).value;}
  async put(path,data,etag){return (await this.request(path,'PUT',data,etag)).value;}
  async patch(path,data){return (await this.request(path,'PATCH',data)).value;}
  async transaction(path,fn){
    for(let i=0;i<4;i++) {
      const old=await this.request(path); const value=await fn(old.value);
      try {return await this.put(path,value,old.etag);} catch(e){if(e.status!==409 || i===3)throw e;}
    }
  }
}
