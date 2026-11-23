import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
const source=readFileSync(new URL('../../secure-client.js',import.meta.url),'utf8');
const MAX_AGE=30*86400*1000;
function harness(age=0){
  let now=1805500000000,observer,timerId=0,popupCalls=0,signouts=0;
  const timers=new Map(),events={},persist=[],requests=[],errors=[],profiles=[];
  const user={uid:'student',getIdTokenResult:async()=>({token:'signed-token',claims:{auth_time:(1805500000000-age)/1000}})};
  const auth={currentUser:user,setPersistence:async mode=>{persist.push(mode);},onAuthStateChanged:cb=>{observer=cb;},signOut:async()=>{signouts++;auth.currentUser=null;await observer(null);},signInWithPopup:()=>{popupCalls++;return Promise.resolve({user});}};
  const firebase={auth:()=>auth};firebase.auth.Auth={Persistence:{LOCAL:'local',SESSION:'session'}};firebase.auth.GoogleAuthProvider=class {};
  const context=vm.createContext({firebase,Date:class extends Date{static now(){return now;}},document:{hidden:false,addEventListener:(type,cb)=>{events[type]=cb;}},setTimeout:(cb,delay)=>{timers.set(++timerId,{cb,delay});return timerId;},clearTimeout:id=>timers.delete(id),fetch:async(url)=>{requests.push(url);return {ok:true,json:async()=>({profile:{uid:'student',status:'approved'},users:[]})};}});
  context.window=context;context.BIOBLING_API_URL='https://biobling-api.example.workers.dev';vm.runInContext(source,context);
  const api=context.BioBling;api.onError=e=>errors.push(e);api.onProfile=p=>profiles.push(p);api.init();
  return {api,auth,user,persist,requests,errors,profiles,timers,events,observe:()=>observer(auth.currentUser),advance:ms=>{now+=ms;},get popupCalls(){return popupCalls;},get signouts(){return signouts;}};
}
test('persistent login is prepared once and popup opens in click call without awaiting storage',async()=>{
  const h=harness();await tick();assert.deepEqual(h.persist,['local']);
  const pending=h.api.login();assert.equal(h.popupCalls,1);await pending;assert.deepEqual(h.persist,['local']);
});
test('repeated clicks share one popup; cancellation can be retried and is explained in Vietnamese',async()=>{
  const h=harness();await tick();h.auth.currentUser=null;
  let reject;let calls=0;h.auth.signInWithPopup=()=>{calls++;return new Promise((_,r)=>{reject=r;});};
  const a=h.api.login(),b=h.api.login();assert.equal(calls,1);
  reject({code:'auth/popup-closed-by-user'});await Promise.all([assert.rejects(a),assert.rejects(b)]);
  const notice=h.api.loginError({code:'auth/popup-closed-by-user',message:'Firebase internal error'});
  assert.equal(notice.neutral,true);assert.match(notice.message,/chưa hoàn tất/);assert.ok(!notice.message.includes('Firebase'));
  h.auth.signInWithPopup=async()=>({user:h.user});assert.equal((await h.api.login()).user.uid,'student');
});
test('restored 29-day session remains valid; reopening does not reset its age',async()=>{
  for(let reopen=0;reopen<2;reopen++){const h=harness(29*86400*1000);await h.observe();assert.equal(h.signouts,0);assert.equal(h.requests.length,1);assert.equal(h.api.profile.uid,'student');}
});
test('expired restored session signs out before data fetch and reports the 30-day limit',async()=>{
  const h=harness(MAX_AGE);await h.observe();assert.equal(h.signouts,1);assert.equal(h.requests.length,0);assert.equal(h.api.profile,null);assert.match(h.errors[0].message,/30 ngày/);
});
test('active session expires at its original deadline and signout clears timers',async()=>{
  const h=harness(MAX_AGE-1000);await h.observe();const deadline=[...h.timers.values()].find(t=>t.delay===1000);assert.ok(deadline);
  h.advance(1000);await deadline.cb();await tick();assert.equal(h.signouts,1);assert.equal(h.api.profile,null);assert.equal(h.timers.size,0);
});
test('tab wake-up rejects expired session before any new data request',async()=>{
  const h=harness(MAX_AGE-1000);await h.observe();const count=h.requests.length;h.advance(2000);await h.events.visibilitychange();await tick();assert.equal(h.signouts,1);assert.equal(h.requests.length,count);
});
test('manual logout clears the saved Firebase session and future polling',async()=>{
  const h=harness();await h.observe();await h.api.logout();assert.equal(h.auth.currentUser,null);assert.equal(h.signouts,1);assert.equal(h.timers.size,0);
});

