/**
 * 375×812 移动端截图（CDP 直连，比 --screenshot CLI 更可靠：能精确设置移动端视口）。
 * 用法：node scripts/shoot.mjs <baseUrl> <outDir> <listFile>
 * listFile 每行 "name path"，例如 "home /"
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;

const [, , baseUrl = "http://localhost:3100", outDir = "shots", listFile = "shots/pages.txt"] =
  process.argv;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDevtools(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
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

async function main() {
  await mkdir(outDir, { recursive: true });
  const pages = (await readFile(listFile, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [name, ...rest] = line.split(" ");
      return { name, urlPath: rest.join(" ") };
    });

  const browser = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${path.resolve(".edge-profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );

  let wsUrl;
  try {
    wsUrl = await waitForDevtools();
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const cdp = new CDP(ws);

    for (const page of pages) {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
        sessionId,
      );

      const url = `${baseUrl}${page.urlPath}`;
      await cdp.send("Page.navigate", { url }, sessionId);
      await sleep(1800);

      // 检查横向溢出：scrollWidth 是否大于 clientWidth
      const metrics = await cdp.send(
        "Runtime.evaluate",
        {
          expression:
            "(() => ({ w: window.innerWidth, sw: document.documentElement.scrollWidth, " +
            "bw: document.body.scrollWidth, h: document.documentElement.scrollHeight }))()",
          returnByValue: true,
        },
        sessionId,
      );

      const shot = await cdp.send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        sessionId,
      );
      await writeFile(path.join(outDir, `${page.name}.png`), Buffer.from(shot.data, "base64"));

      const m = metrics.result.value;
      const overflow = m.sw > m.w;
      console.log(
        `${overflow ? "OVERFLOW" : "ok      "} ${page.name.padEnd(14)} inner=${m.w} scrollW=${m.sw} bodyW=${m.bw} h=${m.h}`,
      );

      await cdp.send("Target.closeTarget", { targetId });
    }

    ws.close();
  } finally {
    browser.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
