/**
 * 裁掉插画右下角的水印（AI 生成图自带），按比例从右边/下边裁。
 * 做法：用浏览器直接打开 PNG，整页截图并按比例裁切——不经 canvas，避免 file:// 污染问题。
 * 用法：node scripts/crop-illustration.mjs <in.png> <out.png> [keepRatioX] [keepRatioY]
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9377;
const [input, output, keepX = "0.86", keepY = "0.9"] = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1200,1200",
      `--remote-debugging-port=${PORT}`,
      "--user-data-dir=.edge-profile",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    let wsUrl;
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) {
          wsUrl = (await res.json()).webSocketDebuggerUrl;
          break;
        }
      } catch {
        /* retry */
      }
      await sleep(300);
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));

    let seq = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
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
      { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false },
      sid,
    );

    await send("Page.navigate", { url: pathToFileURL(path.resolve(input)).href }, sid);
    await sleep(1500);

    const info = await send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const img = document.images[0];
          if (!img) return { ok: false, why: 'no img' };
          const r = img.getBoundingClientRect();
          return { ok: true, naturalW: img.naturalWidth, naturalH: img.naturalHeight, w: r.width, h: r.height, left: r.left, top: r.top };
        })()`,
        returnByValue: true,
      },
      sid,
    );

    const info2 = info.result?.result?.value;
    if (!info2?.ok || !info2.w) {
      console.error("读不到图片尺寸:", JSON.stringify(info2));
      process.exit(1);
    }

    const w = Math.round(info2.w * Number(keepX));
    const h = Math.round(info2.h * Number(keepY));

    const shot = await send(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: info2.left, y: info2.top, width: w, height: h, scale: 1 },
      },
      sid,
    );

    if (!shot.result?.data) {
      console.error("截图失败:", JSON.stringify(shot.error ?? shot));
      process.exit(1);
    }

    await writeFile(output, Buffer.from(shot.result.data, "base64"));
    console.log(`saved ${output} (${w}x${h}, 原 ${info2.naturalW}x${info2.naturalH})`);

    ws.close();
  } finally {
    browser.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
