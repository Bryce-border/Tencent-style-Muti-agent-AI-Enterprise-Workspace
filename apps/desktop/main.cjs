const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const origin = 'http://localhost:8080';
// Keep the desktop profile alongside the portable application, not AppData.
const profile = path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.setAppUserModelId('enterprise.workspace.desktop');
let window;
const internal = url => { try { return new URL(url).origin === origin; } catch { return false; } };
function createWindow() {
  window = new BrowserWindow({ width: 1380, height: 920, minWidth: 700, minHeight: 560,
    title: 'Enterprise Workspace', icon: path.join(__dirname, 'application.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color:'#f1f6f600', symbolColor:'#385a59', height:38 },
    backgroundColor:'#f5f7fa', show:false,
    webPreferences: { nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true }
  });
  Menu.setApplicationMenu(null);
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!internal(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!internal(url)) event.preventDefault(); });
  window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle('Enterprise Workspace'); });
  window.webContents.on('did-finish-load', () => {
    if (internal(window.webContents.getURL())) window.webContents.insertCSS(`body{padding-top:38px} .sidebar{top:38px} body::after{content:'Enterprise Workspace';position:fixed;inset:0 0 auto 0;height:38px;padding:10px 16px;font:12px 'Segoe UI';color:#466563;background:rgba(244,249,249,.9);z-index:1000;-webkit-app-region:drag;box-sizing:border-box}`);
    window.show();
  });
  window.webContents.session.on('will-download', (_event, item) => {
    if (!internal(item.getURL())) { item.cancel(); return; }
    item.setSaveDialogOptions({ defaultPath:path.join(app.getPath('userData'), item.getFilename()) });
  });
  loadWorkspace();
}
async function loadWorkspace() {
  try { const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(4000)}); if(!response.ok) throw new Error(); await window.loadURL(origin); }
  catch { await window.loadFile(path.join(__dirname,'offline.html')); }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if(window){if(window.isMinimized())window.restore();window.focus();loadWorkspace();} });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
