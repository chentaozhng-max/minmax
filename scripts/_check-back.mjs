/**
 * 返回导航的回归检查：确认「消息 ↔ 对话」「详情 ↔ 选时段」不再来回弹。
 * 用法：node scripts/_check-back.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9338;
const BASE = process.argv[2] || "http://127.0.0.1:3000";

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
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
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

const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.resolve(".edge-profile-back")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=zh-CN",
    "--disable-features=Translate,TranslateUI",
    "about:blank",
  ],
  { stdio: "ignore", detached: false },
);

const rows = [];

try {
  const wsUrl = await waitForDevtools();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new CDP(ws);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
    sessionId,
  );

  const evaluate = async (expression) => {
    const out = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    return out.result.value;
  };

  const here = () => evaluate("location.pathname + location.search");

  const waitFor = async (selector, timeoutMs = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (found) return true;
      await sleep(300);
    }
    return false;
  };

  /** 点完之后等路径真的变了（开发模式路由编译慢，不能固定 sleep） */
  const clickAndWait = async (selector) => {
    if (!(await waitFor(selector))) throw new Error(`找不到 ${selector}`);
    const before = await here();
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const started = Date.now();
    while (Date.now() - started < 30000) {
      await sleep(400);
      const now = await here();
      if (now !== before) return now;
    }
    return here();
  };

  const clickTextAndWait = async (text) => {
    if (!(await waitFor("a,button"))) throw new Error("页面没元素");
    const before = await here();
    const ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll('a,button')].find((n) => n.textContent.trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`找不到文本 ${text}`);
    const started = Date.now();
    while (Date.now() - started < 30000) {
      await sleep(400);
      const now = await here();
      if (now !== before) return now;
    }
    return here();
  };

  const login = async (phone) => {
    await cdp.send("Page.navigate", { url: `${BASE}/` }, sessionId);
    await sleep(1500);
    return evaluate(`(async () => {
      const phone = ${JSON.stringify(phone)};
      const h = { "Content-Type": "application/json" };
      await fetch("/api/auth/send-code", { method: "POST", headers: h, body: JSON.stringify({ phone }) });
      const b = await fetch("/api/auth/login", { method: "POST", headers: h, body: JSON.stringify({ phone, code: "123456" }) });
      const d = await b.json().catch(() => ({}));
      return d?.data?.name ?? null;
    })()`);
  };

  const goHome = async () => {
    await cdp.send("Page.navigate", { url: `${BASE}/` }, sessionId);
    await waitFor("a[href^='/experiments/']");
    await sleep(500);
  };

  /* ---------- 场景 A：被试 消息 ↔ 对话 ---------- */
  const who = await login("13900000001");
  await goHome();

  let p = await clickAndWait('a[href="/messages"]');
  rows.push({ step: `${who} 点「消息」tab`, path: p });

  p = await clickAndWait('a[href^="/messages/"]');
  rows.push({ step: "点陈砚这条会话", path: p });

  p = await clickAndWait('button[aria-label="返回"]');
  rows.push({ step: "对话页点返回", path: p });

  const arrowOnList = await evaluate('Boolean(document.querySelector(\'button[aria-label="返回"]\'))');
  rows.push({ step: "消息页上还有没有返回箭头", path: arrowOnList ? "有 ✗" : "没有 ✓" });

  /* ---------- 场景 B：详情 → 选时段 → 返回 ---------- */
  const who2 = await login("13900000002");
  await goHome();
  rows.push({ step: `切换到 ${who2}`, path: await here() });

  p = await clickAndWait('a[href^="/experiments/"]');
  const detailPath = p;
  rows.push({ step: "首页点第一个实验", path: p });

  p = await clickTextAndWait("立即预约");
  rows.push({ step: "点「立即预约」", path: p });

  p = await clickAndWait('button[aria-label="返回"]');
  rows.push({ step: "选时段页点返回", path: `${p}${p === detailPath ? " ✓" : " ✗"}` });

  p = await clickAndWait('button[aria-label="返回"]');
  rows.push({ step: "详情页点返回", path: `${p}${p === "/" ? " ✓" : " ✗"}` });

  /* ---------- 场景 C：主试 消息 ↔ 对话 ---------- */
  const who3 = await login("13800000001");
  await cdp.send("Page.navigate", { url: `${BASE}/r/messages` }, sessionId);
  await waitFor('a[href^="/messages/"]');
  await sleep(600);
  rows.push({ step: `切换到 ${who3}`, path: await here() });

  p = await clickAndWait('a[href^="/messages/"]');
  rows.push({ step: "主试点被试会话", path: p });

  p = await clickAndWait('button[aria-label="返回"]');
  rows.push({ step: "对话页点返回", path: `${p}${p === "/r/messages" ? " ✓" : " ✗"}` });

  const arrowOnRList = await evaluate('Boolean(document.querySelector(\'button[aria-label="返回"]\'))');
  rows.push({ step: "主试消息页还有没有返回箭头", path: arrowOnRList ? "有 ✗" : "没有 ✓" });

  ws.close();
} finally {
  browser.kill();
}

for (const row of rows) {
  console.log(`${row.step.padEnd(26)} → ${row.path}`);
}
