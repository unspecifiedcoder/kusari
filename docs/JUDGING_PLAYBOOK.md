# Kusari judging playbook

Use your own words. Lead with the working shared workspace; show the optional personal and session extensions only if asked. Mumbai's [judging session](https://ethglobal.com/events/mumbai/info/details) allows four minutes for the demonstration and three for questions. No presentation can guarantee selection.

## Before the session

- Open the canonical `/demo` at 100% browser zoom, with the wallet sidebar closed. Connect the owner wallet on Sepolia.
- Check fresh policy, authorization active, cap 5, sufficient remaining daily allowance and test funds, Nox route active, and no pending run.
- Find the existing fixed 2 kUSD success and rejection receipts. Keep the narrated video available if chain or model responses are slow.
- Locate **ENS policy demonstration**, **Freeze agent**, **Integration details** and **Two-agent isolation proof** before starting.
- Leave time to restore cap 5 and authorization after any owner action. Do not let a pending wallet confirmation overlap a different owner action.

## Four-minute presentation

### 0:00–0:30 — Explain the problem

Say: “What happens when an AI trading agent receives malicious instructions, or its key is stolen? Better prompts cannot stop a valid bad transaction. Kusari lets an agent propose trades while the owner keeps control of its funds and permissions.”

Point at the shared vault and policy. “The funds stay in this vault. The agent can request a trade, but cannot withdraw them. ENS holds the live permissions and limits. A Uniswap v4 hook checks execution.”

### 0:30–1:15 — Show a real model decision

Choose **Trade within limits**, sign the gas-free admission message, and run Gemini. Read the real decision, requested amount and resulting receipt. Do not promise a swap before the model actually proposes one.

Say: “This is a real Gemini response. The model makes the decision; the contract decides whether it may execute. Your wallet does not fund this shared test.”

While it runs, expand the enforcement details. “Agent RPC reads and transaction submissions go through Anon-RPC and Nox. The transaction itself remains public.”

### 1:15–2:15 — Demonstrate a live ENS policy change

Open **ENS policy demonstration**. Show the recorded fixed 2 kUSD success at cap 5, explicitly calling it recorded evidence. Change the cap to 1 with the owner wallet, wait for confirmation, then repeat the fixed 2 kUSD test.

Say: “The request is exactly the same: 2 kUSD. I changed an ENS resolver record from 5 to 1. I did not redeploy the hook or change application code. The new request now reverts onchain.”

Explain that the fixed comparison is deterministic; it does not call Gemini. Restore cap 5 and wait for confirmation.

### 2:15–3:15 — Show owner revocation

Freeze the shared agent and confirm the Sepolia transaction. Run the fixed 2 kUSD check at cap 5 while frozen, then inspect its receipt and separate simulation explanation.

Say: “This request is within the spending cap. It still fails because the owner revoked the agent's ENS role. Even a previously signed intent must pass the current permission check.”

Restore authorization and wait for confirmation. If confirmations consume the available time, show the clearly labelled recorded freeze, rejection and restore receipts instead of claiming a pending operation has finished.

### 3:15–3:40 — Show independent agents

Expand **Two-agent isolation proof**. Point to A's revoked role, A's reverted trade and B's successful trade.

Say: “This recorded test used two different owners, agent keys, ENS names and vaults. Freezing A did not stop B. These are actual receipts, not a simulated second agent.”

### 3:40–4:00 — Close with the useful difference

Say: “Kusari puts the boundary outside the model: owner-held funds, live ENS permissions, signed trade intents, and Uniswap checks on the actual output and pool price movement. A different agent can use the same contracts or the bounded trade API. We demonstrated it on Sepolia; production hardening is the next step.”

## Questions to rehearse

**Is this just a spending cap?** A cap is one check. The vault restricts the caller and pool, the hook checks signed identity, intent, nonce, deadline and current ENS authority, then checks actual output and pool price impact. Revoking the role blocks even an otherwise affordable trade. These checks do not guarantee a profitable trade.

**Who holds the keys?** Your owner key stays in your wallet. The funded shared demo's restricted agent key is held by Kusari's Fly runner. The personal beta generates and encrypts the agent key in the browser and signs locally; its full atomic browser walkthrough remains pending.

**Why ENS instead of a custom registry?** A custom registry could implement permissions too. ENSv2 gives us a public name, hierarchy, role delegation and owner-controlled resolver records in an existing system. Removing that integration from this deployment removes its live authorization and policy source.

**Does each agent have its own ENS role?** Yes. Authorization is scoped to its own label in the parent registry. Kusari uses exactly ENSv2's existing `ROLE_RENEW` (`65536`) as a narrow marker, and the hook checks it on each swap. It is not a native ENS trading role. Owners separately control resolver policy and vault withdrawals. A's revoked marker does not revoke B's role.

**Do you use ERC-8004 or ENSIP-25/26?** Not in this release. ERC-8004 provides agent identity/reputation/validation; ENSIP-25 links a name to a registry identity; ENSIP-26 advertises context and endpoints. Kusari uses ENSv2 access control and the ENSIP-24 data profile through ENSIP-10 for enforceable policy. Discovery can be added independently.

**Where are Alpha and Beta?** The shared live name is `alpha.kusari-pramod.eth`. The two-owner proof uses two generated subnames displayed in full. We do not present them as reusable literal Alpha/Beta accounts.

**Does Nox hide everything?** No. It routes the agent's RPC traffic. The hosted service and model see their inputs; the final RPC receives payloads and onchain transactions remain public. Request counters establish observed routing, not an anonymity proof.

**Can a compromised agent still lose funds?** Yes, within permitted trades. The original vault's per-trade/daily limits, pool restriction and revocation reduce authority; they do not supply a fair-price oracle or independent owner output floor. The separate session-vault beta adds a finite expiring allowance and owner floor, but live execution has not been rehearsed.

**Can I try it myself?** Yes: use the shared demo with a Sepolia wallet and sign an expiring admission message. No deposit, token approval or visitor-paid gas is needed. Only the ENS owner can change shared policy or freeze it.

**Is it production-ready?** It is a working testnet prototype with verified receipts and tests. Audits, durable abuse protection, recovery and broader onboarding acceptance remain work for a production release.

## Partner emphasis

- **ENS:** edit the record without redeployment; revoke current authority; show independent names, owners and resolver policies. Open the README's ENS standards table and source links if asked.
- **Uniswap:** show `beforeSwap` intent checks and `afterSwap` actual output/price movement checks, rollback behavior, contract line links and tests. Distinguish signed output minimum from the optional owner floor.
- **Ethereum Foundation:** show default anonymous routing, observed RPC methods and signed submissions, bridge reuse by ordinary RPC clients, and the explicit boundaries in CROPS.

Keep live results, recorded proof and beta plans clearly distinguished. If waiting threatens the four-minute slot, show an existing receipt and keep explaining; do not start another concurrent transaction.
