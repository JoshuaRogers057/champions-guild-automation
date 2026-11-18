// Build the module's compendiums from src/.
//
//   src/packs/<pack>/**/*.json   one Item per file (readable, diffable)
//   src/macros/*.js              ItemMacro source, inlined into items that name it in "_cgaMacro"
//   packs/<pack>/                LevelDB output that Foundry reads (never edit by hand)
//
// Run with tools/build.ps1 (uses Foundry's own Electron as Node). Flags: --check (validate only).
// The packs must not be open in a running Foundry world that has this module enabled.

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_APP = process.env.FOUNDRY_APP || "E:/Foundry/Foundry Virtual Tabletop/resources/app";
const CORE_VERSION = "14.370";
const SYSTEM_VERSION = "6.0.6";
const checkOnly = process.argv.includes("--check");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const ID_RE = /^[A-Za-z0-9]{16}$/;
// Names midi-qol / DAE already bind when an ItemMacro runs - a macro must not redeclare them.
const MACRO_PARAMS = ["speaker", "actor", "token", "character", "scope", "workflow", "rolledActivity", "macroActivity",
  "item", "rolledItem", "macroItem", "args", "options", "midiData"];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : d.name.endsWith(".json") ? [p] : [];
  });
}

function loadMacro(file, name) {
  const p = path.join(ROOT, "src", "macros", name);
  if (!fs.existsSync(p)) { err(file, `_cgaMacro "${name}" not found in src/macros`); return null; }
  const src = fs.readFileSync(p, "utf8");
  try { new AsyncFunction(...MACRO_PARAMS, "{" + src + "\n}"); }
  catch (e) { err(file, `macro ${name} has a syntax error: ${e.message}`); }
  return src;
}

function prepareItem(file, raw, seenIds, seenKeys) {
  const item = structuredClone(raw);
  const rel = path.relative(ROOT, file);
  if (!ID_RE.test(item._id ?? "")) err(rel, `_id "${item._id}" must be exactly 16 letters/digits`);
  if (seenIds.has(item._id)) err(rel, `_id ${item._id} is also used by ${seenIds.get(item._id)}`);
  seenIds.set(item._id, rel);
  if (!item.name) err(rel, "missing name");
  if (!item.type) err(rel, "missing type");
  const identifier = item.system?.identifier;
  if (!identifier) err(rel, "missing system.identifier - CAT matches actor items by it");
  const rules = item.system?.source?.rules || "2024";
  const key = `${item.type}|${identifier}|${rules}`;
  if (seenKeys.has(key)) err(rel, `same type/identifier/rules as ${seenKeys.get(key)} - CAT would only see one`);
  seenKeys.set(key, rel);
  const version = item.flags?.cat?.automation?.version;
  if (!version) err(rel, "missing flags.cat.automation.version - CAT uses it to mark actor items out of date");

  for (const [k, a] of Object.entries(item.system?.activities ?? {})) {
    if (!ID_RE.test(k) || a._id !== k) err(rel, `activity key "${k}" must equal its _id and be 16 letters/digits`);
  }
  for (const e of item.effects ?? []) if (!ID_RE.test(e._id ?? "")) err(rel, `effect "${e.name}" _id must be 16 letters/digits`);

  if (item._cgaMacro) {
    const command = loadMacro(rel, item._cgaMacro);
    if (command != null) {
      item.flags ??= {};
      item.flags.dae ??= {};
      item.flags.dae.macro = { name: item.name, img: item.img, type: "script", scope: "global", command, author: null,
        ownership: { default: 3 }, flags: {} };
      const fromEffect = (item.effects ?? []).some((e) => (e.system?.changes ?? e.changes ?? [])
        .some((c) => c.key === "flags.midi-qol.onUseMacroName" && String(c.value).includes("ItemMacro")));
      if (!item.flags["midi-qol"]?.onUseMacroName?.includes("ItemMacro") && !fromEffect) {
        warn(rel, "has _cgaMacro but neither flags.midi-qol.onUseMacroName nor an effect calls ItemMacro");
      }
    }
    delete item._cgaMacro;
  }
  if (!item.system?.description?.value) warn(rel, "no description (fine - CAT keeps the actor's own description)");

  item._stats = { ...(item._stats ?? {}), coreVersion: CORE_VERSION, systemId: "dnd5e", systemVersion: SYSTEM_VERSION,
    compendiumSource: null, duplicateSource: null, exportSource: null };
  item.folder ??= null;
  item.sort ??= 0;
  item.ownership ??= { default: 0 };
  return item;
}

async function writePack(dir, items) {
  const require = createRequire(path.join(FOUNDRY_APP, "main.mjs"));
  const { ClassicLevel } = require("classic-level");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const db = new ClassicLevel(dir, { valueEncoding: "json" });
  await db.open();
  const batch = db.batch();
  for (const item of items) {
    const effects = item.effects ?? [];
    batch.put(`!items!${item._id}`, { ...item, effects: effects.map((e) => e._id) });
    for (const e of effects) {
      batch.put(`!items.effects!${item._id}.${e._id}`, {
        _stats: { coreVersion: CORE_VERSION, systemId: "dnd5e", systemVersion: SYSTEM_VERSION }, ...e
      });
    }
  }
  await batch.write();
  await db.compactRange("\x00", "\xff");
  await db.close();
}

const seenIds = new Map();
const seenKeys = new Map();
const built = [];
for (const pack of manifest.packs) {
  const name = path.basename(pack.path);
  const files = walk(path.join(ROOT, "src", "packs", name));
  const items = files.map((f) => {
    try { return prepareItem(f, JSON.parse(fs.readFileSync(f, "utf8")), seenIds, seenKeys); }
    catch (e) { err(path.relative(ROOT, f), `not valid JSON: ${e.message}`); return null; }
  }).filter(Boolean);
  built.push({ pack, name, items });
}

for (const w of warnings) console.log("warn  " + w);
if (errors.length) {
  for (const e of errors) console.log("ERROR " + e);
  console.log(`\n${errors.length} error(s) - nothing was written.`);
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(`Check passed: ${built.reduce((n, b) => n + b.items.length, 0)} item(s), no errors.`);
} else {
  for (const { pack, name, items } of built) {
    try { await writePack(path.join(ROOT, pack.path), items); }
    catch (e) {
      console.log(`ERROR writing ${pack.path}: ${e.message}`);
      console.log("Is a Foundry world with this module enabled open? Close it (or return to Setup) and build again.");
      process.exitCode = 1;
      break;
    }
    console.log(`built ${pack.path}: ${items.length} item(s)`);
  }
  if (!process.exitCode) console.log(`\n${manifest.title} ${manifest.version} built.`);
}
