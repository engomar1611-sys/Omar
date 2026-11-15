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
document.getElementById("logoutButton").onclick=()=>{sessionStorage.removeItem("nf_access_token");sessionStorage.removeItem("nf_user_name");location.reload();};
let posProducts=[],posAllProducts=[],posContext=null,posDiscountSettings=null,productSearchTimer=null;
const modules=[["pos","▣","نقطة البيع"],["catalog","▦","الأصناف والباركود"],["inventory","▤","المخازن والمخزون"],["purchasing","🛒","المشتريات وطلبات الشراء"],["sales","🧾","المبيعات والفواتير"],["discounts","％","قواعد الخصم"],["customers","♙","العملاء والولاء"],["suppliers","♧","الموردون"],["accounting","＄","الحسابات والخزينة"],["hr","♙","الموارد البشرية"],["assets","▣","الأصول والصيانة"],["delivery","➤","التوصيل"],["orderChannels","↔","ربط تطبيقات الطلبات"],["ecommerce","▧","المتجر الإلكتروني"],["users","⚙","المستخدمون والصلاحيات"],["settings","⚙","إعدادات النظام"]];
const moduleData={catalog:["الأصناف والباركود",["كود الصنف","اسم الصنف","التصنيف","الوحدة الأساسية","باركود","حالة الوزن","الصلاحية"],"لا توجد أصناف مسجلة بعد. أضف بيانات الأصناف المعتمدة أو استوردها من ملف موثوق."],inventory:["المخازن والمخزون",["كود الصنف","الصنف","المخزن","التشغيلة","الصلاحية","الكمية","متوسط التكلفة"],"ستظهر أرصدة المخزون وحركاته بعد تهيئة المخازن وإدخال أرصدة افتتاحية معتمدة."],purchasing:["المشتريات وطلبات الشراء",["الرقم المرجعي","المورد","التاريخ","الحالة","القيمة"],"أنشئ طلب شراء، ثم اعتمده وأصدر أمر الشراء وسجل الاستلام وفحص الجودة."],sales:["المبيعات والفواتير",["الرقم المرجعي","التاريخ","الكاشير","العميل","الإجمالي","الحالة"],"تظهر فواتير البيع المكتملة والمرتجعات بعد ربط نقاط البيع بقاعدة البيانات."],customers:["العملاء والولاء",["كود العميل","اسم العميل","الهاتف","نقاط الولاء","الحالة"],"سجل العملاء وربطهم بالمبيعات ونظام الولاء."],suppliers:["الموردون",["كود المورد","اسم المورد","الهاتف","الرصيد","الحالة"],"سجل الموردين وربطهم بطلبات الشراء والاستلام والمستحقات."],accounting:["الحسابات والخزينة",["كود الحساب","اسم الحساب","نوع الحساب","الحالة"],"دليل الحسابات والقيود اليومية والخزائن والبنوك والتسويات."],hr:["الموارد البشرية",["كود الموظف","اسم الموظف","الوظيفة","الفرع","الحالة"],"ملفات الموظفين والورديات والحضور والإجازات والصلاحيات الوظيفية."],assets:["الأصول والصيانة",["كود الأصل","اسم الأصل","التصنيف","الموقع","الحالة"],"سجل الأصول والترقيم وطباعة ملصقات الباركود والصيانة."],delivery:["التوصيل",["رقم الطلب","العميل","العنوان","مندوب التوصيل","الحالة"],"إدارة طلبات التوصيل وتخصيص المندوب ومتابعة التسليم."],ecommerce:["المتجر الإلكتروني",["رقم الطلب","العميل","قناة الطلب","الدفع","الحالة"],"إدارة كتالوج المتجر والطلبات ومزامنتها مع المخزون ونقاط البيع."],users:["المستخدمون والصلاحيات",["اسم المستخدم","الاسم","الدور","الصلاحيات","الحالة"],"إدارة المستخدمين والأدوار والصلاحيات على مستوى الموديول والإجراء."],settings:["إعدادات النظام",["الإعداد","القيمة","الوصف"],"إعدادات الشركة والفروع والضرائب والترقيم والطباعة والنسخ الاحتياطي والاتصال."],discounts:["قواعد الخصم",["الحد الأدنى","نوع الخصم","القيمة"],"إعداد خصومات تلقائية للطلبات ورسوم التوصيل."]};
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
 const cfg=posDiscountSettings,eligible=Math.max(0,sub-disc);
 const orderDiscount=cfg&&sub+0.000001>=Number(cfg.min_order_amount||0)?Math.min(eligible,cfg.order_discount_type==="percent"?eligible*Number(cfg.order_discount_value||0)/100:Number(cfg.order_discount_value||0)):0;
 const rawDelivery=$("saleIsDelivery")?.checked?Number($("saleDeliveryFee").value||0):0;
 const deliveryDiscount=cfg&&$("saleIsDelivery")?.checked&&sub+0.000001>=Number(cfg.delivery_min_order_amount||0)?Math.min(rawDelivery,cfg.delivery_discount_type==="percent"?rawDelivery*Number(cfg.delivery_discount_value||0)/100:Number(cfg.delivery_discount_value||0)):0;
 $("cartLines").innerHTML=cart.map((x,i)=>'<div class="cart-line"><span>'+(i+1)+'</span><b>'+escapeHtml(x.name)+'</b><span class="qty-control"><button data-dec="'+x.id+'">−</button>'+x.qty+'<button data-inc="'+x.id+'">+</button></span><span>'+money(x.price)+'</span><b>'+money(x.price*x.qty)+'</b><button class="remove-line" data-del="'+x.id+'">×</button></div>').join("")||'<div class="empty-state">أضف الأصناف إلى فاتورة البيع</div>';
 const deliveryCharge=rawDelivery-deliveryDiscount;$("itemCount").textContent=cart.reduce((s,x)=>s+x.qty,0);$("subtotal").textContent=money(sub);$("discountValue").textContent=money(disc+orderDiscount+deliveryDiscount);$("grandTotal").textContent=money(sub-disc-orderDiscount+deliveryCharge)+" ج.م";
 const hint=$("autoDiscountHint");if(hint)hint.textContent=(orderDiscount>0?"خصم الطلب: "+money(orderDiscount)+" ج.م ":"")+(deliveryDiscount>0?"خصم التوصيل: "+money(deliveryDiscount)+" ج.م":"");
 document.querySelectorAll("[data-inc]").forEach(b=>b.onclick=()=>{const x=cart.find(x=>x.id===b.dataset.inc);if(x){x.qty=Number((x.qty+quantityStep(x)).toFixed(6));renderCart();}});
 document.querySelectorAll("[data-dec]").forEach(b=>b.onclick=()=>{const x=cart.find(x=>x.id===b.dataset.dec);if(x){x.qty=Number((x.qty-quantityStep(x)).toFixed(6));if(x.qty<=0)cart=cart.filter(y=>y.id!==x.id);renderCart();}});
 document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{cart=cart.filter(x=>x.id!==b.dataset.del);renderCart();});
}
async function loadPosData(){
 try{
  const [context,catalog,customers,discounts]=await Promise.all([api("/api/pos/context"),api("/api/products?limit=200"),api("/api/customers"),api("/api/sales/discount-settings")]);
  posContext=context;posProducts=catalog.items||[];posAllProducts=[...posProducts];posDiscountSettings=discounts.settings||null;const customerSelect=$("saleCustomer");if(customerSelect)customerSelect.innerHTML='<option value="">بيع نقدي بدون تسجيل عميل</option>'+(customers.items||[]).map(x=>'<option value="'+escapeHtml(x.id)+'">'+escapeHtml(x.customer_number||x.code)+' — '+escapeHtml(x.name)+' — '+escapeHtml(x.phone||"بدون هاتف")+'</option>').join("");
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
 document.querySelectorAll("[data-edit-product]").forEach(b=>b.onclick=()=>{const p=d.items.find(x=>x.id===b.dataset.editProduct);if(p)showProductEditForm(p);});
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
async function showProductEditForm(product){
 const root=$("catalogContent");
 root.innerHTML='<h2>تعديل بيانات الصنف</h2><div class="form-grid"><label>اسم الصنف بالعربية<input id="pName"></label><label>اسم إنجليزي<input id="pNameEn"></label><label>كود الصنف<input id="pSku"></label><label>التصنيف<select id="pCategory"></select></label><label>الوحدة الأساسية<select id="pUnit"></select></label><label>الماركة<select id="pBrand"><option value="">بدون تحديد</option></select></label><label>حجم العبوة<input id="pPack" type="number" min="0" step="any"></label><label>وحدة العبوة<select id="pPackUnit"><option value="">—</option></select></label><label>وصف الحجم/العبوة<input id="pVariant"></label><label class="check-label"><input id="pWeighted" type="checkbox"> يباع بالوزن</label><label class="check-label"><input id="pExpiry" type="checkbox"> يتطلب تاريخ صلاحية</label><label class="check-label"><input id="pActive" type="checkbox"> الصنف نشط</label><label>إضافة باركود إضافي<input id="pExtraBarcode" placeholder="امسح أو اكتب الباركود"></label></div><div class="module-toolbar"><button class="primary-btn" id="updateProduct">حفظ التعديلات</button><button class="small-btn" id="addProductBarcode">إضافة الباركود</button><button class="small-btn" id="backProducts">رجوع</button></div><div id="editProductMessage" class="muted"></div>';
 try{
  const [cats,units,brands,barcodes]=await Promise.all([api("/api/categories"),api("/api/units"),api("/api/brands"),api("/api/products/"+product.id+"/barcodes")]);
  $("pCategory").innerHTML='<option value="">بدون تصنيف</option>'+cats.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name_ar)+'</option>').join("");
  const opts=units.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name_ar)+' ('+escapeHtml(x.code)+')</option>').join("");
  $("pUnit").innerHTML=opts;$("pPackUnit").innerHTML='<option value="">—</option>'+opts;
  $("pBrand").innerHTML+='<option value="">بدون تحديد</option>'+brands.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name_ar)+'</option>').join("");
  $("pName").value=product.name_ar||"";$("pNameEn").value=product.name_en||"";$("pSku").value=product.sku||"";
  $("pCategory").value=product.category_id||"";$("pUnit").value=product.base_unit_id;$("pBrand").value=product.brand_id||"";
  $("pPack").value=product.pack_size??"";$("pPackUnit").value=product.pack_unit_id||"";$("pVariant").value=product.variant_description||"";
  $("pWeighted").checked=!!product.is_weighted;$("pExpiry").checked=!!product.tracks_expiry;$("pActive").checked=product.is_active!==false;
  $("editProductMessage").textContent="الباركودات الحالية: "+barcodes.items.map(x=>x.barcode).join("، ");
 }catch(e){$("editProductMessage").textContent="تعذر تحميل بيانات التعديل: "+e.message;return;}
 $("updateProduct").onclick=async()=>{
  const body={sku:$("pSku").value.trim(),name_ar:$("pName").value.trim(),name_en:$("pNameEn").value.trim()||null,category_id:$("pCategory").value||null,brand_id:$("pBrand").value||null,base_unit_id:$("pUnit").value,is_weighted:$("pWeighted").checked,tracks_expiry:$("pExpiry").checked,pack_size:$("pPack").value?Number($("pPack").value):null,pack_unit_id:$("pPackUnit").value||null,variant_description:$("pVariant").value.trim()||null,is_active:$("pActive").checked};
  if(!body.name_ar||!body.base_unit_id)return toast("اسم الصنف والوحدة الأساسية مطلوبان");
  try{await api("/api/products/"+product.id,{method:"PATCH",body:JSON.stringify(body)});toast("تم تعديل بيانات الصنف");await loadProducts();}catch(e){toast(e.message);}
 };
 $("addProductBarcode").onclick=async()=>{
  const barcode=$("pExtraBarcode").value.trim();if(!barcode)return toast("أدخل أو امسح الباركود أولًا");
  try{await api("/api/products/"+product.id+"/barcodes",{method:"POST",body:JSON.stringify({barcode,barcode_type:"standard"})});$("pExtraBarcode").value="";const d=await api("/api/products/"+product.id+"/barcodes");$("editProductMessage").textContent="الباركودات: "+d.items.map(x=>x.barcode).join("، ");toast("تم إضافة الباركود");}catch(e){toast(e.message);}
 };
 $("backProducts").onclick=loadProducts;
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
async function openBusinessMaster(kind){
 const cfg=kind==="customers"?{title:"العملاء والولاء",url:"/api/customers",code:"كود العميل",name:"اسم العميل"}:{title:"الموردون",url:"/api/suppliers",code:"كود المورد",name:"اسم المورد"};
 const root=$("moduleView");
 root.innerHTML='<h1 class="module-title">'+cfg.title+'</h1><section class="purchase-panel"><h2>إضافة سجل جديد</h2><div class="form-grid"><label>'+cfg.code+'<input id="masterCode"></label><label>'+cfg.name+'<input id="masterName"></label><label>الهاتف<input id="masterPhone"></label><label>البريد الإلكتروني<input id="masterEmail"></label><label>العنوان بالتفصيل<input id="masterAddress"></label>'+(kind==="suppliers"?'<label>الرقم الضريبي<input id="masterTax"></label>':'')+'</div><button class="primary-btn" id="saveMaster">حفظ</button></section><section class="purchase-panel"><h2>السجلات المسجلة</h2><div id="masterList" class="empty-state">جارٍ التحميل...</div></section>'+(kind==="suppliers"?'<section class="purchase-panel"><h2>ربط منتجات المورد</h2><div class="form-grid"><label>المورد<select id="supplierLinkId"></select></label><label>الصنف<select id="supplierProductId"></select></label><label>كود الصنف لدى المورد<input id="supplierProductCode"></label><label>آخر سعر شراء (ج.م)<input id="supplierLastPrice" type="number" min="0" step="0.000001"></label></div><button class="primary-btn" id="linkSupplierProduct">ربط الصنف بالمورد</button><div id="supplierProductRows" class="muted"></div></section>':'');
 let suppliers=[],catalog=[];
 const refresh=async()=>{
  const data=await api(cfg.url),rows=data.items||[];
  suppliers=rows;
  $("masterList").innerHTML=rows.length?'<div class="table-scroll"><table class="module-table"><thead><tr><th>الرقم</th><th>الكود</th><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>العنوان</th><th>الحالة</th>'+(kind==="suppliers"?'<th>المنتجات</th>':'')+'</tr></thead><tbody>'+rows.map(x=>'<tr><td>'+escapeHtml(kind==="suppliers"?x.supplier_number:x.customer_number)+'</td><td>'+escapeHtml(x.code)+'</td><td>'+escapeHtml(x.name)+'</td><td>'+escapeHtml(x.phone||"—")+'</td><td>'+escapeHtml(x.email||"—")+'</td><td>'+escapeHtml(x.address||"—")+'</td><td>'+(x.is_active===false?"موقوف":"نشط")+'</td>'+(kind==="suppliers"?'<td><button class="small-btn" data-supplier-products="'+x.id+'">عرض المنتجات</button></td>':'')+'</tr>').join("")+'</tbody></table></div>':'<div class="empty-state">لا توجد سجلات.</div>';
  if(kind==="suppliers"){
   $("supplierLinkId").innerHTML='<option value="">اختر المورد</option>'+rows.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+' — '+escapeHtml(x.supplier_number)+'</option>').join("");
  }
  document.querySelectorAll("[data-supplier-products]").forEach(b=>b.onclick=async()=>{try{const d=await api("/api/suppliers/"+b.dataset.supplierProducts+"/products");$("supplierProductRows").innerHTML=d.items.length?'<div class="table-scroll"><table class="module-table"><thead><tr><th>الصنف</th><th>كود المورد</th><th>آخر سعر شراء</th><th>الوحدة</th></tr></thead><tbody>'+d.items.map(p=>'<tr><td>'+escapeHtml(p.name_ar)+' ('+escapeHtml(p.sku)+')</td><td>'+escapeHtml(p.supplier_product_code||"—")+'</td><td>'+money(p.last_purchase_price||0)+'</td><td>'+escapeHtml(p.base_unit_code)+'</td></tr>').join("")+'</tbody></table></div>':'لا توجد أصناف مرتبطة بهذا المورد';}catch(e){toast(e.message);}});
 };
 try{await refresh();if(kind==="suppliers"){const d=await api("/api/products?limit=200");catalog=d.items||[];$("supplierProductId").innerHTML='<option value="">اختر الصنف</option>'+catalog.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name_ar)+' ('+escapeHtml(p.sku)+')</option>').join("");}}catch(e){$("masterList").textContent=e.message;}
 $("saveMaster").onclick=async()=>{
  const code=$("masterCode").value.trim(),name=$("masterName").value.trim();
  if(!code||!name)return toast("أدخل الكود والاسم");
  const body={code,name,phone:$("masterPhone").value.trim()||null,email:$("masterEmail").value.trim()||null,address:$("masterAddress").value.trim()||null};
  if(kind==="suppliers")body.tax_number=$("masterTax").value.trim()||null;
  try{await api(cfg.url,{method:"POST",body:JSON.stringify(body)});toast("تم حفظ السجل وإسناد الرقم التلقائي");["masterCode","masterName","masterPhone","masterEmail","masterAddress","masterTax"].forEach(id=>{if($(id))$(id).value="";});await refresh();}catch(e){toast(e.message);}
 };
 if(kind==="suppliers")$("linkSupplierProduct").onclick=async()=>{
  const supplier_id=$("supplierLinkId").value,product_id=$("supplierProductId").value,price=$("supplierLastPrice").value;
  if(!supplier_id||!product_id)return toast("اختر المورد والصنف");
  try{await api("/api/suppliers/"+supplier_id+"/products",{method:"POST",body:JSON.stringify({product_id,supplier_product_code:$("supplierProductCode").value.trim()||null,last_purchase_price:price===""?null:Number(price)})});toast("تم ربط الصنف بالمورد");$("supplierProductCode").value="";$("supplierLastPrice").value="";const d=await api("/api/suppliers/"+supplier_id+"/products");$("supplierProductRows").innerHTML=d.items.map(p=>'<div>'+escapeHtml(p.name_ar)+' — '+escapeHtml(p.sku)+'</div>').join("");}catch(e){toast(e.message);}
 };
}
async function openDiscountSettings(){
 const root=$("moduleView");
 root.innerHTML='<h1 class="module-title">قواعد الخصم التلقائي</h1><p class="muted">تُطبق القواعد تلقائيًا عند تحقق الحد الأدنى. خصم الطلب يُخصم من قيمة المنتجات، وخصم التوصيل يُخصم من رسوم التوصيل فقط.</p><section class="purchase-panel"><h2>خصم الطلبات</h2><div class="form-grid"><label>الحد الأدنى لقيمة الطلب (ج.م)<input id="minOrderAmount" type="number" min="0" step="0.01"></label><label>نوع الخصم<select id="orderDiscountType"><option value="percent">نسبة مئوية %</option><option value="amount">مبلغ ثابت ج.م</option></select></label><label>قيمة الخصم<input id="orderDiscountValue" type="number" min="0" step="0.01"></label></div></section><section class="purchase-panel"><h2>خصم التوصيل</h2><div class="form-grid"><label>الحد الأدنى لقيمة الطلب للتوصيل (ج.م)<input id="deliveryMinOrder" type="number" min="0" step="0.01"></label><label>نوع الخصم<select id="deliveryDiscountType"><option value="percent">نسبة مئوية %</option><option value="amount">مبلغ ثابت ج.م</option></select></label><label>قيمة الخصم<input id="deliveryDiscountValue" type="number" min="0" step="0.01"></label></div><button class="primary-btn" id="saveDiscountSettings">حفظ قواعد الخصم</button></section>';
 try{const d=await api("/api/sales/discount-settings"),s=d.settings;$("minOrderAmount").value=s.min_order_amount||0;$("orderDiscountType").value=s.order_discount_type||"percent";$("orderDiscountValue").value=s.order_discount_value||0;$("deliveryMinOrder").value=s.delivery_min_order_amount||0;$("deliveryDiscountType").value=s.delivery_discount_type||"percent";$("deliveryDiscountValue").value=s.delivery_discount_value||0;}catch(e){toast(e.message);}
 $("saveDiscountSettings").onclick=async()=>{const body={min_order_amount:Number($("minOrderAmount").value),order_discount_type:$("orderDiscountType").value,order_discount_value:Number($("orderDiscountValue").value),delivery_min_order_amount:Number($("deliveryMinOrder").value),delivery_discount_type:$("deliveryDiscountType").value,delivery_discount_value:Number($("deliveryDiscountValue").value)};try{await api("/api/sales/discount-settings",{method:"PUT",body:JSON.stringify(body)});posDiscountSettings=body;toast("تم حفظ قواعد الخصم");}catch(e){toast(e.message);}};
}
async function openPurchasing(){
 const root=$("moduleView");
 root.innerHTML='<h1 class="module-title">المشتريات والاستلام وفحص الجودة</h1><div id="purchaseWorkspace" class="empty-state">جارٍ تحميل بيانات المشتريات...</div>';
 try{
  const [suppliers,branches,products,orders,receipts]=await Promise.all([
   api("/api/suppliers"),api("/api/branches"),api("/api/products?limit=200"),api("/api/purchase-orders"),api("/api/purchase-receipts")
  ]);
  const host=$("purchaseWorkspace");
  const supplierOpts=suppliers.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+' — '+escapeHtml(x.code)+'</option>').join("");
  const branchOpts=branches.items.map(x=>'<option value="'+x.id+'">'+escapeHtml(x.name)+'</option>').join("");
  const productOpts=products.items.map(x=>'<option value="'+x.id+'" data-unit="'+x.base_unit_id+'" data-name="'+escapeHtml(x.name_ar)+'" data-expiry="'+x.tracks_expiry+'">'+escapeHtml(x.name_ar)+' ('+escapeHtml(x.sku)+')</option>').join("");
  host.innerHTML='<section class="purchase-panel"><h2>إنشاء طلب شراء</h2><div class="form-grid"><label>الرقم المرجعي<input id="poReference" value="PO-'+Date.now()+'"></label><label>المورد<select id="poSupplier">'+supplierOpts+'</select></label><label>الفرع<select id="poBranch">'+branchOpts+'</select></label></div><div id="poLines"></div><div class="module-toolbar"><button class="small-btn" id="addPoLine">إضافة صنف</button><button class="primary-btn" id="createPo">حفظ وإرسال طلب الشراء</button></div></section><section class="purchase-panel"><h2>أوامر الشراء</h2><div id="poList"></div></section><section class="purchase-panel"><h2>استلامات وفحص الجودة</h2><div id="receiptList"></div></section><section class="purchase-panel" id="purchaseAction" hidden></section>';
  let lineNo=0;
  const addLine=()=>{
   const id=++lineNo,wrap=document.createElement("div");wrap.className="purchase-line";wrap.dataset.line=id;
   wrap.innerHTML='<label>الصنف<select class="po-product">'+productOpts+'</select></label><label>الكمية<input class="po-qty" type="number" min="0.000001" step="0.000001" value="1"></label><label>سعر الشراء للوحدة (ج.م)<input class="po-price" type="number" min="0" step="0.000001" value="0"></label><button class="small-btn remove-po-line">حذف</button>';
   wrap.querySelector(".remove-po-line").onclick=()=>wrap.remove();
   $("poLines").appendChild(wrap);
  };
  const renderOrders=()=>{
   $("poList").innerHTML=orders.items.length?'<div class="table-scroll"><table class="module-table"><thead><tr><th>المرجع</th><th>المورد</th><th>الفرع</th><th>الحالة</th><th>التاريخ</th><th>إجراءات</th></tr></thead><tbody>'+orders.items.map(o=>'<tr><td>'+escapeHtml(o.reference_no)+'</td><td>'+escapeHtml(o.supplier_name)+'</td><td>'+escapeHtml(o.branch_name)+'</td><td>'+escapeHtml(o.status)+'</td><td>'+escapeHtml(formatModuleValue(o.created_at))+'</td><td>'+(o.status==="submitted"?'<button class="small-btn" data-approve-po="'+o.id+'">اعتماد</button>':"")+(["approved","ordered","part_received"].includes(o.status)?' <button class="small-btn" data-receive-po="'+o.id+'">تسجيل استلام</button>':"")+'</td></tr>').join("")+'</tbody></table></div>':'<div class="empty-state">لا توجد أوامر شراء.</div>';
   document.querySelectorAll("[data-approve-po]").forEach(b=>b.onclick=async()=>{try{await api("/api/purchase-orders/"+b.dataset.approvePo+"/approve",{method:"POST"});toast("تم اعتماد أمر الشراء");await openPurchasing();}catch(e){toast(e.message);}});
   document.querySelectorAll("[data-receive-po]").forEach(b=>b.onclick=()=>showReceive(b.dataset.receivePo));
  };
  const renderReceipts=()=>{
   $("receiptList").innerHTML=receipts.items.length?'<div class="table-scroll"><table class="module-table"><thead><tr><th>مرجع الاستلام</th><th>أمر الشراء</th><th>المورد</th><th>المخزن</th><th>الفحص</th><th>إجراء</th></tr></thead><tbody>'+receipts.items.map(x=>'<tr><td>'+escapeHtml(x.reference_no)+'</td><td>'+escapeHtml(x.purchase_order_reference)+'</td><td>'+escapeHtml(x.supplier_name)+'</td><td>'+escapeHtml(x.warehouse_name)+'</td><td>'+escapeHtml(x.inspection_status)+'</td><td>'+(x.inspection_status==="pending_inspection"?'<button class="small-btn" data-inspect-receipt="'+x.id+'">فحص واعتماد مخزني</button>':"")+'</td></tr>').join("")+'</tbody></table></div>':'<div class="empty-state">لا توجد استلامات مسجلة.</div>';
   document.querySelectorAll("[data-inspect-receipt]").forEach(b=>b.onclick=()=>showInspection(b.dataset.inspectReceipt));
  };
  const showReceive=async orderId=>{
   try{
    const detail=await api("/api/purchase-orders/"+orderId);
    const warehouses=await api("/api/warehouses?branch_id="+detail.purchase_order.branch_id);
    const available=warehouses.items;
    const section=$("purchaseAction");section.hidden=false;
    section.innerHTML='<h2>تسجيل استلام أمر '+escapeHtml(detail.purchase_order.reference_no)+'</h2><div class="form-grid"><label>رقم إذن الاستلام<input id="receiptReference" value="GRN-'+Date.now()+'"></label><label>المخزن<select id="receiptWarehouse">'+available.map(w=>'<option value="'+w.id+'">'+escapeHtml(w.name)+'</option>').join("")+'</select></label></div><div id="receiveLines"></div><button class="primary-btn" id="saveReceipt">حفظ الاستلام وتحويله للفحص</button>';
    $("receiveLines").innerHTML=detail.lines.map((l,i)=>'<div class="purchase-line" data-product="'+l.product_id+'"><b>'+escapeHtml(l.product_name)+' ('+escapeHtml(l.sku)+')</b><label>الكمية المستلمة<input class="receive-qty" type="number" min="0.000001" step="0.000001" value="'+l.quantity+'"></label><label>تكلفة الوحدة<input class="receive-cost" type="number" min="0" step="0.000001" value="'+l.unit_price+'"></label><label>رقم التشغيلة<input class="receive-lot"></label><label>الصلاحية<input class="receive-expiry" type="date" '+(l.tracks_expiry?"required":"")+'></label></div>').join("");
    $("saveReceipt").onclick=async()=>{
     const lines=[...$("receiveLines").querySelectorAll(".purchase-line")].map(el=>({product_id:el.dataset.product,quantity:Number(el.querySelector(".receive-qty").value),unit_cost:Number(el.querySelector(".receive-cost").value),lot_number:el.querySelector(".receive-lot").value||null,expiry_date:el.querySelector(".receive-expiry").value||null}));
     try{const result=await api("/api/purchase-orders/"+orderId+"/receive",{method:"POST",body:JSON.stringify({reference_no:$("receiptReference").value.trim(),warehouse_id:$("receiptWarehouse").value,lines})});toast("تم تسجيل الاستلام؛ البضاعة محجوزة حتى الفحص");await openPurchasing();await showInspection(result.receipt.id);}catch(e){toast(e.message);}
    };
   }catch(e){toast(e.message);}
  };
  const showInspection=async receiptId=>{
   try{
    const detail=await api("/api/purchase-receipts/"+receiptId),section=$("purchaseAction");section.hidden=false;
    section.innerHTML='<h2>فحص استلام '+escapeHtml(detail.receipt.reference_no)+'</h2><p>يجب توزيع الكمية المستلمة بالكامل بين المقبول والمرفوض. لا تصبح الكمية متاحة للبيع إلا بعد الاعتماد.</p><div id="inspectionLines"></div><button class="primary-btn" id="approveInspection">اعتماد نتيجة الفحص</button>';
    $("inspectionLines").innerHTML=detail.lines.map(l=>'<div class="purchase-line" data-line="'+l.id+'"><b>'+escapeHtml(l.product_name)+' ('+escapeHtml(l.sku)+')</b><span>المستلم: '+formatModuleValue(l.quantity)+'</span><label>مقبول<input class="accepted-qty" type="number" min="0" step="0.000001" value="'+l.quantity+'"></label><label>مرفوض<input class="rejected-qty" type="number" min="0" step="0.000001" value="0"></label></div>').join("");
    $("approveInspection").onclick=async()=>{
     const lines=[...$("inspectionLines").querySelectorAll(".purchase-line")].map(el=>({receipt_line_id:el.dataset.line,accepted_quantity:Number(el.querySelector(".accepted-qty").value),rejected_quantity:Number(el.querySelector(".rejected-qty").value)}));
     try{await api("/api/purchase-receipts/"+receiptId+"/inspect",{method:"POST",body:JSON.stringify({lines})});toast("تم اعتماد فحص الاستلام وتحديث المخزون");await openPurchasing();}catch(e){toast(e.message);}
    };
   }catch(e){toast(e.message);}
  };
  addLine();$("addPoLine").onclick=addLine;
  $("createPo").onclick=async()=>{
   const lines=[...$("poLines").querySelectorAll(".purchase-line")].map(el=>{const select=el.querySelector(".po-product"),option=select.selectedOptions[0];return{product_id:select.value,unit_id:option?.dataset.unit,quantity:Number(el.querySelector(".po-qty").value),unit_price:Number(el.querySelector(".po-price").value)};});
   if(lines.some(x=>!x.product_id||!x.unit_id))return toast("اختر الصنف والوحدة الأساسية");
   try{await api("/api/purchase-orders",{method:"POST",body:JSON.stringify({reference_no:$("poReference").value.trim(),supplier_id:$("poSupplier").value,branch_id:$("poBranch").value,lines})});toast("تم إنشاء طلب الشراء وإرساله للاعتماد");await openPurchasing();}catch(e){toast(e.message);}
  };
  renderOrders();renderReceipts();
 }catch(e){hostError(root,e.message);}
}
function hostError(root,message){root.innerHTML='<div class="empty-state">'+escapeHtml(message)+'</div>';}

async function openDelivery(){
 const root=$("moduleView");
 root.innerHTML='<h1 class="module-title">إدارة الدليفري والتوصيل</h1><section class="purchase-panel"><h2>إنشاء طلب توصيل</h2><div class="form-grid"><label>الرقم المرجعي<input id="deliveryRef" value="DLV-'+Date.now()+'"></label><label>العميل<select id="deliveryCustomer"></select></label><label>قناة الطلب<select id="deliverySource"><option value="pos">نقطة البيع</option><option value="phone">طلب هاتفي</option><option value="talabat">طلبات</option><option value="elmenus">المنيوز</option><option value="breadfast">بريدفاست</option><option value="generic">تطبيق آخر</option></select></label><label>عنوان التوصيل<input id="deliveryAddress"></label><label>رسوم التوصيل (ج.م)<input id="deliveryFee" type="number" min="0" step="0.01" value="0"></label></div><button class="primary-btn" id="createDelivery">حفظ طلب التوصيل</button></section><section class="purchase-panel"><h2>طلبات التوصيل ومتابعة المندوبين</h2><div id="deliveryRows" class="empty-state">جارٍ تحميل الطلبات...</div></section>';
 try{
  const [customers,employees,orders]=await Promise.all([api("/api/customers"),api("/api/employees"),api("/api/delivery/orders")]);
  $("deliveryCustomer").innerHTML='<option value="">اختر العميل</option>'+customers.items.map(c=>'<option value="'+c.id+'">'+escapeHtml(c.name)+' — '+escapeHtml(c.phone||c.code)+'</option>').join("");
  const courierOptions='<option value="">بدون مندوب</option>'+employees.items.filter(e=>e.employment_status==="active").map(e=>'<option value="'+e.id+'">'+escapeHtml(e.full_name)+'</option>').join("");
  const statuses=[["pending","جديد"],["assigned","تم التخصيص"],["out_for_delivery","خرج للتوصيل"],["delivered","تم التسليم"],["failed","تعذر التسليم"],["cancelled","ملغي"]];
  const statusName=s=>statuses.find(x=>x[0]===s)?.[1]||s;
  const render=()=>{
   $("deliveryRows").innerHTML=orders.items.length?'<div class="table-scroll"><table class="module-table"><thead><tr><th>رقم طلب التوصيل</th><th>فاتورة البيع</th><th>العميل</th><th>العنوان</th><th>القناة</th><th>رسوم التوصيل</th><th>المندوب</th><th>الحالة</th><th>حفظ التحديث</th></tr></thead><tbody>'+orders.items.map(o=>'<tr data-delivery-row="'+o.id+'"><td>'+escapeHtml(o.reference_no)+'</td><td>'+escapeHtml(o.sale_reference||"—")+'</td><td>'+escapeHtml(o.customer_name)+'</td><td>'+escapeHtml(o.address)+'</td><td>'+escapeHtml(o.source_channel||"pos")+'</td><td>'+money(o.delivery_fee)+' ج.م</td><td><select class="delivery-courier">'+courierOptions.replace('value="'+(o.courier_employee_id||"__none__")+'"','value="'+(o.courier_employee_id||"__none__")+'"')+'</select></td><td><select class="delivery-status">'+statuses.map(s=>'<option value="'+s[0]+'" '+(s[0]===o.status?"selected":"")+'>'+s[1]+'</option>').join("")+'</select><small class="muted"> '+escapeHtml(statusName(o.status))+'</small></td><td><button class="small-btn" data-save-delivery="'+o.id+'">تحديث</button></td></tr>').join("")+'</tbody></table></div>':'<div class="empty-state">لا توجد طلبات توصيل حتى الآن.</div>';
   document.querySelectorAll("[data-save-delivery]").forEach(btn=>btn.onclick=async()=>{
    const row=btn.closest("tr"),courier=row.querySelector(".delivery-courier").value,status=row.querySelector(".delivery-status").value;
    try{await api("/api/delivery/orders/"+btn.dataset.saveDelivery+"/status",{method:"PATCH",body:JSON.stringify({status,courier_employee_id:courier||null})});toast("تم تحديث حالة طلب التوصيل");await openDelivery();}catch(e){toast(e.message);}
   });
   document.querySelectorAll(".delivery-courier").forEach((s,i)=>{const order=orders.items[i];if(order?.courier_employee_id)s.value=order.courier_employee_id;else s.value="";});
  };
  render();
  $("createDelivery").onclick=async()=>{
   const customer_id=$("deliveryCustomer").value,address=$("deliveryAddress").value.trim(),reference_no=$("deliveryRef").value.trim(),delivery_fee=Number($("deliveryFee").value),source_channel=$("deliverySource").value;
   if(!customer_id||!address||!reference_no||!Number.isFinite(delivery_fee)||delivery_fee<0)return toast("أكمل العميل والعنوان والرقم المرجعي ورسوم التوصيل");
   try{await api("/api/delivery/orders",{method:"POST",body:JSON.stringify({reference_no,customer_id,address,delivery_fee,source_channel})});toast("تم إنشاء طلب التوصيل");await openDelivery();}catch(e){toast(e.message);}
  };
 }catch(e){hostError(root,e.message);}
}
async function openOrderChannels(){
 const root=$("moduleView");
 const providers=[["talabat","طلبات"],["elmenus","المنيوز"],["breadfast","بريدفاست"],["mrsool","مرسول"],["generic","تطبيق طلبات آخر"]];
 root.innerHTML='<h1 class="module-title">ربط تطبيقات الطلبات الخارجية</h1><p class="muted">إعداد قناة لاستقبال الطلبات وربطها بالمخزون ونقطة البيع. حالة «يتطلب موصل API» تعني أن بيانات القناة محفوظة، لكن التبادل الفعلي لم يبدأ بعد.</p><section class="purchase-panel"><h2>إضافة / إعداد قناة طلبات</h2><div class="form-grid"><label>المنصة<select id="channelProvider">'+providers.map(p=>'<option value="'+p[0]+'">'+p[1]+'</option>').join("")+'</select></label><label>اسم العرض<input id="channelName" placeholder="مثال: طلبات - فرع الرئيسي"></label><label>كود المتجر لدى المنصة<input id="channelStore" placeholder="Store ID"></label><label>رابط API الرسمي (HTTPS)<input id="channelUrl" placeholder="https://api.example.com"></label><label>طريقة المزامنة<select id="channelMode"><option value="api">API</option><option value="webhook">Webhook</option><option value="manual">يدوي / استيراد</option></select></label></div><p class="muted">مفاتيح API وكلمات السر لا تُحفظ في هذه الشاشة. يتم إدخالها لاحقًا في إعدادات الخادم الآمنة بعد استلام بيانات الاعتماد الرسمية.</p><button class="primary-btn" id="saveChannel">حفظ إعداد القناة</button></section><section class="purchase-panel"><h2>القنوات المسجلة</h2><div id="channelRows" class="empty-state">جارٍ التحميل...</div></section>';
 const refresh=async()=>{
  const data=await api("/api/integrations/order-channels"),items=data.items||[];
  $("channelRows").innerHTML=items.length?'<div class="table-scroll"><table class="module-table"><thead><tr><th>المنصة</th><th>اسم القناة</th><th>كود المتجر</th><th>المزامنة</th><th>الحالة</th><th>تفعيل إداري</th></tr></thead><tbody>'+items.map(x=>'<tr><td>'+escapeHtml(providers.find(p=>p[0]===x.provider_code)?.[1]||x.provider_code)+'</td><td>'+escapeHtml(x.display_name)+'</td><td>'+escapeHtml(x.store_reference||"—")+'</td><td>'+escapeHtml(x.sync_mode)+'</td><td>'+escapeHtml(x.connection_status)+'</td><td><button class="small-btn" data-toggle-channel="'+x.id+'" data-enabled="'+x.is_enabled+'">'+(x.is_enabled?"إيقاف":"تجهيز")+'</button></td></tr>').join("")+'</tbody></table></div>':'<div class="empty-state">لم تتم إضافة قنوات بعد.</div>';
  document.querySelectorAll("[data-toggle-channel]").forEach(b=>b.onclick=async()=>{try{await api("/api/integrations/order-channels/"+b.dataset.toggleChannel+"/status",{method:"PATCH",body:JSON.stringify({is_enabled:b.dataset.enabled!=="true"})});await refresh();}catch(e){toast(e.message);}});
 };
 $("saveChannel").onclick=async()=>{
  const provider=$("channelProvider").value,display_name=$("channelName").value.trim()||providers.find(p=>p[0]===provider)[1],store_reference=$("channelStore").value.trim()||null,api_base_url=$("channelUrl").value.trim()||null,sync_mode=$("channelMode").value;
  if(api_base_url&&!/^https:\/\//i.test(api_base_url))return toast("يجب أن يبدأ رابط API بـ HTTPS");
  try{await api("/api/integrations/order-channels/"+provider,{method:"PUT",body:JSON.stringify({display_name,store_reference,api_base_url,sync_mode})});toast("تم حفظ إعداد القناة. يلزم تركيب الموصل وبيانات الاعتماد قبل المزامنة.");await refresh();}catch(e){toast(e.message);}
 };
 try{await refresh();}catch(e){$("channelRows").textContent=e.message;}
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
 if(id==="discounts"){openDiscountSettings();return;}
 if(id==="purchasing"){openPurchasing();return;}
 if(id==="customers"||id==="suppliers"){openBusinessMaster(id);return;}
 if(id==="users"){openUsers();return;}
 if(id==="delivery"){openDelivery();return;}
 if(id==="orderChannels"){openOrderChannels();return;}
 if(liveModuleConfig[id]){loadOperationalModule(id);return;}
 const d=moduleData[id];$("moduleView").innerHTML='<h1 class="module-title">'+escapeHtml(d[0])+'</h1><div class="empty-state">'+escapeHtml(d[2])+'</div>';
}

$("saleIsDelivery").addEventListener("change",()=>{$("saleDeliveryFields").classList.toggle("hidden",!$("saleIsDelivery").checked);});
$("saleDeliveryFee").addEventListener("input",renderCart);
$("productSearch").addEventListener("input",()=>{
 renderProducts();clearTimeout(productSearchTimer);
 const q=$("productSearch").value.trim();
 if(q.length===0){posProducts=[...posAllProducts];renderProducts();return;}
 productSearchTimer=setTimeout(async()=>{try{const d=await api("/api/products?limit=200&q="+encodeURIComponent(q));posProducts=d.items||[];renderProducts();}catch(e){toast(e.message);}},250);
});
$("productSearch").addEventListener("keydown",async e=>{
 if(e.key!=="Enter")return;e.preventDefault();const q=$("productSearch").value.trim();if(!q)return;
 try{const d=await api("/api/products?limit=10&q="+encodeURIComponent(q));const exact=(d.items||[]).find(p=>String(p.sku).toLowerCase()===q.toLowerCase()||(p.barcodes||[]).some(b=>String(b).toLowerCase()===q.toLowerCase()));
 if(exact){addProduct(exact.id);$("productSearch").value="";posProducts=[...posAllProducts];renderProducts();}else if(d.items?.length===1){addProduct(d.items[0].id);$("productSearch").value="";posProducts=[...posAllProducts];renderProducts();}else toast("لم يتم العثور على باركود مطابق؛ اختر الصنف من النتائج");}
 catch(err){toast(err.message);}
});
$("discountInput").addEventListener("input",renderCart);
$("clearCart").onclick=()=>{cart=[];renderCart();toast("تم إفراغ السلة المحلية")};
$("discountFocus").onclick=()=>{$("discountInput").focus();$("discountInput").select()};
$("holdSale").onclick=()=>toast("التعليق المحلي للفاتورة: سيتم ربط الحفظ بالخادم في مرحلة التكامل");
$("returnSale").onclick=()=>toast("المرتجعات تتطلب فاتورة أصلية وفحص مخزن واعتمادًا ماليًا");
$("printReceipt").onclick=()=>toast("الطباعة الفعلية تتطلب ربط طابعة الإيصالات");
$("noteSale").onclick=()=>{const n=prompt("ملاحظة الفاتورة");if(n)toast("تم إدخال الملاحظة لهذه الجلسة")};
$("scanButton").onclick=()=>{$("productSearch").focus();$("productSearch").select();toast("امسح الباركود بقارئ متصل بلوحة المفاتيح ثم اضغط Enter");};
$("completeSale").onclick=async()=>{
 if(!cart.length)return toast("السلة فارغة");
 if(!posContext)return toast("بيانات نقطة البيع غير جاهزة");
 const pct=Math.min(100,Math.max(0,Number($("discountInput").value)||0));
 const deliveryEnabled=$("saleIsDelivery").checked;const deliveryFee=deliveryEnabled?Number($("saleDeliveryFee").value||0):0;
 const subTotal=cart.reduce((s,x)=>s+x.price*x.qty,0),manualDiscount=subTotal*pct/100,eligible=Math.max(0,subTotal-manualDiscount),cfg=posDiscountSettings;
 const orderDiscount=cfg&&subTotal+0.000001>=Number(cfg.min_order_amount||0)?Math.min(eligible,cfg.order_discount_type==="percent"?eligible*Number(cfg.order_discount_value||0)/100:Number(cfg.order_discount_value||0)):0;
 const deliveryDiscount=cfg&&deliveryEnabled&&subTotal+0.000001>=Number(cfg.delivery_min_order_amount||0)?Math.min(deliveryFee,cfg.delivery_discount_type==="percent"?deliveryFee*Number(cfg.delivery_discount_value||0)/100:Number(cfg.delivery_discount_value||0)):0;
 const total=eligible-orderDiscount+deliveryFee-deliveryDiscount;
 const payment_method_id=$("paymentMethod").value;
 if(!payment_method_id)return toast("اختر طريقة الدفع");
 const lines=cart.map(x=>({product_id:x.product_id,unit_id:x.unit_id,quantity:x.qty,unit_price:x.price,discount_amount:Number((x.price*x.qty*pct/100).toFixed(6))}));
 try{
  const selectedCustomer=$("saleCustomer").value||null;
  const delivery=deliveryEnabled?{customer_id:selectedCustomer,address:$("saleDeliveryAddress").value.trim(),delivery_fee:deliveryFee,source_channel:"pos"}:null;
 if(deliveryEnabled&&(!delivery.customer_id||!delivery.address||!Number.isFinite(delivery.delivery_fee)||delivery.delivery_fee<0))return toast("اختر عميل التوصيل وأدخل العنوان ورسوم التوصيل");
 const result=await api("/api/sales/complete",{method:"POST",body:JSON.stringify({reference_no:"NF-POS-"+Date.now(),branch_id:posContext.branch.id,customer_id:selectedCustomer,lines,payments:[{payment_method_id,amount:Number(total.toFixed(6))}],delivery,idempotency_key:(crypto.randomUUID?crypto.randomUUID():"NF-"+Date.now()+"-"+Math.random().toString(36).slice(2))})});
  toast("تم حفظ الفاتورة "+result.sale.reference_no+" بإجمالي "+money(result.sale.grand_total)+(result.discounts?.order_discount_amount?" — خصم الطلب "+money(result.discounts.order_discount_amount):"")+(result.discounts?.delivery_discount_amount?" — خصم التوصيل "+money(result.discounts.delivery_discount_amount):"")+(result.delivery?" — طلب توصيل "+result.delivery.reference_no:""));
  cart=[];$("discountInput").value="0";$("saleIsDelivery").checked=false;$("saleDeliveryFields").classList.add("hidden");$("saleCustomer").value="";$("saleDeliveryAddress").value="";$("saleDeliveryFee").value="0";renderCart();
 }catch(e){toast(e.message);}
};
function tick(){const d=new Date();$("dateText").textContent=d.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"});$("timeText").textContent=d.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"});}
renderNav();renderCart();if(storedToken)loadPosData();tick();setInterval(tick,30000);
