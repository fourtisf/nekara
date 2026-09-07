/**
 * The index against the routes.
 *
 * Documentation drifts silently: a route renamed and a doc left behind read
 * exactly alike to whoever wrote them, and only a stranger's client finds out.
 * So this does not check that the index looks right — it reads the routes
 * `api.js` actually handles and holds the two against each other in both
 * directions. A documented route that does not exist fails here, and so does a
 * route nobody documented, unless PRIVATE says why it is not advertised.
 *
 * And the one thing an outside caller must not be lied to about: the public
 * delay reported by the index is the delay the server would actually apply.
 */
import { readFileSync } from "node:fs";
import { FileStore } from "./store.js";
import { serve } from "./api.js";
import { ROUTES, PRIVATE } from "./apidoc.js";
import { TIER_DELAY_S } from "./gating.js";

const DATA = "./data/api-index-test.json";
const PORT = 8802;

let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? "ok   " : "GAGAL"}  ${m}`); if (!c) failures++; };
const head = t => console.log(`\n${t}`);

/* The routes as the server sees them: parsed from the dispatch itself, so this
   cannot be kept in step by hand either. `:seq` stands in for the prefix
   matches, which is how the index writes them. */
const src = readFileSync(new URL("./api.js", import.meta.url), "utf8");
const served = new Set();
for (const m of src.matchAll(/p === "(\/api[^"]*)"/g)) served.add(m[1].replace(/\/$/, "") || "/api");
for (const m of src.matchAll(/p\.startsWith\("(\/api\/[^"]*)"\)/g)) served.add(m[1] + ":seq");

head("indeks dan rute saling menutupi");
{
  const documented = new Set(ROUTES.map(r => r.path));
  const priv = new Set(Object.keys(PRIVATE));

  const ghosts = [...documented].filter(x => !served.has(x));
  ok(ghosts.length === 0, `tidak ada rute yang didokumentasikan tapi tidak dilayani${
    ghosts.length ? " — " + ghosts.join(", ") : ""}`);

  const orphans = [...served].filter(x => !documented.has(x) && !priv.has(x));
  ok(orphans.length === 0, `tidak ada rute yang dilayani tapi tidak disebut di mana pun${
    orphans.length ? " — " + orphans.join(", ") : ""}`);

  const deadPriv = [...priv].filter(x => !served.has(x));
  ok(deadPriv.length === 0, `daftar PRIVATE tidak menyimpan rute yang sudah tidak ada${
    deadPriv.length ? " — " + deadPriv.join(", ") : ""}`);

  ok(ROUTES.every(r => r.returns), "setiap rute mengatakan apa yang dikembalikannya");
}

head("angka latensinya yang sebenarnya, bukan klaim tentangnya");
{
  const delays = { ...TIER_DELAY_S, 0: 1800 };
  const store = new FileStore(DATA);
  const srv = serve(store, { port: PORT, secret: "t", delays, log: () => {} });
  await new Promise(r => setTimeout(r, 60));
  try {
    const j = await (await fetch(`http://127.0.0.1:${PORT}/api`)).json();
    ok(j.latency.anonymous === "1800s behind the desk",
      `kaki publik dilaporkan apa adanya (${j.latency.anonymous})`);
    ok(j.latency.tiers.public === "1800s" && j.latency.tiers["III"] === "0s",
      "seluruh tangganya ikut, jadi pemanggil tahu apa yang dibelinya");
    ok(!/open right now/.test(j.latency.note),
      "dengan jeda terpasang, catatannya bukan yang untuk gerbang terbuka");
    ok(j.routes.length === ROUTES.length && j.cors === "*",
      "dan indeksnya menyajikan daftar yang sama dengan modulnya");

    /* The state that must never be silent: a desk with the gate at zero is a
       desk giving the feed away, and an API that does not say so lets a caller
       believe they are late when they are not. */
    const srv0 = serve(store, { port: PORT + 1, secret: "t",
      delays: { ...TIER_DELAY_S, 0: 0 }, log: () => {} });
    await new Promise(r => setTimeout(r, 60));
    const j0 = await (await fetch(`http://127.0.0.1:${PORT + 1}/api`)).json();
    srv0.close();
    ok(/open right now/.test(j0.latency.note),
      "gerbang di nol dikatakan terang-terangan, bukan didiamkan");
  } finally { srv.close(); }
}

console.log(failures ? `\n${failures} GAGAL` : "\nsemua lolos");
process.exit(failures ? 1 : 0);
