// Dev tool: screenshot a page after letting live data stream in.
//   node src/screenshot.mjs <url> <out.png> [waitMs]
import { chromium } from "playwright";

const [url, out, waitMs = "8000"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(url, { waitUntil: "networkidle" });
console.log("READY");
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("saved", out);
