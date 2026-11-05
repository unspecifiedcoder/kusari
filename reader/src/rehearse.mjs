// Demo rehearsal: drives /demo like a presenter would and saves screenshots.
//   node src/rehearse.mjs <outPrefix> [url]
// Beat 1 the leak (Anon-RPC OFF then ON) · beat 2 normal trade · beat 3 hijack. Beat 4 (revoke) needs the owner wallet.
import { chromium } from "playwright";

const [prefix = "rehearsal", url = "http://localhost:3001/demo"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await page.goto(url, { waitUntil: "networkidle" });

const button = (name) => page.getByRole("button", { name });
const waitIdle = async () => {
  // live Sepolia cycles take ~20s (mixnet reads + tx confirmation)
  await button("Agent thinking…").waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  await button("Agent thinking…").waitFor({ state: "detached", timeout: 150_000 }).catch(() => {});
  await page.waitForTimeout(2500);
};
const run = async () => {
  await button("Run agent once").click();
  await waitIdle();
};

console.log("1a. Anon-RPC OFF: the provider sees everything");
await button("Anon-RPC: ON").click();
await page.waitForTimeout(800);
await run();
await page.screenshot({ path: `${prefix}-1-leak.png`, fullPage: true });

console.log("1b+2. Anon-RPC ON: nothing reaches the provider; normal trade");
await button("Anon-RPC: OFF (leaking)").click();
await page.waitForTimeout(800);
await run();

console.log("3. inject poisoned news + run");
await button("Inject poisoned news").click();
await page.waitForTimeout(500);
await run();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${prefix}-2-hijack.png`, fullPage: true });

await button("Poisoned news: ON").click().catch(() => {}); // reset
console.log("saved", `${prefix}-1-leak.png`, `${prefix}-2-hijack.png`);
await browser.close();
