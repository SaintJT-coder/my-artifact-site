const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
let count=0;
function parse(code,file,module=false){
 if(module||/^\s*(import\s|export\s)/m.test(code)){
  const r=spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'});
  if(r.status!==0)throw Error(file+': '+r.stderr);
 }else new vm.Script(code,{filename:file});
 count++;
}
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(item.name==='node_modules'||item.name==='.git')continue;
 const file=path.join(dir,item.name);
 if(item.isDirectory())walk(file);
 else if(/\.(js|cjs)$/.test(file)){parse(fs.readFileSync(file,'utf8'),file);}
 else if(file.endsWith('.html')){
  for(const match of fs.readFileSync(file,'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc=/.test(match[1])||/application\/(json|ld\+json)/.test(match[1]))continue;
   parse(match[2],file+' inline script',/type=["']module["']/.test(match[1]));
  }
 }
}}
walk('.');console.log('Parsed '+count+' JavaScript files and inline scripts successfully');
