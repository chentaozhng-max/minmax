/**
 * 主试「排班表」截图：时段 tab 的周视图、点开某一段的弹窗、团体实验的占位色。
 *
 * 用法：node scripts/shoot-schedule.mjs http://localhost:3100 shots
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9357;
const baseUrl = process.argv[2] ?? "http://localhost:3100";
const outDir = process.argv[3] ?? "shots";

const EXP_INDIVIDUAL = "cmw0yfgj30001uxpc9htwp7ru"; // 情绪记忆实验（已补 2 条预约）
const EXP_GROUP = "cmw0ustjx0019uxd8uuu6nbfi"; // 团体决策中的从众行为（2/3）

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
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.resolve(".edge-profile-schedule")}`,
      "--lang=zh-CN",
      "--disable-features=Translate,TranslateUI",
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const ws = new WebSocket(await waitForDevtools());
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

    let seq = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
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
    await send("Network.setCacheDisabled", { cacheDisabled: true }, sid);

    const evaluate = async (expression) => {
      const res = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sid,
      );
      if (res.result?.exceptionDetails) {
        console.log("  JS 异常:", res.result.exceptionDetails.text);
      }
      return res.result?.result?.value;
    };

    const shot = async (name) => {
      await sleep(700);
      const res = await send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        sid,
      );
      await writeFile(path.join(outDir, `${name}.png`), Buffer.from(res.result.data, "base64"));
      const overflow = await evaluate("document.documentElement.scrollWidth > window.innerWidth");
      console.log(`${overflow ? "OVERFLOW" : "ok      "} ${name}`);
    };

    const go = async (url) => {
      await send("Page.navigate", { url }, sid);
      await sleep(1800);
    };

    /** 等到页面上出现某段文字（生产构建首屏快，开发构建要等编译） */
    const waitForText = async (text, timeout = 25000) => {
      const expr = `document.body.innerText.includes(${JSON.stringify(text)})`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expr)) return true;
        await sleep(300);
      }
      console.log(`  超时未出现：${text}`);
      return false;
    };

    const clickByText = async (text, timeout = 15000) => {
      const expr = `(() => {
        const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(${JSON.stringify(text)}));
        if (!el) return false;
        el.click();
        return true;
      })()`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expr)) return true;
        await sleep(250);
      }
      console.log(`  点不到：${text}`);
      return false;
    };

    /* ---------- 1. 一对一实验：三段状态各不相同 ---------- */
    await go(`${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/${EXP_INDIVIDUAL}`);
    await waitForText("报名者");
    await shot("schedule-tab-applicants");

    await clickByText("时段");
    await sleep(900);
    await shot("schedule-week");

    // 点有名字的那一格（1/1 已约满）
    const tapped = await evaluate(`(() => {
      const cell = [...document.querySelectorAll('button[title]')]
        .find((b) => (b.getAttribute('title') || '').includes('周叙'));
      if (!cell) return null;
      cell.click();
      return cell.getAttribute('title');
    })()`);
    console.log(`        点中格子：${tapped ?? "没找到"}`);
    await sleep(900);
    await shot("schedule-slot-modal");

    // 关掉弹窗，翻到下一周：验证跨周时时间轴自己跟着变
    await evaluate(`(() => {
      const close = [...document.querySelectorAll('button')]
        .filter((b) => (b.textContent || '').trim() === '关闭').pop();
      close?.click();
      return Boolean(close);
    })()`);
    await sleep(600);
    await evaluate(`document.querySelector('button[aria-label="下一周"]')?.click()`);
    await sleep(900);
    await shot("schedule-next-week");

    /* ---------- 2. 团体实验：2/3 的部分占用 ---------- */
    await go(`${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/${EXP_GROUP}`);
    await waitForText("报名者");
    await clickByText("时段");
    await sleep(900);
    await shot("schedule-group");

    await evaluate(`(() => {
      const cell = [...document.querySelectorAll('button[title]')]
        .find((b) => (b.getAttribute('title') || '').includes('团体决策') || (b.getAttribute('title') || '').includes('2/3'));
      cell?.click();
      return Boolean(cell);
    })()`);
    await sleep(900);
    await shot("schedule-group-modal");
  } finally {
    browser.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
