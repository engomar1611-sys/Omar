const storedToken=sessionStorage.getItem("nf_access_token");
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init={})=>{
  const url=typeof input==="string"?input:input.url;
  const headers=new Headers(init.headers||(typeof input!=="string"?input.headers:undefined));
  if(url&&url.startsWith("/api/")&&!url.startsWith("/api/auth/")&&storedToken)headers.set("Authorization","Bearer "+storedToken);
  return originalFetch(input,{...init,headers}).then(response=>{
    if(response.status===401&&storedToken){sessionStorage.removeItem("nf_access_token");sessionStorage.removeItem("nf_user_name");location.reload();}
    return response;
  });
};
const authMessage=(message)=>{const el=document.getElementById("authMessage");if(el)el.textContent=message||"";};
const saveSession=(data)=>{sessionStorage.setItem("nf_access_token",data.access_token);sessionStorage.setItem("nf_user_name",data.user.display_name);location.reload();};
document.getElementById("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();authMessage("جارٍ التحقق...");
  try{const r=await originalFetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:document.getElementById("loginUsername").value,password:document.getElementById("loginPassword").value})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر تسجيل الدخول");saveSession(d);}catch(err){authMessage(err.message);}
});
document.getElementById("bootstrapForm").addEventListener("submit",async e=>{
  e.preventDefault();authMessage("جارٍ إنشاء المدير الأول...");
  try{const r=await originalFetch("/api/auth/bootstrap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bootstrap_secret:document.getElementById("bootstrapSecret").value,username:document.getElementById("bootstrapUsername").value,display_name:document.getElementById("bootstrapDisplayName").value,password:document.getElementById("bootstrapPassword").value})});const d=await r.json();if(!r.ok)throw new Error(d.error||"تعذر إنشاء المدير");saveSession(d);}catch(err){authMessage(err.message);}
});
if(storedToken){document.getElementById("authGate").style.display="none";const name=sessionStorage.getItem("nf_user_name");const userLabel=document.querySelector(".user b");if(name&&userLabel)userLabel.textContent=name;}
let posProducts=[],posContext=null;
const modules=[["pos","▣","نقطة البيع"],["catalog","▦","الأصناف والباركود"],["inventory","▤","المخازن والمخزون"],["purchasing","🛒","المشتريات وطلبات الشراء"],["sales","🧾","المبيعات والفواتير"],["customers","♙","العملاء والولاء"],["suppliers","♧","الموردون"],["accounting","＄","الحسابات والخزينة"],["hr","♙","الموارد البشرية"],["assets","▣","الأصول والصيانة"],["delivery","➤","التوصيل"],["ecommerce","▧","المتجر الإلكتروني"],["users","⚙","المستخدمون والصلاحيات"],["settings","⚙","إعدادات النظام"]];
const moduleData={catalog:["الأصناف والباركود",["كود الصنف","اسم الصنف","التصنيف","الوحدة الأساسية","باركود","حالة الوزن","الصلاحية"],"لا توجد أصناف مسجلة بعد. أضف بيانات الأصناف المعتمدة أو استوردها من ملف موثوق."],inventory:["المخازن والمخزون",["كود الصنف","الصنف","المخزن","التشغيلة","الصلاحية","الكمية","متوسط التكلفة"],"ستظهر أرصدة المخزون وحركاته بعد تهيئة المخازن وإدخال أرصدة افتتاحية معتمدة."],purchasing:["المشتريات وطلبات الشراء",["الرقم المرجعي","المورد","التاريخ","الحالة","القيمة"],"أنشئ طلب شراء، ثم اعتمده وأصدر أمر الشراء وسجل الاستلام وفحص الجودة."],sales:["المبيعات والفواتير",["الرقم المرجعي","التاريخ","الكاشير","العميل","الإجمالي","الحالة"],"تظهر فواتير البيع المكتملة والمرتجعات بعد ربط نقاط البيع بقاعدة البيانات."],customers:["العملاء والولاء",["كود العميل","اسم العميل","الهاتف","نقاط الولاء","الحالة"],"سجل العملاء وربطهم بالمبيعات ونظام الولاء."],suppliers:["الموردون",["كود المورد","اسم المورد","الهاتف","الرصيد","الحالة"],"سجل الموردين وربطهم بطلبات الشراء والاستلام والمستحقات."],accounting:["الحسابات والخزينة",["كود الحساب","اسم الحساب","نوع الحساب","الحالة"],"دليل الحسابات والقيود اليومية والخزائن والبنوك والتسويات."],hr:["الموارد البشرية",["كود الموظف","اسم الموظف","الوظيفة","الفرع","الحالة"],"ملفات الموظفين والورديات والحضور والإجازات والصلاحيات الوظيفية."],assets:["الأصول والصيانة",["كود الأصل","اسم الأصل","التصنيف","الموقع","الحالة"],"سجل الأصول والترقيم وطباعة ملصقات الباركود والصيانة."],delivery:["التوصيل",["رقم الطلب","العميل","العنوان","مندوب التوصيل","الحالة"],"إدارة طلبات التوصيل وتخصيص المندوب ومتابعة التسليم."],ecommerce:["المتجر الإلكتروني",["رقم الطلب","العميل","قناة الطلب","الدفع","الحالة"],"إدارة كتالوج المتجر والطلبات ومزامنتها مع المخزون ونقاط البيع."],users:["المستخدمون والصلاحيات",["اسم المستخدم","الاسم","الدور","الصلاحيات","الحالة"],"إدارة المستخدمين والأدوار والصلاحيات على مستوى الموديول والإجراء."],settings:["إعدادات النظام",["الإعداد","القيمة","الوصف"],"إعدادات الشركة والفروع والضرائب والترقيم والطباعة والنسخ الاحتياطي والاتصال."]};
let cart=[],activeCategory="الكل";
const $=id=>document.getElementById(id),money=n=>Number(n).toFixed(2);
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.append(t);setTimeout(()=>t.remove(),2600)}
function renderNav(){ $("moduleNav").innerHTML=modules.map(([id,ic,name])=>'<button class="nav-item '+(id==="pos"?"active":"")+'" data-module="'+id+'"><span class="nav-icon">'+ic+'</span>'+name+'</button>').join("");document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>openModule(b.dataset.module));}
function renderCategories(){
 const cats=["الكل",...new Set(posProducts.map(p=>p.category_name).filter(Boolean))];
 if(activeCategory!=="الكل"&&!cats.includes(activeCategory))activeCategory="الكل";
 $("categories").innerHTML=cats.map(x=>'<button class="category '+(x===activeCategory?"active":"")+'" data-cat="'+escapeHtml(x)+'">'+escapeHtml(x)+'</button>').join("");
 document.querySelectorAll(".category").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;renderCategories();renderProducts();});
}
function renderProducts(){
 const q=$("productSearch").value.trim().toLowerCase();
 const list=posProducts.filter(p=>(activeCategory==="الكل"||p.category_name===activeCategory)&&(!q||p.name_ar.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q)||(p.barcodes||[]).some(x=>String(x).includes(q))));
 $("productGrid").innerHTML=list.map(p=>{
  const price=p.retail_price===null||p.retail_price===undefined?null:Number(p.retail_price);
  return '<button class="product-card" data-id="'+p.id+'" '+(price===null?'disabled':'')+'><span class="product-visual">▦</span><b>'+escapeHtml(p.name_ar)+'</b><small>'+escapeHtml(p.sku)+'</small><strong>'+(price===null?'السعر غير محدد':money(price)+' ج.م')+'</strong></button>';
 }).join("")||'<div class="empty-state">لا توجد أصناف مطابقة في كتالوج قاعدة البيانات</div>';
 document.querySelectorAll(".product-card:not(:disabled)").forEach(b=>b.onclick=()=>addProduct(b.dataset.id));
}
function quantityStep(item){if(!item.weighted)return 1;return ["KG","L"].includes(item.base_unit_code)?0.1:["G","ML"].includes(item.base_unit_code)?100:0.1;}
function addProduct(id){
 const p=posProducts.find(x=>x.id===id);
 if(!p)return;
 if(p.retail_price===null||p.retail_price===undefined)return toast("لا يمكن البيع قبل تسجيل سعر تجزئة معتمد للصنف");
 let amount=1;
 if(p.is_weighted){const entered=prompt("أدخل الكمية بوحدة "+(p.base_unit_code||"الصنف"),"0.5");if(entered===null)return;amount=Number(entered);if(!Number.isFinite(amount)||amount<=0)return toast("الكمية غير صحيحة");}
 const found=cart.find(x=>x.id===id);
 if(found)found.qty=Number((found.qty+amount).toFixed(6));
 else cart.push({id:p.id,product_id:p.id,unit_id:p.base_unit_id,name:p.name_ar,price:Number(p.retail_price),cat:p.category_name||"",qty:amount,weighted:p.is_weighted,base_unit_code:p.base_unit_code});
 renderCart();
}
function renderCart(){
 const sub=cart.reduce((s,x)=>s+x.price*x.qty,0),pct=Math.min(100,Math.max(0,Number($("discountInput").value)||0)),disc=sub*pct/100;
 $("cartLines").innerHTML=cart.map((x,i)=>'<div class="cart-line"><span>'+(i+1)+'</span><b>'+escapeHtml(x.name)+'</b><span class="qty-control"><button data-dec="'+x.id+'">−</button>'+x.qty+'<button data-inc="'+x.id+'">+</button></span><span>'+money(x.price)+'</span><b>'+money(x.price*x.qty)+'</b><button class="remove-line" data-del="'+x.id+'">×</button></div>').join("")||'<div class="empty-state">أضف الأصناف إلى فاتورة البيع</div>';
 $("itemCount").textContent=cart.reduce((s,x)=>s+x.qty,0);$("subtotal").textContent=money(sub);$("discountValue").textContent=money(disc);$("grandTotal").textContent=money(sub-disc)+" ج.م";
 document.querySelectorAll("[data-inc]").forEach(b=>b.onclick=()=>{const x=cart.find(x=>x.id===b.dataset.inc);if(x){x.qty=Number((x.qty+quantityStep(x)).toFixed(6));renderCart();}});
 document.querySelectorAll("[data-dec]").forEach(b=>b.onclick=()=>{const x=cart.find(x=>x.id===b.dataset.dec);if(x){x.qty=Number((x.qty-quantityStep(x)).toFixed(6));if(x.qty<=0)cart=cart.filter(y=>y.id!==x.id);renderCart();}});
 document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==b.dataset.del);renderCart();});
}
async function loadPosData(){
 try{
  const [context,catalog]=await Promise.all([api("/api/pos/context"),api("/api/products?limit=200")]);
  posContext=context;posProducts=catalog.items||[];
  $("paymentMethod").innerHTML=context.payment_methods.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name_ar)+'</option>').join("");
  renderCategories();renderProducts();
 }catch(e){$("productGrid").innerHTML='<div class="empty-state">'+escapeHtml(e.message)+'<br>تحقق من تهيئة الفرع والصلاحيات والأسعار.</div>';}
}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"تعذر تنفيذ الطلب");return data;}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));}
async function openCatalog(){
 $("moduleView").innerHTML='<h1 class="module-title">إدارة الأصناف والباركود</h1><div class="catalog-tabs"><button class="primary-btn" data-tab="products">الأصناف</button><button class="primary-btn" data-tab="add">إضافة صنف</button><button class="primary-btn" data-tab="import">استيراد كتالوج</button></div><div id="catalogContent"><div class="empty-state">جارٍ تحميل بيانات الأصناف...</div></div>';
 document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("tab-active",x===b));if(b.dataset.tab==="products")loadProducts();if(b.dataset.tab==="add")showProductForm();if(b.dataset.tab==="import")showImportForm();});
 document.querySelector('[data-tab="products"]').classList.add("tab-active");await loadProducts();
}
async function loadProducts(){
 const root=$("catalogContent");root.innerHTML='<div class="empty-state">جارٍ تحميل الأصناف...</div>';
 try{const d=await api("/api/products?limit=200");root.innerHTML='<div class="module-toolbar"><input id="catalogSearch" placeholder="بحث بالاسم أو كود الصنف"><span class="muted">عدد السجلات: '+d.items.length+'</span></div><div class="table-scroll"><table class="module-table"><thead><tr><th>الكود الداخلي</th><th>اسم الصنف</th><th>التصنيف</th><th>الوحدة</th><th>وزني</th><th>الصلاحية</th><th>الباركود والطباعة</th></tr></thead><tbody id="catalogRows">'+d.items.map(p=>'<tr><td>'+escapeHtml(p.sku)+'</td><td>'+escapeHtml(p.name_ar)+'</td><td>'+escapeHtml(p.category_name||"—")+'</td><td>'+escapeHtml(p.base_unit_code||"—")+'</td><td>'+(p.is_weighted?"نعم":"لا")+'</td><td>'+(p.tracks_expiry?"نعم":"لا")+'</td><td><button class="small-btn" data-barcode="'+p.id+'">إنشاء باركود</button> <button class="small-btn" data-label="'+p.id+'">طباعة ملصق</button></td></tr>').join("")+'</tbody></table></div>';
 $("catalogSearch").oninput=()=>{const q=$("catalogSearch").value.toLowerCase();document.querySelectorAll("#catalogRows tr").forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(q));};
 document.querySelectorAll("[data-barcode]").forEach(b=>b.onclick=async()=>{try{const x=await api("/api/products/"+b.dataset.barcode+"/internal-barcode",{method:"POST",body:"{}"});toast("تم إنشاء باركود داخلي: "+x.barcode);await loadProducts();}catch(e){toast(e.message)}});
 document.querySelectorAll("[data-label]").forEach(b=>b.onclick=()=>{const size=prompt("اختر مقاس الملصق: 30x20 أو 50x30 أو 70x40 أو 100x50 مم","50x30");if(size&&["30x20","50x30","70x40","100x50"].includes(size))window.open("/api/products/"+b.dataset.label+"/label?size="+size,"_blank","noopener");});
 }catch(e){root.innerHTML='<div class="empty-state">'+escapeHtml(e.message)+'<br>تحقق من تشغيل الخادم وترحيلات قاعدة البيانات.</div>';}
}
async function showProductForm(){
 const root=$("catalogContent");root.innerHTML='<h2>تسجيل صنف جديد</h2><div class="form-grid"><label>اسم الصنف بالعربية<input id="pName" required></label><label>اسم إنجليزي<input id="pNameEn"></label><label>التصنيف<select id="pCategory"></select></label><label>الوحدة الأساسية<select id="pUnit"></select></label><label>الماركة (اختياري)<select id="pBrand"><option value="">بدون تحديد</option></select></label><label>كود الصنف (اتركه فارغًا للتوليد التلقائي)<input id="pSku"></label><label>حجم العبوة<input id="pPack" type="number" min="0" step="any"></label><label>وحدة العبوة<select id="pPackUnit"><option value="">—</option></select></label><label>وصف الحجم/العبوة<input id="pVariant" placeholder="مثال: عبوة 1.5 لتر"></label><label>باركود المصنع<input id="pBarcode"></label><label class="check-label"><input id="pWeighted" type="checkbox"> يباع بالوزن</label><label class="check-label"><input id="pExpiry" type="checkbox"> يتطلب تاريخ صلاحية</label></div><div class="module-toolbar"><button class="primary-btn" id="saveProduct">حفظ الصنف</button></div><div id="formMessage" class="muted"></div>';
 try{const [cats,units,brands]=await Promise.all([api("/api/categories"),api("/api/units"),api("/api/brands")]);$("pCategory").innerHTML='<option value="">بدون تصنيف</option>'+cats.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name_ar)+'</option>').join("");const opts=units.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name_ar)+' ('+escapeHtml(x.code)+')</option>').join("");$("pUnit").innerHTML=opts;$("pPackUnit").innerHTML='<option value="">—</option>'+opts;$("pBrand").innerHTML+='<option value="">بدون تحديد</option>'+brands.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name_ar)+'</option>').join("");
 }catch(e){$("formMessage").textContent="تعذر تحميل القوائم المرجعية: "+e.message;return;}
 $("saveProduct").onclick=async()=>{const name=$("pName").value.trim(),unit=$("pUnit").value;if(!name||!unit)return toast("اسم الصنف والوحدة الأساسية مطلوبان");const bar=$("pBarcode").value.trim();const body={name_ar:name,name_en:$("pNameEn").value.trim()||null,sku:$("pSku").value.trim()||null,category_id:$("pCategory").value||null,brand_id:$("pBrand").value||null,base_unit_id:unit,pack_size:$("pPack").value?Number($("pPack").value):null,pack_unit_id:$("pPackUnit").value||null,variant_description:$("pVariant").value.trim()||null,is_weighted:$("pWeighted").checked,tracks_expiry:$("pExpiry").checked,barcodes:bar?[bar]:[]};try{const p=await api("/api/products",{method:"POST",body:JSON.stringify(body)});toast("تم حفظ الصنف بالكود "+p.sku);await loadProducts();}catch(e){toast(e.message)}};
}
function showImportForm(){
 $("catalogContent").innerHTML='<h2>استيراد دفعة كتالوج</h2><p class="muted">الصق بيانات JSON. سيتم فحصها وحفظها في منطقة المراجعة فقط؛ لن تُضاف الأصناف إلى البيع قبل الاعتماد.</p><textarea id="importJson" rows="12" style="width:100%;font:13px monospace;direction:ltr" placeholder=\'{"source_name":"مورد","rows":[{"name_ar":"اسم صنف موثق","category_code":"BEVERAGES","base_unit_code":"PCS"}]}\'></textarea><div class="module-toolbar"><button class="primary-btn" id="validateImport">فحص واستيراد للمراجعة</button></div><div id="importResult"></div>';
 $("validateImport").onclick=async()=>{try{const body=JSON.parse($("importJson").value);const r=await api("/api/product-imports",{method:"POST",body:JSON.stringify(body)});$("importResult").innerHTML='<p>رقم الدفعة: <b>'+escapeHtml(r.batch_id)+'</b></p><p>الصفوف: '+r.row_count+' | صالحة للمراجعة: '+r.valid_for_review+' | مرفوضة: '+r.rejected+'</p><pre>'+escapeHtml(JSON.stringify(r.rows,null,2))+'</pre><button class="primary-btn" id="approveBatch" '+(r.valid_for_review===0?"disabled":"")+'>اعتماد وإضافة الأصناف الصالحة</button>';
$("approveBatch").onclick=async()=>{if(!confirm("سيتم إنشاء الأصناف الصالحة وتسجيل الأسعار الواردة بمصادرها. هل تريد المتابعة؟"))return;try{const a=await api("/api/product-imports/"+r.batch_id+"/approve",{method:"POST",body:"{}"});$("importResult").insertAdjacentHTML("beforeend",'<p>تم الاعتماد. أصناف مضافة: '+a.created_count+' | مرفوضة: '+a.rejected_count+'</p>');}catch(e){toast(e.message)}}; }catch(e){$("importResult").textContent=e.message;}};
}
const liveModuleConfig={
 inventory:{title:"المخزون المتاح",url:"/api/inventory/stock",columns:[["sku","كود الصنف"],["name_ar","الصنف"],["warehouse_name","المخزن"],["lot_number","التشغيلة"],["expiry_date","الصلاحية"],["quantity_on_hand","الكمية"],["unit_cost","تكلفة الوحدة"]]},
 purchasing:{title:"أوامر الشراء والاستلام",url:"/api/purchase-orders",columns:[["reference_no","الرقم المرجعي"],["supplier_name","المورد"],["branch_name","الفرع"],["status","الحالة"],["created_at","تاريخ الإنشاء"]]},
 sales:{title:"فواتير البيع",url:"/api/sales",columns:[["reference_no","رقم الفاتورة"],["created_at","التاريخ"],["cashier_name","الكاشير"],["customer_name","العميل"],["grand_total","الإجمالي"],["status","الحالة"]]},
 customers:{title:"العملاء",url:"/api/customers",columns:[["code","الكود"],["name","الاسم"],["phone","الهاتف"],["loyalty_points","نقاط الولاء"],["is_active","نشط"]]},
 suppliers:{title:"الموردون",url:"/api/suppliers",columns:[["code","الكود"],["name","الاسم"],["phone","الهاتف"],["tax_number","الرقم الضريبي"],["is_active","نشط"]]},
 hr:{title:"الموظفون والورديات",url:"/api/employees",columns:[["employee_code","كود الموظف"],["full_name","الاسم"],["job_title","الوظيفة"],["branch_name","الفرع"],["employment_status","الحالة"]]},
 assets:{title:"الأصول والصيانة",url:"/api/assets",columns:[["asset_code","كود الأصل"],["name","الأصل"],["category","التصنيف"],["branch_name","الفرع"],["purchase_cost","تكلفة الشراء"],["status","الحالة"]]},
 delivery:{title:"طلبات التوصيل",url:"/api/delivery/orders",columns:[["reference_no","رقم الطلب"],["customer_name","العميل"],["address","العنوان"],["delivery_fee","رسوم التوصيل"],["status","الحالة"]]},
 ecommerce:{title:"طلبات المتجر الإلكتروني",url:"/api/ecommerce/orders",columns:[["reference_no","رقم الطلب"],["customer_name","العميل"],["phone","الهاتف"],["address","العنوان"],["status","الحالة"],["created_at","التاريخ"]]},
 accounting:{title:"الفترات المحاسبية",url:"/api/accounting/periods",columns:[["period_name","الفترة"],["starts_on","من"],["ends_on","إلى"],["status","الحالة"]]}
};
function formatModuleValue(value){
 if(value===null||value===undefined||value==="")return "—";
 if(typeof value==="boolean")return value?"نعم":"لا";
 if(typeof value==="number")return money(value);
 if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(value))return new Date(value).toLocaleString("ar-EG");
 return String(value);
}
async function loadOperationalModule(id){
 const cfg=liveModuleConfig[id],root=$("moduleView");
 root.innerHTML='<h1 class="module-title">'+escapeHtml(cfg.title)+'</h1><div class="module-toolbar"><input id="moduleSearch" placeholder="بحث في البيانات"><span class="muted">جارٍ تحميل البيانات...</span></div><div id="liveModuleContent" class="table-scroll"></div>';
 try{
  const data=await api(cfg.url),rows=data.items||[];
  const renderRows=items=>items.map(row=>'<tr>'+cfg.columns.map(([key])=>'<td>'+escapeHtml(formatModuleValue(row[key]))+'</td>').join("")+'</tr>').join("");
  const header='<thead><tr>'+cfg.columns.map(([,label])=>'<th>'+escapeHtml(label)+'</th>').join("")+'</tr></thead>';
  const content=$("liveModuleContent");
  content.innerHTML=rows.length?'<table class="module-table">'+header+'<tbody>'+renderRows(rows)+'</tbody></table>':'<div class="empty-state">لا توجد بيانات مسجلة حتى الآن.</div>';
  $("moduleSearch").oninput=()=>{
   const q=$("moduleSearch").value.toLowerCase();
   content.querySelectorAll("tbody tr").forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(q));
  };
  if(id==="accounting"){
   const journals=await api("/api/accounting/journals");
   const items=journals.items||[];
   content.innerHTML+='<h2 class="module-title">قيود الأستاذ العام</h2>'+(items.length?'<table class="module-table"><thead><tr><th>المرجع</th><th>المصدر</th><th>التاريخ</th><th>الحالة</th><th>مدين</th><th>دائن</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(x.reference_no)+'</td><td>'+escapeHtml(x.source_type)+'</td><td>'+escapeHtml(formatModuleValue(x.entry_date))+'</td><td>'+escapeHtml(x.status)+'</td><td>'+money(x.total_debit)+'</td><td>'+money(x.total_credit)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">لا توجد قيود مرحّلة حتى الآن.</div>');
  }
  if(id==="sales"){
   const returns=await api("/api/sales/returns");
   const extra=returns.items||[];
   content.innerHTML+='<h2 class="module-title">طلبات المرتجعات</h2>'+(extra.length?'<table class="module-table"><thead><tr><th>رقم المرتجع</th><th>الفاتورة الأصلية</th><th>العميل</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>'+extra.map(x=>'<tr><td>'+escapeHtml(x.reference_no)+'</td><td>'+escapeHtml(x.sale_reference)+'</td><td>'+escapeHtml(x.customer_name||"—")+'</td><td>'+escapeHtml(x.status)+'</td><td>'+money(x.refund_total)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty-state">لا توجد مرتجعات مسجلة.</div>');
  }
 }catch(e){$("liveModuleContent").innerHTML='<div class="empty-state">'+escapeHtml(e.message)+'</div>';}
}
async function openUsers(){
 const root=$("moduleView");
 root.innerHTML='<h1 class="module-title">المستخدمون والصلاحيات</h1><div id="usersContent" class="empty-state">جارٍ تحميل المستخدمين...</div>';
 try{
  const [users,roles,permissions]=await Promise.all([api("/api/users"),api("/api/roles"),api("/api/permissions")]);
  const target=$("usersContent");
  const roleOptions=roles.items.map(r=>'<option value="'+escapeHtml(r.code)+'">'+escapeHtml(r.name)+' ('+escapeHtml(r.code)+')</option>').join("");
  target.innerHTML='<h2>إضافة مستخدم</h2><div class="form-grid"><label>اسم المستخدم<input id="newUsername"></label><label>الاسم الظاهر<input id="newDisplayName"></label><label>كلمة المرور<input id="newUserPassword" type="password" minlength="12"></label><label>الأدوار (يمكن اختيار أكثر من دور)<select id="newUserRoles" multiple size="4">'+roleOptions+'</select></label></div><button class="primary-btn" id="createUser">إنشاء المستخدم</button><div class="table-scroll"><h2>قائمة المستخدمين</h2><table class="module-table"><thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>الأدوار</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>'+users.items.map(u=>'<tr><td>'+escapeHtml(u.username)+'</td><td>'+escapeHtml(u.display_name)+'</td><td>'+escapeHtml((u.role_codes||[]).join("، "))+'</td><td>'+(u.is_active?"نشط":"موقوف")+'</td><td><button class="small-btn" data-user-toggle="'+u.id+'" data-active="'+u.is_active+'">'+(u.is_active?"إيقاف":"تفعيل")+'</button></td></tr>').join("")+'</tbody></table></div><h2>صلاحيات الأدوار</h2><div class="module-toolbar"><select id="rolePermissionTarget">'+roleOptions+'</select><button class="primary-btn" id="saveRolePermissions">حفظ صلاحيات الدور</button></div><div id="permissionChecks" class="form-grid"></div>';
  $("createUser").onclick=async()=>{
   const selected=[...$("newUserRoles").selectedOptions].map(x=>x.value);
   const body={username:$("newUsername").value.trim(),display_name:$("newDisplayName").value.trim(),password:$("newUserPassword").value,role_codes:selected};
   try{await api("/api/users",{method:"POST",body:JSON.stringify(body)});toast("تم إنشاء المستخدم");await openUsers();}catch(e){toast(e.message);}
  };
  document.querySelectorAll("[data-user-toggle]").forEach(b=>b.onclick=async()=>{
   try{await api("/api/users/"+b.dataset.userToggle+"/status",{method:"PATCH",body:JSON.stringify({is_active:b.dataset.active!=="true"})});toast("تم تحديث حالة المستخدم");await openUsers();}catch(e){toast(e.message);}
  });
  const renderPermissions=()=>{
   const role=roles.items.find(x=>x.code===$("rolePermissionTarget").value);
   const selected=new Set(role?.permission_codes||[]);
   $("permissionChecks").innerHTML=permissions.items.map(p=>'<label class="check-label"><input type="checkbox" value="'+escapeHtml(p.code)+'" '+(selected.has(p.code)?"checked":"")+' '+(role?.code==="SUPER_ADMIN"?"disabled":"")+'>'+escapeHtml(p.description)+' ('+escapeHtml(p.code)+')</label>').join("");
   $("saveRolePermissions").disabled=role?.code==="SUPER_ADMIN";
  };
  $("rolePermissionTarget").onchange=renderPermissions;renderPermissions();
  $("saveRolePermissions").onclick=async()=>{
   const role=$("rolePermissionTarget").value;
   const permission_codes=[...$("permissionChecks").querySelectorAll("input:checked")].map(x=>x.value);
   try{await api("/api/roles/"+encodeURIComponent(role)+"/permissions",{method:"PUT",body:JSON.stringify({permission_codes})});toast("تم حفظ صلاحيات الدور");await openUsers();}catch(e){toast(e.message);}
  };
 }catch(e){root.innerHTML='<div class="empty-state">'+escapeHtml(e.message)+'</div>';}
}
function openModule(id){
 document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.module===id));
 $("posView").classList.toggle("hidden",id!=="pos");$("posActions").classList.toggle("hidden",id!=="pos");$("moduleView").classList.toggle("hidden",id==="pos");
 const title=modules.find(x=>x[0]===id)?.[2]||"نقطة البيع";$("screenTitle").textContent=title;
 if(id==="pos")return;
 if(id==="catalog"){openCatalog();return;}
 if(id==="users"){openUsers();return;}
 if(liveModuleConfig[id]){loadOperationalModule(id);return;}
 const d=moduleData[id];$("moduleView").innerHTML='<h1 class="module-title">'+escapeHtml(d[0])+'</h1><div class="empty-state">'+escapeHtml(d[2])+'</div>';
}

$("productSearch").addEventListener("input",renderProducts);$("discountInput").addEventListener("input",renderCart);
$("clearCart").onclick=()=>{cart=[];renderCart();toast("تم إفراغ السلة المحلية")};
$("discountFocus").onclick=()=>{$("discountInput").focus();$("discountInput").select()};
$("holdSale").onclick=()=>toast("التعليق المحلي للفاتورة: سيتم ربط الحفظ بالخادم في مرحلة التكامل");
$("returnSale").onclick=()=>toast("المرتجعات تتطلب فاتورة أصلية وفحص مخزن واعتمادًا ماليًا");
$("printReceipt").onclick=()=>toast("الطباعة الفعلية تتطلب ربط طابعة الإيصالات");
$("noteSale").onclick=()=>{const n=prompt("ملاحظة الفاتورة");if(n)toast("تم إدخال الملاحظة لهذه الجلسة")};
$("scanButton").onclick=()=>{const code=prompt("أدخل أو امسح الباركود");if(code){const p=posProducts.find(x=>String(x.sku)===code||(x.barcodes||[]).includes(code));if(p)addProduct(p.id);else toast("الباركود غير مسجل في كتالوج قاعدة البيانات")}};
$("completeSale").onclick=async()=>{
 if(!cart.length)return toast("السلة فارغة");
 if(!posContext)return toast("بيانات نقطة البيع غير جاهزة");
 const pct=Math.min(100,Math.max(0,Number($("discountInput").value)||0));
 const total=cart.reduce((s,x)=>s+x.price*x.qty,0)*(1-pct/100);
 const payment_method_id=$("paymentMethod").value;
 if(!payment_method_id)return toast("اختر طريقة الدفع");
 const lines=cart.map(x=>({product_id:x.product_id,unit_id:x.unit_id,quantity:x.qty,unit_price:x.price,discount_amount:Number((x.price*x.qty*pct/100).toFixed(6))}));
 try{
  const result=await api("/api/sales/complete",{method:"POST",body:JSON.stringify({reference_no:"NF-POS-"+Date.now(),branch_id:posContext.branch.id,cashier_id:posContext.user.id,lines,payments:[{payment_method_id,amount:Number(total.toFixed(6))}],idempotency_key:(crypto.randomUUID?crypto.randomUUID():"NF-"+Date.now()+"-"+Math.random().toString(36).slice(2))})});
  toast("تم حفظ الفاتورة "+result.sale.reference_no+" بإجمالي "+money(result.sale.grand_total)+" ج.م");
  cart=[];$("discountInput").value="0";renderCart();
 }catch(e){toast(e.message);}
};
function tick(){const d=new Date();$("dateText").textContent=d.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"});$("timeText").textContent=d.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"});}
renderNav();renderCart();if(storedToken)loadPosData();tick();setInterval(tick,30000);
