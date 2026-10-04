const {contextBridge,ipcRenderer}=require('electron');
const channels=new Set(['system','active','alerts','pet:clicked','chat:reply','chat:thinking','pet:say','pet:motion','pet:command','pet:edge']);
contextBridge.exposeInMainWorld('deskPet',{
  isElectron:true,initial:()=>ipcRenderer.invoke('initial'),
  on:(ch,fn)=>{if(channels.has(ch))ipcRenderer.on(ch,(_e,v)=>fn(v));},
  down:()=>ipcRenderer.send('pet:down'),up:p=>ipcRenderer.send('pet:up',{cancelled:Boolean(p?.cancelled)}),
  menu:()=>ipcRenderer.send('pet:menu'),size:h=>ipcRenderer.send('pet:size',h),
  touch:(kind,info)=>ipcRenderer.send('pet:touch',kind,info),petState:s=>ipcRenderer.send('pet:state',s),
  behavior:s=>ipcRenderer.send('pet:behavior',s),command:k=>ipcRenderer.send('pet:command',k),log:()=>{},
  public:{state:()=>ipcRenderer.invoke('public:state'),save:s=>ipcRenderer.invoke('public:save',s),send:s=>ipcRenderer.invoke('public:send',s),stop:()=>ipcRenderer.invoke('public:stop'),clear:()=>ipcRenderer.invoke('public:clear')}
});
