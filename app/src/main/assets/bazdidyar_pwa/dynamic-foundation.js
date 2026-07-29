(function () {
  'use strict';

  const FOUNDATION_VERSION = '2.0.0';

  // نام‌های قدیمی برای سازگاری داده و افزونه‌ها باقی می‌مانند؛ نام‌های پنگ رابط رسمی جدید هستند.
  if (window.BazdidyarDomain && !window.PANGDomain) window.PANGDomain = window.BazdidyarDomain;
  if (window.BazdidyarCoverageEngine && !window.PANGCoverageEngine) window.PANGCoverageEngine = window.BazdidyarCoverageEngine;

  function installFoundationStatus() {
    const help = document.getElementById('helpTab');
    if (!help || document.getElementById('dynamicFoundationStatus')) return;
    const card = document.createElement('div');
    card.id = 'dynamicFoundationStatus';
    card.className = 'card';
    card.innerHTML = `
      <h2>زیرساخت پویای پوشش‌ها و شرایط خاص</h2>
      <div class="status warn">این زیرساخت در نسخه ${faDigits(FOUNDATION_VERSION)} آزمایشی است. وجود یک پوشش در کاتالوگ به معنی تأیید جاری‌بودن شرط، قبول خسارت یا تعیین فرانشیز قطعی نیست.</div>
      <p>تصمیم نهایی پوشش فقط توسط کاربر انسانی مجاز و پس از کنترل آخرین شرایط و بخشنامه‌های شرکت قابل ثبت است.</p>
      <p id="dynamicFoundationCatalogState" class="small">در حال کنترل فهرست آفلاین دامنه…</p>`;
    help.appendChild(card);
    checkDomainManifest();
  }

  async function checkDomainManifest() {
    const state = document.getElementById('dynamicFoundationCatalogState');
    if (!state || !window.BazdidyarDomain) return;
    try {
      const response = await fetch('./domain/manifest.json', {cache: 'no-cache'});
      if (!response.ok) throw new Error('MANIFEST_NOT_AVAILABLE');
      const manifest = window.BazdidyarDomain.validateManifest(await response.json());
      state.textContent = `فهرست دامنه نسخه ${manifest.version} شامل ${faDigits(manifest.files.length)} دارایی نسخه‌دار است.`;
    } catch (error) {
      state.textContent = 'فهرست دامنه در این اجرای منبع در دسترس نیست؛ در APK ساخته‌شده، فایل‌ها هنگام ساخت به‌صورت آفلاین افزوده می‌شوند.';
    }
  }

  const foundationInfo = Object.freeze({
    productName: 'PANG',
    productNameFa: 'پنگ',
    version: FOUNDATION_VERSION,
    automaticFinalCoverageDecision: false,
    officialDeductibleConfigured: false
  });
  window.PANGFoundationInfo = foundationInfo;
  window.BazdidyarFoundationInfo = foundationInfo;

  const previousShowApp = window.showApp;
  if (typeof previousShowApp === 'function') {
    window.showApp = function () {
      const result = previousShowApp.apply(this, arguments);
      installFoundationStatus();
      return result;
    };
  }
  installFoundationStatus();
})();
