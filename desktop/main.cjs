const {app,BrowserWindow,Menu,ipcMain,shell,net}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {normalizeServerUrl}=require('./config.cjs');
let mainWindow,setupWindow;
function configPath(){return path.join(app.getPath('userData'),'connection.json');}
function readConfig(){try{return {serverUrl:normalizeServerUrl(JSON.parse(fs.readFileSync(configPath(),'utf8')).serverUrl)};}catch{return {serverUrl:''};}}
function writeConfig(serverUrl){fs.mkdirSync(path.dirname(configPath()),{recursive:true});fs.writeFileSync(configPath(),JSON.stringify({serverUrl},null,2),{mode:0o600});}
async function checkServer(value){
 const base=normalizeServerUrl(value),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
 try{const response=await net.fetch(base+'/ready',{signal:controller.signal,headers:{accept:'application/json'}});
  if(!response.ok)throw new Error('السيرفر لا يؤكد جاهزية قاعدة البيانات (HTTP '+response.status+')');
  const result=await response.json();if(result.status!=='ready'||result.database!=='connected')throw new Error('السيرفر يعمل لكن قاعدة البيانات غير جاهزة');
  return {ok:true,serverUrl:base,message:'الاتصال بالسيرفر وقاعدة البيانات ناجح'};
 }catch(error){if(error.name==='AbortError')throw new Error('انتهت مهلة الاتصال بالسيرفر');
  if(/certificate|self.signed|CERT_AUTHORITY_INVALID/i.test(error.message))throw new Error('شهادة HTTPS غير موثوقة. ثبّت شهادة الجهة المصدرة المعتمدة في Windows.');
  throw new Error(error.message||'تعذر الاتصال بالسيرفر');
 }finally{clearTimeout(timer);}
}
function openSetup(){
 if(setupWindow&&!setupWindow.isDestroyed()){setupWindow.focus();return;}
 setupWindow=new BrowserWindow({width:620,height:610,resizable:false,title:'تعريف النظام - NEW FEED ERP',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 setupWindow.on('closed',()=>setupWindow=null);setupWindow.loadFile(path.join(__dirname,'setup.html'));
}
function installMenu(){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'النظام',submenu:[
 {label:'تعريف النظام / إعداد السيرفر',click:openSetup},{label:'إعادة تحميل النظام',click:()=>mainWindow?.reload()},{type:'separator'},{role:'quit',label:'خروج'}]}]));}
async function openMain(){
 const cfg=readConfig();if(!cfg.serverUrl){openSetup();return;}
 mainWindow=new BrowserWindow({width:1440,height:920,minWidth:1050,minHeight:700,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 mainWindow.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith('https://'))shell.openExternal(url);return {action:'deny'};});
 mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!==cfg.serverUrl&&!url.startsWith(cfg.serverUrl+'/'))event.preventDefault();});
 mainWindow.on('closed',()=>mainWindow=null);await mainWindow.loadURL(cfg.serverUrl);
}
ipcMain.handle('erp:get-config',()=>readConfig());
ipcMain.handle('erp:test-server',(_e,url)=>checkServer(url));
ipcMain.handle('erp:save-config',async(_e,url)=>{const result=await checkServer(url);writeConfig(result.serverUrl);
 if(setupWindow&&!setupWindow.isDestroyed())setupWindow.close();
 if(mainWindow&&!mainWindow.isDestroyed())await mainWindow.loadURL(result.serverUrl);else await openMain();return result;});
app.whenReady().then(()=>{installMenu();openMain();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)openMain();});});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
