# LONGSHOT: One Tweet. One Token.

*Launch a stock-paired token on Long.xyz by tagging a bot on X, and earn 80% of every trading fee it makes.*

---

## TL;DR

- Tweet **`@longshotpadxyz launch $TICKER "Name" paired $NVDA`** and LONGSHOT launches your token on Long.xyz, paired with a real tokenized stock on Robinhood Chain.
- **No website, no wallet, no gas** needed to launch. LONGSHOT pays the gas.
- **You earn 80% of every trading fee** your token generates, forever. Claim anytime at **longshotpad.xyz** by signing in with X.
- **Fair by design:** 1,000,000,000 fixed supply, 100% sold through the curve, 0% team, 0% presale, liquidity locked.
- **72 markets** to pair with: NVDA, TSLA, AAPL, SPY, QQQ, GLD and more.

---

## The problem

Launching a token today still asks a lot of the person with the idea:

- Open a launchpad, connect a wallet, bridge funds, pay gas.
- Fill in a form, upload a logo, write a description.
- Then go back to X to tell people it exists.

The idea is born on X, but the launch happens somewhere else. By the time the token is live, the moment has often passed.

## The idea: launch where the idea is born

**LONGSHOT turns a tweet into a token.**

You tag **@longshotpadxyz** with a ticker. The bot reads the tweet, launches the token on **Long.xyz** (the launchpad on Robinhood Chain where every token is paired with a real tokenized stock), and replies in the same thread with the contract address.

The meme and the token are born in the same place, at the same moment, in public.

---

## How it works

### 1. Tweet it

```
@longshotpadxyz launch $MOON "Moon Nvidia" paired $NVDA
```

| Part | Required | What it does |
|---|---|---|
| `@longshotpadxyz` | ✅ | Wakes up the bot |
| `launch $TICKER` | ✅ | Your ticker: letters only, 2–10 characters |
| `"Token Name"` | Optional | Defaults to the ticker |
| `paired $STOCK` | Optional | Any of 72 markets (default: $NVDA) |
| `fees @user` | Optional | Send the creator fees to another X account |
| An image | Optional | Becomes the token logo |

You can also write `deploy` or `long` instead of `launch`.

### 2. The bot launches it

LONGSHOT checks your tweet, launches the token through **Long.xyz's own launcher** on Robinhood Chain, and replies:

```
✅ $MOON "Moon Nvidia" is LIVE on Long.xyz
📈 Paired: $NVDA
📜 CA: 0x1234…1e18
🔗 https://app.long.xyz/tokens/0x…
💰 @you earns 80% of every trading fee — claim: https://longshotpad.xyz/claim
```

The token's X link points to your launch tweet, and its website is the token page on longshotpad.xyz.

### 3. Earn, and claim anytime

Every trade pays a 1% fee. **80% of that fee is yours.** Sign in at **longshotpad.xyz/claim** with the X account you tweeted from, paste any EVM wallet, and claim.

---

## Tokenomics: the same fair setup for every launch

| | |
|---|---|
| **Total supply** | 1,000,000,000, fixed, no minting |
| **Fair launch** | 100% of supply sold through the bonding curve |
| **Team / presale** | 0% / 0%, no insiders |
| **Liquidity** | Locked in the pool, no migration |
| **Pair** | A real tokenized stock, ETF or Long.xyz market |
| **Trading fee** | 1% per trade |

### Where every trade's fee goes

| Recipient | Share of the 1% fee | Per $100 traded |
|---|---|---|
| **You (the X account that tagged)** | **80%** | $0.80 |
| LONGSHOT | 20% | $0.20 |

Long.xyz's own protocol cut is paid **out of LONGSHOT's 20%**, so your 80% is never reduced.

Fees are paid in both sides of the pool (the paired stock token and your own token), and you get 80% of both.

---

## Features

### 🎯 Launch by tag
One tweet, one token. No website visit, no wallet connection, no gas.

### 📈 72 stock-paired markets
Pair your token with the market that fits the meme:

- **Big Tech:** NVDA, AAPL, MSFT, GOOGL, AMZN, META, TSLA
- **Visionaries and New:** SPCX, PLTR, COIN
- **ETFs:** SPY, QQQ, GLD, SLV
- **Long.xyz tokens:** $AI, $NVDAx3L, $ANTHROPICx1L, $OPENAIx1L
- …and many more at **longshotpad.xyz/stocks**

### 💰 80% creator rewards
The biggest share goes to the person with the idea, not the platform.

### 🔥 Claim & burn supply
The claim page has two buttons:

- **Claim fees:** every reward goes to your wallet.
- **Claim & burn supply:** your stock rewards go to your wallet, and the rewards paid in **your own token** are sent to the burn address and destroyed forever. That shrinks your token's supply, publicly and on-chain.

### 🎁 Send fees
Want the rewards to go to someone else, a friend, a charity or an AI agent? Add `fees @username` to your launch tweet:

```
@longshotpadxyz launch $GIFT "For Bob" paired $NVDA fees @bob
```

@bob receives the 80% creator share and claims it with their own X login. The receiver is shown on the token page for everyone to see.

### 🔍 Full transparency
- The **Transparency** page (longshotpad.xyz/fees) lists every fee collected per token, and every payout and burn with its on-chain transaction.
- The Treasury address is public.
- Home page counters show rewards **claimed**, **unclaimed** and **burned** across the whole platform.

### 🛡️ Fair ticker rules
- LONGSHOT follows Long.xyz's rules: a ticker already launched recently on Long.xyz or via LONGSHOT is **reserved**, and the bot replies `❌ $TICKER reserved. Try again using another ticker.`
- Real stock symbols ($AAPL, $TSLA, …) can never be used as tickers.
- Basic anti-spam checks and a per-account daily launch limit keep the feed clean.

---

## Why Robinhood Chain and Long.xyz?

Long.xyz lets anyone launch a token that trades against a **tokenized stock** on Robinhood Chain, instead of against ETH or a stablecoin. That makes every token a statement: *"this meme rides with NVDA"*, *"this one bets on SpaceX"*.

LONGSHOT is the fastest way in: from a tweet to a live, stock-paired token in about a minute.

---

## Safety first

- **LONGSHOT never DMs first** and will never ask for your seed phrase or private key. Anyone who does is a scammer.
- The only official account is **@longshotpadxyz**. The only official website is **longshotpad.xyz**.
- Claiming only needs your X login and a wallet **address**, never a signature or a key.
- Launches are simulated on-chain before they're sent, and every payout is recorded publicly.

---

## FAQ

**Is LONGSHOT part of Long.xyz?**
No. LONGSHOT is an independent project built on the same launch infrastructure. It is not affiliated with Long.xyz or Robinhood.

**What does it cost to launch?**
Nothing. LONGSHOT pays the gas, funded by its 20% share of trading fees.

**How do I claim?**
Go to longshotpad.xyz/claim, sign in with the X account you tweeted from, paste any EVM wallet and press **Claim fees** (or **Claim & burn supply**).

**Why was my ticker "reserved"?**
Someone launched it recently on Long.xyz or via LONGSHOT, or it's a real stock symbol. Pick another ticker, or try again once it's free.

**Can I use numbers in my ticker?**
No. Long.xyz only accepts letters (A–Z).

**Can I send my rewards to someone else?**
Yes. Add `fees @username` to your launch tweet.

---

## Take your shot

```
@longshotpadxyz launch $TICKER "Your Token" paired $NVDA
```

🌐 **longshotpad.xyz**
🐦 **@longshotpadxyz**

*One tweet. One token. Take a shot on Long.* 🟢

---

*Memecoins are highly speculative and can lose all their value. Nothing here is financial advice. LONGSHOT is independent and not affiliated with Long.xyz or Robinhood.*
