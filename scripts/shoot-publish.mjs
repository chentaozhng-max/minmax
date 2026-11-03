/**
 * 主试端交互截图：课程表排期、发布前检查、禁发布拦截、发布助手。
 *
 * 这些页面都要点击才能到，不能只靠导航，所以用 CDP 直接驱动页面。
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

    // 复用 .edge-profile 时会命中磁盘缓存：dev 的 chunk 文件名不变，
    // 改了代码还拍到旧界面。这里直接关缓存。
    await send("Network.enable", {}, sid);
    await send("Network.setCacheDisabled", { cacheDisabled: true }, sid);

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
      const overflow = await evaluate("document.documentElement.scrollWidth > window.innerWidth");
      console.log(`${overflow ? "OVERFLOW" : "ok      "} ${name}`);
    };

    const go = async (url) => {
      await send("Page.navigate", { url }, sid);
      await sleep(2000);
    };

    /** dev 首次编译可能十几秒：等元素出现再动手，别用固定 sleep 赌 */
    const waitForSelector = async (selector, timeout = 25000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
        await sleep(250);
      }
      return false;
    };

    /** 等某段文字出现在页面上（文案就是断言） */
    const waitForText = async (text, timeout = 25000) => {
      const expr = `document.body.innerText.includes(${JSON.stringify(text)})`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expr)) return true;
        await sleep(250);
      }
      return false;
    };

    /** 按按钮文案点（页面上按钮文案是唯一稳定标识） */
    const clickByText = async (text, timeout = 25000) => {
      const expr = `(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
        if (!btn) return false;
        btn.click();
        return true;
      })()`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expr)) return true;
        await sleep(250);
      }
      return false;
    };

    /* ---------- 1. 发布流程（未禁用账号 陈砚） ---------- */
    await go(`${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/new`);
    await waitForSelector("textarea");

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
        setValue(document.querySelector('textarea'), '被试需要在电脑上完成一轮点探测任务：先看情绪面孔图片，再对探测点位置做按键反应，全程约 40 分钟。数据匿名保存，仅用于学术研究。');
        setValue(byPlaceholder('俊秀楼 305'), '俊秀楼 412 情绪实验室');
        return 'filled';
      })()
    `);
    await sleep(300);
    await shot("pub-1");

    // 第 2 步：课程表
    await clickByText("下一步");
    await waitForSelector('button[aria-label$="添加时段"]');
    await shot("pub-2-empty");

    // 点 14:00 / 15:00 的格子，跳过已过去的日期（disabled 的格子点了没反应）
    const clicked = await evaluate(`
      (() => {
        const cells = [...document.querySelectorAll('button[aria-label$="添加时段"]')].filter((b) => !b.disabled);
        const pick = cells
          .filter((b) => /\\s(14:00|15:00)\\s/.test(b.getAttribute('aria-label') || ""))
          .slice(0, 9);
        pick.forEach((b, i) => setTimeout(() => b.click(), i * 60));
        return pick.map((b) => b.getAttribute('aria-label'));
      })()
    `);
    console.log(`        已点 ${Array.isArray(clicked) ? clicked.length : 0} 个格子`);
    await sleep(1200);
    await shot("pub-2");

    // 第 3 步：发布前检查（默认截止时间是明天中午，会晚于最早时段 → 应有 block）
    await clickByText("下一步");
    await waitForText("发布前检查");
    await evaluate("window.scrollTo(0, 0)");
    await shot("pub-3");

    // 体检里的「一键改好」应把截止时间挪到最早时段前 2 小时，block 消失
    const fixed = await clickByText("一键改好", 4000);
    await sleep(800);
    await evaluate("window.scrollTo(0, 0)");
    await shot(`pub-3-fixed${fixed ? "" : "-missing"}`);

    /* ---------- 2. 发布助手（规则版，本地没配 key） ---------- */
    await go(`${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/assistant`);
    await waitForText("发布助手");
    await shot("assistant-empty");

    await evaluate(`
      (() => {
        const chip = [...document.querySelectorAll('button')]
          .find((b) => (b.textContent || "").includes('一对一'));
        chip?.click();
        return Boolean(chip);
      })()
    `);
    await waitForText("填入发布表单");
    await sleep(400);
    await shot("assistant-draft");

    // 填入发布表单 → 检查草稿真的落到表单里
    await clickByText("填入发布表单");
    await waitForText("已填入发布助手写的草稿");
    await shot("pub-prefilled");

    /* ---------- 2.5 编辑已有的实验：只读课程表 + 追加时段 ---------- */
    await go(`${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/cmw0ustc80007uxd8p2dc9dd6/edit`);
    await waitForText("已有时段");
    await evaluate("window.scrollTo(0, 620)");
    await shot("edit-slots");

    // 滚到「追加时段」，同时能看到只读表的图例（确认只读态不再写「可点」）
    const scrolled = await evaluate(`
      (() => {
        const el = [...document.querySelectorAll('h2,h3,p,span')]
          .find((e) => e.textContent.trim() === '追加时段');
        el?.scrollIntoView({ block: 'start' });
        return Boolean(el);
      })()
    `);
    await sleep(600);
    await shot(`edit-append${scrolled ? "" : "-missing"}`);

    // 只读图的图例应该写「已开时段」而不是「已选」
    const legend = await evaluate(`
      (() => {
        const el = [...document.querySelectorAll('span')].find((e) => e.textContent.trim() === '已开时段');
        el?.scrollIntoView({ block: 'center' });
        return Boolean(el);
      })()
    `);
    await sleep(500);
    await shot(`edit-readonly-legend${legend ? "" : "-missing"}`);

    /* ---------- 3. 禁发布（谢秋池，种子里有 3 天禁期） ---------- */
    await go(`${baseUrl}/api/dev/login?phone=13800000002&to=/r/experiments`);
    await waitForText("禁发布");
    await shot("ban-list");

    await clickByText("发布");
    await waitForText("暂时不能发布实验", 6000);
    await shot("ban-modal");

    await go(`${baseUrl}/r/experiments/new`);
    await waitForText("你现在不能发布实验");
    await shot("ban-page");

    ws.close();
  } finally {
    browser.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
