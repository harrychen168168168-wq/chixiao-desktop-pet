const { BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const ALLOWED = new Set(['claude.ai', 'chatgpt.com', 'status.claude.com', 'status.openai.com']);
for (const host of require('./official-web-source').HOSTS) ALLOWED.add(host);

function createResetWindow({ monitor, pet, onState, onNotice }) {
  let win = null, quitting = false;
  const alive = () => win && !win.isDestroyed();
  function send() { if (alive() && !win.webContents.isLoading()) win.webContents.send('resets:state', monitor.snapshot()); }
  function show() {
    if (!alive()) {
      const a = screen.getDisplayMatching(pet().getBounds()).workArea;
      win = new BrowserWindow({ width: 470, height: Math.min(760, a.height - 24), x: a.x + a.width - 486, y: a.y + 12,
        title: '赤霄 · 重置提醒', show: false, alwaysOnTop: true, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, '..', 'reset-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
      win.webContents.once('did-finish-load', () => { send(); win.show(); win.setAlwaysOnTop(true, 'screen-saver'); });
      win.loadFile(path.join(__dirname, '..', 'ui', 'resets.html'));
      win.show(); win.setAlwaysOnTop(true, 'screen-saver');
      win.on('close', e => {
        if (quitting) return;
        e.preventDefault();
        win.webContents.send('resets:request-close');
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
    } else { send(); win.show(); win.setAlwaysOnTop(true, 'screen-saver'); }
  }
  const valid = e => alive() && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame;
  ipcMain.handle('resets:initial', e => valid(e) ? monitor.snapshot() : null);
  ipcMain.handle('resets:refresh', async e => { if (!valid(e)) return; await monitor.refresh(); return monitor.snapshot(); });
  ipcMain.on('resets:close', (e, ids) => {
    if (!valid(e)) return;
    monitor.acknowledge(ids);
    if (!monitor.state.notices.some(n => !n.acknowledgedAt)) win.hide(); else send();
  });
  ipcMain.handle('resets:claude-login', async e => {
    if (!valid(e)) return;
    if (!monitor.enabled('claude')) return {ok:false,error:'请先在上方开启读取自己的 Claude 账户并保存'};
    try { await monitor.claude.openLogin(); return { ok: true }; }
    catch { return { ok: false, error: '官方登录页暂时无法打开，请稍后重试' }; }
  });
  ipcMain.on('resets:open-url', (e, url) => {
    if (!valid(e)) return;
    try { const u = new URL(url); if (u.protocol === 'https:' && !u.username && !u.password && ALLOWED.has(u.hostname)) shell.openExternal(u.href); } catch { /* invalid URL */ }
  });
  monitor.on('update', state => { send(); onState(state); });
  monitor.on('notice', n => { show(); onNotice(n); });
  return { show, stop() { quitting = true; monitor.stop(); }, getWindow: () => win };
}
module.exports = { createResetWindow };
