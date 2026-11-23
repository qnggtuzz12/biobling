const fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'dist');fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','secure-client.js','social-client.js','secure-config.js','favicon.png','favicon.ico'])fs.copyFileSync(path.join(__dirname,file),path.join(out,file));
// The temporary preview URL now uses the exact production application.
fs.copyFileSync(path.join(__dirname,'index.html'),path.join(out,'security-preview.html'));
fs.writeFileSync(path.join(out,'404.html'),'<!doctype html><html lang="vi"><meta charset="utf-8"><title>Không tìm thấy trang</title><p>Không tìm thấy trang này. <a href="/">Về BioBling</a></p></html>');
console.log('Built only the public website assets. Private backups and server tools are excluded.');
