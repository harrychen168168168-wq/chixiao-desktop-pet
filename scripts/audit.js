const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const runtime=['package.json','main.js','preload.js','lib/alerts.js','lib/address.js','lib/chat.js','lib/edge-hide.js','lib/lines.js','lib/mind.js','lib/roam.js','lib/settings.js','lib/system.js','lib/util.js','ui/common.css','ui/fire-field.js','ui/format.js','ui/idle-life.js','ui/panel.css','ui/panel.html','ui/panel.js','ui/pet.css','ui/pet.html','ui/pet.js','ui/status-inscriptions.js','ui/status-life.js','ui/assets/pet-anim.js','ui/assets/icon.ico','ui/assets/pet.png','ui/assets/cloud-platform-v1.png','ui/assets/cloud-guardian-v1.png','ui/assets/edge-peek-head-v2.png','README.md','PRIVACY.md','LICENSE'];
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'ui/assets/pet-anim.js'),'utf8'),ctx);
runtime.push('reset-preload.js','lib/reset-preferences.js','lib/codex-reset-source.js','lib/claude-reset-source.js','lib/claude-usage.js','lib/official-web-source.js','lib/reset-monitor.js','lib/reset-window.js','ui/resets.html','ui/resets.css','ui/resets.js','ui/carry-motion.js','ui/assets/chixiao-held-v1.png','CHANGELOG.md');
runtime.push(...Object.values(ctx.window.PET_ANIM.clips).map(c=>'ui/'+c.src));
const publicExtras=['.gitignore','package-lock.json','scripts/audit.js','scripts/package.ps1','test/privacy.test.js','test/edge.test.js'];
publicExtras.push('test/carry.test.js','test/official-web.test.js','test/resets.test.js');
const allowed=new Set([...runtime,...publicExtras]);
function walk(dir,prefix=''){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    if(!prefix&&['.git','node_modules','dist','verification'].includes(e.name))return [];
    const p=prefix+e.name;if(e.isSymbolicLink())throw Error('Symlink not permitted: '+p);
    return e.isDirectory()?walk(path.join(dir,e.name),p+'/'):[p];
  });
}
function audit(){
  const actual=walk(root);for(const p of actual)if(!allowed.has(p))throw Error('Unreviewed file: '+p);
  for(const p of allowed)if(!fs.existsSync(path.join(root,p)))throw Error('Missing file: '+p);
  const rules=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/gh[pousr]_[A-Za-z0-9]{25,}/,/github_pat_[A-Za-z0-9_]{30,}/,/[A-Z]:[\\/](?:Users|NEZHA|AppMigration)[\\/]/i];
  for(const p of actual){
    const b=fs.readFileSync(path.join(root,p));
    if(/\.(?:js|json|md|html|css|ps1)$/.test(p))for(const re of rules)if(re.test(b.toString()))throw Error('Sensitive-looking content in '+p);
    if(p.endsWith('.png')){
      for(let i=8;i+12<=b.length;){const n=b.readUInt32BE(i),kind=b.toString('ascii',i+4,i+8);if(['tEXt','zTXt','iTXt','eXIf'].includes(kind))throw Error('Image metadata must be removed: '+p+' '+kind);i+=n+12;}
    }
    if(p.endsWith('.webp')){
      for(let i=12;i+8<=b.length;){const kind=b.toString('ascii',i,i+4),n=b.readUInt32LE(i+4);if(['EXIF','XMP '].includes(kind))throw Error('Image metadata must be removed: '+p);i+=8+n+(n%2);}
    }
  }
  return [...new Set(runtime)].sort().map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),bytes:fs.statSync(path.join(root,file)).size}));
}
if(require.main===module){try{const files=audit();if(process.argv.includes('--json'))console.log(JSON.stringify(files,null,2));else console.log('PASS: '+files.length+' allowlisted runtime files; source file set, secret patterns and image metadata checked.');}catch(e){console.error(e.message);process.exit(1);}}
module.exports={audit,runtime};
