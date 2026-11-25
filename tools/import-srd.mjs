// Copy tested SRD spells from the dnd5e system compendium into src/packs/spells, tagged for CAT.
// Usage (Foundry's Electron as Node): tools\import-srd.ps1 -Names "Fireball,Fire Bolt" [-Pack spells24]
// Reads a COPY of the dnd5e pack (pass its folder with --from) so a running Foundry's lock doesn't matter.
// Existing src files are left alone unless --force is given (so hand-made fixes aren't overwritten).
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_APP = process.env.FOUNDRY_APP || "E:/Foundry/Foundry Virtual Tabletop/resources/app";
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const from = arg("--from");
const names = (arg("--names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const force = process.argv.includes("--force");
if (!from || !names.length) { console.log("usage: --from <copy of dnd5e/packs/spells24> --names \"A,B\" [--force]"); process.exit(1); }

const require = createRequire(path.join(FOUNDRY_APP, "main.mjs"));
const { ClassicLevel } = require("classic-level");
const db = new ClassicLevel(from, { valueEncoding: "json" });
await db.open();
const items = [], effects = {};
for await (const [k, v] of db.iterator()) {
  if (k.startsWith("!items!")) items.push(v);
  else if (k.startsWith("!items.effects!")) effects[k.split("!")[2]] = v;
}
await db.close();

const outDir = path.join(ROOT, "src", "packs", "spells");
for (const name of names) {
  const src = items.find((i) => i.name === name && i.type === "spell");
  if (!src) { console.log(`MISSING ${name}`); continue; }
  const it = structuredClone(src);
  it.effects = (it.effects ?? []).map((id) => { const e = structuredClone(effects[`${src._id}.${id}`]); delete e._stats; return e; });
  const file = path.join(outDir, `${it.system.identifier}.json`);
  if (fs.existsSync(file) && !force) { console.log(`skip   ${name} (src file exists)`); continue; }
  it._id = ("cga" + src._id.slice(3)).slice(0, 16);
  for (const k of ["_stats", "folder", "sort", "ownership"]) delete it[k];
  delete it.system.sourceItem;
  it.system.prepared = 0;
  it.system.description = { value: "<p><em>Champions Guild Automation:</em> tested with midi-qol and CAT.</p>", chat: "" };
  it.system.source = { custom: "Champions Guild Automation", book: "", page: "", license: "", rules: "2024", revision: 1 };
  it.flags = { ...(it.flags ?? {}), cat: { automation: { version: "1.0.0", notes: "Champions Guild Automation: tested (damage, saves, scaling, effects)." } } };
  fs.writeFileSync(file, JSON.stringify(it, null, 2) + "\n");
  console.log(`wrote  ${name} -> ${path.relative(ROOT, file)} (${it._id})`);
}
