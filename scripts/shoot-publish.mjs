/**
 * 发布流程第 2、3 步的截图（需要交互，不能只靠导航）。
 * 用法：node scripts/shoot-publish.mjs http://localhost:3100 shots
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9355;
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
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.resolve(".edge-profile")}`,
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

    const evaluate = async (expression) => {
      const res = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sid,
      );
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
      const overflow = await evaluate(
        "document.documentElement.scrollWidth > window.innerWidth",
      );
      console.log(`${overflow ? "OVERFLOW" : "ok      "} ${name}`);
    };

    // 以主试身份进入发布页
    await send(
      "Page.navigate",
      { url: `${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/new` },
      sid,
    );
    await sleep(2200);

    // 第 1 步：填必填项
    await evaluate(`
      (() => {
        const setValue = (el, value) => {
          const proto = el.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const byPlaceholder = (p) => [...document.querySelectorAll('input,textarea')]
          .find((e) => (e.placeholder || '').includes(p));
        setValue(byPlaceholder('面孔吸引力判断实验'), '情绪面孔的注意偏向实验');
        setValue(document.querySelector('textarea'), '被试需要在电脑上完成一轮点探测任务，先看情绪面孔图片，再对探测点位置做按键反应，全程约 40 分钟。数据匿名保存，仅用于学术研究。');
        setValue(byPlaceholder('俊秀楼 305'), '俊秀楼 412 情绪实验室');
        return 'filled';
      })()
    `);
    await sleep(400);
    await shot("pub-1");

    // 进第 2 步
    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '下一步').click()",
    );
    await sleep(900);
    await shot("pub-2");

    // 生成时段
    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '一键生成时段').click()",
    );
    await sleep(1200);
    await shot("pub-2-slots");

    // 进第 3 步（确认页）
    await evaluate(
      "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '下一步').click()",
    );
    await sleep(900);
    await evaluate("window.scrollTo(0, 0)");
    await shot("pub-3");

    ws.close();
  } finally {
    browser.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
