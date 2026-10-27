/** 滚动到指定位置再截图（检查首屏之外的内容）。用法：node scripts/shoot-scroll.mjs <url> <out.png> <scrollY> */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9366;
const [url, out, scrollY = "600"] = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      "--user-data-dir=E:/minmax/.edge-profile",
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
      { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
      sid,
    );
    await send("Page.navigate", { url }, sid);
    await sleep(2500);
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollY})` }, sid);
    await sleep(600);

    const shot = await send("Page.captureScreenshot", { format: "png" }, sid);
    await writeFile(out, Buffer.from(shot.result.data, "base64"));
    console.log("saved", out);

    ws.close();
  } finally {
    browser.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
