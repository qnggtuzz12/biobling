const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
// Firebase Auth registers against App at script evaluation time. Wrong ordering
// stops startup before the auth observer can dismiss the loading screen.
const externalScripts=[...html.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]);
const dependencies=['firebase-app-compat.js','firebase-auth-compat.js','secure-config.js','secure-client.js'];
let previous=-1;
for(const name of dependencies){
  const matches=externalScripts.filter(src=>src.endsWith(name));assert.equal(matches.length,1,'Exactly one '+name);
  const index=externalScripts.indexOf(matches[0]);assert.ok(index>previous,'Dependency order: '+name);previous=index;
}
assert.ok(html.indexOf('id="startupScreen"')<html.indexOf('<script src="https://www.gstatic.com/firebasejs/13.4.0/firebase-app-compat.js"'));
assert.ok(!html.includes('>Về trang giới thiệu</button>'));
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
new vm.Script(script);
const helpers=script.slice(script.indexOf('    function safeWebUrl'),script.indexOf('    /* ================= REALTIME'));
const ctx=vm.createContext({URL,BioBling:{auth:{currentUser:{uid:'firebase-user'}}}});
vm.runInContext(helpers,ctx);
for(const bad of ['javascript:alert(1)','data:text/html,test','http://example.com','https://user:pass@example.com','//example.com','https://']) assert.equal(ctx.safeWebUrl(bad),'');
assert.equal(ctx.safeWebUrl('https://drive.google.com/file/d/abc/view'),'https://drive.google.com/file/d/abc/view');
assert.equal(ctx.safeAvatarUrl('data:image/svg+xml;base64,PHN2Zz4='),'');
assert.equal(ctx.safeAvatarUrl('data:image/png;base64,YWJj'),'data:image/png;base64,YWJj');
const user={id:1,uid:'firebase-user',status:'approved'};
assert.equal(ctx.hasValidLegacySession(user),true);
assert.equal(ctx.hasValidLegacySession({...user,status:'pending'}),false);
assert.equal(ctx.hasValidLegacySession({...user,uid:'another-user'}),false);
assert.equal(ctx.hasValidLegacySession({...user,uid:undefined}),false);
assert.equal(ctx.hasValidLegacySession(null),false);
assert.ok(!script.includes('firebase.database()'));
assert.ok(!script.includes('firebase.firestore()'));
assert.ok(!script.includes('String(u.password'));
const confirmCode=script.slice(script.indexOf('    function safeConfirm'),script.indexOf('    function safeAlert'));
const dialog=vm.createContext({window:{confirm:()=>false},showToast:()=>{}});
vm.runInContext(confirmCode,dialog);assert.equal(dialog.safeConfirm('delete?'),false);
dialog.window.confirm=()=>true;assert.equal(dialog.safeConfirm('delete?'),true);
dialog.window.confirm=()=>{throw Error('blocked')};assert.equal(dialog.safeConfirm('delete?'),false);
assert.ok(!script.includes('const DEFAULT_ADMIN_ACCOUNTS'));
assert.ok(!script.includes('dbUser || savedSession'));
console.log('PASS: syntax, URL schemes, avatar formats, revoked/pending/missing sessions, confirmation cancel/error, no default accounts');
