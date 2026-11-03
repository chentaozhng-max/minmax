/**
 * 验证「点底部 tab 不再像卡死」。
 *
 * 用法：node scripts/check-nav-perf.mjs http://localhost:3100 shots
 *
 * 三个断言：
 *   1. 服务端变慢时，点「我的」在 300ms 内就能看到骨架（不是干等）
 *   2. 目标 tab 在点击瞬间就变色（有按压反馈）
 *   3. 30 秒内回到「我的」走客户端缓存，不发新的页面请求
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9359;
const baseUrl = process.argv[2] ?? "http://localhost:3100";
const outDir = process.argv[3] ?? "shots";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error("devtools 没起来");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.resolve(".edge-profile-navperf")}`,
      "--lang=zh-CN",
      "--disable-features=Translate,TranslateUI",
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    const ws = new WebSocket(await waitForDevtools());
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

    let seq = 0;
    const pending = new Map();
    const pageRequests = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
        return;
      }
      if (msg.method === "Network.requestWillBeSent") {
        const url = msg.params?.request?.url ?? "";
        if (url.includes("_rsc")) pageRequests.push({ t: Date.now(), url });
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });

    const { result: created } = await send("Target.createTarget", { url: "about:blank" });
    const { result: attached } = await send("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    const sid = attached.sessionId;

    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
      sid,
    );
    await send("Network.enable", {}, sid);
    await send("Page.enable", {}, sid);

    const evaluate = async (expression) => {
      const res = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sid,
      );
      return res.result?.result?.value;
    };

    const shot = async (name) => {
      const res = await send("Page.captureScreenshot", { format: "png" }, sid);
      const data = res.result?.data;
      if (!data) return;
      await writeFile(path.join(outDir, `${name}.png`), Buffer.from(data, "base64"));
    };

    // 登录并打开主试列表页
    await send("Page.navigate", { url: `${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments` }, sid);
    await sleep(3000);

    /* ---- 1. 模拟「服务端很慢」：加 1.5s 延迟，再点「我的」 ---- */
    console.log("\n[1] 服务端慢 1.5s 时的点击反馈");
    await send(
      "Network.emulateNetworkConditions",
      {
        offline: false,
        latency: 1500,
        downloadThroughput: (2 * 1024 * 1024) / 8,
        uploadThroughput: (1 * 1024 * 1024) / 8,
      },
      sid,
    );

    // 点击后 350ms 抓一张：此时服务端还没回，应该已经是骨架 + tab 高亮
    const early = await evaluate(`
      (async () => {
        const tab = [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/r/profile');
        if (!tab) return { error: 'no tab' };
        const t0 = performance.now();
        tab.click();
        await new Promise((r) => setTimeout(r, 350));
        return {
          elapsed: Math.round(performance.now() - t0),
          path: location.pathname,
          hasSkeleton: Boolean(document.querySelector('.skeleton')),
          // aria-busy 是点击反馈的标记
          busyTab: Boolean(document.querySelector('nav a[aria-busy="true"]')),
          // 底部导航还在不在（骨架里也带着 TabBar）
          tabBarCount: document.querySelectorAll('nav').length,
        };
      })()
    `);
    await shot("nav-skeleton");
    console.log("   ", JSON.stringify(early));
    check("慢服务端下 350ms 内出现骨架", early?.hasSkeleton === true);
    check("加载期间底部导航仍在", (early?.tabBarCount ?? 0) > 0);

    // 等真正到站
    await sleep(4000);
    const arrived = await evaluate(`({ path: location.pathname, title: document.querySelector('h1')?.textContent })`);
    check("最终到达「我的」", arrived?.path === "/r/profile", JSON.stringify(arrived));

    /* ---- 1b. 预取没赶上（等于冷启动）时，点击本身要有反馈 ---- */
    console.log("\n[1b] 预取被挡住时，点 tab 是否立刻有加载态");
    await send("Network.setBlockedURLs", { urls: ["*_rsc=*"] }, sid);
    await send("Page.navigate", { url: `${baseUrl}/r/experiments` }, sid);
    await sleep(3500);
    await send("Network.setBlockedURLs", { urls: [] }, sid);
    await send(
      "Network.emulateNetworkConditions",
      { offline: false, latency: 1500, downloadThroughput: (2 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8 },
      sid,
    );

    const noPrefetch = await evaluate(`
      (async () => {
        const tab = [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/r/profile');
        if (!tab) return { error: 'no tab' };
        tab.click();
        await new Promise((r) => setTimeout(r, 300));
        const busy = document.querySelector('nav a[aria-busy="true"]');
        return {
          path: location.pathname,
          busyTab: Boolean(busy),
          busyLabel: busy ? busy.textContent.trim() : null,
          skeleton: Boolean(document.querySelector('.skeleton')),
        };
      })()
    `);
    console.log("   ", JSON.stringify(noPrefetch));
    await shot("nav-tab-busy");
    check("预取没到时 tab 立刻进入加载态", noPrefetch?.busyTab === true, `标签=${noPrefetch?.busyLabel}`);
    await sleep(4000);

    /* ---- 2. 恢复正常网速，回列表再点回来：应命中客户端缓存 ---- */
    await send(
      "Network.emulateNetworkConditions",
      { offline: false, latency: 20, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 },
      sid,
    );

    console.log("\n[2] 30 秒内回到「我的」是否省掉服务器往返");
    await evaluate(`
      [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/r/experiments')?.click()
    `);
    await sleep(2500);
    const before = pageRequests.length;

    const second = await evaluate(`
      (async () => {
        const tab = [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/r/profile');
        if (!tab) return { error: 'no tab' };
        const t0 = performance.now();
        tab.click();
        while (location.pathname !== '/r/profile' && performance.now() - t0 < 15000) {
          await new Promise((r) => setTimeout(r, 10));
        }
        return { urlMs: Math.round(performance.now() - t0) };
      })()
    `);
    await sleep(1200);
    const newRequests = pageRequests.length - before;
    console.log("   ", JSON.stringify(second), "新增 RSC 请求:", newRequests);
    check("回访「我的」不再请求服务器", newRequests === 0, `新增 ${newRequests} 个 _rsc 请求`);
    check("回访「我的」1 秒内切换", (second?.urlMs ?? 99999) < 1000, `${second?.urlMs}ms`);

    await shot("nav-cached");

    /* ---- 3. 被试端同样验证一遍 ---- */
    console.log("\n[3] 被试端「我的」");
    await send("Page.navigate", { url: `${baseUrl}/api/dev/login?phone=13900000001&to=/appointments` }, sid);
    await sleep(3000);
    await send(
      "Network.emulateNetworkConditions",
      { offline: false, latency: 1500, downloadThroughput: (2 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8 },
      sid,
    );
    const subject = await evaluate(`
      (async () => {
        const tab = [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/me');
        if (!tab) return { error: 'no tab' };
        tab.click();
        await new Promise((r) => setTimeout(r, 350));
        return {
          hasSkeleton: Boolean(document.querySelector('.skeleton')),
          // 到站了会有 aria-current，没到站应该有 aria-busy —— 两者有一个就说明点下去了
          responded: Boolean(document.querySelector('nav a[aria-current="page"], nav a[aria-busy="true"]')),
        };
      })()
    `);
    await shot("nav-skeleton-subject");
    console.log("   ", JSON.stringify(subject));
    check("被试端点「我的」有即时骨架与反馈", subject?.hasSkeleton === true && subject?.responded === true);

    await sleep(4000);
    await send(
      "Network.emulateNetworkConditions",
      { offline: false, latency: 20, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 },
      sid,
    );
    await shot("nav-me-loaded");
  } finally {
    browser.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "全部通过" : `${failed.length} 项未通过`}（共 ${results.length} 项）`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
