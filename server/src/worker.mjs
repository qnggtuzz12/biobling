import {Store,verifyIdentity} from './firebase.mjs';
import {social} from './social.mjs';
import {HttpError,requireValue,object,list,text,id,httpsUrl,classesOf,assigned,admin,canAccess,requireAdmin,safeUser,validateKeys,publicExam,cleanAnswers,grade,deadlineMs,studentSubmission} from './domain.mjs';

function owner(user,env){return admin(user) && user.uid===env.OWNER_UID;}
function assertApproved(user){requireValue(user?.status==='approved','Tài khoản đang chờ giảng viên phê duyệt.',403);}
function uidUser(accounts,uid){return Object.values(accounts||{}).find(u=>u.uid===uid);}
function profileChanges(value){
  const out={};
  if(value.fullName!==undefined)out.fullName=text(value.fullName,100,true);
  if(value.bio!==undefined)out.bio=text(value.bio,1000);
  if(value.avatar!==undefined){text(value.avatar,180000);requireValue(!value.avatar || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.avatar) || httpsUrl(value.avatar));out.avatar=value.avatar;}
  return out;
}
function validateCatalog(kind, rows){
  requireValue(Array.isArray(rows) && rows.length<=1500); const ids=new Set();
  for(const r of rows){
    requireValue(object(r));id(String(r.id));requireValue(!ids.has(String(r.id)));ids.add(String(r.id));
    if(kind==='classes')text(r.name,150,true);else text(r.title,300,true);
    requireValue(JSON.stringify(r).length<=15000);
    if(kind==='media')httpsUrl(r.url);
    for(const k of ['classId','sessionId'])if(r[k])id(r[k]);
    if(r.classIds){requireValue(Array.isArray(r.classIds)&&r.classIds.length<=100);r.classIds.forEach(id);}
    for(const [k,v] of Object.entries(r))requireValue(!['__proto__','constructor','prototype','password'].includes(k) && (typeof v==='string'?v.length<=10000:true));
  }
  return rows;
}
function validateExam(input){
  requireValue(object(input));const e={};
  e.code=id(input.code);e.title=text(input.title,300,true);e.rawDocsUrl=httpsUrl(input.rawDocsUrl);e.embedUrl=httpsUrl(input.embedUrl||input.rawDocsUrl);
  e.timeLimit=Number(input.timeLimit);requireValue(Number.isInteger(e.timeLimit)&&e.timeLimit>=1&&e.timeLimit<=600);
  e.targetClassIds=[...new Set(input.targetClassIds||[input.targetClassId])];requireValue(e.targetClassIds.length>0&&e.targetClassIds.length<=100);e.targetClassIds.forEach(id);e.targetClassId=e.targetClassIds[0];
  e.isUnlimited=!!input.isUnlimited;e.practiceOnly=!!input.practiceOnly;e.deadline=text(input.deadline||'',50);deadlineMs(e.deadline);
  for(const k of ['mcqKeys','tfKeys','saKeys'])e[k]=input[k]||{};validateKeys(e);
  for(const k of ['rawMcq','rawTf','rawSa'])e[k]=text(input[k]||'',15000);
  e.updatedAt=new Date().toISOString();e.revision=crypto.randomUUID();return e;
}
async function snapshot(store,user,active=false){
  if(active)await store.put(`status/${user.username}`,{state:'online',lastChanged:Date.now()});
  const elevated=admin(user);
  const [catalog,exams,accounts,attempts,legacy,live,status,legacyKeys]=await Promise.all([
    store.get('catalog'),store.get('exams'),store.get('accounts'),store.get(elevated?'attempts':`attempts/${user.uid}`),store.get('legacySubmissions'),store.get(elevated?'live':`live/${user.id}`),store.get('status'),store.get('legacyPrivateKeys')
  ]);
  const submissions=elevated?Object.values(attempts||{}).flatMap(x=>Object.values(x||{})):Object.values(attempts||{});
  const mine=classesOf(user);
  const users=Object.values(accounts||{}).filter(u=>elevated||u.id===user.id||(u.status==='approved'&&classesOf(u).some(c=>mine.includes(c)))).map(u=>safeUser(u,elevated||u.id===user.id));
  const userNames=new Set(users.map(u=>u.username));
  const liveRows=elevated?Object.values(live||{}).flatMap(x=>Object.values(x||{})):Object.values(live||{});
  return {profile:safeUser(user,true),classes:list(catalog?.classes).filter(c=>elevated||mine.includes(String(c.id))),
    sessions:list(catalog?.sessions).filter(s=>canAccess(user,s)),media:list(catalog?.media).filter(m=>canAccess(user,m)),users,
    exams:Object.values(exams||{}).filter(e=>!e.archived && canAccess(user,e,true)).map(e=>elevated?e:publicExam(e)),
    submissions:[...submissions.filter(a=>a.result).map(a=>elevated?{...a.result,gradingKeys:{mcq:a.examSnapshot.mcqKeys||{},tf:a.examSnapshot.tfKeys||{},sa:a.examSnapshot.saKeys||{}}}:studentSubmission(a.result,a.examSnapshot)),...Object.values(legacy||{}).filter(s=>elevated||String(s.userId)===String(user.id)).map(s=>elevated?{...s,...(legacyKeys?.[s.id]?{gradingKeys:legacyKeys[s.id]}:{})}:studentSubmission(s,legacyKeys?.[s.id]?{...s,mcqKeys:legacyKeys[s.id].mcq,tfKeys:legacyKeys[s.id].tf,saKeys:legacyKeys[s.id].sa}:null))],
    live_exams:Object.fromEntries(liveRows.filter(Boolean).map(s=>[s.sessionKey,s])),status:Object.fromEntries(Object.entries(status||{}).filter(([k])=>userNames.has(k)).map(([k,s])=>[k.toLowerCase(),{state:s?.state==='online'&&Number.isFinite(s.lastChanged)&&Date.now()-s.lastChanged>=0&&Date.now()-s.lastChanged<90000?'online':'offline',lastChanged:s?.lastChanged||0}])),serverTime:Date.now()};
}
export async function dispatch(path,body,identity,env,store){
  let accounts=await store.get('accounts')||{};
  let user=uidUser(accounts,identity.uid);
  if(path==='/session'||path==='/bootstrap') {
    if(!user){
      const newId=Date.now()*100+crypto.getRandomValues(new Uint8Array(1))[0]%100;
      const p={id:newId,uid:identity.uid,username:'hv_'+String(newId),email:identity.email,fullName:text(identity.name||'Học viên',100,true),role:'student',status:'pending',classId:'',classIds:[],avatar:'',bio:'',createdAt:new Date().toLocaleDateString('vi-VN')};
      accounts=await store.transaction('accounts',old=>{old=old||{};if(!uidUser(old,identity.uid))old[newId]=p;return old;});user=uidUser(accounts,identity.uid);
    }
    return path==='/bootstrap'&&user.status==='approved'?snapshot(store,user,body.active===true):{profile:safeUser(user,true)};
  }
  requireValue(user,'Hãy đăng nhập lại.',401);assertApproved(user);
  if(path==='/snapshot')return snapshot(store,user,body.active===true);
  if(path.startsWith('/social/'))return social(path,body,user,accounts,store);
  if(path==='/comments/list'||path==='/comments/add'){
    const mediaId=id(String(body.mediaId));
    const media=list(await store.get('catalog/media')).find(m=>String(m.id)===mediaId);
    requireValue(media&&media.type==='drive_video'&&canAccess(user,media),'Bạn không có quyền xem video này.',403);
    const location=`comments/${mediaId}`;
    if(path==='/comments/add'){
      const content=text(body.content,2000,true).trim();requireValue(content.length>0);
      const commentId=id(body.commentId);
      await store.transaction(location,old=>{
        old=old||{};if(old[commentId]){requireValue(old[commentId].uid===user.uid,'Bình luận không hợp lệ.',403);return old;}
        const recent=Object.values(old).filter(c=>c.uid===user.uid).sort((a,b)=>b.createdAt-a.createdAt)[0];
        requireValue(!recent||Date.now()-recent.createdAt>=5000,'Bạn đợi vài giây rồi gửi tiếp nhé.',429);
        return {...old,[commentId]:{id:commentId,uid:user.uid,name:user.fullName||user.username,content,createdAt:Date.now(),teacher:admin(user)}};
      });
    }
    return {comments:Object.values(await store.get(location)||{}).sort((a,b)=>b.createdAt-a.createdAt).map(({uid,...c})=>({...c,avatar:uidUser(accounts,uid)?.avatar||''}))};
  }
  if(path==='/profile'){
    const patch=profileChanges(body);await store.transaction('accounts',old=>{requireValue(old?.[user.id]?.uid===identity.uid,'Tài khoản đã thay đổi.',403);return {...old,[user.id]:{...old[user.id],...patch}};});return {ok:true};
  }
  if(path==='/users'){
    requireAdmin(user);requireValue(Array.isArray(body.users)&&body.users.length<=3000);
    await store.transaction('accounts',old=>{
      requireAdmin(uidUser(old,identity.uid));
      for(const proposed of body.users){
        const prior=old?.[proposed.id];requireValue(prior,'Không tạo tài khoản bằng mật khẩu cũ. Học viên cần đăng nhập Google trước.');
        if((prior.role==='admin'||proposed.role==='admin') && !(prior.uid===identity.uid&&prior.role===proposed.role&&prior.status===proposed.status))requireValue(owner(user,env),'Chỉ chủ hệ thống quản lý giảng viên.',403);
        requireValue(proposed.uid===prior.uid,'Không được thay liên kết tài khoản bằng thao tác này.',403);
        requireValue(['student','admin'].includes(proposed.role)&&['approved','pending','suspended'].includes(proposed.status));
        if(prior.uid===env.OWNER_UID)requireValue(proposed.role==='admin'&&proposed.status==='approved','Không thể khóa chủ hệ thống.');
        const classIds=[...new Set(proposed.classIds||[proposed.classId].filter(Boolean))];requireValue(classIds.length<=100);classIds.forEach(id);
        old[prior.id]={...prior,...profileChanges(proposed),role:proposed.role,status:proposed.status,classIds,classId:classIds[0]||''};
      }
      return old;
    });return {ok:true};
  }
  if(path==='/users/link'){
    requireAdmin(user);const sourceId=Number(body.pendingId),targetId=Number(body.legacyId);
    await store.transaction('accounts',old=>{
      requireAdmin(uidUser(old,identity.uid));const source=old?.[sourceId],target=old?.[targetId];
      requireValue(source?.uid&&source.status==='pending'&&target&&!target.uid&&target.migrationRequired,'Liên kết tài khoản không hợp lệ.');
      if(target.role==='admin')requireValue(owner(user,env),'Chỉ chủ hệ thống liên kết giảng viên.',403);
      old[targetId]={...target,uid:source.uid,email:source.email,migrationRequired:false,status:'approved'};delete old[sourceId];return old;
    });return {ok:true};
  }
  if(path==='/catalog'){
    requireAdmin(user);requireValue(['classes','sessions','media'].includes(body.kind));
    const rows=validateCatalog(body.kind,body.rows);
    const current=await store.request(`catalog/${body.kind}`);requireValue(body.etag===current.etag,'Dữ liệu đã được thay đổi. Hãy tải lại.',409);
    await store.put(`catalog/${body.kind}`,rows,current.etag);return {ok:true};
  }
  if(path==='/catalog/read') {requireAdmin(user);requireValue(['classes','sessions','media'].includes(body.kind));return store.request(`catalog/${body.kind}`);}
  if(path==='/exam/regrade') {
    requireAdmin(user);const code=id(body.code),keys={mcqKeys:body.mcqKeys,tfKeys:body.tfKeys,saKeys:body.saKeys};validateKeys(keys);
    const shape=e=>JSON.stringify(['mcqKeys','tfKeys','saKeys'].map(k=>Object.keys(e[k]||{}).sort()));
    const revision=crypto.randomUUID(),at=new Date().toISOString();let graded=0,active=0,skipped=0;
    const root=await store.transaction('',data=>{
      requireAdmin(uidUser(data?.accounts,identity.uid));graded=0;active=0;skipped=0;
      const exam=data.exams?.[code];requireValue(exam,'Không tìm thấy đề.',404);
      requireValue(exam.revision===body.revision,'Đáp án đã thay đổi. Hãy đóng và mở lại bài trước khi sửa.',409);
      requireValue(shape(exam)===shape(keys),'Cấu trúc đề đã thay đổi; không thể chấm lại bằng bộ đáp án này.',409);
      data.regradeHistory??={};data.regradeHistory[revision]={code,at,by:identity.uid,previousRevision:exam.revision||null,previousKeys:{mcqKeys:exam.mcqKeys||{},tfKeys:exam.tfKeys||{},saKeys:exam.saKeys||{}},newKeys:keys};
      data.exams[code]={...exam,...keys,revision,updatedAt:at};
      const regrade=(result,e)=>({...result,...grade(result.answers||{mcq:{},tf:{},sa:{}},e),previousScore:result.score??null,regradedAt:at,regradedBy:identity.uid,questionStructure:publicExam(e)});
      for(const attempts of Object.values(data.attempts||{}))for(const a of Object.values(attempts||{})){
        if(a.examCode!==code)continue;
        if(shape(a.examSnapshot)!==shape(keys)){skipped++;continue;}
        a.examSnapshot={...a.examSnapshot,...keys,revision,updatedAt:at};
        if(a.result){a.result=regrade(a.result,a.examSnapshot);graded++;}else active++;
      }
      for(const [sid,s] of Object.entries(data.legacySubmissions||{})){
        if(s.examCode!==code)continue;
        const old=data.legacyPrivateKeys?.[sid];
        if(!old||!s.answers||shape({mcqKeys:old.mcq,tfKeys:old.tf,saKeys:old.sa})!==shape(keys)){skipped++;continue;}
        const e={...exam,...keys,practiceOnly:!!s.practiceOnly};data.legacySubmissions[sid]=regrade(s,e);
        data.legacyPrivateKeys[sid]={mcq:keys.mcqKeys,tf:keys.tfKeys,sa:keys.saKeys};graded++;
      }
      data.regradeHistory[revision].counts={graded,active,skipped};return data;
    });
    return {exam:root.exams[code],graded,active,skipped};
  }
  if(path==='/exam/save') {
    requireAdmin(user);const e=validateExam(body.exam);const current=await store.get(`exams/${e.code}`);
    requireValue(body.creating?!current:!!current,body.creating?'Mã đề đã tồn tại.':'Không tìm thấy đề.',409);
    if(current)requireValue(body.revision===current.revision,'Đề đã được người khác chỉnh sửa. Hãy tải lại.',409);
    await store.transaction(`exams/${e.code}`,old=>{requireValue((old?.revision||null)===(current?.revision||null),'Đề đã thay đổi.',409);return e;});return {exam:e};
  }
  if(path==='/exam/archive') {requireAdmin(user);id(body.code);await store.transaction(`exams/${body.code}`,e=>{requireValue(e,'Không tìm thấy đề.',404);return {...e,archived:true};});return {ok:true};}
  if(path==='/attempt/start'){
    const code=id(body.code),exam=await store.get(`exams/${code}`);requireValue(exam&&!exam.archived&&canAccess(user,exam,true),'Không có quyền làm đề này.',403);
    validateKeys(exam);const now=Date.now(),deadline=deadlineMs(exam.deadline);requireValue(!deadline||now<deadline,'Đề đã hết hạn.',403);
    const attemptId=id(body.attemptId),slot=`attempts/${identity.uid}/${attemptId}`;
    const attempt=await store.transaction(slot,old=>{
      if(old){requireValue(old.examCode===code,'Lượt thi không khớp.',409);return old;}
      const timer=exam.isUnlimited?null:now+exam.timeLimit*60000;
      return {id:attemptId,uid:identity.uid,userId:user.id,examCode:code,examSnapshot:exam,startedAt:now,expiresAt:deadline&&timer?Math.min(timer,deadline):(deadline||timer),draft:{mcq:{},tf:{},sa:{}},draftSavedAt:now};
    });
    return {attemptId,startedAt:attempt.startedAt,expiresAt:attempt.expiresAt,answers:attempt.draft||{},exam:publicExam(attempt.examSnapshot),result:attempt.result?studentSubmission(attempt.result,attempt.examSnapshot):null,serverTime:Date.now()};
  }
  if(path==='/attempt/draft'||path==='/attempt/submit'){
    const attemptId=id(body.attemptId),slot=`attempts/${identity.uid}/${attemptId}`,submit=path.endsWith('/submit'),now=Date.now();
    const a=await store.transaction(slot,old=>{
      requireValue(old&&old.uid===identity.uid,'Không tìm thấy lượt thi.',404);
      requireValue(canAccess(user,old.examSnapshot,true),'Không còn quyền làm đề này.',403);
      if(old.result)return old; // Idempotent retry returns the first accepted result.
      const expired=old.expiresAt&&now>old.expiresAt;
      if(!submit)requireValue(!expired,'Đã hết giờ; hãy nộp bản nháp cuối cùng đã đồng bộ.',409);
      // Late submissions grade only the draft accepted before the server deadline.
      const answers=expired?(old.draft||{mcq:{},tf:{},sa:{}}):cleanAnswers(body.answers,old.examSnapshot);
      if(!submit)return {...old,draft:answers,draftSavedAt:now};
      const e=old.examSnapshot,result={...grade(answers,e),id:attemptId,attemptId,userId:user.id,username:user.username,fullName:user.fullName,classId:user.classId||'',examCode:e.code,examTitle:e.title,rawDocsUrl:e.rawDocsUrl,embedUrl:e.embedUrl,practiceOnly:!!e.practiceOnly,startedAt:new Date(old.startedAt).toISOString(),submittedAt:new Date(now).toISOString(),examUpdatedAt:e.updatedAt,gradedBy:'server',lateSubmission:!!expired,questionStructure:publicExam(e)};
      return {...old,result,draft:answers};
    });return {result:a.result?studentSubmission(a.result,a.examSnapshot):null,savedAt:a.draftSavedAt};
  }
  if(path==='/live/view'){
    requireAdmin(user);const target=id(body.userId),code=id(body.examCode);
    const session=await store.get('live/'+target+'/'+code);requireValue(session,'Phiên theo dõi không còn tồn tại.',404);
    const account=Object.values(accounts).find(u=>String(u.id)===target);
    const attempts=account?.uid?await store.get('attempts/'+account.uid):null;
    const attempt=Object.values(attempts||{}).find(a=>a.examCode===code&&(session.attemptId?a.id===session.attemptId:a.startedAt===session.startedAt));
    requireValue(attempt,'Không tìm thấy lượt làm bài tương ứng. Hãy tải lại danh sách live.',404);
    return {exam:attempt.examSnapshot,session:{...session,answers:attempt.result?.answers||attempt.draft||{},status:attempt.result?'submitted':session.status}};
  }
  if(path==='/live'){
    id(body.examCode);const data=body.data||{},key=`${user.id}_${body.examCode}`;
    const mine=await store.get(`attempts/${identity.uid}/${id(body.attemptId)}`);requireValue(mine&&mine.examCode===body.examCode,'Lượt thi không hợp lệ.',403);
    const next={attemptId:mine.id,sessionKey:key,userId:user.id,username:user.username,fullName:user.fullName,classNames:classesOf(user).join(', '),examCode:mine.examCode,examTitle:mine.examSnapshot.title,status:mine.result?'submitted':(data.status==='paused'?'paused':'active'),startedAt:mine.startedAt,expiresAt:mine.expiresAt,answers:mine.draft||{},updatedAt:Date.now(),totalItems:0};
    const e=mine.examSnapshot;next.totalItems=Object.keys(e.mcqKeys||{}).length+Object.keys(e.tfKeys||{}).length+Object.keys(e.saKeys||{}).length;
    next.totalCount=next.totalItems;
    next.answeredCount=Object.keys(next.answers.mcq||{}).length+Object.values(next.answers.tf||{}).filter(x=>Object.keys(x).length===4).length+Object.keys(next.answers.sa||{}).length;
    await store.patch(`live/${user.id}/${body.examCode}`,next);return {ok:true};
  }
  if(path==='/signal'){
    requireAdmin(user);const target=id(body.userId),code=id(body.examCode),s=await store.get(`live/${target}/${code}`);requireValue(s,'Lượt thi không còn hoạt động.',404);
    const signals=Object.entries(s.signals||{}).slice(-19);signals.push([crypto.randomUUID(),{senderName:user.fullName||user.username,kind:body.kind==='emote'?'emote':'banner',content:text(body.content,500,true),time:Date.now()}]);
    await store.put(`live/${target}/${code}/signals`,Object.fromEntries(signals));return {ok:true};
  }
  if(path==='/live/remove'){requireAdmin(user);id(body.userId);id(body.examCode);await store.put(`live/${body.userId}/${body.examCode}`,null);return {ok:true};}
  if(path==='/presence') {await store.put(`status/${user.username}`,{state:body.state==='offline'?'offline':'online',lastChanged:Date.now()});return {ok:true};}
  throw new HttpError(404,'Không tìm thấy thao tác.');
}

export function createHandler({identityVerifier=verifyIdentity,storeFactory=env=>new Store(env)}={}){
  return async function handle(request,env){
    const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',');
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}:{})};
    const reply=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
    try{
      requireValue(!origin||allowed.includes(origin),'Nguồn yêu cầu không được phép.',403);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(new URL(request.url).pathname==='/health')return reply({service:'BioBling',maintenance:env.RELEASE_ENABLED!=='true'});
      requireValue(request.method==='POST','Phương thức không hợp lệ.',405);
      const token=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      const identity=await identityVerifier(token,env.FIREBASE_PROJECT);
      requireValue(env.RELEASE_ENABLED==='true'||identity.uid===env.OWNER_UID,'Hệ thống đang bảo trì.',503);
      if(env.API_RATE_LIMITER){const limit=await env.API_RATE_LIMITER.limit({key:identity.uid});requireValue(limit.success,'Bạn thao tác quá nhanh. Vui lòng thử lại sau một phút.',429);}
      const reader=request.body?.getReader();let raw='',size=0;const decoder=new TextDecoder();
      if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>400000){await reader.cancel();throw new HttpError(413,'Dữ liệu quá lớn.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
      let body;try{body=JSON.parse(raw);}catch{throw new HttpError(400,'Dữ liệu không hợp lệ.');}requireValue(object(body));
      const result=await dispatch(new URL(request.url).pathname,body,identity,env,storeFactory(env));return reply(result);
    }catch(e){return reply({error:e instanceof HttpError?e.message:'Không thể xử lý yêu cầu. Vui lòng thử lại.'},e instanceof HttpError?e.status:500);}
  };
}
export default {fetch:createHandler()};
