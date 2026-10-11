const $=id=>document.getElementById(id),api=window.deskPet.public;
let current,busy=false;
$('open-ai-resets').onclick=()=>window.deskPet.openResets();
$('open-chat').onclick=()=>$('message').focus();
function fields(){const p=$('provider').value;$('model-field').hidden=p!=='ollama';$('agent-field').hidden=p!=='openclaw';$('token-field').hidden=p!=='openclaw';}
function history(messages){
  if(!messages.length){$('conversation').replaceChildren();const p=document.createElement('p');p.className='welcome';p.textContent='主人，按住赤霄或祥云可以拖动，拖进屏幕边缘就能藏身。想聊天时，请先连接你自己的 AI。';$('conversation').append(p);return;}
  $('conversation').replaceChildren();for(const m of messages){const p=document.createElement('div'),who=document.createElement('strong');p.className='message '+m.role;who.textContent=m.role==='user'?'主人':'赤霄';p.append(who,document.createTextNode(m.content));$('conversation').append(p);}
  $('conversation').scrollTop=$('conversation').scrollHeight;
}
function render(state){
  current=state;const c=state.settings;
  for(const k of ['provider','endpoint','model','agent'])$(k).value=c[k];$('share-system').checked=c.shareSystem;$('token').value='';
  $('token-state').textContent=c.hasToken?'已保存口令；留空保留，使用“移除口令”可删除。':'尚未保存口令';
  $('connection').textContent=c.provider==='disabled'?'尚未连接 · 桌宠照常陪伴':'已配置 '+(c.provider==='ollama'?'本机 Ollama':'本机 OpenClaw')+' · 发送时连接';
  fields();history(state.messages);
}
function notice(error){$('notice').textContent=String(error?.message||error||'').replace(/^Error invoking remote method '[^']+': Error: /,'');}
$('provider').onchange=()=>{const p=$('provider').value;if(['http://127.0.0.1:11434','http://127.0.0.1:18789'].includes($('endpoint').value))$('endpoint').value='http://127.0.0.1:'+(p==='openclaw'?'18789':'11434');fields();};
function form(){return {provider:$('provider').value,endpoint:$('endpoint').value,model:$('model').value,agent:$('agent').value,token:$('token').value,shareSystem:$('share-system').checked};}
$('settings-form').onsubmit=async e=>{e.preventDefault();try{render(await api.save(form()));notice('连接设置已保存。不会自动启动服务或下载模型。');}catch(e){notice(e);}};
$('forget').onclick=async()=>{try{render(await api.save({...current.settings,forgetToken:true}));notice('已移除本机保存的口令。');}catch(e){notice(e);}};
$('chat-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;const text=$('message').value.trim();if(!text)return;
  busy=true;$('send').disabled=true;$('stop').disabled=false;notice('正在等待你配置的服务回复…');
  try{render(await api.send(text));$('message').value='';notice('');}catch(e){notice(e);}
  finally{busy=false;$('send').disabled=false;$('stop').disabled=true;}
};
$('stop').onclick=async()=>{await api.stop();notice('已停止等待；OpenClaw 已经开始的任务，需要在它的控制台确认停止。');};
$('clear').onclick=async()=>{try{render(await api.clear());notice('本地对话已清空。OpenClaw 自己保存的记录和记忆不受影响。');}catch(e){notice(e);}};
api.state().then(render).catch(notice);
