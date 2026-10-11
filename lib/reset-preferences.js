const DEFAULTS=Object.freeze({official:false,codex:false,claude:false});
function validate(value){return Object.fromEntries(Object.keys(DEFAULTS).map(key=>[key,value?.[key]===true]));}
function enabled(settings,key){
  if(key==='codex'||key==='official:codex-messages')return settings.codex;
  if(key==='claude')return settings.claude;
  return key.startsWith('official:')&&settings.official;
}
module.exports={DEFAULTS,validate,enabled};
