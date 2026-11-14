const input=document.getElementById('serverUrl'),box=document.getElementById('status'),test=document.getElementById('test'),save=document.getElementById('save');
function show(message,kind=''){box.textContent=message;box.className='status '+kind;}
window.erpDesktop.getConfig().then(c=>{if(c.serverUrl)input.value=c.serverUrl;}).catch(()=>show('تعذر قراءة الإعدادات المحلية.'));
test.addEventListener('click',async()=>{test.disabled=true;show('جارٍ اختبار الاتصال...');try{const r=await window.erpDesktop.testServer(input.value);show(r.message+' — '+r.serverUrl,'ok');}catch(e){show(e.message,'bad');}finally{test.disabled=false;}});
save.addEventListener('click',async()=>{save.disabled=true;show('جارٍ التحقق والحفظ...');try{const r=await window.erpDesktop.saveConfig(input.value);show(r.message,'ok');}catch(e){show(e.message,'bad');save.disabled=false;}});
