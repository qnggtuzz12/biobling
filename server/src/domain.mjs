export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireValue(ok, message = 'Dữ liệu không hợp lệ.', status = 400) {
  if (!ok) throw new HttpError(status, message);
}
export const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
export const list = x => Array.isArray(x) ? x.filter(Boolean) : Object.values(x || {});
export function text(x, max = 200, required = false) {
  requireValue(typeof x === 'string' && x.length <= max && (!required || x.trim().length > 0));
  return x.trim();
}
export function id(x) { requireValue(typeof x === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(x)); return x; }
export function httpsUrl(x, allowEmpty = false) {
  if (allowEmpty && !x) return '';
  text(x, 3000, true);
  let u; try { u = new URL(x); } catch { throw new HttpError(400, 'Đường dẫn không hợp lệ.'); }
  requireValue(u.protocol === 'https:' && !u.username && !u.password, 'Chỉ dùng đường dẫn HTTPS.');
  return u.href;
}
export function classesOf(user) { return [...new Set([...(user.classIds || []), user.classId].filter(Boolean).map(String))]; }
export function assigned(item, exam = false) {
  return [...new Set([...(exam ? item.targetClassIds || [] : item.classIds || []), exam ? item.targetClassId : item.classId].filter(Boolean).map(String))];
}
export const admin = user => user?.status === 'approved' && user.role === 'admin';
export function canAccess(user, item, exam = false) {
  if (admin(user)) return true;
  if (user?.status !== 'approved') return false;
  const targets = assigned(item, exam), mine = classesOf(user);
  return mine.length > 0 && (targets.includes('all') || targets.some(c => mine.includes(c)));
}
export function requireAdmin(user) { requireValue(admin(user), 'Bạn không có quyền quản trị.', 403); }
export function safeUser(u, ownOrAdmin = false) {
  const fields = ['id','username','fullName','role','status','classId','classIds','avatar','bio','createdAt'];
  if (ownOrAdmin) fields.push('uid','email','migrationRequired');
  return Object.fromEntries(fields.filter(k => u[k] !== undefined).map(k => [k, u[k]]));
}
export function validateKeys(exam) {
  let count = 0;
  for (const [part, values] of Object.entries({mcq:exam.mcqKeys||{}, tf:exam.tfKeys||{}, sa:exam.saKeys||{}})) {
    requireValue(object(values));
    for (const [q, v] of Object.entries(values)) {
      requireValue(/^[1-9]\d{0,2}$/.test(q)); count++;
      if (part === 'mcq') requireValue(['A','B','C','D'].includes(v));
      if (part === 'sa') text(v, 300, true);
      if (part === 'tf') requireValue(object(v) && Object.keys(v).length === 4 && ['a','b','c','d'].every(s => ['Đ','S'].includes(v[s])));
    }
  }
  requireValue(count > 0 && count <= 200, 'Đề thi cần từ 1 đến 200 câu.');
}
export function publicExam(exam) {
  const fields = ['code','title','timeLimit','targetClassId','targetClassIds','isUnlimited','practiceOnly','deadline','rawDocsUrl','embedUrl','updatedAt','revision'];
  const out = Object.fromEntries(fields.filter(k=>exam[k] !== undefined).map(k=>[k,exam[k]]));
  // These maps contain identifiers only; never put answer values in student responses.
  for (const k of ['mcqKeys','tfKeys','saKeys']) out[k] = Object.fromEntries(Object.keys(exam[k] || {}).map(q=>[q, k==='tfKeys'?{a:'',b:'',c:'',d:''}:'']));
  out.answersHidden = true;
  return out;
}
export function cleanAnswers(answers, exam) {
  requireValue(object(answers) && Object.keys(answers).every(k => ['mcq','tf','sa'].includes(k)));
  const out = {mcq:{},tf:{},sa:{}};
  for (const p of ['mcq','tf','sa']) {
    const values=answers[p] || {}; requireValue(object(values) && Object.keys(values).length <= 200);
    for (const [q,v] of Object.entries(values)) {
      requireValue(Object.hasOwn(exam[p+'Keys'] || {},q), 'Bài làm chứa câu không thuộc đề.');
      if (p==='mcq') { requireValue(v === null || v === '' || ['A','B','C','D'].includes(v)); if(v)out[p][q]=v; }
      if (p==='sa') { const s=text(v,300); if(s)out[p][q]=s; }
      if (p==='tf') {
        requireValue(object(v) && Object.keys(v).every(s=>['a','b','c','d'].includes(s)));
        out[p][q]={};
        for(const [s,a] of Object.entries(v)){requireValue(a===null || a==='' || ['Đ','S'].includes(a));if(a)out[p][q][s]=a;}
      }
    }
  }
  return out;
}
export function normalizeShort(value) {
  const s=String(value ?? '').trim().replace(/\s+/g,' ');
  return /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(s) ? String(Number(s.replace(',','.'))) : s.toLowerCase();
}
export function grade(answers, exam) {
  const a=cleanAnswers(answers,exam), mcq=exam.mcqKeys||{},tf=exam.tfKeys||{},sa=exam.saKeys||{};
  let mcqCorrect=0,tfCorrectSubCount=0,saCorrect=0,tfScore=0;
  for(const q of Object.keys(mcq)) if(a.mcq[q]===mcq[q])mcqCorrect++;
  for(const q of Object.keys(tf)) {
    const n=['a','b','c','d'].filter(s=>a.tf[q]?.[s]===tf[q][s]).length;
    tfCorrectSubCount+=n; tfScore += [0,0.1,0.25,0.5,1][n];
  }
  for(const q of Object.keys(sa)) if(a.sa[q] && normalizeShort(a.sa[q])===normalizeShort(sa[q]))saCorrect++;
  const standard=Object.keys(mcq).length===18 && Object.keys(tf).length===4 && Object.keys(sa).length===6;
  const raw=mcqCorrect*.25+tfScore+saCorrect*(standard?.25:1);
  const max=Object.keys(mcq).length*.25+Object.keys(tf).length+Object.keys(sa).length*(standard?.25:1);
  return {answers:a,score:exam.practiceOnly?null:Number(raw.toFixed(2)),maxScore:max,
    mcqCorrect,tfCorrectSubCount,saCorrect,mcqTotal:Object.keys(mcq).length,tfTotalSubCount:Object.keys(tf).length*4,saTotal:Object.keys(sa).length,
    mcqAnswered:Object.keys(a.mcq).length,tfAnsweredSubCount:Object.values(a.tf).reduce((n,v)=>n+Object.keys(v).length,0),saAnswered:Object.keys(a.sa).length};
}
export function deadlineMs(value) {
  if(!value)return null;
  // Legacy datetime-local values refer to Vietnam, never the Worker timezone.
  const normalized=/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)?value+':00+07:00':value;
  const n=Date.parse(normalized); requireValue(Number.isFinite(n),'Hạn làm bài không hợp lệ.');return n;
}
export function answerFeedback(answers,exam) {
  const a=answers||{},out={mcq:{},tf:{},sa:{}};
  const verdict=(v,key,short=false)=>v===undefined||v===null||String(v).trim()===''?'blank':(short?normalizeShort(v)===normalizeShort(key):v===key)?'correct':'wrong';
  for(const [q,key] of Object.entries(exam.mcqKeys||{}))out.mcq[q]=verdict(a.mcq?.[q],key);
  for(const [q,keys] of Object.entries(exam.tfKeys||{}))out.tf[q]=Object.fromEntries(Object.entries(keys).map(([sub,key])=>[sub,verdict(a.tf?.[q]?.[sub],key)]));
  for(const [q,key] of Object.entries(exam.saKeys||{}))out.sa[q]=verdict(a.sa?.[q],key,true);
  return out;
}
export function studentSubmission(s,exam=null) {
  const {gradingKeys,examSnapshot,privateKeys, ...safe}=s;
  return exam?{...safe,questionStructure:publicExam(exam),feedback:answerFeedback(s.answers,exam)}:safe;
}
