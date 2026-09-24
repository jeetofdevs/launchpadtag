import { readFileSync } from "node:fs";
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Tagged template that escapes interpolations unless they are `raw()`. */
export class Raw {
  constructor(readonly html: string) {}
  toString() {
    return this.html;
  }
}
export const raw = (s: string) => new Raw(s);

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.html : esc(x))).join("") : v instanceof Raw ? v.html : esc(v);
    out += part + strings[i + 1];
  });
  return raw(out);
}

const CSS = `
:root{--bg:#04130b;--panel:#0a2217;--panel-2:#0e2c1e;--line:#17402c;--text:#e4f7ec;--muted:#8db8a1;--accent:#35f28a;--accent-ink:#022012;--accent-2:#1d8f55;--accent-3:#2c5a43;--burn:#ff7a3d;--burn-ink:#1c0a00;--danger:#ff6b6b;--warn:#ffc857;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);background-image:radial-gradient(1200px 600px at 80% -10%,rgba(53,242,138,.12),transparent 60%),radial-gradient(900px 500px at -10% 30%,rgba(29,143,85,.14),transparent 60%);background-attachment:fixed;color:var(--text);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:1240px;margin:0 auto;padding:0 32px}
@media (max-width:640px){.wrap{padding:0 16px}}
header{border-bottom:1px solid var(--line);background:rgba(4,19,11,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:sticky;top:0;z-index:20}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:60px}
.logo{font-weight:800;letter-spacing:.08em;color:var(--text);text-decoration:none;display:inline-flex;align-items:center}
.logo .mark{width:26px;height:26px;flex:none;margin-right:8px}
.logo span{color:var(--accent)}
.nav-main{display:flex;gap:22px;margin-left:28px;margin-right:auto}
.nav-main a,.icon-link{color:var(--muted);text-decoration:none;font-size:14px}
.nav-main a:hover,.icon-link:hover{color:var(--text)}
.nav-right{display:flex;align-items:center;gap:12px}
.icon-link{font-size:17px}
.btn.sm{padding:8px 14px;font-size:14px;border-radius:9px}
.menu{display:none;position:relative}
.menu summary{list-style:none;cursor:pointer;font-size:20px;color:var(--text);padding:2px 4px}
.menu summary::-webkit-details-marker{display:none}
.menu-panel{position:absolute;right:0;top:36px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px;display:flex;flex-direction:column;min-width:190px;z-index:10;box-shadow:0 12px 30px rgba(0,0,0,.25)}
.menu-panel a{color:var(--text);text-decoration:none;padding:10px 12px;border-radius:8px}
.menu-panel a:hover{background:var(--panel-2)}
@media (max-width:760px){.nav-main{display:none}.menu{display:block}.nav-right{margin-left:auto}}
main{padding:32px 0 64px}
h1{font-size:clamp(32px,6vw,52px);line-height:1.05;margin:8px 0 12px;letter-spacing:-.02em}
h2{font-size:20px;margin:32px 0 12px}
.lead{color:var(--muted);font-size:19px;max-width:700px}
.tag{display:inline-block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto;font-size:14px;white-space:pre-wrap;word-break:break-word}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.stat b{display:block;font-size:26px}
.stat small{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
input[type=text],input[type=search]{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;font-family:ui-monospace,monospace;font-size:14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.muted{color:var(--muted)}
.ok{color:var(--accent)}.err{color:var(--danger)}.warn{color:var(--warn)}
.mono{font-family:ui-monospace,monospace;word-break:break-all}
ol.steps{padding-left:20px}ol.steps li{margin:8px 0}
.hero{padding:8px 0 20px}
.hero .row{margin:20px 0}
h3{font-size:16px;margin:24px 0 10px}
.tk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
@media (max-width:640px){.tk-grid{grid-template-columns:repeat(2,1fr)}}
.tk{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.tk b{display:block;font-size:22px;letter-spacing:-.01em}
.tk small{color:var(--muted)}
.split{display:flex;gap:2px;height:16px;border-radius:8px;overflow:hidden;margin:8px 0 12px}
.split.big{height:34px;border-radius:10px}
.split.big .seg{display:flex;align-items:center;padding:0 10px;font-size:13px;font-weight:700;color:var(--accent-ink);white-space:nowrap;overflow:hidden}
.split.big .seg.s2{color:var(--text)}
.reward{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px}
.reward-big{display:flex;gap:14px;align-items:center;margin-bottom:12px}
.reward-big b{font-size:clamp(40px,9vw,64px);line-height:1;color:var(--accent);letter-spacing:-.03em}
.reward-big span{font-size:17px}
.rewards-now{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.rn{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
.rn small{display:block;color:var(--muted);margin-bottom:6px}
.rn b{display:block;font-size:24px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.rn:nth-child(2) b{color:var(--accent)}
.rn.burn b{color:var(--burn)}
.rn small + small, .rn b + small{margin-top:4px}
.nowrap{white-space:nowrap;word-break:normal}
.burn-tag{font-size:12px;color:var(--burn);white-space:nowrap}
.btn.burn-btn{background:var(--burn);color:var(--burn-ink)}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.claim-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
@media (max-width:640px){.claim-options{grid-template-columns:1fr}}
.opt{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:6px}
.opt b{font-size:17px}
.opt p{margin:0 0 8px;color:var(--muted);font-size:14px}
.opt .btn{align-self:flex-start;margin-top:auto}
.opt.burn{border-color:color-mix(in srgb,var(--burn) 45%,var(--line))}
@media (max-width:760px){.rewards-now{grid-template-columns:1fr}}
.small{font-size:12px}
.seg{display:block;min-width:4px}
.s1{background:var(--accent)}.s2{background:var(--accent-2)}.s3{background:var(--accent-3)}
.legend{list-style:none;padding:0;margin:0 0 12px}
.legend li{margin:8px 0;padding-left:18px;position:relative}
.dot{position:absolute;left:0;top:.45em;width:10px;height:10px;border-radius:3px}
@media (max-width:480px){.logo{letter-spacing:.04em}}
code{overflow-wrap:anywhere}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px;padding:36px 0 28px;margin-top:40px}
.foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:24px}
.foot-grid b{display:block;color:var(--text);margin-bottom:8px;font-size:13px}
.foot-grid a:not(.logo){display:block;color:var(--muted);text-decoration:none;margin:6px 0}
.foot-grid a:hover{color:var(--text)}
.foot-grid p{margin:10px 0 0}
.fine{margin-top:28px;font-size:12px;line-height:1.6}
@media (max-width:760px){.foot-grid{grid-template-columns:1fr 1fr}.foot-grid>div:first-child{grid-column:1/-1}}

/* ── Home ── */
.hero2{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;padding:24px 0 12px}
.hero2 h1{font-size:clamp(40px,7vw,68px)}
.hero2 .row{margin:22px 0 10px}
.feesto{display:inline-block;margin-top:8px;border:1px solid var(--accent-2);background:rgba(53,242,138,.08);color:var(--text);border-radius:999px;padding:4px 12px;font-size:14px}
.official{display:grid;grid-template-columns:1fr 1.2fr;gap:24px;align-items:center;margin:8px 0 28px;padding:24px 28px;border:1px solid var(--accent-2);border-radius:18px;background:linear-gradient(135deg,rgba(53,242,138,.10),rgba(10,34,23,.6))}
.official h2{margin:4px 0 6px;font-size:40px;letter-spacing:-.02em}
.official p{margin:0}
.ca-box{display:flex;gap:10px;align-items:center;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px}
.ca-box code{flex:1;min-width:0;word-break:break-all;font-size:14px;color:var(--text)}
@media (max-width:760px){.official{grid-template-columns:1fr;padding:20px}}
.chipline{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.slogo{width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:8px;background:#0f2a1c;object-fit:cover}
.chip .slogo{width:16px;height:16px;margin-right:5px}
.chip{text-decoration:none;display:inline-block;border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--muted)}
@media (max-width:860px){.hero2{grid-template-columns:1fr;gap:24px}}
.tweet{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 16px;font-size:15px}
.tweet + .tweet{margin-top:10px;margin-left:28px;position:relative}
.tweet + .tweet::before{content:"";position:absolute;left:-16px;top:-10px;bottom:50%;border-left:2px solid var(--line);border-bottom:2px solid var(--line);width:12px;border-bottom-left-radius:10px}
.tw-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.av{width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:800;font-size:14px;color:var(--accent-ink);background:var(--accent)}
.av.alt{background:var(--accent-3);color:var(--text)}
.tw-name{font-weight:700;font-size:14px;line-height:1.2}.tw-name small{display:block;color:var(--muted);font-weight:400}
.tw-body{white-space:pre-line;line-height:1.5}
.tw-body .m{color:var(--accent)}
.band{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}
@media (max-width:760px){.band{grid-template-columns:1fr 1fr}}
.section{margin-top:56px}
.section>h2{font-size:clamp(24px,4vw,32px);margin:0 0 6px;letter-spacing:-.01em}
.section>.sub{color:var(--muted);margin:0 0 20px;max-width:760px}
.steps4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;counter-reset:s}
@media (max-width:860px){.steps4{grid-template-columns:1fr 1fr}}
@media (max-width:520px){.steps4{grid-template-columns:1fr}}
.step{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;counter-increment:s}
.step::before{content:counter(s,decimal-leading-zero);display:block;color:var(--accent);font-weight:800;font-size:13px;letter-spacing:.1em;margin-bottom:8px}
.step b{display:block;font-size:17px;margin-bottom:4px}
.step p{margin:0;color:var(--muted);font-size:14px}
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:860px){.features{grid-template-columns:1fr 1fr}}
@media (max-width:520px){.features{grid-template-columns:1fr}}
.feat{transition:border-color .15s,transform .15s;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
.feat:hover,.step:hover,.phase:hover{border-color:var(--accent-2)}
.feat i{font-style:normal;font-size:22px}
.feat b{display:block;margin:8px 0 4px;font-size:16px}
.feat p{margin:0;color:var(--muted);font-size:14px}
.road{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:760px){.road{grid-template-columns:1fr}}
.phase{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
.phase .st{display:inline-block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;border-radius:999px;padding:3px 9px;border:1px solid var(--line);color:var(--muted)}
.phase .st.live{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.phase b{display:block;margin:10px 0 8px;font-size:17px}
.phase ul{margin:0;padding-left:18px;color:var(--muted);font-size:14px}
.phase li{margin:5px 0}
.faq details{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:0 18px;margin:8px 0}
.faq summary{cursor:pointer;padding:16px 0;font-weight:600;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--muted);font-weight:400}
.faq details[open] summary::after{content:"−"}
.faq details p{margin:0 0 16px;color:var(--muted)}
.cta{margin-top:56px;background:linear-gradient(135deg,var(--panel-2),var(--panel));border:1px solid var(--line);border-radius:18px;padding:32px;text-align:center}
.cta h2{font-size:clamp(26px,5vw,40px);margin:0 0 8px}
.cta p{color:var(--muted);margin:0 0 18px}
.cta .row{justify-content:center}
.more{float:right;font-size:14px;font-weight:400}
.tokhead{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.tokhead .av{width:56px;height:56px;font-size:20px}
.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}
@media (max-width:760px){.kv{grid-template-columns:1fr 1fr}}
.kv div{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.kv small{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}
.search{display:flex;gap:8px;margin:12px 0 16px}
.search input{flex:1}
`;

export interface LayoutOpts {
  botHandle: string;
  /** Signed-in X user, if any. */
  user?: { username: string } | null;
  description?: string;
  publicUrl?: string;
}

const BRAND_DIR = new URL("../../brand/", import.meta.url);
const FAVICON = `data:image/svg+xml,${encodeURIComponent(readFileSync(new URL("longshot-logo.svg", BRAND_DIR), "utf8"))}`;
/** The LONGSHOT mark (bullseye + rising arrow) inlined next to the wordmark. */
const MARK = readFileSync(new URL("longshot-mark.svg", BRAND_DIR), "utf8").replace(/ width="\d+" height="\d+"/, ' class="mark" aria-hidden="true"');

export function layout(title: string, body: Raw, o: LayoutOpts): string {
  const x = `https://x.com/${encodeURIComponent(o.botHandle)}`;
  const desc = o.description ?? "Launch a token on Long.xyz with one tweet. Tag @longshotpadxyz, get a stock-paired token, earn 80% of every trading fee.";
  const auth = o.user
    ? `<a class="btn sm ghost" href="/claim" title="Your rewards">@${esc(o.user.username)}</a>`
    : `<a class="btn sm" href="/login">𝕏 Sign in</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">
${o.publicUrl ? `<meta property="og:url" content="${esc(o.publicUrl)}">` : ""}
${o.publicUrl ? `<meta property="og:image" content="${esc(o.publicUrl)}/brand/og-1200x630.png"><meta name="twitter:image" content="${esc(o.publicUrl)}/brand/og-1200x630.png">` : ""}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${esc(o.botHandle)}">
<meta name="theme-color" content="#04130b"><link rel="icon" href="${FAVICON}">
<style>${CSS}</style></head><body>
<header><div class="wrap">
  <a class="logo" href="/">${MARK}LONG<span>SHOT</span></a>
  <nav class="nav-main"><a href="/launches">Launches</a><a href="/stocks">Stocks</a><a href="/#tokenomics">Tokenomics</a><a href="/fees">Transparency</a><a href="/#faq">FAQ</a></nav>
  <div class="nav-right">
    <a class="icon-link" href="${x}" target="_blank" rel="noopener" aria-label="LONGSHOT on X">𝕏</a>
    ${auth}
    <details class="menu"><summary aria-label="Menu">☰</summary><div class="menu-panel"><a href="/launches">Launches</a><a href="/stocks">Stocks</a><a href="/#tokenomics">Tokenomics</a><a href="/fees">Transparency</a><a href="/#faq">FAQ</a><a href="/claim">Claim rewards</a></div></details>
  </div>
</div></header>
<main><div class="wrap">${body.html}</div></main>
<footer><div class="wrap">
  <div class="foot-grid">
    <div><a class="logo" href="/">${MARK}LONG<span>SHOT</span></a><p>One tweet. One token.<br>Stock-paired launches on Long.xyz.</p></div>
    <div><b>Product</b><a href="/launches">Launches</a><a href="/stocks">Stocks</a><a href="/claim">Claim rewards</a><a href="/#how">How it works</a></div>
    <div><b>Resources</b><a href="/#tokenomics">Tokenomics</a><a href="/fees">Transparency</a><a href="/#faq">FAQ</a></div>
    <div><b>Community</b><a href="${x}" target="_blank" rel="noopener">𝕏 @${esc(o.botHandle)}</a><a href="https://app.long.xyz" target="_blank" rel="noopener">app.long.xyz</a></div>
  </div>
  <p class="fine">LONGSHOT is an independent project and is not affiliated with Long.xyz or Robinhood. It launches tokens on Long.xyz infrastructure on behalf of the person who tags it. LONGSHOT never DMs first and will never ask for your seed phrase — the only official account is <a href="${x}" target="_blank" rel="noopener">@${esc(o.botHandle)}</a>. Memecoins are highly speculative; nothing here is financial advice.</p>
</div></footer>
</body></html>`;
}
