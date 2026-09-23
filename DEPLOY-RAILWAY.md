# Deploying LONGSHOT on Railway — Step by Step

This guide has two stages:

- **Stage 1 — Test mode (no real money).** The LONGSHOT website goes online, but tokens and fees are simulated. The goal is to confirm the server runs.
- **Stage 2 — Live mode.** The bot reads real tweets and launches real tokens on Robinhood Chain.

Finish Stage 1 before moving to Stage 2.

---

## Stage 1 — Online in test mode

### Step 1. Create a Railway account

1. Go to **https://railway.com** and click **Login**.
2. Choose **Login with GitHub**, using the account that owns this repository.
3. For a server that runs 24/7, choose the **Hobby** plan (about $5/month) under **Account → Plans**.

### Step 2. Create a project from the repository

1. In the Railway dashboard, click **New Project**.
2. Choose **Deploy from GitHub repo**.
3. If asked, click **Configure GitHub App** and give Railway access to **this repository only**.
4. Select the repository.
5. Railway reads the `Dockerfile` and `railway.json` in the repository automatically; no build settings are needed.

> If Railway asks for a branch, pick the branch that contains LONGSHOT.

The very first deploy may fail. That is expected until the Variables are set (Step 4).

### Step 3. Add a Volume (persistent storage)

Without a Volume, all data (launched tokens, fee records) is **lost on every restart**.

1. Open the project canvas.
2. Click **+ Create** (or right-click the canvas) and choose **Volume**.
3. Attach it to the LONGSHOT service.
4. Set **Mount path** to: `/data`

### Step 4. Set the Variables

1. Click the LONGSHOT service and open the **Variables** tab.
2. Click **Raw Editor** and paste:

```
PORT=8787
CHAIN_MODE=mock
X_ENABLED=false
ALLOW_DEV_LOGIN=true
DB_PATH=/data/longshot.db
SESSION_SECRET=REPLACE_WITH_A_LONG_RANDOM_STRING
```

3. Replace `REPLACE_WITH_A_LONG_RANDOM_STRING` with at least 32 random letters and digits (for example from https://www.random.org/strings/). **Never share it.** If you leave `SESSION_SECRET` out, LONGSHOT generates one and stores it on the Volume.
4. Click **Update Variables**. Railway redeploys automatically.

### Step 5. Create a public address

1. In the LONGSHOT service, open the **Settings** tab.
2. Under **Networking**, click **Generate Domain**.
3. If asked for a port, enter **8787**.
4. You get an address like `longshot-production.up.railway.app`.

### Step 6. Check it works

1. Open `https://YOUR-ADDRESS.up.railway.app/healthz`. If you see `{"ok":true,...}`, **the server is running**. 🎉
2. Open `https://YOUR-ADDRESS.up.railway.app/` to see the LONGSHOT website.
3. If something is wrong, open **Deployments**, click the latest deploy, then **View Logs**. Lines starting with `FATAL:` explain exactly what to fix.

### Step 7. Connect takealongshot.xyz

1. In the LONGSHOT service, open **Settings → Networking → Custom Domain**.
2. Enter `takealongshot.xyz`, port **8787**, and click **Add**.
3. Railway shows the DNS record(s) to create — usually a **CNAME** (and sometimes a **TXT** record for verification). Copy the exact values Railway shows.
4. Log in where you bought the domain and open its **DNS settings**. Add the records exactly as Railway shows them:
   - For the root domain (`takealongshot.xyz`, often written as `@`), use **CNAME** if your registrar allows it on the root, otherwise **ALIAS/ANAME**. If your registrar supports neither, move the domain's DNS to **Cloudflare** (free), which supports this.
   - If you use Cloudflare, set the record to **DNS only** (grey cloud) until Railway shows the domain as verified.
5. Repeat steps 2–4 for `www.takealongshot.xyz` — LONGSHOT automatically redirects `www` to the main domain.
6. Wait until Railway shows a green check next to the domain (a few minutes, sometimes up to an hour). Railway sets up HTTPS automatically.
7. In **Variables**, add:

```
PUBLIC_URL=https://takealongshot.xyz
```

8. Open **https://takealongshot.xyz/healthz** — you should see `{"ok":true,...}`.

✅ **Stage 1 done.** In this mode no tweets are read and no real tokens are created.

---

## Stage 2 — Live mode

⚠️ From here on the bot uses **real money**. Prepare these first.

### A. LONGSHOT Treasury wallet

1. In MetaMask, create a **new account** just for the bot. Never use a personal wallet.
2. Add the **Robinhood Chain** network:
   - Network name: `Robinhood Chain`
   - RPC URL: `https://rpc.mainnet.chain.robinhood.com`
   - Chain ID: `4663`
   - Currency symbol: `ETH`
   - Block explorer: `https://robinhoodchain.blockscout.com`
3. Send a **small amount of ETH** to this wallet for gas.
4. Export the private key: MetaMask → ⋮ → **Account details → Show private key**.
   - Paste it **only** into Railway Variables (step D). **Never send it in any chat, email, or message.** If a key has ever been shared, treat that wallet as test-only.

### B. X account for the bot

1. Create a new X account for the bot, e.g. `@longshotbot`.
2. Sign in with it at **https://developer.x.com** and register as a developer.
3. Choose a plan that includes **search** (Basic or higher; the free plan is not enough).
4. Create a **Project** and an **App**, and note:
   - **Bearer Token**
   - **API Key** and **API Key Secret**
   - **Access Token** and **Access Token Secret** — permissions must be **Read and Write** so the bot can reply.
5. In the App's **User authentication settings**, enable **OAuth 2.0**:
   - Type of App: **Web App**
   - Callback URL: `https://takealongshot.xyz/auth/x/callback`
   - Website URL: `https://takealongshot.xyz`
   - Note the **Client ID** and **Client Secret**.

### C. Permission from Long.xyz (strongly recommended)

DM **@longdotxyz** and ask whether they are fine with the LONGSHOT bot and whether bot-launched tokens can be listed on app.long.xyz.

### D. Switch Railway to live mode

Open **Variables** → **Raw Editor** and replace the contents with (fill in the blanks):

```
PORT=8787
PUBLIC_URL=https://takealongshot.xyz
CHAIN_MODE=onchain
DB_PATH=/data/longshot.db
SESSION_SECRET=same-random-string-as-stage-1

TREASURY_PRIVATE_KEY=
MAX_PAYOUT_PER_CLAIM=0

X_ENABLED=true
TRIGGER_HANDLE=longdotxyz
X_BEARER_TOKEN=
X_APP_KEY=
X_APP_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
X_OAUTH_CLIENT_ID=
X_OAUTH_CLIENT_SECRET=
```

Remove `ALLOW_DEV_LOGIN` if it is still there. Click **Update Variables**.

> **First start in live mode:** the bot reads the full history of Long.xyz launches to learn which tickers are *reserved*. This can take a few minutes; the logs show `ticker index: backfilling…` and progress. Launch tweets are deferred (not lost) until it finishes.

Check the logs for `LONGSHOT starting — chain=onchain, treasury=0x…`. The Treasury address must match your MetaMask wallet.

### E. Small test before announcing

1. From your **personal** X account, tweet: `@longdotxyz launch $TESTLS "Test Longshot" paired $NVDA`
2. Within about a minute the bot should reply with the contract address.
3. Buy a small amount of the token so it earns fees.
4. Wait about 15 minutes (fees are collected periodically).
5. Open `https://takealongshot.xyz/claim`, sign in with X, enter your personal wallet, and click **Claim now**.
6. Check your personal wallet: 80% of the fees should arrive.
7. Tweet `@longdotxyz launch $SI` — the bot should reply `❌ $SI reserved. Try again using another ticker.`

If all of this works, LONGSHOT is ready to announce. 🚀

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Deploy shows **Crashed** | Open **View Logs** and look for a line starting with `FATAL:` — it names the setting to fix. |
| takealongshot.xyz does not load | DNS not set up yet or still propagating — check Railway shows a green check next to the domain (Step 7). The `…up.railway.app` address keeps working meanwhile. |
| "Sign in with X" fails with a callback error | The Callback URL in the X developer portal must be exactly `https://takealongshot.xyz/auth/x/callback`, and `PUBLIC_URL` must be `https://takealongshot.xyz`. |
| `/healthz` does not load | No domain yet (Step 5), or the deploy failed — check the logs. |
| `FATAL: TREASURY_PRIVATE_KEY is missing/invalid` | Key missing or mis-copied (64 hex characters, with or without `0x`). |
| Data disappears after a restart | The Volume is not mounted at `/data` (Step 3). |
| Bot does not reply to tweets | `X_ENABLED` is not `true`, the X plan lacks search access, or the App is not *Read and Write*. |
| Bot replies `reserved` | The ticker was already launched (via LONGSHOT or on app.long.xyz) or is a Robinhood stock symbol. |
| Repeated `ticker-sync error` | The Robinhood Chain RPC is having trouble; launches wait until ticker checks succeed again. |
| `RECONCILE:` in the logs | A transaction was sent but not confirmed. The user's balance stays locked so it can't be paid twice; verify the transaction on the explorer. |
