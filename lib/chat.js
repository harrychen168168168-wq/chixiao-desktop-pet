const {randomUUID}=require('node:crypto');
const {validate}=require('./settings');
const PERSONA='你是赤霄，一条红金色中国龙桌宠。用简短自然的中文回应，称用户为主人。不了解的事说不知道，未执行的动作不能声称已完成。仅依据当前对话和明确提供的数据回答，不猜测用户身份、文件或电脑状态。';
function request(settings,token,messages,system){
  const c=validate(settings);
  if(c.provider==='disabled')throw Error('主人，请先在连接设置中配置你自己的本机模型或 OpenClaw。');
  if(c.provider==='openclaw'&&!token)throw Error('请输入你自己的 OpenClaw 网关口令');
  const context=PERSONA+' 当前本地时间：'+new Date().toLocaleString('zh-CN')+(c.shareSystem&&system?' 当前电脑读数：'+JSON.stringify(system):'');
  const history=[{role:'system',content:context},...messages.slice(-24)];
  const headers={'Content-Type':'application/json'};
  if(c.provider==='openclaw')headers.Authorization='Bearer '+token;
  return {url:c.endpoint+(c.provider==='ollama'?'/api/chat':'/v1/chat/completions'),headers,body:JSON.stringify({model:c.provider==='ollama'?c.model:'openclaw/'+c.agent,messages:history,stream:false})};
}
class Chat{
  constructor({settings,token,read,write,system,fetcher=fetch}){Object.assign(this,{settings,token,read,write,system,fetcher});this.messages=read('chat.json',[]);if(!Array.isArray(this.messages))this.messages=[];this.messages=this.messages.filter(m=>['user','assistant'].includes(m.role)&&typeof m.content==='string').slice(-100);this.session=randomUUID();}
  clear(){this.cancel();this.messages=[];this.session=randomUUID();this.write('chat.json',[]);}
  cancel(){this.controller?.abort();}
  async send(text){
    if(this.controller)throw Error('请等当前回复结束，或先停止等待');
    text=String(text).trim();if(!text||text.length>12000)throw Error('请输入 1–12000 个字符');
    const history=[...this.messages,{role:'user',content:text}];
    const r=request(this.settings(),this.token(),history,this.system());
    if(this.settings().provider==='openclaw')r.headers['x-openclaw-session-key']='agent:'+this.settings().agent+':chixiao-public-'+this.session;
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),120000);
    try{
      const res=await this.fetcher(r.url,{method:'POST',headers:r.headers,body:r.body,redirect:'error',signal:controller.signal});
      if(!res.ok)throw Error('本机服务返回 HTTP '+res.status+'，请检查地址、模型与口令');
      const data=await res.json();if(controller.signal.aborted)throw Error('已停止等待回复');
      const reply=data.message?.content||data.choices?.[0]?.message?.content;
      if(typeof reply!=='string'||!reply.trim())throw Error('本机服务没有返回文字');
      this.messages=[...history,{role:'assistant',content:reply.slice(0,40000)}].slice(-100);this.write('chat.json',this.messages);
      return reply.slice(0,40000);
    }catch(e){if(controller.signal.aborted)throw Error('已停止等待回复；已交给 OpenClaw 的任务请在其控制台确认是否停止。');if(e.message?.startsWith('本机'))throw e;throw Error('本机服务未能完成回复，请确认服务正在运行。');}
    finally{clearTimeout(timeout);this.controller=null;}
  }
}
module.exports={Chat,request};
