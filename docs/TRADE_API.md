# Shared demo trade API

An external agent can request a guarded Sepolia swap without creating a personal workspace. The browser demo remains the main experience at [Try the demo](https://kusari.outcomeseal.com/demo). This API accepts an external caller's trade decision; it does not claim that Gemini made that decision. The browser's normal/poisoned-news scenarios still use real Gemini.

## Custody and permissions

The **shared workspace's agent private key is held by Kusari's Fly runner**. The runner signs for the configured demo agent and vault only. Vault funds remain subject to the Uniswap v4 hook and live ENS policy. The owner alone can revoke/restore the ENS role, edit policy or withdraw vault funds. The API exposes none of those owner operations.

The demo API bearer key is a separate, low-privilege credential. It is not the agent private key or the private Vercel-to-Fly gateway credential. Obtain it from the presenter and keep it in your environment. For local development, set `KUSARI_DEMO_API_KEY` in the ignored `.env`; it is also a Fly runtime secret. Never commit its value. No API credential is required to inspect the public UI or recorded receipts.

## Request a trade

```bash
curl --fail-with-body https://kusari.outcomeseal.com/v1/trade \
  -H "Authorization: Bearer $KUSARI_DEMO_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"amountIn":"1.0","reason":"My agent requested a test trade"}'
```

Example acceptance (a job ID is not a completed transaction):

```json
{"requestId":"3154c484-b2a9-40b3-8751-0fe903804b11","status":"accepted"}
```

| Field | Meaning |
| --- | --- |
| `amountIn` | Required decimal string, greater than zero and at most **1 kUSD**, up to 18 decimal places. |
| `reason` | Optional text up to 280 characters. Displayed as the caller's explanation; never treated as trusted model instructions. |
| `minAmountOut` | Optional unsigned integer string in kETH base units (18 decimals), at most uint128. It can only tighten the runner's calculated minimum, never remove its output protection. |

The default minimum output is calculated from the observed pool price, allowing the configured 0.3% pool fee and 3% slippage margin. The exact input amount is preserved in wei. Unknown fields—including wallet, vault, contract, network, key or RPC overrides—are rejected. Requests have a small bounded JSON body.

Both `/v1/trade` and `/api/v1/trade` are supported on the canonical hostname. External clients do not need a browser `Origin` header. Deployment aliases do not accept trade requests.

## Inspect the result

```bash
curl --fail-with-body \
  https://kusari.outcomeseal.com/v1/trade/3154c484-b2a9-40b3-8751-0fe903804b11 \
  -H "Authorization: Bearer $KUSARI_DEMO_API_KEY"
```

```json
{
  "requestId":"3154c484-b2a9-40b3-8751-0fe903804b11",
  "status":"success",
  "amountIn":"1",
  "hash":"0x736d1bbdcc78ae9d2e26105f15f760b5b02a5a35eb67d56811127f5a6c68556e",
  "route":"Anon-RPC / Nox",
  "chainId":11155111,
  "source":"external-agent"
}
```

Poll a known request ID every few seconds. `accepted`, `running` and `pending` are not final receipts. `success` and `reverted` describe confirmed receipts. A `preflightReason`, when available, is the simulation's prediction and is separate from the receipt. `error` without a hash does not claim a completed swap.

If a POST times out or returns an ambiguous service error, do not automatically submit it again: execution may already have started. Inspect any known request ID, transaction hash or shared activity first. Retrying GET is safe. A temporary GET failure does not mean the transaction failed.

## Bounds and transport

- Sepolia only; existing shared agent, vault, hook and pool only.
- Maximum 1 kUSD per API request is a **service admission limit**. The hook independently enforces the owner's actual ENS limits and revocation against signed trades.
- API and browser runs share the same admission budget: 20 accepted requests/hour, 40/day, a 10-second global cooldown and 30-second caller cooldown. All external API callers share the API caller bucket. Accepted failures still consume admission budget.
- The runtime's shared busy lock prevents overlapping browser/API execution. `409` means busy; `429` means cooldown/capacity, with retry information where available. Invalid keys return `401`; invalid or over-limit input returns `400`.
- Agent chain reads, simulation, signing submission and receipt reads require the configured Anon-RPC route with the bridge observed in anonymous mode. Signatures are created by the runner before network submission. Public transaction data is still visible; the route label is not cryptographic anonymity proof.
- The API does not grant any new allowance to the shared agent and cannot change ENS policy, revoke roles, withdraw funds, select arbitrary contracts or change transport.
- Job storage is bounded and in memory for up to one hour. A Fly restart clears jobs and admission counters. Receipts remain public and can be inspected independently by hash.

## Verified release

The public hosted API passed on 7 November 2026 IST: wrong key `401`, above-cap amount and unknown field `400`, accepted request `202`, immediate repeat `429`, and an independently verified successful **1 kUSD** Sepolia transaction. The shared demo remained fresh, idle, authorized and routed through Nox afterward.

[Receipt](https://sepolia.etherscan.io/tx/0x736d1bbdcc78ae9d2e26105f15f760b5b02a5a35eb67d56811127f5a6c68556e) · [Public evidence](evidence/trade-api.json) · [Rehearsal script](../scripts/rehearse-trade-api.mjs)

For an agent that signs with its **own** key and calls its own vault directly, use [Bring your own agent](BRING_YOUR_OWN_AGENT.md). That path does not use the shared hosted signer.
