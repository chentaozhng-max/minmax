/**
 * 回归验证：草稿里含「已经开始的时段」时，发布流程能不能走通。
 *
 * 复现的是用户报的那条：275 个时段里有 70 个已经过去，报名截止落在昨天，
 * 点「一键改好」算出来的还是过去时间 —— 发布按钮永远是灰的。
 *
 * 用法：node scripts/check-stale-draft.mjs http://localhost:3100 shots
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9356;
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
      `--user-data-dir=${path.resolve(".edge-profile-check")}`,
      "--lang=zh-CN",
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
      return res.result?.result?.value;
    };

    const shot = async (name) => {
      await sleep(600);
      const res = await send("Page.captureScreenshot", { format: "png" }, sid);
      await writeFile(path.join(outDir, `${name}.png`), Buffer.from(res.result.data, "base64"));
      const overflow = await evaluate("document.documentElement.scrollWidth > window.innerWidth");
      console.log(`${overflow ? "OVERFLOW" : "ok      "} ${name}`);
    };

    const waitForText = async (text, timeout = 25000) => {
      const expr = `document.body.innerText.includes(${JSON.stringify(text)})`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expr)) return true;
        await sleep(250);
      }
      return false;
    };

    const clickByText = async (text, timeout = 20000) => {
      const expr = `(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
        if (!b) return false;
        b.click();
        return true;
      })()`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expr)) return true;
        await sleep(200);
      }
      return false;
    };

    /* ---------- 造一份「两天前写的」草稿：2 段已开始 + 2 段在未来 ---------- */
    await send("Page.navigate", { url: `${baseUrl}/api/dev/login?phone=13800000001&to=/r/experiments/new` }, sid);
    await sleep(2500);
    await waitForText("实验标题", 25000);

    const seeded = await evaluate(`
      (() => {
        const now = Date.now();
        const H = 3600 * 1000;
        // 课程表按整点/半点铺格子，时段也要对齐，否则格子对不上（真实数据都是对齐的）
        const align = (ms) => Math.ceil(ms / (30 * 60 * 1000)) * (30 * 60 * 1000);
        const iso = (ms) => new Date(ms).toISOString();
        const slot = (start) => ({ startAt: iso(align(start)), endAt: iso(align(start) + 30 * 60 * 1000), capacity: 1 });
        const draft = {
          title: "面孔吸引力判断实验",
          description: "在实验室完成一段电脑任务，全程约 30 分钟，报酬当场结算，数据仅用于本研究。",
          location: "俊秀楼 305 认知实验室",
          durationMin: 30,
          rewardYuan: 30,
          type: "INDIVIDUAL",
          groupSize: null,
          requirements: "矫正视力正常",
          minCreditScore: 0,
          needsVerification: true,
          // 前两段是昨天的，后两段在明天
          slots: [slot(now - 26 * H), slot(now - 25 * H), slot(now + 26 * H), slot(now + 27 * H)],
          slotPlan: null,
          staleDeadline: iso(now - 30 * H)
        };
        sessionStorage.setItem("psymatch:publish-draft", JSON.stringify(draft));
        return { count: draft.slots.length, deadlineSeeded: draft.staleDeadline, starts: draft.slots.map((s) => s.startAt) };
      })()
    `);
    console.log("已写入草稿：", JSON.stringify(seeded));

    await evaluate("location.reload()");
    await sleep(3000);
    await waitForText("实验标题", 25000);
    await sleep(800);

    const step1 = await evaluate(`
      (() => {
        const body = document.body.innerText;
        const dt = document.querySelector('input[type="datetime-local"]');
        return {
          toast: (body.match(/已填入[^\\n]*/) || [])[0] || null,
          deadline: dt ? dt.value : null,
          hasTitle: body.includes("面孔吸引力判断实验")
        };
      })()
    `);
    console.log("第 1 步：", JSON.stringify(step1));
    await shot("stale-1");

    await clickByText("下一步");
    await sleep(1200);
    const step2 = await evaluate(`
      (() => {
        const picked = [...document.querySelectorAll('button[aria-label$="取消这个时段"]')]
          .map((b) => b.getAttribute('aria-label'));
        const body = document.body.innerText;
        return { picked: picked.length, labels: picked, conflict: /发布会被拒绝/.test(body) };
      })()
    `);
    console.log("第 2 步：", JSON.stringify(step2));
    await shot("stale-2");

    await clickByText("下一步");
    await sleep(1200);
    await evaluate("window.scrollTo(0, 0)");
    const step3 = await evaluate(`
      (() => {
        const panel = [...document.querySelectorAll('div')]
          .find((d) => d.textContent.trim().startsWith("发布前检查"));
        const publishBtn = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === "发布");
        return {
          panel: panel ? panel.innerText.replace(/\\n+/g, " | ") : null,
          publishDisabled: publishBtn ? publishBtn.disabled : null,
          footerNote: (document.body.innerText.match(/还有 \\d+ 项要补[^\\n]*/) || [])[0] || null
        };
      })()
    `);
    console.log("第 3 步：", JSON.stringify(step3, null, 1));
    await shot("stale-3");
  } finally {
    browser.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
