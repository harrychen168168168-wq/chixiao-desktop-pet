const DEFAULTS=Object.freeze({provider:'disabled',endpoint:'http://127.0.0.1:11434',model:'',agent:'main',shareSystem:false});
function validate(input){
  const c={...DEFAULTS,...input};
  if(!['disabled','ollama','openclaw'].includes(c.provider))throw Error('请选择支持的连接方式');
  const u=new URL(String(c.endpoint));
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('只接受本机地址，例如 http://127.0.0.1:11434，不要附加路径或口令');
  if(typeof c.model!=='string'||c.model.length>150||/[\r\n]/.test(c.model))throw Error('模型名称无效');
  if(c.provider==='ollama'&&!c.model.trim())throw Error('请输入你已安装的模型名称');
  if(typeof c.agent!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(c.agent))throw Error('智能体名称只能包含字母、数字、下划线和短横线');
  return {provider:c.provider,endpoint:u.origin,model:c.model.trim(),agent:c.agent,shareSystem:c.shareSystem===true};
}
module.exports={DEFAULTS,validate};
