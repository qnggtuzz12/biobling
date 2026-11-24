import test from 'node:test';
import assert from 'node:assert/strict';
import {grade,publicExam,canAccess,deadlineMs,validateKeys,studentSubmission} from '../src/domain.mjs';
import {dispatch,createHandler} from '../src/worker.mjs';
import {verifyIdentity,normalizeFirebase} from '../src/firebase.mjs';
const copy=x=>structuredClone(x);
const teacher={id:1,uid:'teacher',username:'admin1',fullName:'Teacher',role:'admin',status:'approved',classIds:[]};
const alice={id:2,uid:'alice',username:'alice',fullName:'Alice',role:'student',status:'approved',classId:'a',classIds:['a']};
const bob={id:3,uid:'bob',username:'bob',fullName:'Bob',role:'student',status:'approved',classId:'b',classIds:['b']};
const exam={code:'BIO_1',title:'Biology',targetClassIds:['a'],targetClassId:'a',timeLimit:50,isUnlimited:false,practiceOnly:false,deadline:'',rawDocsUrl:'https://docs.google.com/document/d/test/preview',embedUrl:'https://docs.google.com/document/d/test/preview',mcqKeys:{1:'B',2:'C'},tfKeys:{1:{a:'Đ',b:'S',c:'Đ',d:'S'}},saKeys:{1:'0',2:'1,5'},rawMcq:'SECRET',rawTf:'SECRET',rawSa:'SECRET',revision:'r1'};
class MemoryStore {
  constructor(){this.data={accounts:{1:copy(teacher),2:copy(alice),3:copy(bob)},exams:{BIO_1:copy(exam)},catalog:{classes:[{id:'a',name:'A'},{id:'b',name:'B'}],media:[{id:'ma',classIds:['a'],title:'A',url:'https://example.com/a'},{id:'mb',classIds:['b'],title:'B',url:'https://example.com/b'}],sessions:[{id:'sa',classId:'a'},{id:'sb',classId:'b'}]},legacySubmissions:{s1:{id:'s1',userId:2,gradingKeys:{secret:'KEY'},score:5},s2:{id:'s2',userId:3,score:7}}};}
  async get(path){return copy(path.split('/').reduce((v,k)=>v?.[k],this.data)??null);}
  async put(path,value){const keys=path.split('/');let p=this.data;for(const k of keys.slice(0,-1))p=p[k]??={};p[keys.at(-1)]=copy(value);return copy(value);}
  async patch(path,value){return this.put(path,{...await this.get(path),...value});}
  async transaction(path,fn){return this.put(path,await fn(await this.get(path)));}
  async request(path){return {value:await this.get(path),etag:'etag'};}
}
const env={OWNER_UID:'teacher',FIREBASE_PROJECT:'biobling',RELEASE_ENABLED:'true',ALLOWED_ORIGINS:'https://qnggtuzz12.github.io'};
const as=uid=>({uid,email:uid+'@example.com',name:uid});
const answers={mcq:{1:'B',2:'C'},tf:{1:{a:'Đ',b:'S',c:'Đ',d:'S'}},sa:{1:'0',2:'1.50'}};
test('submitted review reports correct, wrong and blank using the original exam without disclosing keys',async()=>{
 const s=new MemoryStore();await dispatch('/attempt/start',{code:'BIO_1',attemptId:'review'},as('alice'),env,s);
 const input={mcq:{1:'B',2:'A'},tf:{1:{a:'Đ',b:'Đ'}},sa:{1:'0'}};
 const {result}=await dispatch('/attempt/submit',{attemptId:'review',answers:input},as('alice'),env,s);
 assert.deepEqual(result.feedback,{mcq:{1:'correct',2:'wrong'},tf:{1:{a:'correct',b:'wrong',c:'blank',d:'blank'}},sa:{1:'correct',2:'blank'}});
 assert.equal(result.gradingKeys,undefined);assert.equal(result.questionStructure.mcqKeys[1],'');
 s.data.exams.BIO_1.mcqKeys[1]='A';
 const snapshot=await dispatch('/snapshot',{},as('alice'),env,s);
 assert.deepEqual(snapshot.submissions.find(x=>x.id==='review').feedback,result.feedback);
 assert.ok(!(await dispatch('/snapshot',{},as('bob'),env,s)).submissions.some(x=>x.id==='review'));
});
test('live viewer uses the exact attempt even when the original exam is archived or changed; students cannot access it',async()=>{
 const s=new MemoryStore();await dispatch('/attempt/start',{code:'BIO_1',attemptId:'live1'},as('alice'),env,s);
 await dispatch('/attempt/draft',{attemptId:'live1',answers},as('alice'),env,s);
 await dispatch('/live',{examCode:'BIO_1',attemptId:'live1',data:{}},as('alice'),env,s);
 assert.equal(s.data.live[2].BIO_1.totalCount,5);
 s.data.exams.BIO_1.archived=true;s.data.exams.BIO_1.mcqKeys[1]='A';
 const r=await dispatch('/live/view',{userId:'2',examCode:'BIO_1'},as('teacher'),env,s);
 assert.equal(r.exam.mcqKeys[1],'B');assert.deepEqual(r.session.answers,answers);
 await assert.rejects(dispatch('/live/view',{userId:'2',examCode:'BIO_1'},as('alice'),env,s));
 await assert.rejects(dispatch('/live/view',{userId:'3',examCode:'BIO_1'},as('teacher'),env,s));
 delete s.data.live[2].BIO_1.attemptId;
 assert.equal((await dispatch('/live/view',{userId:'2',examCode:'BIO_1'},as('teacher'),env,s)).exam.mcqKeys[1],'B');
});
test('presence expires, visible snapshots renew it, hidden snapshots do not; class access remains restricted',async()=>{
 const s=new MemoryStore();const old=Date.now()-100000;
 s.data.status={alice:{state:'online',lastChanged:old},bob:{state:'online',lastChanged:Date.now()},admin1:{state:'online'}};
 let r=await dispatch('/snapshot',{active:false},as('alice'),env,s);
 assert.equal(r.status.alice.state,'offline');assert.equal(r.status.bob,undefined);assert.equal(s.data.status.alice.lastChanged,old);
 r=await dispatch('/bootstrap',{active:true},as('alice'),env,s);assert.equal(r.status.alice.state,'online');assert.ok(s.data.status.alice.lastChanged>old);
 r=await dispatch('/snapshot',{},as('teacher'),env,s);assert.equal(r.status.admin1.state,'offline');assert.equal(r.status.bob.state,'online');
 s.data.status.alice={state:'online',lastChanged:Date.now()+100000};
 assert.equal((await dispatch('/snapshot',{},as('alice'),env,s)).status.alice.state,'offline');
 await dispatch('/presence',{state:'offline'},as('alice'),env,s);
 assert.equal((await dispatch('/snapshot',{},as('alice'),env,s)).status.alice.state,'offline');
 s.data.accounts[2].status='pending';await dispatch('/bootstrap',{active:true},as('alice'),env,s);assert.equal(s.data.status.alice.state,'offline');
 await assert.rejects(dispatch('/snapshot',{active:true},as('alice'),env,s));
});
test('teacher invitations are visible to recipients without a shared class and accepted chat works both ways',async()=>{
 const s=new MemoryStore();
 await dispatch('/social/friend',{userId:2},as('teacher'),env,s);
 const inbox=await dispatch('/social/list',{},as('alice'),env,s);assert.equal(inbox.friends.length,1);assert.ok(inbox.peers.some(p=>p.id===1));assert.ok(!inbox.peers.some(p=>p.id===3));
 await assert.rejects(dispatch('/social/friend',{userId:2,accept:true},as('teacher'),env,s));
 await dispatch('/social/friend',{userId:1,accept:true},as('alice'),env,s);
 assert.equal((await dispatch('/social/list',{},as('teacher'),env,s)).friends[0].accepted,true);
 const {room}=await dispatch('/social/create',{roomId:'teacher-chat',members:['1'],title:'Teacher chat',group:false},as('alice'),env,s);assert.equal(room.classId,'a');
 await dispatch('/social/send',{roomId:room.id,messageId:'reply',content:'Question'},as('alice'),env,s);
 assert.equal((await dispatch('/social/messages',{roomId:room.id},as('teacher'),env,s)).messages.length,1);
 await assert.rejects(dispatch('/social/messages',{roomId:room.id},as('bob'),env,s));
 s.data.accounts[4]={...teacher,id:4,uid:'teacher2'};await dispatch('/social/friend',{userId:4},as('teacher'),env,s);await dispatch('/social/friend',{userId:1,accept:true},as('teacher2'),env,s);
 assert.equal((await dispatch('/social/create',{roomId:'staff-chat',members:['4'],title:'Staff',group:false},as('teacher'),env,s)).room.classId,'staff');
 s.data.accounts[5]={...alice,id:5,uid:undefined};assert.ok(!(await dispatch('/social/list',{},as('teacher'),env,s)).peers.some(p=>p.id===5));
});
test('community confines discovery and messages to class and room membership; admin can inspect',async()=>{
 const s=new MemoryStore();let r=await dispatch('/social/list',{},as('alice'),env,s);assert.ok(!r.peers.some(p=>p.id===3));
 await assert.rejects(dispatch('/social/friend',{userId:3},as('alice'),env,s));
 s.data.accounts[3].classIds=['a'];s.data.accounts[3].classId='a';
 await dispatch('/social/friend',{userId:3},as('alice'),env,s);
 await assert.rejects(dispatch('/social/create',{roomId:'r1',classId:'a',members:['3'],title:'Chat',group:false},as('alice'),env,s));
 await dispatch('/social/friend',{userId:2,accept:true},as('bob'),env,s);
 await dispatch('/social/create',{roomId:'r1',classId:'a',members:['3'],title:'Chat',group:false},as('alice'),env,s);
 await dispatch('/social/send',{roomId:'r1',messageId:'m1',content:'Hello'},as('alice'),env,s);
 assert.equal((await dispatch('/social/messages',{roomId:'r1'},as('teacher'),env,s)).messages.length,1);
 s.data.accounts[3].classIds=['b'];s.data.accounts[3].classId='b';
 await assert.rejects(dispatch('/social/messages',{roomId:'r1'},as('bob'),env,s));
 s.data.accounts[4]={...alice,id:4,uid:'outsider'};await assert.rejects(dispatch('/social/messages',{roomId:'r1'},as('outsider'),env,s));
});
test('video comments require class membership and approved identity, preserve author and deduplicate retries',async()=>{
  const s=new MemoryStore();s.data.catalog.media[0].type='drive_video';
  const body={mediaId:'ma',commentId:'comment-1',content:'Câu hỏi bài học',name:'Forged teacher'};
  await assert.rejects(dispatch('/comments/list',body,as('bob'),env,s));
  await assert.rejects(dispatch('/comments/add',body,as('bob'),env,s));
  const result=await dispatch('/comments/add',body,as('alice'),env,s);assert.equal(result.comments[0].name,'Alice');assert.equal(result.comments[0].uid,undefined);
  assert.equal((await dispatch('/comments/add',body,as('alice'),env,s)).comments.length,1);
  await assert.rejects(dispatch('/comments/add',{...body,commentId:'c2',content:'x'.repeat(2001)},as('alice'),env,s));
  s.data.accounts[2].status='suspended';await assert.rejects(dispatch('/comments/list',body,as('alice'),env,s));
});
test('bootstrap returns filtered data in one request while pending users get only profile',async()=>{
  const s=new MemoryStore();const result=await dispatch('/bootstrap',{},as('alice'),env,s);assert.equal(result.profile.uid,'alice');assert.equal(result.media.length,1);
  s.data.accounts[2].status='pending';const pending=await dispatch('/bootstrap',{},as('alice'),env,s);assert.equal(pending.media,undefined);
});
test('student projection never includes keys or raw answers',()=>{
  const p=publicExam(exam);assert.equal(p.mcqKeys[1],'');assert.equal(p.tfKeys[1].a,'');assert.equal(p.saKeys[1],'');assert.equal(p.rawMcq,undefined);assert.equal(p.rawTf,undefined);assert.equal(p.rawSa,undefined);assert.equal(p.answersHidden,true);
});
test('grading handles zero, decimal comma, blank, partial TF; standard total is 10',()=>{
  assert.equal(grade(answers,exam).mcqCorrect,2);assert.equal(grade(answers,exam).saCorrect,2);
  assert.equal(grade({mcq:{},tf:{1:{a:'Đ'}},sa:{}},exam).tfCorrectSubCount,1);
  assert.equal(grade({mcq:{},tf:{},sa:{1:' '}},exam).saCorrect,0);
  const standard={...exam,mcqKeys:Object.fromEntries(Array.from({length:18},(_,i)=>[i+1,'A'])),tfKeys:Object.fromEntries(Array.from({length:4},(_,i)=>[i+1,{a:'Đ',b:'Đ',c:'Đ',d:'Đ'}])),saKeys:Object.fromEntries(Array.from({length:6},(_,i)=>[i+1,'0']))};
  assert.equal(grade({mcq:standard.mcqKeys,tf:standard.tfKeys,sa:standard.saKeys},standard).score,10);
  assert.equal(grade({mcq:{},tf:{},sa:{}},standard).score,0);
});
test('malformed or oversized answers are rejected',()=>{
  for(const a of [{mcq:{999:'A'}},{mcq:{1:'<script>'}},{tf:{1:{e:'Đ'}}},{sa:{1:'x'.repeat(301)}},{mcq:[],tf:{},sa:{}}])assert.throws(()=>grade(a,exam));
  assert.throws(()=>validateKeys({...exam,mcqKeys:{'0':'A'}}));
});
test('class access checks are enforced by the server',()=>{
  assert.equal(canAccess(alice,exam,true),true);assert.equal(canAccess(bob,exam,true),false);assert.equal(canAccess({...alice,status:'pending'},exam,true),false);
  assert.equal(deadlineMs('2026-11-17T10:00'),Date.parse('2026-11-17T03:00:00Z'));
});
test('snapshot contains only the assigned class and own results, no passwords or keys',async()=>{
  const s=new MemoryStore();s.data.accounts[2].password='PRIVATE';
  const r=await dispatch('/snapshot',{},as('alice'),env,s);assert.deepEqual(r.classes.map(x=>x.id),['a']);assert.deepEqual(r.media.map(x=>x.id),['ma']);assert.equal(r.submissions.length,1);assert.equal(r.submissions[0].userId,2);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!JSON.stringify(r).includes('SECRET'));assert.ok(!JSON.stringify(r).includes('gradingKeys'));assert.ok(!r.users.some(u=>u.uid==='bob'));
});
test('student cannot change roles, create exams, send mentor signals, or write scores',async()=>{
  for(const [p,b] of [['/users',{users:[{...alice,role:'admin'}]}],['/exam/save',{exam}],['/signal',{userId:'3',examCode:'BIO_1',content:'hi'}],['/submissions',{score:10}]])await assert.rejects(dispatch(p,b,as('alice'),env,new MemoryStore()));
  const s=new MemoryStore();await dispatch('/profile',{fullName:'Alice',role:'admin',status:'approved',uid:'teacher'},as('alice'),env,s);assert.equal(s.data.accounts[2].role,'student');assert.equal(s.data.accounts[2].uid,'alice');
});
test('attempts bind identity, preserve exam version and ignore submitted score',async()=>{
  const s=new MemoryStore();await assert.rejects(dispatch('/attempt/start',{code:'BIO_1',attemptId:'a1'},as('bob'),env,s));
  const started=await dispatch('/attempt/start',{code:'BIO_1',attemptId:'a1'},as('alice'),env,s);assert.equal(started.exam.mcqKeys[1],'');
  s.data.exams.BIO_1.mcqKeys[1]='A';
  const r=await dispatch('/attempt/submit',{attemptId:'a1',answers,score:999,userId:3},as('alice'),env,s);assert.equal(r.result.mcqCorrect,2);assert.equal(r.result.userId,2);assert.notEqual(r.result.score,999);
  const again=await dispatch('/attempt/submit',{attemptId:'a1',answers:{mcq:{},tf:{},sa:{}}},as('alice'),env,s);assert.deepEqual(again,r);
  await assert.rejects(dispatch('/attempt/submit',{attemptId:'a1',answers},as('bob'),env,s));
});
test('expired attempts grade only the previously accepted draft',async()=>{
  const s=new MemoryStore();await dispatch('/attempt/start',{code:'BIO_1',attemptId:'late'},as('alice'),env,s);
  await dispatch('/attempt/draft',{attemptId:'late',answers:{mcq:{1:'B'},tf:{},sa:{}}},as('alice'),env,s);
  s.data.attempts.alice.late.expiresAt=Date.now()-100;
  await assert.rejects(dispatch('/attempt/draft',{attemptId:'late',answers},as('alice'),env,s));
  const r=await dispatch('/attempt/submit',{attemptId:'late',answers},as('alice'),env,s);assert.equal(r.result.mcqCorrect,1);assert.equal(r.result.saCorrect,0);assert.equal(r.result.lateSubmission,true);
});
test('pending/suspended users cannot read snapshot or submit',async()=>{
  for(const status of ['pending','suspended']){const s=new MemoryStore();s.data.accounts[2].status=status;await assert.rejects(dispatch('/snapshot',{},as('alice'),env,s));await assert.rejects(dispatch('/attempt/submit',{attemptId:'a1',answers},as('alice'),env,s));}
});
test('only owner may elevate teachers; UID links cannot be overwritten',async()=>{
  const s=new MemoryStore();s.data.accounts[3].role='admin';
  await assert.rejects(dispatch('/users',{users:[{...alice,role:'admin'}]},as('bob'),env,s));
  await assert.rejects(dispatch('/users',{users:[{...alice,uid:'bob'}]},as('teacher'),env,s));
});
test('HTTP rejects bad origins, anonymous tokens and invalid JSON',async()=>{
  const handler=createHandler({identityVerifier:async token=>{if(token!=='ok')throw Object.assign(new Error('invalid'),{status:401});return as('alice');},storeFactory:()=>new MemoryStore()});
  const bad=await handler(new Request('https://api.example/snapshot',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),env);assert.equal(bad.status,403);
  const invalid=await handler(new Request('https://api.example/snapshot',{method:'POST',headers:{Authorization:'Bearer ok'},body:'bad json'}),env);assert.equal(invalid.status,400);
  const valid=await handler(new Request('https://api.example/snapshot',{method:'POST',headers:{Authorization:'Bearer ok',Origin:'https://qnggtuzz12.github.io'},body:'{}'}),env);assert.equal(valid.status,200);assert.equal(valid.headers.get('cache-control'),'no-store');
});
test('forged and malformed Firebase tokens fail before data access',async()=>{
  for(const token of [null,'abc','e30.e30.fake'])await assert.rejects(verifyIdentity(token,'biobling'));
  assert.equal(studentSubmission({score:4,gradingKeys:{a:1}}).gradingKeys,undefined);
});
test('Firebase numeric maps survive round trip without phantom question zero',()=>{
  const restored=normalizeFirebase({mcqKeys:[null,'A','B'],tfKeys:[null,{a:'Đ',b:'S',c:'Đ',d:'S'}],classIds:['a','b'],answers:{sa:[null,'0']}});
  assert.deepEqual(restored.mcqKeys,{'1':'A','2':'B'});assert.deepEqual(restored.classIds,['a','b']);assert.deepEqual(restored.answers.sa,{'1':'0'});validateKeys(restored);
});
test('verified Firebase signature, issuer, audience, provider and expiry are required',async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-key';
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const now=Math.floor(Date.now()/1000),payload={aud:'biobling',iss:'https://securetoken.google.com/biobling',sub:'alice',exp:now+3600,iat:now,auth_time:now,email_verified:true,firebase:{sign_in_provider:'google.com'}};
  const sign=async p=>{const content=enc({alg:'RS256',kid:'test-key'})+'.'+enc(p);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(content));return content+'.'+Buffer.from(signature).toString('base64url');};
  const fetcher=async()=>Response.json({keys:[jwk]});
  assert.equal((await verifyIdentity(await sign(payload),'biobling',fetcher)).uid,'alice');
  assert.equal((await verifyIdentity(await sign({...payload,auth_time:now-29*86400}),'biobling',fetcher)).uid,'alice');
  for(const auth_time of [now-30*86400,now-31*86400,0,'123',null])await assert.rejects(verifyIdentity(await sign({...payload,auth_time}),'biobling',fetcher));
  for(const p of [{...payload,aud:'other'},{...payload,iss:'https://evil.test'},{...payload,exp:now-1},{...payload,email_verified:false},{...payload,firebase:{sign_in_provider:'custom'}}])await assert.rejects(verifyIdentity(await sign(p),'biobling',fetcher));
  const valid=await sign(payload);const forged=valid.split('.');forged[1]=enc({...payload,sub:'teacher'});await assert.rejects(verifyIdentity(forged.join('.'),'biobling',fetcher));
});
