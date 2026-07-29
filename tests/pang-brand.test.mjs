import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pwaRoot = resolve(projectRoot, 'app/src/main/assets/bazdidyar_pwa');
const read = relative => readFileSync(resolve(projectRoot, relative), 'utf8');

test('public PWA identity uses the official PANG name and slogan', () => {
  const manifest = JSON.parse(read('app/src/main/assets/bazdidyar_pwa/manifest.webmanifest'));
  const index = read('app/src/main/assets/bazdidyar_pwa/index.html');

  assert.equal(manifest.name, 'پنگ؛ سکوی یکپارچه بیمه‌ای');
  assert.equal(manifest.short_name, 'پنگ');
  assert.match(manifest.description, /یک هسته، صدها شاخه، یک نظم/);
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.match(index, /<title>پنگ \| سکوی یکپارچه بیمه‌ای<\/title>/);
  assert.match(index, /class="brandLatin"[^>]*>PANG<\/span>/);
  assert.match(index, /پنگ؛ یک هسته، صدها شاخه، یک نظم/);
  assert.match(index, /PANG-Body-/);
  assert.match(index, /getAllInspections\(\)\)\.filter\(x=>x\.module!==\'fire\'\)/);
  assert.match(index, /function drawPangMark\(/);
  assert.match(index, /pangPrintMark/);
  assert.doesNotMatch(index, /<h1>بازدیدیار/);
});

test('the inline application script remains valid JavaScript', () => {
  const index = read('app/src/main/assets/bazdidyar_pwa/index.html');
  const inlineScripts = [...index.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]))
    .map(match => match[2]);
  assert.equal(inlineScripts.length, 1);
  assert.doesNotThrow(() => new Script(inlineScripts[0], { filename: 'index.inline.js' }));
});

test('Android shell and GitHub artifact use PANG version 2.0 identity', () => {
  const gradle = read('app/build.gradle');
  const settings = read('settings.gradle');
  const strings = read('app/src/main/res/values/strings.xml');
  const androidManifest = read('app/src/main/AndroidManifest.xml');
  const mainActivity = read('app/src/main/java/ir/bimehiran/bazdidyar/MainActivity.java');
  const launcher = read('app/src/main/res/drawable/ic_launcher.xml');
  const workflow = read('.github/workflows/build-apk.yml');

  assert.match(gradle, /versionCode 20/);
  assert.match(gradle, /versionName '2\.0-pang-brand-foundation'/);
  assert.match(settings, /PANGInsurancePlatform/);
  assert.match(strings, /<string name="app_name">پنگ<\/string>/);
  assert.match(mainActivity, /DIRECTORY_DOWNLOADS \+ "\/PANG"/);
  assert.match(mainActivity, /getExternalStoragePublicDirectory\(Environment\.DIRECTORY_DOWNLOADS\)/);
  assert.match(mainActivity, /requestRuntimePermissionsIfNeeded\(\)/);
  assert.match(mainActivity, /اشتراک‌گذاری فایل پنگ/);
  assert.match(androidManifest, /WRITE_EXTERNAL_STORAGE/);
  assert.match(androidManifest, /maxSdkVersion="28"/);
  assert.match(launcher, /#D6A33C/);
  assert.match(launcher, /#7BD1C2/);
  assert.match(workflow, /Build PANG APK - Easy Debug/);
  assert.match(workflow, /PANG-Insurance-Platform-v2\.0-debug\.apk/);
});

test('brand assets are self-contained vector files and install icons exist', () => {
  const assets = ['brand/pang-mark.svg', 'brand/pang-lockup-fa.svg', 'app/src/main/assets/bazdidyar_pwa/icon.svg'];
  for (const asset of assets) {
    const svg = read(asset);
    assert.match(svg, /<svg\b/);
    assert.match(svg, /viewBox="[^"]+"/);
    assert.doesNotMatch(svg, /<script\b/i);
    assert.doesNotMatch(svg, /(?:href|xlink:href)=["'](?:https?:|\/\/)/i);
  }
  assert.ok(existsSync(resolve(pwaRoot, 'icon-192.png')));
  assert.ok(existsSync(resolve(pwaRoot, 'icon-512.png')));
  assert.ok(existsSync(resolve(projectRoot, 'brand/pang-mark-1024.png')));
  assert.ok(existsSync(resolve(projectRoot, 'brand/pang-lockup-fa.png')));
  assert.ok(existsSync(resolve(projectRoot, 'brand/pang-lockup-fa-white.png')));
});

test('legacy identifiers remain for upgrades while PANG aliases are exposed', () => {
  const gradle = read('app/build.gradle');
  const index = read('app/src/main/assets/bazdidyar_pwa/index.html');
  const stabilization = read('app/src/main/assets/bazdidyar_pwa/stabilization.js');
  const foundation = read('app/src/main/assets/bazdidyar_pwa/dynamic-foundation.js');
  const fire = read('app/src/main/assets/bazdidyar_pwa/fire-module.js');

  assert.match(gradle, /applicationId 'ir\.bimehiran\.bazdidyar'/);
  assert.match(index, /indexedDB\.open\('bazdidyar_db'/);
  assert.match(stabilization, /format:'bazdidyar-backup'/);
  assert.match(foundation, /window\.PANGDomain = window\.BazdidyarDomain/);
  assert.match(foundation, /window\.PANGCoverageEngine = window\.BazdidyarCoverageEngine/);
  assert.match(stabilization, /BZD-JAH-/);
  assert.match(fire, /BZF-JAH-/);
});
