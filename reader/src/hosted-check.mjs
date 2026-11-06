// Dev check: open the app under a fake public hostname to see what a hosted (e.g. Vercel) visitor gets.
//   node src/hosted-check.mjs <outPrefix>
import { chromium } from "playwright";

const [prefix = "hosted", port = "3002"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP kusari.test 127.0.0.1"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const path of ["/demo", "/"]) {
  await page.goto(`http://kusari.test:${port}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const text = await page.locator("body").innerText();
  console.log(`${path}: hosted notice=${text.includes("runs on the team")} badge="${text.match(/reads: [^\n]+/)?.[0] ?? "none"}"`);
  await page.screenshot({ path: `${prefix}${path === "/" ? "-home" : "-demo"}.png`, fullPage: true });
}
await browser.close();
