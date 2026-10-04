const fs=require('node:fs');
const path=require('node:path');
// Dedicated public-edition profile. No search or migration of another app's data.
const {app}=require('electron');
const DATA_DIR=app.getPath('userData');
function readJson(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(DATA_DIR,name),'utf8'));}catch{return fallback;}}
function writeJson(name,value){fs.mkdirSync(DATA_DIR,{recursive:true});const p=path.join(DATA_DIR,name);fs.writeFileSync(p+'.tmp',JSON.stringify(value,null,2));fs.renameSync(p+'.tmp',p);}
module.exports={DATA_DIR,readJson,writeJson};
