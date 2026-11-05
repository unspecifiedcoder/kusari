// Launches headless Chromium with the Anon-RPC page. Shared by the probe (C1) and the bridge (C2).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

export const SEPOLIA_RPC = process.env.AGENT_UPSTREAM_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
export const NOX_SPECIFIER = "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";

/** Serve dist/ on 127.0.0.1 (random port), open it in headless Chromium, wait for the worker. */
export async function startAnonBrowser({ upstream = SEPOLIA_RPC, bootstrap = SEPOLIA_RPC, specifier = NOX_SPECIFIER } = {}) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const file = path === "/" ? "index.html" : path.slice(1);
    try {
      const body = await readFile(DIST + file);
      res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  // Same flags as the anon-rpc repo's own e2e test (WebRTC is how the harness reaches the mixnet).
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-features=WebRtcHideLocalIpsWithMdns", "--force-webrtc-ip-handling-policy=default"],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`[page:${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[page:error] ${e.message}`));

  const qs = new URLSearchParams({ upstream, bootstrap, specifier });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/?${qs}`);
  const ready = await page.evaluate(() => window.anonReady);
  const bootMs = Date.now() - t0;

  return {
    ready,
    bootMs,
    logs,
    anon: (body) => page.evaluate((b) => window.anonRpc(b), body),
    direct: (body) => page.evaluate((b) => window.directRpc(b), body),
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}
