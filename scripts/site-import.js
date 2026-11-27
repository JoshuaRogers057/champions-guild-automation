// Champions Guild Automation - characters imported from the Champions Guild website (championsguildrpg.com).
// The website's Foundry file says WHAT a character has (each item's name, text and identifier) but carries no
// mechanics: no activities, uses, effects or scale values. Before CAT's Mass Apply can add our fixes, the items need
// the mechanics the dnd5e 2024 compendium gives them, the same data a D&D Beyond or compendium item would have:
//  - class and subclass: the compendium's Scale Value advancements (sorcery points, rage uses, cantrip dice ...)
//  - features, species traits, feats, spells and gear: the compendium item's activities, uses, effects and item
//    data, matched by identifier (class features by the class or subclass that grants them; weapons and armor also
//    by base item, so "Longsword +1" becomes a Longsword with its +1). The site's name, text, quantity, equipped,
//    attuned, prepared and magic bonus are kept.
//  - an Unarmed Strike if the character has none.
// It runs once per item when the character's sheet is opened (by the GM, or the owner when no GM is on), then says
// so in chat. Mass Apply afterwards swaps in the CAT / CGA versions where they exist.
import { MODULE_ID } from "./main.js";

const PACKS = { classes: "dnd5e.classes24", origins: "dnd5e.origins24", feats: "dnd5e.feats24", spells: "dnd5e.spells24", items: "dnd5e.equipment24", cga: `${MODULE_ID}.cga-features` };

// Magic items the site names "<kind> <base item>" ("Vicious Longsword +1", "Mariner's Chain Mail") get the identifier the
// book item has, so CAT and the module rules find them. armor/weapon/ammo say which item types each one is for.
const VARIANTS = [
  ["adamantine", { armor: "adamantine-armor", weapon: "adamantine-weapon", ammo: "adamantine-weapon" }],
  ["cast-off", { armor: "cast-off-armor" }], ["smoldering", { armor: "smoldering-armor" }], ["mariners", { armor: "mariners-armor" }],
  ["mithral", { armor: "mithral-armor" }], ["tramontane", { armor: "tramontane-armor" }], ["demon", { armor: "demon-armor" }],
  ["dancing", { weapon: "dancing-sword" }], ["dazzling", { weapon: "dazzling-weapon" }], ["vicious", { weapon: "vicious-weapon" }],
  ["vorpal", { weapon: "vorpal-sword" }], ["moon-touched", { weapon: "moon-touched-sword" }], ["executioners", { weapon: "executioners-axe" }],
  ["energy", { weapon: "energy-bow" }], ["repeating", { weapon: "repeating-shot" }], ["returning", { weapon: "returning-weapon" }],
  ["silvered", { weapon: "silvered-weapon", ammo: "silvered-weapon" }], ["wave-swept", { weapon: "wave-swept-weapon" }],
  ["walloping", { ammo: "walloping-ammunition" }], ["dispelling", { ammo: "dispelling-ammunition" }], ["goading", { ammo: "goading-ammunition" }]
];
function canonicalIdent(item) {
  const id = item.system.identifier || slug(item.name);
  const kind = item.type === "weapon" ? "weapon"
    : item.type === "equipment" && ["light", "medium", "heavy"].includes(item.system.type?.value) ? "armor"
    : item.type === "consumable" && item.system.type?.value === "ammo" ? "ammo" : null;
  if (/^ring-of-[a-z]+-resistance$/.test(id)) return "ring-of-resistance";
  if (kind === "armor" && /^armor-of-[a-z]+-resistance/.test(id)) return "armor-of-resistance";
  if (kind === "ammo" && /-of-slaying/.test(id)) return "ammunition-of-slaying";
  if (!kind) return null;
  for (const [prefix, map] of VARIANTS) if (map[kind] && id.startsWith(`${prefix}-`) && id !== map[kind]) return map[kind];
  return null;
}

// Species resistances the site doesn't record (D&D Beyond and the dnd5e species advancement set them).
const DRACONIC = { black: "acid", blue: "lightning", brass: "fire", bronze: "lightning", copper: "acid", gold: "fire", green: "poison", red: "fire", silver: "cold", white: "cold" };
const LEGACY = { abyssal: "poison", chthonic: "necrotic", infernal: "fire" };
function speciesResistances(species, choice, actor) {
  const s = slug(species), c = slug(choice).split("-")[0];
  if (s === "aasimar") return ["necrotic", "radiant"];
  if (s === "dhampir") return ["necrotic"];
  if (s === "kalashtar") return ["psychic"];
  if (s === "rimekin") return ["cold"];
  if (s === "dragonborn") return DRACONIC[c] ? [DRACONIC[c]] : [];
  if (s === "tiefling") return LEGACY[c] ? [LEGACY[c]] : [];
  if (s === "reborn") {
    const pick = slug(actor.items.find((i) => i.system.identifier === "strange-endurance")?.flags?.[MODULE_ID]?.site?.choice);
    return ["cold", "necrotic", "poison"].filter((t) => pick.includes(t)).slice(0, 1);
  }
  return [];
}
// Enchantment templates not to apply to a website weapon: its +N is already its magic bonus; Dancing Sword is by hand.
const NO_ENCHANT = /^(weapon|armor|shield|ammunition)(-|$)|dancing-sword/;
const SHIFTER_OPTIONS =["beasthide", "longtooth", "swiftstride", "wildhunt"];

// Features whose picks the site keeps as free text, and where their option items come from.
const OPTION_SOURCES = {
  "metamagic": { subtype: "metamagic" },
  "eldritch-invocations": { subtype: "eldritchInvocation" },
  "fighting-style": { subtype: "fightingStyle" },
  "additional-fighting-style": { subtype: "fightingStyle" }
};
const letters = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const words = (s) => ` ${String(s ?? "").toLowerCase().replace(/['’‘]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

// Uses read from the book text, for a feature nothing else gives uses to (module rules then count them).
const ABILITY = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
function usesFromText(html) {
  const text = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const rest = /finish a Short or Long Rest/i.test(text) ? "sr" : /finish a Long Rest/i.test(text) ? "lr" : /finish a Short Rest/i.test(text) ? "sr" : null;
  if (!rest) return null;
  let max = null;
  const ab = /number of times equal to your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier/i.exec(text);
  if (/number of times equal to your Proficiency Bonus/i.test(text)) max = "@prof";
  else if (ab) max = `max(1, @abilities.${ABILITY[ab[1].toLowerCase()]}.mod)`;
  else if (/\bonce\b[^.]*until you finish a|can't (?:use|do) (?:it|this|that|so) again until you finish a/i.test(text)) max = "1";
  else { const n = /\b(two|three|four|five) times\b[^.]*until you finish a/i.exec(text); if (n) max = String({ two: 2, three: 3, four: 4, five: 5 }[n[1].toLowerCase()]); }
  return max ? { max, spent: 0, recovery: [{ period: rest, type: "recoverAll" }] } : null;
}
const siteFlag = (doc) => doc?.flags?.[MODULE_ID]?.site;
const slug = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’‘]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ------------------------------------------------------------------ compendium lookups (built once per session)
let cache = null;
async function lookups() {
  if (cache) return cache;
  const byIdent = {}; // pack key -> identifier -> [index entries]
  for (const [key, id] of Object.entries(PACKS)) {
    const pack = game.packs.get(id);
    byIdent[key] = {};
    if (!pack) continue;
    for (const e of await pack.getIndex({ fields: ["system.identifier", "system.requirements", "system.type"] })) {
      const ident = e.system?.identifier || slug(e.name);
      (byIdent[key][ident] ??= []).push({ ...e, uuid: e.uuid ?? `Compendium.${id}.Item.${e._id}` });
    }
  }
  // Which class or subclass grants each class feature (from their Item Grant advancements), and their scale values.
  const owner = new Map(); // feature uuid -> class/subclass identifier
  const scales = {}; // class/subclass identifier -> [ScaleValue advancement data]
  const pack = game.packs.get(PACKS.classes);
  if (pack) for (const doc of await pack.getDocuments({ type__in: ["class", "subclass"] })) {
    const ident = doc.system.identifier;
    const adv = Object.values(doc.toObject().system.advancement ?? {});
    scales[ident] = adv.filter((a) => a.type === "ScaleValue");
    for (const a of adv) if (a.type === "ItemGrant") for (const it of a.configuration?.items ?? []) owner.set(it.uuid, ident);
  }
  return (cache = { byIdent, owner, scales });
}

// The compendium entry for a site item, or null. baseOnly: skip the named item (it was an enchantment template).
async function findSource(item, { baseOnly = false } = {}) {
  const { byIdent, owner } = await lookups();
  const flag = siteFlag(item) ?? {};
  const ident = item.system.identifier || slug(item.name);
  const pick = (list, ok = () => true) => (list ?? []).filter(ok);
  switch (item.type) {
    case "spell": return pick(byIdent.spells[ident])[0] ?? null;
    case "feat": {
      if (flag.kind === "class-feature" || flag.kind === "subclass-feature") {
        const who = slug(String(flag.key ?? "").split("|")[1]);
        const list = pick(byIdent.classes[ident], (e) => e.type === "feat");
        return list.find((e) => owner.get(e.uuid) === who) ?? (list.length === 1 ? list[0] : list.find((e) => !owner.has(e.uuid)) ?? null);
      }
      if (flag.kind === "species-feature") {
        const species = String(flag.key ?? "").split("|")[1] ?? "";
        const list = pick(byIdent.origins[ident], (e) => e.type === "feat");
        return list.find((e) => String(e.system?.requirements ?? "").toLowerCase().startsWith(species.toLowerCase())) ?? list[0] ?? null;
      }
      return pick(byIdent.feats[ident], (e) => e.type === "feat")[0] ?? pick(byIdent.origins[ident], (e) => e.type === "feat")[0] ?? null;
    }
    case "weapon": case "equipment": case "consumable": case "tool": {
      const same = (e) => e.type === item.type || (item.type === "equipment" && e.type === "equipment");
      const canon = canonicalIdent(item);
      let hit = baseOnly ? null : (canon && pick(byIdent.items[canon], same)[0]) || pick(byIdent.items[ident], same)[0];
      // "Longsword +1" / "Shield +2": the plain item (the +N is kept as the item's magic bonus).
      if (!hit && /-\d$/.test(ident)) hit = pick(byIdent.items[ident.replace(/-\d$/, "")], same)[0];
      // "Flame Tongue Shortsword": the longest named item (two words or more) the name starts with.
      if (!hit && !baseOnly) {
        const parts = ident.split("-");
        for (let n = parts.length - 1; n >= 2 && !hit; n--) hit = pick(byIdent.items[parts.slice(0, n).join("-")], same)[0];
      }
      // Weapons and armor by base item ("Flame Tongue" exported as a shortsword keeps the shortsword's numbers).
      const base = item.system.type?.baseItem;
      if (!hit && base && (item.type === "weapon" || item.type === "equipment")) {
        const cfg = item.type === "weapon" ? CONFIG.DND5E.weaponIds : { ...CONFIG.DND5E.armorIds, ...CONFIG.DND5E.shieldIds };
        const uuid = cfg?.[base];
        if (uuid && /equipment24/.test(uuid)) hit = { uuid };
        else hit = pick(byIdent.items[slug(base)], same)[0] ?? pick(byIdent.items[base], same)[0];
      }
      return hit ?? null;
    }
    default: return null;
  }
}

// The new item data: the compendium item with the site's own details laid over it.
function merge(siteItem, source) {
  const site = siteItem.toObject();
  const data = source.toObject();
  const sys = data.system;
  const s = site.system;
  const keep = ["identifier", "description", "quantity", "equipped", "attuned", "prepared", "method", "sourceItem", "requirements", "container"];
  for (const k of keep) if (s[k] !== undefined) sys[k] = s[k];
  if (s.price?.value) sys.price = s.price;
  if (s.weight?.value) sys.weight = s.weight;
  if (s.rarities?.length) sys.rarities = s.rarities;
  if (s.magicalBonus) sys.magicalBonus = s.magicalBonus;
  if (s.attunement && !sys.attunement) sys.attunement = s.attunement;
  if (s.level !== undefined && siteItem.type === "spell") sys.level = s.level;
  // A named weapon or armor keeps the site's numbers when the compendium copy is a different base.
  if (siteItem.type === "weapon" && source.type === "weapon" && s.type?.baseItem && s.type.baseItem !== sys.type?.baseItem) {
    for (const k of ["type", "damage", "range", "mastery"]) if (s[k] !== undefined) sys[k] = s[k];
  }
  if (siteItem.type === "equipment" && s.armor && s.type?.baseItem && s.type.baseItem !== sys.type?.baseItem) {
    for (const k of ["type", "armor", "strength"]) if (s[k] !== undefined) sys[k] = s[k];
  }
  if (Array.isArray(s.properties) || s.properties) sys.properties = [...new Set([...(sys.properties ?? []), ...(s.properties ?? [])])];
  if (sys.uses) sys.uses.spent = 0;
  const canon = canonicalIdent(siteItem);
  if (canon) sys.identifier = canon;
  return {
    ...data,
    _id: site._id,
    name: site.name,
    img: data.img && !/item-bag/.test(data.img) ? data.img : site.img,
    sort: site.sort,
    folder: null,
    flags: foundry.utils.mergeObject(data.flags ?? {}, { [MODULE_ID]: { site: { ...(site.flags?.[MODULE_ID]?.site ?? {}), filled: source.uuid } } }),
    // dnd5e finds the other features an activity spends (Font of Magic's points, Channel Divinity ...) by this.
    _stats: { ...(data._stats ?? {}), compendiumSource: source.uuid, duplicateSource: null }
  };
}

// A weapon named for a compendium enchantment template (Vicious, Frost Brand, Holy Avenger, Vorpal ...): write the
// enchantment's changes into the weapon itself. dnd5e won't enchant a weapon that is already magical, and the site
// marks these magical. Only the changes a DM's enchanting would make: extra damage, magic bonus, attunement.
function bakeEnchantment(data, template) {
  const act = template.system.activities.find((a) => a.type === "enchant");
  if (!act) return null;
  const name = words(data.name);
  const profiles = act.effects.map((p) => template.effects.get(p._id)).filter(Boolean);
  const effect = profiles.find((e) => name.includes(words(e.name.replace(/\(.*\)/, "")))) ?? profiles[0];
  if (!effect) return null;
  const sys = data.system;
  const attacks = Object.values(sys.activities ?? {}).filter((a) => a.type === "attack");
  for (const c of effect.system?.changes ?? effect.changes ?? []) {
    const v = String(c.value ?? "");
    if (c.key === "system.damage.base.bonus") sys.damage.base.bonus = [sys.damage.base.bonus, v].filter(Boolean).join(" + ");
    else if (c.key === "system.damage.parts") {
      const [formula, type] = v.split(",").map((s) => s.trim());
      const m = /^(\d+)d(\d+)$/.exec(formula ?? "");
      if (m) for (const a of attacks) (a.damage.parts ??= []).push({ number: Number(m[1]), denomination: Number(m[2]), bonus: "", types: type ? [type] : [], custom: { enabled: false }, scaling: { number: 1 } });
    }
    else if (c.key === "system.magicalBonus" && !Number(sys.magicalBonus)) sys.magicalBonus = v;
    else if (c.key === "system.attunement") sys.attunement = v;
    else if (c.key === "system.properties") sys.properties = [...new Set([...(sys.properties ?? []), v])];
    // Critical-hit extras (Vorpal, Life Stealing, Sharpness) are module rules already, so they're left out here.
  }
  return `${effect.name} built in`;
}

// New items from compendium entries (skipping identifiers the character already has).
async function addFrom(actor, entries, siteKey) {
  const have = new Set(actor.items.map((i) => i.system.identifier));
  const data = [];
  for (const e of entries) {
    const ident = e.system?.identifier || slug(e.name);
    if (have.has(ident)) continue;
    const src = await fromUuid(e.uuid);
    if (!src) continue;
    const d = src.toObject();
    delete d._id;
    d._stats = { ...(d._stats ?? {}), compendiumSource: src.uuid, duplicateSource: null };
    foundry.utils.setProperty(d, `flags.${MODULE_ID}.site`, { kind: "added", key: siteKey, filled: src.uuid });
    data.push(d);
    have.add(ident);
  }
  if (data.length) await actor.createEmbeddedDocuments("Item", data, { cgaSiteFill: true });
  return data.map((d) => d.name.replace(/^.*?:\s*/, ""));
}

async function addChoices(actor) {
  const { byIdent } = await lookups();
  const out = [];
  const all = (key) => Object.values(byIdent[key] ?? {}).flat();
  // Metamagic, Eldritch Invocations, Fighting Style: option items named in the feature's chosen text.
  for (const feat of actor.items.filter((i) => OPTION_SOURCES[i.system.identifier] && siteFlag(i)?.choice)) {
    const { subtype } = OPTION_SOURCES[feat.system.identifier];
    const text = words(siteFlag(feat).choice);
    const pool = [...all("cga"), ...all("classes"), ...all("feats")].filter((e) => e.type === "feat" && e.system?.type?.subtype === subtype);
    const seen = new Set();
    const picked = pool.filter((e) => {
      const name = words(e.name.replace(/^.*?:\s*/, ""));
      const ident = e.system?.identifier || slug(e.name);
      if (seen.has(ident) || !text.includes(name)) return false;
      seen.add(ident);
      return true;
    });
    const added = await addFrom(actor, picked, feat.name);
    if (added.length) out.push(`${feat.name}: ${added.join(", ")}`);
  }
  // Weapon Mastery: the weapons named become the character's mastery list.
  const wm = actor.items.filter((i) => i.system.identifier === "weapon-mastery" && siteFlag(i)?.choice);
  if (wm.length) {
    let text = letters(wm.map((i) => siteFlag(i).choice).join(" ")).replace(/crossbowhand/g, "handcrossbow").replace(/crossbowlight/g, "lightcrossbow").replace(/crossbowheavy/g, "heavycrossbow");
    const keys = Object.keys(CONFIG.DND5E.weaponIds ?? {}).sort((a, b) => b.length - a.length);
    const found = [];
    for (const k of keys) if (text.includes(k)) { found.push(k); text = text.split(k).join(" "); }
    if (found.length) {
      const now = [...(actor.system.traits.weaponProf?.mastery?.value ?? [])];
      await actor.update({ "system.traits.weaponProf.mastery.value": [...new Set([...now, ...found])] });
      out.push(`Weapon Mastery: ${found.join(", ")}`);
    }
  }
  // Species: the lineage or ancestry picked on the site ("Chosen: Fire" in the species text) and resistances.
  const race = actor.items.find((i) => i.type === "race");
  if (race) {
    const species = race.name;
    const choice = siteFlag(race)?.choice ?? /<strong>Chosen:<\/strong>\s*([^<]+)/i.exec(race.system.description?.value ?? "")?.[1]?.trim() ?? "";
    if (choice) {
      const rx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const key = choice.replace(new RegExp(`\\b(${rx(species)}|giant|elf|gnome)\\b`, "ig"), "").trim();
      const req = new RegExp(`^${rx(species)}\\s*\\(\\s*${rx(key)}`, "i");
      const lineage = all("origins").filter((e) => e.type === "feat" && (req.test(e.system?.requirements ?? "")
        || (slug(e.system?.requirements) === slug(species) && (e.system?.identifier ?? "").endsWith(`-${slug(key)}`))));
      const added = await addFrom(actor, lineage, `${species} (${choice})`);
      if (added.length) out.push(`${species} lineage: ${added.join(", ")}`);
      // Shifter options are module rules that look for the trait by name.
      if (slug(species) === "shifter" && SHIFTER_OPTIONS.includes(slug(choice)) && !actor.items.some((i) => i.system.identifier === slug(choice))) {
        await actor.createEmbeddedDocuments("Item", [{ name: choice, type: "feat", system: { identifier: slug(choice), type: { value: "race", subtype: "" }, description: { value: `<p>Shifter option chosen on the Champions Guild website.</p>` }, source: { rules: "2024" } },
          flags: { [MODULE_ID]: { site: { kind: "added", key: `Shifter (${choice})`, filled: "added" } } } }], { cgaSiteFill: true });
        out.push(`Shifter: ${choice}`);
      }
    }
    const dr = speciesResistances(species, choice, actor);
    const now = [...(actor.system.traits.dr?.value ?? [])];
    const add = dr.filter((t) => !now.includes(t));
    if (add.length) {
      await actor.update({ "system.traits.dr.value": [...now, ...add] });
      out.push(`${species} Resistance: ${add.join(", ")}`);
    }
  }
  return out;
}

const running = new Set();
const tried = new Set(); // item uuids with no compendium match this session
export async function fillSiteItems(actor, { quiet = false } = {}) {
  if (!actor?.flags?.[MODULE_ID]?.export || running.has(actor.uuid)) return null;
  running.add(actor.uuid);
  const filled = [], missing = [];
  try {
    const { scales } = await lookups();
    // Class and subclass scale values.
    for (const cls of actor.items.filter((i) => (i.type === "class" || i.type === "subclass") && siteFlag(i) && !siteFlag(i).filled)) {
      const want = scales[cls.system.identifier] ?? [];
      const have = new Set(Object.values(cls.toObject().system.advancement ?? {}).map((a) => a.configuration?.identifier ?? a.title));
      const add = {};
      for (const a of want) if (!have.has(a.configuration?.identifier ?? a.title)) add[a._id] = a;
      await cls.update({ "system.advancement": add, [`flags.${MODULE_ID}.site.filled`]: true });
      if (Object.keys(add).length) filled.push(`${cls.name} (scale values)`);
    }
    // Everything else.
    const todo = actor.items.filter((i) => siteFlag(i) && !siteFlag(i).filled && !tried.has(i.uuid)
      && ["feat", "spell", "weapon", "equipment", "consumable", "tool"].includes(i.type)
      && !i.flags?.cat?.automation && !i.flags?.cat?.hash && !i.flags?.cat?.source);
    const create = [], remove = [];
    const patch = [], enchant = [];
    for (const item of todo) {
      let entry = await findSource(item);
      let source = entry && await fromUuid(entry.uuid);
      // An enchantment template (Ring of Resistance, Weapon +1 ...) only renames an item: use the base item instead,
      // and let the module rules read the rest from the name.
      if (source?.system.activities?.some?.((a) => a.type === "enchant") && item.type !== "spell" && item.type !== "feat") {
        if (item.type === "weapon" && !NO_ENCHANT.test(source.system.identifier ?? "")) enchant.push({ id: item.id, template: source });
        entry = await findSource(item, { baseOnly: true });
        source = entry && entry.uuid !== source.uuid ? await fromUuid(entry.uuid) : null;
      }
      if (source) {
        const data = merge(item, source);
        const tmpl = enchant.find((e) => e.id === item.id)?.template;
        const baked = tmpl ? bakeEnchantment(data, tmpl) : null;
        create.push(data);
        remove.push(item.id);
        filled.push(baked ? `${item.name} (${baked})` : item.name);
        continue;
      }
      // No compendium copy: still give it the book item's identifier, and uses from its text.
      tried.add(item.uuid);
      const up = { _id: item.id };
      const canon = canonicalIdent(item);
      if (canon) up["system.identifier"] = canon;
      const uses = item.type === "feat" && !item.system.uses?.max ? usesFromText(item.system.description?.value) : null;
      if (uses) up["system.uses"] = uses;
      if (Object.keys(up).length > 1) { up[`flags.${MODULE_ID}.site.filled`] = canon ? "identifier" : "uses"; patch.push(up); filled.push(`${item.name} (${[canon && "identifier " + canon, uses && "uses"].filter(Boolean).join(", ")})`); }
      else missing.push(item.name);
    }
    if (remove.length) {
      await actor.deleteEmbeddedDocuments("Item", remove, { cgaSiteFill: true });
      await actor.createEmbeddedDocuments("Item", create, { keepId: true, cgaSiteFill: true });
    }
    if (patch.length) await actor.updateEmbeddedDocuments("Item", patch, { cgaSiteFill: true });
    // Once per export: picks kept as text, the species lineage and resistances, weapon masteries.
    const stamp = actor.flags[MODULE_ID].export.exportedAtUtc ?? "1";
    if (actor.getFlag(MODULE_ID, "siteFilled") !== stamp) {
      filled.push(...await addChoices(actor));
      await actor.setFlag(MODULE_ID, "siteFilled", stamp);
    }
    // An Unarmed Strike, as every character sheet has.
    if (!actor.items.some((i) => i.type === "weapon" && i.system.identifier === "unarmed-strike")) {
      const { byIdent } = await lookups();
      const entry = (byIdent.classes["unarmed-strike"] ?? []).find((e) => !/monk/i.test(e.name)) ?? byIdent.classes["unarmed-strike"]?.[0];
      const src = entry && await fromUuid(entry.uuid);
      if (src) {
        const data = src.toObject();
        data._stats = { ...(data._stats ?? {}), compendiumSource: src.uuid };
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.site`, { kind: "added", key: "Unarmed Strike", filled: src.uuid });
        await actor.createEmbeddedDocuments("Item", [data], { cgaSiteFill: true });
        filled.push("Unarmed Strike (added)");
      }
    }
    if (filled.length && !quiet) {
      const esc = foundry.utils.escapeHTML ?? ((x) => x);
      const gm = game.users.filter((u) => u.isGM).map((u) => u.id);
      const owners = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.id);
      ChatMessage.create({ speaker: { alias: "Champions Guild Automation" }, whisper: [...new Set([...gm, ...owners])],
        content: `<p><strong>${esc(actor.name)}</strong> came from the Champions Guild website. Gave ${filled.length} items their D&amp;D rules data: ${esc(filled.join(", "))}.</p>`
          + (missing.length ? `<p>No D&amp;D compendium entry (Mass Apply may still have one): ${esc(missing.join(", "))}.</p>` : "")
          + `<p>Next: open the CAT shield in the sheet's title bar and click <strong>Mass Apply / Update</strong>.</p>` });
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | filling ${actor?.name}'s website items failed`, err);
  } finally {
    running.delete(actor.uuid);
  }
  return { filled, missing };
}

// One client does it: the active GM, or an owner when no GM is on.
function shouldRun(actor) {
  if (!actor?.flags?.[MODULE_ID]?.export) return false;
  const gm = game.users.activeGM;
  if (gm) return gm.isSelf;
  const owner = game.users.find((u) => u.active && actor.testUserPermission(u, "OWNER"));
  return owner?.isSelf ?? false;
}
const needsFill = (actor) => actor.getFlag(MODULE_ID, "siteFilled") !== (actor.flags[MODULE_ID].export.exportedAtUtc ?? "1") || actor.items.some((i) => siteFlag(i) && !siteFlag(i).filled && !tried.has(i.uuid)
  && ["class", "subclass", "feat", "spell", "weapon", "equipment", "consumable", "tool"].includes(i.type))
  || !actor.items.some((i) => i.type === "weapon" && i.system.identifier === "unarmed-strike");
Hooks.on("renderActorSheetV2", (app) => {
  const actor = app.document;
  if (actor?.type !== "character" || !shouldRun(actor) || !needsFill(actor)) return;
  fillSiteItems(actor);
});
// Import Data runs without hooks, so also check characters that are already open or get updated.
Hooks.on("updateActor", (actor) => { if (actor?.type === "character" && actor.sheet?.rendered && shouldRun(actor) && needsFill(actor)) fillSiteItems(actor); });
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  mod.api = Object.assign(mod.api ?? {}, { fillSiteItems });
});
