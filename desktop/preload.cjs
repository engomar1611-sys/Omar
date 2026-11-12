const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('erpDesktop',Object.freeze({
 getConfig:()=>ipcRenderer.invoke('erp:get-config'),
 testServer:url=>ipcRenderer.invoke('erp:test-server',url),
 saveConfig:url=>ipcRenderer.invoke('erp:save-config',url)
}));
