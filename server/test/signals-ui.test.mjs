import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
test('signal sender waits for acknowledgement, reports failures and keeps the typed message',async()=>{
 const source=html.slice(html.indexOf('    async function sendMentorSignalToTarget'),html.indexOf('    // Phát tín hiệu hoặc',html.indexOf('    async function sendMentorSignalToTarget')));
 let resolve,reject;const notices=[],errors=[],input={value:'Hello'};
 const context={requireAdmin:()=>true,currentUser:{fullName:'Teacher'},spectatingSessionKey:'2_BIO_1',rtdb:{ref:()=>({push:()=>new Promise((a,b)=>{resolve=a;reject=b;})})},showToast:x=>notices.push(x),safeAlert:x=>errors.push(x),document:{getElementById:()=>input}};
 vm.createContext(context);vm.runInContext(source,context);
 const pending=context.handleSpectatorSignalSubmit({preventDefault(){}});assert.equal(notices.length,0);reject(Error('Network failed'));await pending;assert.equal(notices.length,0);assert.equal(errors.length,1);assert.equal(input.value,'Hello');
 const success=context.handleSpectatorSignalSubmit({preventDefault(){}});resolve({ok:true});await success;assert.equal(input.value,'');assert.equal(notices.length,1);
});
