// C1 pass test: eth_blockNumber on Sepolia through Anon-RPC (Nox), timed against a direct read.
//   npm run probe
import { startAnonBrowser } from "./browser.mjs";

const N = Number(process.env.PROBE_READS ?? 5);
const req = (id) => ({ jsonrpc: "2.0", id, method: "eth_blockNumber", params: [] });
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const ab = await startAnonBrowser();
console.log(`worker boot: ${ab.bootMs} ms ->`, ab.ready);

if (!ab.ready.ok) {
  console.log(ab.logs.slice(-20).join("\n"));
  await ab.close();
  process.exit(1);
}

const anon = [];
const direct = [];
for (let i = 1; i <= N; i++) {
  const a = await ab.anon(req(i));
  const d = await ab.direct(req(i));
  console.log(
    `read ${i}: anon ${a.ok ? a.ms + " ms -> block " + parseInt(a.body.result, 16) : "FAILED " + a.error}` +
      ` | direct ${d.ok ? d.ms + " ms" : "FAILED"}`,
  );
  if (a.ok) anon.push(a.ms);
  if (d.ok) direct.push(d.ms);
}

console.log(`\nmedian: anon ${anon.length ? median(anon) : "-"} ms, direct ${direct.length ? median(direct) : "-"} ms (${anon.length}/${N} anon reads ok)`);
if (process.env.PROBE_LOGS) console.log(ab.logs.join("\n"));
await ab.close();
process.exit(anon.length === N ? 0 : 1);
