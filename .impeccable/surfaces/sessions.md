# Bounded sessions · Beta

MODE: Operate

THESIS: The owner can see and explicitly approve a finite session budget, expiry and minimum output rate without confusing this experimental vault with the existing shared demo.

OWN-WORLD: Extend the established charcoal product workspace, Instrument Sans, soft mint task actions and compact policy context. This is an owner-control surface, not a new visual identity.

STORY: Discover a real session vault from the separate manifest or owner-indexed session factory; inspect the onchain owner and session bounds; choose budget, duration and minimum rate; optionally copy a suggested floor from the live pool reference; review all three bounds; confirm one owner transaction on Sepolia; inspect actual session swap events when an integration runner executes them.

## Structure and states

The first viewport names the feature Beta and links prominently to the main demo. A persistent notice states that the existing shared and personal policy vaults do not gain this separate session protection. A missing manifest produces a truthful undeployed state, without a working-looking approval or execution button.

At desktop widths, the approval task is beside compact actual session state. Narrow widths preserve task-first reading order. Native labels and explicit kUSD/kETH units accompany each input. The proposed budget, duration and output floor are repeated together before approval; replacing a session is named as replacement. The live reference is a spot calculation using the observed LP fee, not a guaranteed execution quote. Using its 2% margin requires an explicit owner action.

Budget and rate accept exact decimal values up to 18 places without silent rounding. Duration is from one minute to 30 days. A fresh chain timestamp determines expiry. Wallet/account/network/origin checks and an estimated gas-balance check precede the owner transaction. Cancelled, reverted and confirmed transactions remain distinct.

The actual session view shows remaining budget, expiry, output floor, session ID, token balances, owner, restricted agent and vault. The inspected chain timestamp determines expiry status; the browser clock is not treated as authorization evidence. Full requested input consumes session budget even on a partial fill; actual input and output determine the minimum-rate check.

## Execution and evidence boundaries

This surface does not run Gemini or expose a web agent-swap button. A separate runner must sign an intent and call the session vault. No private-key or passphrase input is added. Browser contract reads do not imply Nox routing.

Actual output evidence comes only from this vault's SessionSwap events, with requested input, actual input, actual output, remaining budget and the real transaction link. Empty or failed event reads are stated explicitly; a balance change is not fabricated into a swap result.

## Verification ownership

The release owner controls deployment and runtime acceptance. Source-only checks and helper tests do not establish a deployed vault, browser approval or successful session swap. Keep this feature separate from the existing main demo's verified evidence.
