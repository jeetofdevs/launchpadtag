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
:root{--bg:#0b0d0c;--panel:#141816;--line:#232a26;--text:#e9f1ec;--muted:#8a978f;--accent:#35f28a;--accent-ink:#04200f;--accent-2:#1f8f53;--accent-3:#4b5a52;--burn:#ff7a3d;--burn-ink:#1c0a00;--danger:#ff6b6b;--warn:#ffc857}
@media (prefers-color-scheme: light){:root{--bg:#f6f8f7;--panel:#ffffff;--line:#dfe6e2;--text:#0e1511;--muted:#5d6b63;--accent:#0fae57;--accent-ink:#ffffff;--accent-2:#7fd6a6;--accent-3:#b7c4bc;--burn:#c2410c;--burn-ink:#ffffff;--danger:#c62828;--warn:#9a6700}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:60px}
.logo{font-weight:800;letter-spacing:.08em;color:var(--text);text-decoration:none}
.logo span{color:var(--accent)}
nav a{color:var(--muted);text-decoration:none;margin-left:16px;font-size:14px}
nav a:hover{color:var(--text)}
main{padding:32px 0 64px}
h1{font-size:clamp(32px,6vw,52px);line-height:1.05;margin:8px 0 12px;letter-spacing:-.02em}
h2{font-size:20px;margin:32px 0 12px}
.lead{color:var(--muted);font-size:18px;max-width:620px}
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
input[type=text]{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;font-family:ui-monospace,monospace;font-size:14px}
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
@media (max-width:760px){.rewards-now{grid-template-columns:1fr}}
.small{font-size:12px}
.seg{display:block;min-width:4px}
.s1{background:var(--accent)}.s2{background:var(--accent-2)}.s3{background:var(--accent-3)}
.legend{list-style:none;padding:0;margin:0 0 12px}
.legend li{margin:8px 0;padding-left:18px;position:relative}
.dot{position:absolute;left:0;top:.45em;width:10px;height:10px;border-radius:3px}
@media (max-width:480px){.hide-sm{display:none}nav a{margin-left:12px;font-size:13px}.logo{letter-spacing:.04em}}
code{overflow-wrap:anywhere}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px;padding:20px 0}
`;

export function layout(title: string, body: Raw, botHandle = "longshotpadxyz"): string {
  const x = `https://x.com/${encodeURIComponent(botHandle)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<header><div class="wrap"><a class="logo" href="/">LONG<span>SHOT</span></a>
<nav><a href="/fees">Transparency</a><a href="/claim">Claim</a><a href="${x}" target="_blank" rel="noopener" aria-label="LONGSHOT on X">𝕏<span class="hide-sm"> @${esc(botHandle)}</span></a></nav></div></header>
<main><div class="wrap">${body.html}</div></main>
<footer><div class="wrap">LONGSHOT is an independent bot that launches tokens on Long.xyz on behalf of the person who tags it. Deployers earn most of every trading fee — see <a href="/#tokenomics">Tokenomics</a>. LONGSHOT never DMs first and will never ask for your seed phrase. Official account: <a href="${x}" target="_blank" rel="noopener">@${esc(botHandle)}</a> — anyone else is an impersonator.</div></footer>
</body></html>`;
}
