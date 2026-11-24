import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('    function renderLiveExamAnswerSheet()'),html.indexOf('    function pickLiveOption('));
class Element {
 constructor(){this.style={};this.children=[];this.innerHTML='';}
 appendChild(e){this.children.push(e);}
 text(){return this.innerHTML+this.children.map(c=>c.text()).join('');}
}
test('student review renders server verdicts for every section without showing empty answer keys',()=>{
 const nodes={};const context={document:{getElementById:id=>nodes[id]??=new Element(),createElement:()=>new Element()},isLiveReviewMode:true,isAdminEditingExamKeys:false,
 activeExam:{answersHidden:true,mcqKeys:{1:'',2:'',3:''},tfKeys:{1:{a:'',b:'',c:'',d:''}},saKeys:{1:'',2:''},feedback:{mcq:{1:'correct',2:'wrong',3:'blank'},tf:{1:{a:'correct',b:'wrong',c:'blank',d:'blank'}},sa:{1:'correct',2:'blank'}}},
 studentLiveAnswers:{mcq:{1:'A',2:'B'},tf:{1:{a:'Đ',b:'S'}},sa:{1:'0'}},escapeHTML:String,examQuestionTargetId:(p,q)=>p+q,updateLiveProgress:()=>{},normalizeShortExamAnswer:String};
 vm.createContext(context);vm.runInContext(source,context);context.renderLiveExamAnswerSheet();
 assert.match(nodes.liveReviewStatsBanner.innerHTML,/Đúng: 3/);assert.match(nodes.liveReviewStatsBanner.innerHTML,/Sai: 2/);assert.match(nodes.liveReviewStatsBanner.innerHTML,/Bỏ trống\): 4/);
 for(const sparse of [{},{mcq:{1:'A'}},{tf:{1:{a:'Đ'}}},{mcq:null,tf:null,sa:null}]){context.studentLiveAnswers=sparse;assert.doesNotThrow(()=>context.renderLiveExamAnswerSheet());}
 assert.ok(!nodes.liveAnswerSheetList.text().includes('Đ/A:'));assert.match(nodes.liveAnswerSheetList.text(),/✓ Đúng/);assert.match(nodes.liveAnswerSheetList.text(),/✕ Sai/);assert.match(nodes.liveAnswerSheetList.text(),/Chưa làm/);
});
test('opening and reopening a student review with missing answer sections displays the room without fullscreen',async()=>{
 const nodes={};let fullscreen=0;
 const node=id=>nodes[id]??=Object.assign(new Element(),{classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)},contains(x){return this.values.has(x)}},close(){},setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]}});
 const context={document:{getElementById:node,createElement:()=>new Element(),body:{style:{}}},currentUser:{role:'admin'},isLiveSpectatorMode:false,studentLiveAnswers:{mcq:{1:'A'}},setTimeout:()=>0,setInterval:()=>0,clearInterval(){},enterExamFullscreenIfNeeded(){fullscreen++},stopExamDraftHeartbeat(){},setElText(){},clearExamCanvas(){},safeWebUrl:x=>x||'',convertDocsToPreview:x=>x,showExamDraftStatus(){},detachStudentLiveMentorChatListener(){},initExamCanvas(){},escapeHTML:String,examQuestionTargetId:(p,q)=>p+q,updateLiveProgress(){},normalizeShortExamAnswer:String,examCountdownTimer:null};
 vm.createContext(context);vm.runInContext(source,context);
 vm.runInContext(html.slice(html.indexOf('    async function prepareExamRoom('),html.indexOf('    let isAdminEditingExamKeys')),context);
 for(const code of ['ONE','TWO','ONE']){context.studentLiveAnswers={};await context.prepareExamRoom({code,mcqKeys:{1:'A'},tfKeys:{1:{a:'Đ',b:'S',c:'Đ',d:'S'}},saKeys:{1:'0'},rawDocsUrl:'https://example.com/'+code},true);assert.ok(node('liveExamModal').classList.contains('open'));assert.equal(context.activeExam.code,code);assert.equal(node('liveExamIframe').getAttribute('data-loaded-url'),'https://example.com/'+code);}
 assert.equal(fullscreen,0);
});
