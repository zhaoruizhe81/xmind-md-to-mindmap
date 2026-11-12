#!/usr/bin/env node
/**
 * md2mindmap — 用 XMind 官网自己的转换器+渲染器，把 Markdown 变成思维导图图片。
 *
 * 原理（逆向所得）：
 *   官网 app.xmind.cn 的 Markdown 导入是纯前端：
 *     markdown_v3.chunk  importMarkdownV3(bytes) -> .xmind(ArrayBuffer)
 *     import-file.chunk   openDocWithInject(xmind, true) -> { doc }（套默认主题/版本）
 *     snowmonster-ext     renderThumbnail(doc, {size}) -> PNG(ArrayBuffer)（官方布局引擎）
 *   本脚本用无头 Chrome 打开官网公开页(登录页也有完整运行时/Manifests)，
 *   动态 import 这几个官方 chunk 并调用它们 —— 等于直接复用官网接口，产出官方渲染图。
 *
 * 用法：
 *   node cli/md2mindmap.mjs input.md                     # -> input.png
 *   node cli/md2mindmap.mjs input.md -o out.png
 *   node cli/md2mindmap.mjs input.md --xmind out.xmind   # 同时导出 .xmind
 *   node cli/md2mindmap.mjs - < in.md > out.png?          # 读 stdin（配合 -o）
 *   node cli/md2mindmap.mjs input.md --width 2000 --height 1200
 *   node cli/md2mindmap.mjs input.md --headful           # 调试时显示浏览器
 * 环境变量：CHROME_PATH 覆盖 Chrome 可执行路径；XMIND_ORIGIN 覆盖站点（默认 https://app.xmind.cn）
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const a = { _: [], width: 1600, height: 1000, headful: false, xmind: null, out: null, timeout: 90000 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '-o' || t === '--out') a.out = argv[++i];
    else if (t === '--xmind') a.xmind = argv[++i];
    else if (t === '--width') a.width = parseInt(argv[++i], 10);
    else if (t === '--height') a.height = parseInt(argv[++i], 10);
    else if (t === '--headful') a.headful = true;
    else if (t === '--timeout') a.timeout = parseInt(argv[++i], 10);
    else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const input = args._[0];
if (!input) {
  console.error('用法: node cli/md2mindmap.mjs <input.md | -> [-o out.png] [--xmind out.xmind] [--width N --height N] [--headful]');
  process.exit(2);
}

const md = input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8');
const outPng = args.out || (input === '-' ? 'mindmap.png' : input.replace(/\.(md|markdown|txt)$/i, '') + '.png');

const ORIGIN = process.env.XMIND_ORIGIN || 'https://app.xmind.cn';
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

function findChrome() {
  for (const p of CANDIDATES) if (p && fs.existsSync(p)) return p;
  return undefined; // 交给 playwright 用自带 chromium
}

// ---- 动态解析当前线上 chunk 文件名（内容哈希会随官网发版变化）----
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return await r.text();
}
async function resolveModules(origin) {
  const mods = {
    markdownV3: process.env.MD2MM_MARKDOWN_V3 || '/markdown_v3.chunk.CSQo9SQm.js',
    importFile: process.env.MD2MM_IMPORT_FILE || '/import-file.chunk.W4qCciBn.js',
    snowmonster: process.env.MD2MM_SNOWMONSTER || '/snowmonster-ext.chunk.DHFl-4AP.js',
  };
  if (process.env.MD2MM_NO_DISCOVER) return mods;
  try {
    const shell = await fetchText(origin + '/home');
    const em = shell.match(/<script[^>]+src="([^"]*entry[^"]*\.js)"/i) || shell.match(/src="([^"]+\.js)"/i);
    if (!em) return mods;
    const entryUrl = new URL(em[1], origin).href;
    const entry = await fetchText(entryUrl);
    const cands = [...new Set([...entry.matchAll(/markdown\.chunk\.[A-Za-z0-9_-]+\.js/g)].map(m => m[0]))];
    for (const rel of cands) {
      let src;
      try { src = await fetchText(new URL('./' + rel, entryUrl).href); } catch { continue; }
      if (!src.includes('importMarkdownV3')) continue;
      const pick = (re) => (src.match(re) || [])[0];
      const v3 = pick(/markdown_v3\.chunk\.[A-Za-z0-9_-]+\.js/);
      const im = pick(/import-file\.chunk\.[A-Za-z0-9_-]+\.js/);
      const sm = pick(/snowmonster-ext\.chunk\.[A-Za-z0-9_-]+\.js/);
      if (v3 && im && sm) return { markdownV3: '/' + v3, importFile: '/' + im, snowmonster: '/' + sm };
    }
  } catch (e) {
    if (process.env.MD2MM_DEBUG) console.error('[discover] 失败，用默认:', e.message);
  }
  return mods;
}
const MODULES = await resolveModules(ORIGIN);
if (process.env.MD2MM_DEBUG) console.error('[modules]', MODULES);

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: !args.headful,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1400 } });
  page.on('pageerror', () => {}); // 官网有些无关 chunk 会报错，忽略

  // 公开页面，避免登录跳转；同时已加载完整运行时（window.Manifests 等）
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.Manifests === 'object', null, { timeout: 30000 }).catch(() => {});

  const result = await page.evaluate(async ({ md, width, height, modules }) => {
    window.logger = window.logger || { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} };
    const toB64 = (x) => {
      if (!x) return null;
      let u;
      if (x instanceof ArrayBuffer) u = new Uint8Array(x);
      else if (ArrayBuffer.isView(x)) u = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      else return null;
      let s = ''; const CH = 0x8000;
      for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
      return btoa(s);
    };
    const mdmod = await import(modules.markdownV3);       // r.importMarkdownV3
    const ifm = await import(modules.importFile);         // o = openDocWithInject
    const sm = await import(modules.snowmonster);      // _ = renderThumbnail, d = packXmind
    const xmind = await mdmod.r.importMarkdownV3(new TextEncoder().encode(md)); // -> .xmind ArrayBuffer
    const wrapped = await ifm.o(xmind, true);                                    // -> { doc, ... }
    if (!wrapped || !wrapped.doc) throw new Error('openDocWithInject 未返回 doc');
    const png = await sm._(wrapped.doc, { size: { width, height } });            // -> PNG ArrayBuffer
    if (!png) throw new Error('renderThumbnail 返回 null（布局/渲染失败）');
    return { pngB64: toB64(png), xmindB64: toB64(xmind), sheets: wrapped.doc.sheets && wrapped.doc.sheets.length };
  }, { md, width: args.width, height: args.height, modules: MODULES });

  const pngBuf = Buffer.from(result.pngB64, 'base64');
  fs.mkdirSync(path.dirname(path.resolve(outPng)), { recursive: true });
  fs.writeFileSync(outPng, pngBuf);
  console.error(`✔ 图片: ${outPng}  (${pngBuf.length} bytes, sheets=${result.sheets})`);

  if (args.xmind) {
    fs.mkdirSync(path.dirname(path.resolve(args.xmind)), { recursive: true });
    fs.writeFileSync(args.xmind, Buffer.from(result.xmindB64, 'base64'));
    console.error(`✔ XMind: ${args.xmind}`);
  }
  process.stdout.write(outPng + '\n');
} finally {
  await browser.close();
}
