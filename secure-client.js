/* All database access goes through the authenticated API. Firebase client Rules stay deny-all. */
window.BioBling = (() => {
  let auth, profile, data = {}, timer, loading, epoch=0, draftTimer, draftPromise=Promise.resolve(), loginPromise;
  let persistenceReady=false, persistenceError, expiryTimer, snapshotReceivedAt=0;
  const SESSION_MAX_AGE_MS=30*24*60*60*1000;
  const expiredMessage='Phiên đăng nhập đã đủ 30 ngày. Vui lòng đăng nhập Google lại để tiếp tục.';
  function loginError(error){
    const messages={
      'auth/popup-closed-by-user':'Đăng nhập chưa hoàn tất vì cửa sổ Google đã đóng. Bấm “Tiếp tục với Google” để thử lại và giữ cửa sổ mở đến khi hoàn tất.',
      'auth/cancelled-popup-request':'Một cửa sổ đăng nhập đang mở. Hãy hoàn tất trong cửa sổ Google đó.',
      'auth/popup-blocked':'Trình duyệt đang chặn cửa sổ Google. Cho phép cửa sổ bật lên tại biobling.vercel.app, rồi bấm đăng nhập lại. Nếu mở từ Zalo hoặc Facebook, hãy mở trang bằng Chrome, Edge hoặc Safari.',
      'auth/web-storage-unsupported':'Trình duyệt đang chặn lưu đăng nhập. Hãy cho phép dữ liệu trang web và mở BioBling trong cửa sổ duyệt web thông thường.',
      'auth/network-request-failed':'Chưa kết nối được với Google. Kiểm tra mạng rồi thử đăng nhập lại.',
      'auth/unauthorized-domain':'Địa chỉ website này chưa được cho phép đăng nhập. Hãy truy cập https://biobling.vercel.app.',
      'auth/too-many-requests':'Có quá nhiều lần đăng nhập liên tiếp. Bạn đợi một lúc rồi thử lại nhé.'
    };
    return {message:messages[error?.code]||error?.userMessage||'Chưa thể đăng nhập Google. Vui lòng thử lại bằng Chrome, Edge hoặc Safari.',neutral:['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(error?.code)};
  }
  function preparePersistence(){
    persistenceReady=false;persistenceError=null;
    return auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).then(()=>{persistenceReady=true;},e=>{persistenceError=e;});
  }
  async function expireSession(user,message=expiredMessage){
    if(auth.currentUser!==user)return;
    clear();await auth.signOut();BioBling.onError?.(Object.assign(Error(message),{userMessage:message}));
  }
  async function sessionToken(user){
    const token=await user.getIdTokenResult();
    if(auth.currentUser!==user)throw Error('Phiên đăng nhập đã thay đổi.');
    const signedInAt=token.claims.auth_time;
    const remaining=Number.isFinite(signedInAt)?signedInAt*1000+SESSION_MAX_AGE_MS-Date.now():0;
    if(remaining<=0){await expireSession(user);throw Object.assign(Error(expiredMessage),{status:401,reported:true});}
    clearTimeout(expiryTimer);
    // Recheck after wake-up and cap the timeout below the browser's integer limit.
    expiryTimer=setTimeout(()=>sessionToken(user).catch(e=>{if(!e.reported&&auth.currentUser===user)BioBling.onError?.(e);}),Math.min(remaining,300000));
    return token.token;
  }
  const listeners=new Map();
  const clone=x=>JSON.parse(JSON.stringify(x??null));
  function apiBase(){const value=window.BIOBLING_API_URL;if(!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(value||''))throw Error('Hệ thống đang bảo trì.');return value;}
  async function call(path,body={}) {
    if(!auth?.currentUser)throw Error('Hãy đăng nhập để tiếp tục.');
    const user=auth.currentUser,token=await sessionToken(user);
    const response=await fetch(apiBase()+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),cache:'no-store'});
    const result=await response.json();if(!response.ok){const e=Error(result.error||'Không thể kết nối máy chủ.');e.status=response.status;if(e.status===401){await expireSession(user,'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập Google lại.');e.reported=true;}throw e;}return result;
  }
  const normalized=p=>p.replace(/^\//,'');
  function valueAt(p){return p.split('/').reduce((v,k)=>v?.[k],data)??null;}
  function notify(force=false){
    for(const [p,set] of listeners){const value=valueAt(p),fingerprint=JSON.stringify(value);
      for(const listener of set){if(force||listener.previous!==fingerprint){listener.previous=fingerprint;listener.cb({val:()=>clone(value)});}}
    }
  }
  function clear(){data={};profile=null;epoch++;clearTimeout(timer);clearTimeout(expiryTimer);clearTimeout(draftTimer);notify(true);BioBling.onProfile?.(null);}
  async function refresh(){
    if(loading)return loading;if(!auth?.currentUser)return;
    const currentEpoch=epoch;
    loading=(async()=>{try{
      if(profile?.status!=='approved'){
        const session=await call('/session');if(currentEpoch!==epoch)return;
        profile=session.profile;BioBling.onProfile?.(profile);if(profile?.status!=='approved')return;
      }
      const next=await call('/snapshot',{active:!document.hidden});if(currentEpoch!==epoch)return;
      profile=next.profile;data=next;snapshotReceivedAt=Date.now();BioBling.onProfile?.(profile);notify();
    }catch(e){
      if(e.reported||currentEpoch!==epoch)return;
      if(e.status===403){try{const s=await call('/session');if(currentEpoch===epoch){profile=s.profile;data={};notify(true);BioBling.onProfile?.(profile);}}catch(error){if(!error.reported)BioBling.onError?.(error);}}
      else BioBling.onError?.(e);
    }finally{loading=null;}})();return loading;
  }
  function schedule(){clearTimeout(timer);if(auth?.currentUser)timer=setTimeout(async()=>{await refresh();schedule();},document.hidden?60000:15000);}
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
  return {call,mutate,refresh,ref,db,loginError,get profile(){return profile;},get auth(){return auth;},
    isOnline(status){const now=Number(data.serverTime)+Math.max(0,Date.now()-snapshotReceivedAt);return status?.state==='online'&&Number.isFinite(status.lastChanged)&&now>=status.lastChanged&&now-status.lastChanged<90000;},
    init(){auth=firebase.auth();preparePersistence();auth.onAuthStateChanged(async user=>{
      clear();if(!user){BioBling.onReady?.();return;}
      const currentEpoch=epoch;
      try{const s=await call('/bootstrap',{active:!document.hidden});if(currentEpoch!==epoch)return;profile=s.profile;data=s;snapshotReceivedAt=Date.now();BioBling.onProfile?.(profile);notify(true);schedule();}catch(e){if(!e.reported)BioBling.onError?.(e);}finally{BioBling.onReady?.();}
    });document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});},
    async login(){
      if(loginPromise)return loginPromise;
      if(!persistenceReady){if(persistenceError){const error=persistenceError;preparePersistence();throw error;}throw {userMessage:'Đang chuẩn bị đăng nhập. Bạn bấm lại sau giây lát nhé.'};}
      // Open directly in the click handler: no persistence await before the popup.
      loginPromise=auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      try{return await loginPromise;}catch(e){
        if(e.code==='auth/popup-closed-by-user'&&auth.currentUser){await sessionToken(auth.currentUser);await refresh();return {user:auth.currentUser};}
        throw e;
      }finally{loginPromise=null;}
    },
    async logout(){try{if(profile?.status==='approved')await call('/presence',{state:'offline'});}catch{}await auth.signOut();clear();},
    queueDraft(attemptId,answers){
      clearTimeout(draftTimer);const snapshot=clone(answers);
      draftTimer=setTimeout(()=>{draftPromise=draftPromise.catch(()=>{}).then(()=>call('/attempt/draft',{attemptId,answers:snapshot})).then(()=>{BioBling.onDraftSaved?.();}).catch(e=>BioBling.onDraftError?.(e));},800);
    },
    async submit(attemptId,answers){clearTimeout(draftTimer);await draftPromise;const r=await mutate('/attempt/submit',{attemptId,answers});return r.result;}
  };
})();
