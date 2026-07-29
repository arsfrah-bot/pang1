/* پنگ ۲.۰: لایه پایدارسازی بدون وابستگی خارجی؛ شناسه‌های ذخیره‌سازی قدیمی برای مهاجرت حفظ شده‌اند. */
'use strict';

const APP_VERSION = '2.0.0';
const DB_VERSION = 2;
const ACTIVE_DRAFT_KEY = 'active';
let currentDraftReportNo = '';
let draftTimer = null;
let requiredImagesThumb = {};
let extraImagesThumb = [];

function openDbV2(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('bazdidyar_db',DB_VERSION);
    req.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains('inspections')) db.createObjectStore('inspections',{keyPath:'id'});
      if(!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts',{keyPath:'key'});
      if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
openDb = openDbV2;

function dbPut(store,value){return openDbV2().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));}
function dbGet(store,key){return openDbV2().then(db=>new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);}));}
function dbDelete(store,key){return openDbV2().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}));}

function secureSuffix(){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%10000).padStart(4,'0');}
function tehranStamp(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA-u-ca-gregory',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}
makeTrackingNo = function(proposal=''){
  const code=sanitizeFilePart(profile?.agencyCode||'AG');
  const prop=normalizeDigits(proposal).trim();
  return `BZD-JAH-${code}-${tehranStamp()}${prop?'-'+sanitizeFilePart(prop):''}-${secureSuffix()}`;
};

function isValidIranianNationalCode(value){
  const code=normalizeDigits(value).trim();
  if(!/^\d{10}$/.test(code)||/^(\d)\1{9}$/.test(code)) return false;
  const check=Number(code[9]);
  let sum=0;
  for(let i=0;i<9;i++) sum+=Number(code[i])*(10-i);
  const remainder=sum%11;
  return check===(remainder<2?remainder:11-remainder);
}

validateInspection = function(quiet=false){
  const name=$('insuredName')?.value.trim();
  const national=normalizeDigits($('nationalCode')?.value);
  const plate=$('plateNumber')?.value.trim();
  if($('nationalCode')) $('nationalCode').value=national;
  const missing=[];
  if(!name) missing.push('نام بیمه‌گزار');
  if(!isValidIranianNationalCode(national||'')) missing.push('کد ملی معتبر');
  if(!plate) missing.push('شماره پلاک');
  requiredDefs.forEach(([k,t])=>{if(!requiredImages[k])missing.push(t);});
  const ok=missing.length===0;
  if($('finalBtn')) $('finalBtn').disabled=!ok;
  const box=$('validationBox');
  if(box){
    if(!isFormDirty()||quiet){box.className='status warn';box.textContent='فرم برای بازدید جدید آماده است. پس از ورود اطلاعات، موارد ناقص اینجا نمایش داده می‌شود.';}
    else if(ok){box.className='status ok';box.textContent='اطلاعات کامل است. امکان ساخت خروجی وجود دارد.';}
    else {box.className='status err';box.textContent='موارد ناقص: '+missing.join('، ')+(national&&!isValidIranianNationalCode(national)?' — کد ملی واردشده معتبر نیست.':'');}
  }
  scheduleDraftSave();
  return ok;
};

const originalMakeImageVersions=makeImageVersions;
makeImageVersions=async function(file){
  const base=await originalMakeImageVersions(file);
  const thumb=await compressImage(file,320,.65);
  return {...base,thumb};
};

handleRequiredPhoto=async function(ev,key){
  const file=ev.target.files[0];if(!file)return;
  try{
    const v=await makeImageVersions(file);
    requiredImages[key]=v.pdf;requiredImagesHi[key]=v.high;requiredImagesThumb[key]=v.thumb;
    $('prev_'+key).innerHTML='<img src="'+v.thumb+'">';
    validateInspection();scheduleDraftSave(true);
  }catch(e){alert('خطا در پردازش عکس. عکس قبلی حفظ شد.');}
};

handleExtraPhotos=async function(ev){
  const files=[...ev.target.files];
  try{for(const f of files){const v=await makeImageVersions(f);extraImages.push(v.pdf);extraImagesHi.push(v.high);extraImagesThumb.push(v.thumb);}renderExtraPhotos();ev.target.value='';scheduleDraftSave(true);}
  catch(e){alert('پردازش یکی از عکس‌های تکمیلی انجام نشد. عکس‌های پردازش‌شده حفظ شدند.');}
};

removeExtra=function(i){extraImages.splice(i,1);extraImagesHi.splice(i,1);extraImagesThumb.splice(i,1);renderExtraPhotos();scheduleDraftSave(true);};

drawCoverImage=function(ctx,img,x,y,w,h){
  const r=Math.min(w/img.width,h/img.height);const dw=img.width*r,dh=img.height*r;
  ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
};

const originalMakeLetterCanvas=makeLetterCanvas;
makeLetterCanvas=async function(d){
  const canvas=await originalMakeLetterCanvas(d);const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(55,118,1130,54);
  drawCentered(ctx,'متمم بازدید اولیه بدنه خودرو',150,'23px Tahoma, Arial');
  drawInfoRow(ctx,423,'بیمه‌نامه قبلی',d.previousPolicy||'-','نوع / مدل خودرو',d.vehicleModel||'-');
  drawPangMark(ctx,1065,62,92);
  return canvas;
};

const originalMakePhotosCanvas=makePhotosCanvas;
makePhotosCanvas=async function(items,d,title){
  const canvas=await originalMakePhotosCanvas(items,d,title);const ctx=canvas.getContext('2d');
  drawPangMark(ctx,1080,68,70);
  return canvas;
};

function collectDraft(){
  if(!currentDraftReportNo) currentDraftReportNo=makeTrackingNo($('proposalNo')?.value||'');
  return {key:ACTIVE_DRAFT_KEY,reportNo:currentDraftReportNo,savedAt:new Date().toISOString(),fields:Object.fromEntries(['insuredName','nationalCode','plateNumber','proposalNo','previousPolicy','vehicleModel','mobile','notes'].map(id=>[id,$(id)?.value||''])),requiredImages:{...requiredImages},requiredImagesHi:{...requiredImagesHi},requiredImagesThumb:{...requiredImagesThumb},extraImages:[...extraImages],extraImagesHi:[...extraImagesHi],extraImagesThumb:[...extraImagesThumb]};
}
function scheduleDraftSave(immediate=false){
  if(!profile||!isFormDirty()) return;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>dbPut('drafts',collectDraft()).catch(()=>showTransientError('ذخیره پیش‌نویس انجام نشد؛ فضای ذخیره‌سازی را بررسی کنید.')),immediate?50:700);
}
function showTransientError(message){const box=$('validationBox');if(box){box.className='status err';box.textContent=message;}}

async function restoreActiveDraft(){
  const d=await dbGet('drafts',ACTIVE_DRAFT_KEY);if(!d)return;
  const banner=$('draftRecovery');
  if(banner){banner.classList.remove('hidden');banner.innerHTML='<b>پیش‌نویس بازدید ناتمام بازیابی شد.</b><div class="row" style="margin-top:8px"><button class="btn" onclick="continueDraft()">ادامه پیش‌نویس</button><button class="btn danger" onclick="discardDraft()">حذف پیش‌نویس و شروع بازدید جدید</button></div>';}
}
window.continueDraft=async function(){
  const d=await dbGet('drafts',ACTIVE_DRAFT_KEY);if(!d)return;
  currentDraftReportNo=d.reportNo||makeTrackingNo(d.fields?.proposalNo||'');
  Object.entries(d.fields||{}).forEach(([id,v])=>{if($(id))$(id).value=v;});
  requiredImages=d.requiredImages||{};requiredImagesHi=d.requiredImagesHi||{};requiredImagesThumb=d.requiredImagesThumb||{};
  extraImages=d.extraImages||[];extraImagesHi=d.extraImagesHi||[];extraImagesThumb=d.extraImagesThumb||[];
  renderRequiredPhotos();renderExtraPhotos();validateInspection();$('draftRecovery')?.classList.add('hidden');
};
window.discardDraft=async function(){await dbDelete('drafts',ACTIVE_DRAFT_KEY);currentDraftReportNo='';resetForm();$('draftRecovery')?.classList.add('hidden');};

const originalResetForm=resetForm;
resetForm=function(){
  originalResetForm();requiredImagesThumb={};extraImagesThumb=[];currentDraftReportNo='';clearTimeout(draftTimer);
  dbDelete('drafts',ACTIVE_DRAFT_KEY).catch(()=>{});
};

function normalizedPlate(value){return normalizeDigits(value).replace(/\s+/g,'').replace(/[^\dA-Za-zآ-ی]/g,'').toLowerCase();}

buildImagesZipBlob=async function(d){
  const items=photoItemsFor(d);if(!items.length)throw new Error('NO_IMAGES');
  const manifest={schemaVersion:1,productName:'PANG',productNameFa:'پنگ',platformVersion:APP_VERSION,module:'vehicle-body-initial-inspection',inspectionId:d.reportNo,createdAt:d.createdAt,timezone:'Asia/Tehran',agency:{name:d.profile.agencyName,code:d.profile.agencyCode},insured:{name:d.insuredName,nationalCode:d.nationalCode},vehicle:{plate:d.plateNumber,plateNormalized:d.plateNormalized||normalizedPlate(d.plateNumber),model:d.vehicleModel||''},proposalNo:d.proposalNo||'',photoCount:items.length,files:items.map(it=>({name:imageNameFor(d,it),type:it.kind,label:it.title})),ownership:OWNER_TRACE};
  const readme=`پنگ | ماژول بازدید اولیه بدنه خودرو\r\nPANG\r\nشماره نامه/بایگانی: ${d.reportNo}\r\nنام نمایندگی: ${d.profile.agencyName}\r\nکد نمایندگی: ${d.profile.agencyCode}\r\nنام بیمه‌گزار: ${d.insuredName}\r\nکد ملی: ${d.nationalCode}\r\nپلاک: ${d.plateNumber}\r\nشماره پیشنهاد/کد رهگیری: ${d.proposalNo||'-'}\r\nتاریخ بازدید: ${d.createdAtFa}\r\n${OWNER_TRACE}\r\n\r\nاین بسته شامل نسخه باکیفیت‌تر عکس‌های بازدید است.`;
  const entries=[{name:'README_PANG.txt',data:utf8Bytes(readme)},{name:'manifest.json',data:utf8Bytes(JSON.stringify(manifest,null,2))}];
  for(const it of items){const marked=await watermarkImageDataUrl(it.src,d,it);entries.push({name:imageNameFor(d,it),data:dataUrlToBytes(marked)});}
  return makeZipBlob(entries);
};

finalizeInspection=async function(){
  if(!validateInspection())return;
  const button=$('finalBtn');button.disabled=true;button.textContent='در حال ساخت و کنترل خروجی‌ها…';
  try{
    const now=new Date();const proposal=$('proposalNo').value.trim();
    const reportNo=currentDraftReportNo||makeTrackingNo(proposal);
    const data={id:Date.now(),schemaVersion:2,productName:'PANG',productNameFa:'پنگ',platformVersion:APP_VERSION,module:'vehicle-body-initial-inspection',status:'finalized',reportNo,archiveNo:reportNo,createdAt:now.toISOString(),createdAtFa:nowFa(),timezone:'Asia/Tehran',profile:{agencyName:profile.agencyName,agencyCode:profile.agencyCode,address:profile.address,phone:profile.phone||''},insuredName:$('insuredName').value.trim(),nationalCode:normalizeDigits($('nationalCode').value),plateNumber:$('plateNumber').value.trim(),plateNormalized:normalizedPlate($('plateNumber').value),proposalNo:proposal,previousPolicy:$('previousPolicy').value.trim(),vehicleModel:$('vehicleModel')?.value.trim()||'',mobile:$('mobile').value.trim(),notes:$('notes').value.trim(),requiredImages:{...requiredImages},requiredImagesHi:{...requiredImagesHi},requiredImagesThumb:{...requiredImagesThumb},extraImages:[...extraImages],extraImagesHi:[...extraImagesHi],extraImagesThumb:[...extraImagesThumb],ownership:OWNER_TRACE};
    const pdf=await buildPdfBlob(data);
    const zip=await buildImagesZipBlob(data);
    data.generatedFiles={pdf:{bytes:pdf.size,type:pdf.type,generatedAt:new Date().toISOString()},zip:{bytes:zip.size,type:zip.type,generatedAt:new Date().toISOString()}};
    await saveInspectionRecord(data);
    const verified=await getInspection(data.id);
    if(!verified||verified.reportNo!==reportNo||verified.status!=='finalized')throw new Error('ARCHIVE_VERIFY_FAILED');
    await dbDelete('drafts',ACTIVE_DRAFT_KEY);
    lastInspection=verified;lastPdfBlob=pdf;showLastOutput(verified,pdf);resetForm();
  }catch(e){showTransientError('نهایی‌سازی کامل نشد؛ فرم و عکس‌ها حفظ شدند. دوباره تلاش کنید.');console.error('FINALIZE_FAILED',e);}
  finally{button.textContent='ذخیره و ساخت PDF';validateInspection();}
};

function ensureInstallationId(){let id=localStorage.getItem('bazdidyar_installation_id');if(!id){id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${secureSuffix()}-${secureSuffix()}`;localStorage.setItem('bazdidyar_installation_id',id);}return id;}

async function exportBackup(){
  const inspections=await getAllInspections();
  const payload={format:'bazdidyar-backup',schemaVersion:2,productName:'PANG',productNameFa:'پنگ',exportedAt:new Date().toISOString(),appVersion:APP_VERSION,installationId:ensureInstallationId(),profile:{agencyName:profile?.agencyName||'',agencyCode:profile?.agencyCode||'',address:profile?.address||'',phone:profile?.phone||''},ownership:OWNER_TRACE,inspections};
  await downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`PANG-Backup-${tehranStamp()}.json`);
}
async function importBackupFile(file){
  const parsed=JSON.parse(await file.text());
  if(parsed?.format!=='bazdidyar-backup'||!Array.isArray(parsed.inspections))throw new Error('INVALID_BACKUP');
  let added=0,skipped=0;
  for(const item of parsed.inspections){const old=await getInspection(item.id);if(old){skipped++;continue;}await saveInspectionRecord(item);added++;}
  alert(`بازیابی انجام شد. ${faDigits(added)} رکورد افزوده و ${faDigits(skipped)} رکورد تکراری نادیده گرفته شد.`);loadArchive();
}
async function downloadSupportReport(){
  const inspections=await getAllInspections();let estimate=null;
  if(navigator.storage?.estimate)try{estimate=await navigator.storage.estimate();}catch(e){}
  const report={productName:'PANG',productNameFa:'پنگ',appVersion:APP_VERSION,generatedAt:new Date().toISOString(),platform:navigator.platform||'',userAgent:navigator.userAgent||'',installationId:ensureInstallationId(),agencyCode:profile?.agencyCode||'',inspectionCount:inspections.length,draftCount:(await dbGet('drafts',ACTIVE_DRAFT_KEY))?1:0,storage:estimate?{usage:estimate.usage||0,quota:estimate.quota||0}:null,lastOperation:'support-report',ownership:OWNER_TRACE,privacy:'این گزارش شامل کد ملی، پلاک، شماره شاسی، عکس، رمز یا محتوای کامل بازدید نیست.'};
  await downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`PANG-Support-${tehranStamp()}.json`);
}

function installStabilizationUi(){
  const newTab=$('newTab');if(newTab&&!$('draftRecovery')){const b=document.createElement('div');b.id='draftRecovery';b.className='card hidden';newTab.prepend(b);}
  const help=$('helpTab');if(help&&!$('dataTools')){const card=document.createElement('div');card.id='dataTools';card.className='card';card.innerHTML=`<h2>پشتیبان‌گیری، حریم خصوصی و پشتیبانی</h2><div class="status warn">پاک‌کردن داده‌های مرورگر یا داده‌های برنامه می‌تواند بایگانی محلی را حذف کند. پس از بازدیدهای مهم نسخه پشتیبان بگیرید.</div><div class="row"><button class="btn" id="backupExportBtn">دریافت نسخه پشتیبان</button><button class="btn secondary" id="backupImportBtn">بازیابی نسخه پشتیبان</button><button class="btn secondary" id="supportReportBtn">دریافت گزارش فنی</button></div><input id="backupFileInput" class="hidden" type="file" accept="application/json,.json"><div class="hr"></div><p><b>وضعیت ارتباط مرکزی:</b> در این نسخه غیرفعال است و هیچ اطلاعات بازدید به سرور یا ایمیل ارسال نمی‌شود.</p><p><b>شناسه نصب:</b> <span class="mono">${esc(ensureInstallationId())}</span></p><p>${esc(OWNER_TRACE)}</p>`;help.appendChild(card);$('backupExportBtn').onclick=()=>exportBackup().catch(()=>alert('ساخت نسخه پشتیبان انجام نشد.'));$('backupImportBtn').onclick=()=>$('backupFileInput').click();$('backupFileInput').onchange=e=>{const f=e.target.files[0];if(f)importBackupFile(f).catch(()=>alert('فایل پشتیبان معتبر نیست یا بازیابی انجام نشد.'));e.target.value='';};$('supportReportBtn').onclick=()=>downloadSupportReport().catch(()=>alert('ساخت گزارش فنی انجام نشد.'));}
  ['insuredName','nationalCode','plateNumber','proposalNo','previousPolicy','vehicleModel','mobile','notes'].forEach(id=>$(id)?.addEventListener('input',()=>scheduleDraftSave()));
}

const originalShowApp=showApp;
showApp=function(){originalShowApp();installStabilizationUi();restoreActiveDraft().catch(()=>{});};
installStabilizationUi();
