// Demo rehearsal: drives /demo like a presenter would and saves a screenshot.
//   node src/rehearse.mjs <out.png> [url]
import { chromium } from "playwright";

const [out = "rehearsal.png", url = "http://localhost:3001/demo"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1300 } });
await page.goto(url, { waitUntil: "networkidle" });

const waitIdle = async () => {
  await page.getByRole("button", { name: "Agent thinking…" }).waitFor({ state: "detached", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);
};

console.log("1. normal cycle");
await page.getByRole("button", { name: "Run agent once" }).click();
await page.waitForTimeout(1000);
await waitIdle();

console.log("2. inject poisoned news + run");
await page.getByRole("button", { name: "Inject poisoned news" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Run agent once" }).click();
await page.waitForTimeout(1000);
await waitIdle();
await page.waitForTimeout(6000);

await page.screenshot({ path: out, fullPage: true });
console.log("saved", out);
await page.getByRole("button", { name: "Poisoned news: ON" }).click().catch(() => {}); // reset
await browser.close();
