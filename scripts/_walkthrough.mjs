/**
 * 真实走一遍 PsyMatch 主流程：主试发布实验 → 被试报名 → 确认。
 * 每步截图 + 记录 API 状态，用来找体验摩擦点。
 * 用法：node scripts/_walkthrough.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9336;
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("shots/walkthrough");
const PROFILE = path.resolve(".edge-profile-walk");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error("devtools 没起来");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 30000);
    });
  }
}

const log = (...a) => console.log(...a);

async function main() {
  await rm(PROFILE, { recursive: true, force: true });
  await mkdir(PROFILE, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const browser = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--lang=zh-CN",
    "--disable-features=Translate,TranslateUI", "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    ws = new WebSocket(await waitForDevtools());
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    const cdp = new CDP(ws);

    async function newPage() {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }, sessionId);
      return { targetId, sessionId };
    }

    const js = async (page, expr) => {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, page.sessionId);
      if (r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };
    const go = async (page, p) => {
      await cdp.send("Page.navigate", { url: `${BASE}${p}` }, page.sessionId);
      await sleep(2200);
      return js(page, "location.pathname + location.search");
    };
    const shot = async (page, name) => {
      const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, page.sessionId);
      await writeFile(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
      log(`  [shot] ${name}.png`);
    };
    const buttons = (page) => js(page, `[...document.querySelectorAll("button")].map(b=>b.textContent.trim()).filter(Boolean)`);
    const clickText = async (page, text, exact = false) => {
      const r = await js(page, `(() => {
        const bs = [...document.querySelectorAll("button, a")];
        const hit = bs.find(b => ${exact ? `b.textContent.trim() === ${JSON.stringify(text)}` : `b.textContent.includes(${JSON.stringify(text)})`});
        if (!hit) return { ok: false, all: bs.map(b => b.textContent.trim()).filter(Boolean).slice(0, 20) };
        hit.scrollIntoView({ block: "center" });
        hit.click();
        return { ok: true, text: hit.textContent.trim() };
      })()`);
      if (!r.ok) throw new Error(`找不到按钮「${text}」，现有：${JSON.stringify(r.all)}`);
      return r.text;
    };
    const fill = (page, placeholder, value) => js(page, `(() => {
      const el = [...document.querySelectorAll("input,textarea")].find(e => (e.placeholder||"").includes(${JSON.stringify(placeholder)}));
      if (!el) return { ok: false, fields: [...document.querySelectorAll("input,textarea")].map(e=>e.placeholder||e.type) };
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, value: el.value };
    })()`);
    const text = (page) => js(page, "document.body.innerText");

    // ---------- 主试：发布实验 ----------
    log("\n=== 主试 陈砚 13800000001 发布实验 ===");
    const p1 = await newPage();
    let at = await go(p1, "/");
    log("  落地:", at);
    const login1 = await js(p1, `(async () => {
      const h = { "Content-Type": "application/json" };
      await fetch("/api/auth/send-code", { method: "POST", headers: h, body: JSON.stringify({ phone: "13800000001" }) });
      const b = await fetch("/api/auth/login", { method: "POST", headers: h, body: JSON.stringify({ phone: "13800000001", code: "123456", role: "RESEARCHER" }) });
      const d = await b.json().catch(()=>({}));
      return { status: b.status, name: d?.data?.name, role: d?.data?.role };
    })()`);
    log("  登录:", JSON.stringify(login1));

    at = await go(p1, "/r/experiments/new");
    log("  发布页:", at);
    await shot(p1, "01-publish-step1-empty");
    log("  步骤1按钮:", JSON.stringify(await buttons(p1)));

    for (const [ph, v] of [
      ["例：面孔吸引力判断实验", "面孔吸引力判断实验（体验测试）"],
      ["被试需要做什么", "在电脑上对 60 组面孔照片做好坏判断，全程约 30 分钟；数据仅用于本研究，匿名处理。"],
      ["例：俊秀楼", "俊秀楼 305 认知实验室"],
      ["例：矫正视力正常", "矫正视力正常；近三个月未参加过同类实验"],
    ]) {
      const r = await fill(p1, ph, v);
      log(`  填 ${ph}: ${JSON.stringify(r).slice(0, 120)}`);
    }
    await shot(p1, "02-publish-step1-filled");
    await clickText(p1, "下一步", true);
    await sleep(800);
    await shot(p1, "03-publish-step2-slots-empty");
    log("  步骤2按钮:", JSON.stringify(await buttons(p1)));

    await clickText(p1, "一键生成时段");
    await sleep(1200);
    await shot(p1, "04-publish-step2-generated");
    const slotText = await js(p1, `(() => { const m = document.body.innerText.match(/已添加\\s*(\\d+)\\s*个时段/); return m ? m[1] : null; })()`);
    log("  生成时段数:", slotText);

    await clickText(p1, "下一步", true);
    await sleep(800);
    await shot(p1, "05-publish-step3-preview");
    log("  步骤3按钮:", JSON.stringify(await buttons(p1)));
    log("  预览文本:", (await text(p1)).slice(0, 400).replace(/\n+/g, " | "));

    await clickText(p1, "发布", true).catch(async (e) => {
      log("  「发布」精确匹配失败，改用包含匹配:", e.message.slice(0, 160));
      await clickText(p1, "发布");
    });
    await sleep(2500);
    const afterPublish = await js(p1, "location.pathname");
    log("  发布后地址:", afterPublish);
    await shot(p1, "06-publish-done");
    log("  发布后按钮:", JSON.stringify(await buttons(p1)));

    // ---------- 被试：报名 ----------
    log("\n=== 被试 周叙 13900000002 报名 ===");
    const p2 = await newPage();
    await go(p2, "/");
    const login2 = await js(p2, `(async () => {
      const h = { "Content-Type": "application/json" };
      await fetch("/api/auth/send-code", { method: "POST", headers: h, body: JSON.stringify({ phone: "13900000002" }) });
      const b = await fetch("/api/auth/login", { method: "POST", headers: h, body: JSON.stringify({ phone: "13900000002", code: "123456", role: "SUBJECT" }) });
      const d = await b.json().catch(()=>({}));
      return { status: b.status, name: d?.data?.name, role: d?.data?.role, completed: d?.data?.profileCompleted };
    })()`);
    log("  登录:", JSON.stringify(login2));

    at = await go(p2, "/");
    log("  首页:", at);
    await shot(p2, "07-subject-home");
    const homeText = await text(p2);
    log("  首页文案:", homeText.slice(0, 500).replace(/\n+/g, " | "));

    const opened = await js(p2, `(() => {
      const el = [...document.querySelectorAll("a")].find(a => a.textContent.includes("面孔吸引力判断实验（体验测试）"));
      if (!el) return { ok: false, cards: [...document.querySelectorAll("a")].map(a=>a.textContent.trim().slice(0,20)).slice(0,12) };
      el.click(); return { ok: true, href: el.getAttribute("href") };
    })()`);
    log("  点开实验:", JSON.stringify(opened));
    await sleep(2200);
    await shot(p2, "08-subject-detail");
    log("  详情页地址:", await js(p2, "location.pathname"));
    log("  详情页按钮:", JSON.stringify(await buttons(p2)));

    await clickText(p2, "预约").catch(async (e) => { log("  预约按钮失败:", e.message.slice(0, 200)); });
    await sleep(2200);
    await shot(p2, "09-subject-book-page");
    log("  选时段页地址:", await js(p2, "location.pathname"));
    log("  选时段页按钮:", JSON.stringify(await buttons(p2)));

    const slotPick = await js(p2, `(() => {
      const btns = [...document.querySelectorAll("button")].filter(b => /\\d{1,2}:\\d{2}/.test(b.textContent));
      if (!btns.length) return { ok: false, sample: [...document.querySelectorAll("button")].map(b=>b.textContent.trim()).slice(0,20) };
      btns[0].click();
      return { ok: true, picked: btns[0].textContent.trim(), total: btns.length };
    })()`);
    log("  选时段:", JSON.stringify(slotPick));
    await sleep(800);
    await shot(p2, "10-subject-slot-picked");
    log("  选完后按钮:", JSON.stringify(await buttons(p2)));

    const confirmBtn = await js(p2, `(() => {
      const bs = [...document.querySelectorAll("button")];
      const hit = bs.find(b => /确认|就这个|锁定|报名/.test(b.textContent));
      if (!hit) return { ok: false };
      hit.click(); return { ok: true, text: hit.textContent.trim() };
    })()`);
    log("  确认报名:", JSON.stringify(confirmBtn));
    await sleep(2500);
    await shot(p2, "11-subject-booked");
    log("  报名后地址:", await js(p2, "location.pathname"));
    log("  报名后文案:", (await text(p2)).slice(0, 400).replace(/\n+/g, " | "));

    at = await go(p2, "/appointments");
    await shot(p2, "12-subject-appointments");
    log("  我的预约地址:", at);
    log("  我的预约文案:", (await text(p2)).slice(0, 600).replace(/\n+/g, " | "));
    log("  我的预约按钮:", JSON.stringify(await buttons(p2)));

    // ---------- 网络事件汇总 ----------
    const fails = cdp.events.filter((e) => e.method === "Network.loadingFailed");
    const apiCalls = cdp.events.filter((e) => e.method === "Network.requestWillBeSent" && /\/api\//.test(e.params.request.url));
    const responses = cdp.events.filter((e) => e.method === "Network.responseReceived" && /\/api\//.test(e.params.response.url));
    log("\n=== 网络 ===");
    log("API 请求数:", apiCalls.length, " 失败:", fails.length);
    for (const r of responses) log("  ", r.params.response.status, r.params.response.url.replace(BASE, ""));
    for (const f of fails) log("  FAIL", f.params.errorText, f.params.requestId);
  } finally {
    try { ws?.close(); } catch {}
    browser.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });