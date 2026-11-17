/* All database access goes through the authenticated API. Firebase client Rules stay deny-all. */
window.BioBling = (() => {
  let auth, profile, data = {}, timer, loading, epoch=0, draftTimer, draftPromise=Promise.resolve();
  const listeners=new Map();
  const clone=x=>JSON.parse(JSON.stringify(x??null));
  function apiBase(){const value=window.BIOBLING_API_URL;if(!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(value||''))throw Error('Hệ thống đang bảo trì.');return value;}
  async function call(path,body={}) {
    if(!auth?.currentUser)throw Error('Hãy đăng nhập để tiếp tục.');
    const response=await fetch(apiBase()+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await auth.currentUser.getIdToken()},body:JSON.stringify(body),cache:'no-store'});
    const result=await response.json();if(!response.ok){const e=Error(result.error||'Không thể kết nối máy chủ.');e.status=response.status;throw e;}return result;
  }
  const normalized=p=>p.replace(/^\//,'');
  function valueAt(p){return p.split('/').reduce((v,k)=>v?.[k],data)??null;}
  function notify(force=false){
    for(const [p,set] of listeners){const value=valueAt(p),fingerprint=JSON.stringify(value);
      for(const listener of set){if(force||listener.previous!==fingerprint){listener.previous=fingerprint;listener.cb({val:()=>clone(value)});}}
    }
  }
  function clear(){data={};profile=null;epoch++;clearTimeout(timer);clearTimeout(draftTimer);notify(true);BioBling.onProfile?.(null);}
  async function refresh(){
    if(loading)return loading;if(!auth?.currentUser||profile?.status!=='approved')return;
    const currentEpoch=epoch;
    loading=(async()=>{try{
      const next=await call('/snapshot');if(currentEpoch!==epoch)return;
      profile=next.profile;data=next;BioBling.onProfile?.(profile);notify();
    }catch(e){
      if(e.status===401||e.status===403){const s=await call('/session');if(currentEpoch===epoch){profile=s.profile;data={};notify(true);BioBling.onProfile?.(profile);}}
      else BioBling.onError?.(e);
    }finally{loading=null;}})();return loading;
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(async()=>{await refresh();schedule();},document.hidden?60000:15000);}
  async function mutate(path,body){const r=await call(path,body);await refresh();return r;}
  function splitLive(p){const key=p.split('/')[1],match=/^(\d+)_(.+)$/.exec(key||'');if(!match)throw Error('Lượt thi không hợp lệ.');return {userId:match[1],examCode:match[2]};}
  function ref(path){
    const p=normalized(path);return {
      on(event,cb){if(p==='.info/connected'){cb({val:()=>true});return cb;}if(!listeners.has(p))listeners.set(p,new Set());const l={cb};listeners.get(p).add(l);if(profile?.status==='approved'){l.previous=JSON.stringify(valueAt(p));cb({val:()=>clone(valueAt(p))});}return cb;},
      off(){listeners.delete(p);},
      onDisconnect(){return {set:async()=>{}};},
      async set(value){
        if(p==='users'){
          const changed=value.filter(u=>JSON.stringify(u)!==JSON.stringify((data.users||[]).find(old=>old.id===u.id)));
          return mutate(profile?.role==='admin'?'/users':'/profile',profile?.role==='admin'?{users:changed}:value.find(u=>u.id===profile.id)||{});
        }
        if(p.startsWith('status/'))return call('/presence',{state:value.state});
        throw Error('Thao tác không được hỗ trợ.');
      },
      async update(value){
        if(p.startsWith('live_exams/')){
          if(typeof activeDraftAttemptId==='undefined'||!activeDraftAttemptId)return;
          await draftPromise;
          return call('/live',{...splitLive(p),attemptId:activeDraftAttemptId,data:{status:value.status}});
        }
        throw Error('Thao tác không được hỗ trợ.');
      },
      async transaction(modifier){
        const base=await call('/catalog/read',{kind:p});const rows=modifier(base.value);
        await mutate('/catalog',{kind:p,rows,etag:base.etag});return {committed:true,snapshot:{val:()=>rows}};
      },
      async push(value){return mutate('/signal',{...splitLive(p),kind:value.kind,content:value.content});},
      async remove(){if(p.startsWith('status/'))return;return mutate('/live/remove',splitLive(p));}
    };
  }
  const db={collection(name){return {
    onSnapshot(cb){return ref(name).on('value',snap=>{const rows=snap.val()||[];cb({forEach:fn=>rows.forEach(row=>fn({id:row.id||row.code,data:()=>clone(row)}))});});},
    doc(code){return {
      async set(value,options){
        if(name!=='exams')throw Error('Điểm được tính và lưu trên máy chủ.');
        const prior=(data.exams||[]).find(e=>e.code===code);
        return mutate('/exam/save',{exam:options?.merge?{...prior,...value,code}:{...value,code},creating:!prior,revision:prior?.revision});
      },
      async delete(){if(name!=='exams')throw Error('Không thể xóa bài nộp.');return mutate('/exam/archive',{code});}
    };}
  };}};
  return {call,mutate,refresh,ref,db,get profile(){return profile;},get auth(){return auth;},
    init(){auth=firebase.auth();auth.onAuthStateChanged(async user=>{
      clear();if(!user)return;
      try{const s=await call('/session');profile=s.profile;BioBling.onProfile?.(profile);await refresh();schedule();}catch(e){BioBling.onError?.(e);}
    });document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});},
    async login(){await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);return auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());},
    async logout(){try{if(profile?.status==='approved')await call('/presence',{state:'offline'});}catch{}await auth.signOut();clear();},
    queueDraft(attemptId,answers){
      clearTimeout(draftTimer);const snapshot=clone(answers);
      draftTimer=setTimeout(()=>{draftPromise=draftPromise.catch(()=>{}).then(()=>call('/attempt/draft',{attemptId,answers:snapshot})).then(()=>{BioBling.onDraftSaved?.();}).catch(e=>BioBling.onDraftError?.(e));},800);
    },
    async submit(attemptId,answers){clearTimeout(draftTimer);await draftPromise;const r=await mutate('/attempt/submit',{attemptId,answers});return r.result;}
  };
})();

