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
 assert.ok(!nodes.liveAnswerSheetList.text().includes('Đ/A:'));assert.match(nodes.liveAnswerSheetList.text(),/✓ Đúng/);assert.match(nodes.liveAnswerSheetList.text(),/✕ Sai/);assert.match(nodes.liveAnswerSheetList.text(),/Chưa làm/);
});
