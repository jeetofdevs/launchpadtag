# LONGSHOT — Launch a token by tagging @longdotxyz

> **"One tweet. One token."**
> Launch a token on [Long.xyz](https://app.long.xyz/) straight from X (Twitter) with a single tweet that tags **@longdotxyz**. No website, no wallet connection needed to launch.

☁️ **Deploying?** Follow the [step-by-step Railway guide](DEPLOY-RAILWAY.md).

---

## 1. The idea

Long.xyz is a permissionless launchpad on Robinhood Chain where every token is paired with a **Robinhood Stock Token** (NVDA, AAPL, MSFT, GOOGL, TSLA, MU, SPCX).

**LONGSHOT** adds a new way in: **launch by tag**. A user tweets:

```
@longdotxyz launch $MOON "Moon Nvidia" paired $NVDA
```

The LONGSHOT bot reads the tweet, launches the token, and replies with the contract address and token link.

Why it works:
- **Viral by default** — every launch is a public tweet plus a bot reply, so distribution starts immediately.
- **Zero friction** — the meme and the token are born in the same thread.
- **Creator-first** — 80% of creator fees are credited to the X account that tagged, claimable at any time.

---

## 2. Command syntax

```
@longdotxyz launch $<TICKER> "<Token Name>" [paired $<STOCK>] [+ image]
```

| Part | Required | Notes |
|---|---|---|
| `@longdotxyz` | ✅ | Triggers the bot |
| `launch` | ✅ | Command keyword (aliases: `deploy`, `long`) |
| `$TICKER` | ✅ | 2–10 letters/digits |
| `"Token Name"` | ❌ | Defaults to the ticker |
| `paired $STOCK` | ❌ | One of `NVDA`, `AAPL`, `MSFT`, `GOOGL`, `TSLA`, `MU`, `SPCX`. Default: `NVDA` |
| Image in the tweet | ❌ | Becomes the token logo |

Examples:

```
@longdotxyz launch $ROBO "Robo Tesla" paired $TSLA   (+ photo)
@longdotxyz launch $APPLZ
@longdotxyz long $CHIP "Micron Degen" paired $MU
```

**Launch from a reply:** reply to any tweet with `@longdotxyz launch $TICKER` and the image of the original tweet is used as the logo, with the original tweet stored as the token's origin.

### Bot replies

Success:

```
✅ $ROBO "Robo Tesla" is LIVE on @longdotxyz
📈 Paired: $TSLA
📜 CA: 0x1234…abcd
🔗 https://app.long.xyz/tokens/0x1234…abcd
💰 80% of creator fees go to @username — claim: https://longshotpad.xyz/claim
```

Ticker taken:

```
❌ $SI reserved. Try again using another ticker.
```

---

## 3. Tokenomics

Every token launched with LONGSHOT gets the same fair, fixed setup:

| | |
|---|---|
| **Supply** | 1,000,000,000 — fixed, no minting |
| **Fair launch** | 100% of supply sold through the bonding curve |
| **Team / presale** | 0% / 0% — no insiders |
| **Liquidity** | Locked in the pool forever (no migration) |
| **Pair** | A real Robinhood Stock Token (NVDA, AAPL, MSFT, GOOGL, TSLA, MU, SPCX) |
| **Trading fee** | 1% per trade |

Where every trade's 1% fee goes:

| Recipient | Share of volume | Share of fee |
|---|---|---|
| **Deployer** (the X account that tagged) | 0.76% | 76% |
| LONGSHOT (bot operations) | 0.19% | 19% |
| Doppler protocol (launch infrastructure) | 0.05% | 5% |

Example: $10,000 of daily volume earns the deployer about $76 a day. The home page computes these numbers from the live config (`POOL_FEE`, `PROTOCOL_SHARE_BPS`).

---

## 4. Fees & claiming

### LONGSHOT Treasury

All launches and fee collection run from one operator wallet, the **LONGSHOT Treasury**:

1. **Launch** — the Treasury creates the token and is set as the pool's fee beneficiary.
2. **Collect** — the bot regularly collects the Treasury's fees from every LONGSHOT pool.
3. **Book** — every fee is recorded per token and per **X account ID** of the deployer (ID, not username, so renames are safe).
4. **Claim** — the deployer opens `/claim`, signs in with X, enters a wallet, and the Treasury sends **80%**. The remaining **20%** covers bot operations (gas, server, X API).

| Recipient | Share |
|---|---|
| Deployer (the X account that tagged) | 80% |
| LONGSHOT Treasury (operations) | 20% |

Pools pay fees in **both** pool assets — the Stock Token and the launched token — and both are split 80/20.

### Transparency

- The Treasury address is shown on the website.
- `/fees` is a public page listing, per token, total fees, the 80% deployer share, the 20% operations share, and every payout with its transaction hash.
- The claim page shows each deployer's totals, amounts already paid, and what is claimable.

### Treasury safety

- Use a dedicated hot wallet with a small balance; never a personal wallet.
- Set `MAX_PAYOUT_PER_CLAIM` to cap any single payout.
- Fee collection and payouts never run at the same time, so fee accounting stays exact.
- If a transaction is broadcast but not confirmed, the balance stays locked and the log shows `RECONCILE:` for manual review — it can never be paid twice.

---

## 5. Anti-spam & tickers

- **Account requirements:** at least 30 days old and 50 followers; protected accounts can't launch.
- **Rate limit:** 1 launch per account per 24 hours.
- **Reserved tickers (same rule as Long.xyz):** a ticker that has **ever** been launched — via LONGSHOT or directly on app.long.xyz — is refused with *"❌ $TICKER reserved. Try again using another ticker."* All 196 Robinhood stock symbols (AMZN, META, PLTR, …) are reserved too.
  - The bot indexes every `LaunchCreated` event from the Long.xyz launcher contract and reads each token's `symbol()`.
  - Before handling tweets it syncs to the latest block; if that fails, tweets are deferred to the next round and nothing is launched.
  - `TICKER_COOLDOWN_HOURS=0` (default) reserves forever; set e.g. `24` if Long.xyz releases tickers after a day.
- **Idempotent:** one tweet ID can produce at most one token.
- **Safety:** the bot never DMs first and never asks for seed phrases or private keys.

---

## 6. Running locally

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite`, no external database).

```bash
npm install
cp .env.example .env
npm run simulate   # full loop: tweet → launch → reply → fee collection → 80% claim
npm test           # parser, anti-spam, reserved tickers, 80/20 ledger, double-claim protection
npm start          # bot + fee collector + website on http://localhost:8787
```

The default `CHAIN_MODE=mock` uses a fake launchpad, so everything works without a wallet or X API keys.

### Code map

| File | Purpose |
|---|---|
| `src/parser.ts` | Parses `@longdotxyz launch $TICKER "Name" paired $STOCK` |
| `src/validate.ts` | Account checks, rate limit, reserved tickers |
| `src/stockSymbols.ts` | All Robinhood Stock Token symbols |
| `src/chain/tickers.ts` | Indexes Long.xyz launches to know which tickers are taken |
| `src/bot.ts` | Handles one tweet: validate → metadata → launch → reply |
| `src/x/client.ts` | X API: search for tags, reply from the bot account |
| `src/chain/onchain.ts` | Treasury transactions via the Doppler SDK: launch, collect fees, transfer |
| `src/chain/mock.ts` | Fake launchpad for development and tests |
| `src/harvester.ts` | Collects fees into the Treasury and books them 80/20 |
| `src/ledger.ts` | Fee and payout ledger with atomic reservations |
| `src/claim.ts` | Pays the deployer's 80% |
| `src/web/server.ts` | Website: home, `/claim`, `/fees`, `/healthz`, token metadata |

---

## 7. On-chain integration

Long.xyz runs on the **Doppler Protocol** on **Robinhood Chain (chain ID 4663)**. A Long.xyz launch is a Doppler multicurve pool paired with a Stock Token, and creator fees stream to **beneficiary** addresses fixed at launch — exactly the LONGSHOT Treasury model.

`src/chain/onchain.ts` uses the official `@whetstone-research/doppler-sdk`:

- **Launch:** multicurve pool paired with the chosen Stock Token, 1% pool fee, beneficiaries = Doppler protocol owner (5% minimum) + **LONGSHOT Treasury (95%)**, no migration so the pool stays locked and fees keep flowing.
- **Collect:** `collectFees()` from the Treasury; the amount booked is what actually arrived in the Treasury.

| Contract | Address |
|---|---|
| Long.xyz launcher | `0x22e99278308B393ea1260859B181AD7E78f5eeED` |
| Doppler Airlock | `0xeb7C034704eF8Dcd2D32324c1545f62fB4aD0862` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` |
| MU | `0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD` |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` |

> ⚠️ The official Long.xyz domain is **long.xyz** (`app.long.xyz`). Look-alike domains such as `longxyz.com` are not official — never connect the Treasury wallet to them.

### Open items

1. **Listing on app.long.xyz.** Tokens launched directly through Doppler use the same infrastructure, but the Long.xyz feed is built from its launcher contract. If tokens must appear there, launching must go through that contract (its ABI is not public yet). Only the launch function would change; fee collection stays the same.
2. **Curve parameters** use the SDK's market-cap presets; tune them to match Long.xyz if needed.
3. **Test with small amounts first.** Addresses come from public sources and have not been exercised end-to-end yet.

---

## 8. Branding

- **Name:** LONGSHOT
- **Website:** https://longshotpad.xyz
- **X:** [@longshotpadxyz](https://x.com/longshotpadxyz)
- **Tagline:** "Take a shot on Long." / "One tweet. One token."
- **Hashtag:** `#LongShot`
- **Launch tweet:** "No website needed. Tag @longdotxyz with a $TICKER and your token goes live, paired with a real stock. One tweet. One token. 🟢 #LongShot"
