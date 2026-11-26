// Champions Guild Automation - the last Dungeon Master's Guide magic items (the ones with no dnd5e compendium copy).
// Module rules match the character's own item (D&D Beyond or CGA) by identifier or name; the CGA items in cga-items
// add the activities (summons, casts, saves).
//  Activities: Cube of Summoning (rolls the summon spell), Enspelled Armor / Staff / Weapon (Bind Spell), Figurine of
//  Wondrous Power (Obsidian Steed's 10 percent; Ivory Goats' Goat of Terror aura, horns and reverting), Instrument of
//  the Bards (unattuned play), Iron Bands of Bilarro (Release), Keoghtom's Ointment (ends Poisoned), Potion of Fire
//  Breath (Exhale Fire feature), Rival Coin (heads or tails), Staff of the Adder (bite only while animate).
//  Passives and riders: Mariner's Armor (Swim Speed, 0-HP underwater heal), Lute of Thunderous Thumping (+2d8 Thunder),
//  Walloping Ammunition (Prone), Wraps of Unarmed Power (+N and Force on Unarmed Strikes).
import { MODULE_ID, askOwner, askChoice, edgeDistance, gmRollSave } from "./main.js";
import { magicItem, isMagicItem, attuned, say, tokenOf, isGM, chg, ON_HIT, PASSIVES, hasPart } from "./item-rules.js";
import { usesLeft, spend } from "./background-feats.js";
import { addEffect, updateActor } from "./feat-rules-books.js";
import { runAct, hits, targetsOf, sceneTokens, tokensOf, hostile, alive, statusEffect, removeEffects } from "./class-rules-books.js";

const later = (fn, ms = 900) => setTimeout(() => Promise.resolve(fn()).catch((err) => console.warn(`${MODULE_ID} | DMG item follow-up failed`, err)), ms);
async function failSave(actor, ability, dc) { return (await gmRollSave(actor, ability, dc)) === false; }
const ident = (act) => act?.midiProperties?.identifier ?? "";
const findAct = (item, id) => item?.system?.activities?.find((a) => ident(a) === id);
async function rollMsg(actor, formula, flavor) { const r = await new Roll(formula).evaluate(); await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor }); return r.total; }
// The item behind an activity being used: the item itself, or for a cast spell the item whose cast activity made it.
function sourceOf(activity) {
  const item = activity?.item, actor = item?.actor;
  const cached = item?.flags?.dnd5e?.cachedFor;
  if (!cached || !actor) return { item, activity };
  const act = fromUuidSync(cached, { relative: actor });
  return { item: act?.item ?? item, activity: act ?? activity };
}

// ------------------------------------------------------------------ Passives and on-hit damage
PASSIVES.push(
  { key: "mariners-armor", active: (a) => !!magicItem(a, "mariners-armor"),
    effect: (a) => ({ name: "Mariner's Armor (Swim Speed)", img: "icons/equipment/chest/breastplate-scale-grey.webp",
      changes: [chg("system.attributes.movement.swim", String(Number(a.system.attributes?.movement?.walk ?? 30) || 30), "upgrade")] }) }
);
ON_HIT.push({ ident: "lute-of-thunderous-thumping", label: "Lute of Thunderous Thumping", formula: "2d8", type: "thunder", when: () => true, builtIn: (item) => hasPart(item, 2, 8, "thunder", true) });

// ------------------------------------------------------------------ Wraps of Unarmed Power: +N to hit and damage, Force allowed
function wrapsBonus(actor) {
  const w = magicItem(actor, "wraps-of-unarmed-power");
  if (!w) return 0;
  const m = /\+([123])/.exec(w.name);
  return m ? Number(m[1]) : ({ uncommon: 1, rare: 2, veryRare: 3, legendary: 3 }[w.system.rarity] ?? 1);
}
const unarmed = (act) => act?.attack?.type?.classification === "unarmed" || /unarmed/i.test(act?.item?.system?.identifier ?? "")
  || /unarmed strike/i.test(act?.item?.name ?? "") || act?.item?.system?.type?.baseItem === "unarmed";
Hooks.on("dnd5e.preRollAttackV2", (config) => {
  try {
    const act = config?.subject, n = wrapsBonus(act?.actor);
    if (n && unarmed(act) && config.rolls?.[0]) (config.rolls[0].parts ??= []).push(`${n}`);
  } catch (err) { console.warn(`${MODULE_ID} | wraps attack failed`, err); }
});
Hooks.on("dnd5e.preRollDamageV2", (config) => {
  try {
    const act = config?.subject, n = wrapsBonus(act?.actor), r = config.rolls?.[0];
    if (!n || !unarmed(act) || !r) return;
    (r.parts ??= []).push(`${n}`);
    r.options ??= {};
    const types = Array.from(r.options.types ?? (r.options.type ? [r.options.type] : []));
    if (!types.includes("force")) r.options.types = [...types, "force"];
  } catch (err) { console.warn(`${MODULE_ID} | wraps damage failed`, err); }
});

// ------------------------------------------------------------------ Before use: Instrument of the Bards, Staff of the Adder
Hooks.on("dnd5e.preUseActivity", (activity) => {
  try {
    const { item, activity: src } = sourceOf(activity), actor = item?.actor;
    if (!actor) return;
    if (isMagicItem(item, "instrument-of-the-bards") && item.type !== "spell" && !attuned(item)) {
      ui.notifications.warn(`${item.name}: you aren't attuned to it - DC 15 WIS save or 2d4 Psychic damage, and no spell.`);
      later(async () => {
        if (!(await failSave(actor, "wis", 15))) return say(actor, `<strong>${item.name}:</strong> ${actor.name} resists the instrument.`);
        const dmg = await rollMsg(actor, "2d4", `${item.name}: unattuned play (Psychic)`);
        await actor.applyDamage([{ value: dmg, type: "psychic" }]);
      }, 300);
      return false;
    }
    if (ident(src) === "adder-bite" && !actor.effects.some((e) => e.flags?.world?.cgaAdder && !e.disabled)) {
      ui.notifications.warn("Staff of the Adder: animate the snake head first (Bonus Action).");
      return false;
    }
  } catch (err) { console.warn(`${MODULE_ID} | DMG item preUse failed`, err); }
});

// ------------------------------------------------------------------ Workflow done
const ENSPELL = { "enspelled-armor": ["abj", "ill"], "enspelled-weapon": ["con", "div", "evo", "nec", "trs"], "enspelled-staff": null };
const ENSPELL_TABLE = [[13, 5, "uncommon"], [13, 5, "uncommon"], [13, 5, "rare"], [15, 7, "rare"], [15, 7, "veryRare"], [17, 9, "veryRare"], [17, 9, "legendary"], [18, 10, "legendary"], [18, 10, "legendary"]];
async function findSpell(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  for (const id of [`${MODULE_ID}.cga-spells`, "dnd5e.spells24", "dnd5e.spells"]) {
    const pack = game.packs.get(id);
    const hit = pack && (await pack.getIndex()).find((e) => e.name.toLowerCase() === n);
    if (hit) return pack.getDocument(hit._id);
  }
  return game.items.find((i) => i.type === "spell" && i.name.toLowerCase() === n) ?? null;
}
async function bindSpell(item) {
  const kind = Object.keys(ENSPELL).find((k) => isMagicItem(item, k));
  if (!kind) return;
  const schools = ENSPELL[kind];
  const label = schools ? schools.map((s) => CONFIG.DND5E.spellSchools[s]?.label ?? s).join(", ") : "any school";
  const name = await foundry.applications.api.DialogV2.prompt({ window: { title: `Bind Spell: ${item.name}` },
    content: `<p>Which spell is bound into it? Level 8 or lower, ${label}.</p><input type="text" name="spell" placeholder="Spell name" autofocus>`,
    ok: { label: "Bind", callback: (ev, button) => button.form.elements.spell.value } }).catch(() => null);
  if (!name) return;
  const spell = await findSpell(name);
  if (!spell) return ui.notifications.warn(`Bind Spell: no spell named "${name}" in the compendiums.`);
  const lvl = Number(spell.system.level ?? 0);
  if (lvl > 8) return ui.notifications.warn(`Bind Spell: ${spell.name} is above level 8.`);
  if (schools && !schools.includes(spell.system.school)) return ui.notifications.warn(`Bind Spell: ${spell.name} isn't ${label}.`);
  const [dc, atk, rarity] = ENSPELL_TABLE[lvl];
  const upd = { "system.rarity": rarity };
  for (const a of item.system.activities.filter((x) => ident(x) === "enspelled-cast")) upd[`system.activities.-=${a.id}`] = null;
  const id = foundry.utils.randomID();
  upd[`system.activities.${id}`] = { _id: id, type: "cast", name: `Cast ${spell.name}`, img: spell.img,
    consumption: { targets: [{ type: "itemUses", value: "1", target: "", scaling: {} }], scaling: { allowed: false, max: "" }, spellSlot: false },
    spell: { uuid: spell.uuid, challenge: { override: true, save: dc, attack: atk }, properties: [], spellbook: false, ability: "", level: null },
    midiProperties: { identifier: "enspelled-cast" } };
  await item.update(upd);
  say(item.actor, `<strong>${item.name}:</strong> ${spell.name} is bound into it (save DC ${dc}, +${atk} to hit, ${CONFIG.DND5E.itemRarity[rarity] ?? rarity}). Expend 1 charge to cast it.`);
}
async function grantFireBreath(actor) {
  const src = await fromUuid(`Compendium.${MODULE_ID}.cga-features.Item.cgaIxFireExhFt00`);
  const old = actor.items.filter((i) => i.flags?.world?.cgaGrantedBy === "potion-of-fire-breath");
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((i) => i.id));
  if (src) { const data = src.toObject(); delete data._id; foundry.utils.setProperty(data, "flags.world.cgaGrantedBy", "potion-of-fire-breath"); await actor.createEmbeddedDocuments("Item", [data]); }
  await addEffect(actor, { name: "Potion of Fire Breath (1 hour)", img: "icons/magic/fire/projectile-smoke-swirl-red.webp", transfer: false,
    duration: { seconds: 3600, value: 3600, units: "seconds" }, flags: { world: { cgaFireBreath: true }, dae: { stackable: "noneName", specialDuration: [] } } });
}
async function endFireBreath(actor) {
  const feats = actor.items.filter((i) => i.flags?.world?.cgaGrantedBy === "potion-of-fire-breath");
  if (feats.length) await actor.deleteEmbeddedDocuments("Item", feats.map((i) => i.id)).catch(() => {});
  const fx = actor.effects.filter((e) => e.flags?.world?.cgaFireBreath);
  if (fx.length) await removeEffects(actor, fx.map((e) => e.id));
}

Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item, act = workflow?.activity;
    if (!actor || !act) return;
    const id = ident(act);
    if (id === "cube-crank") {
      const n = await rollMsg(actor, "1d6", "Cube of Summoning: the crank turns");
      const cast = findAct(item, `cube-${n}`);
      // The spell's own dialog opens, so the player picks the creature's form.
      if (cast) later(() => MidiQOL.completeActivityUse(cast, {}, { configure: true }, {}), 600);
      return;
    }
    if (id === "enspelled-bind") return bindSpell(item);
    // A bound spell's workflow belongs to the cast spell: look through to the staff.
    const src = sourceOf(act);
    if (ident(src.activity) === "enspelled-cast" && isMagicItem(src.item, "enspelled-staff") && Number(src.item.system.uses?.value ?? 1) <= 0) {
      const staff = src.item;
      const r = await rollMsg(actor, "1d20", `${staff.name}: the last charge (on a 1 it becomes a nonmagical Quarterstaff)`);
      if (r === 1) say(actor, `<strong>${staff.name}</strong> loses its properties and becomes a nonmagical Quarterstaff (change it on the sheet).`);
      return;
    }
    if (id === "goat-terror-horn") {
      const p = await askChoice(actor, `Goat of Terror: ${actor.name}`, "<p>Remove which horn?</p>", [{ action: "lance", label: "+1 Lance", default: true }, { action: "longsword", label: "+2 Longsword" }]);
      const [base, bonus] = p === "longsword" ? ["Longsword", 2] : ["Lance", 1];
      const pack = game.packs.get("dnd5e.equipment24");
      const hit = pack && (await pack.getIndex()).find((e) => e.name === base);
      const doc = hit && await pack.getDocument(hit._id);
      if (!doc) return;
      const data = doc.toObject(); delete data._id;
      Object.assign(data, { name: `Goat of Terror Horn (+${bonus} ${base})` });
      Object.assign(data.system, { magicalBonus: bonus, equipped: true, properties: [...new Set([...(data.system.properties ?? []), "mgc"])] });
      foundry.utils.setProperty(data, "flags.world.cgaGoatHorn", item.uuid);
      await actor.createEmbeddedDocuments("Item", [data]);
      return say(actor, `<strong>Goat of Terror:</strong> ${actor.name} takes a horn - a +${bonus} ${base} until the goat reverts.`);
    }
    if (id === "iron-bands-release") {
      let n = 0;
      for (const t of sceneTokens(tokensOf(actor)[0] ?? canvas.scene?.tokens?.contents?.[0])) {
        const fx = t.actor?.effects?.filter((e) => e.flags?.world?.cgaIronBands && String(e.origin ?? "").startsWith(item.uuid)) ?? [];
        if (fx.length) { await removeEffects(t.actor, fx.map((e) => e.id)); n++; }
      }
      return say(actor, n ? "<strong>Iron Bands of Bilarro:</strong> the bands let go and snap back into a sphere." : "<strong>Iron Bands of Bilarro:</strong> nobody is bound.");
    }
    if (id === "keoghtom") {
      for (const t of targetsOf(workflow)) {
        const fx = t.actor.effects.filter((e) => e.statuses?.has?.("poisoned"));
        if (fx.length) await removeEffects(t.actor, fx.map((e) => e.id));
      }
      return;
    }
    if (id === "fire-breath-drink") return grantFireBreath(actor);
    // The workflow's item can predate the use it just spent: read the live one.
    if (id === "fire-breath-exhale") { later(() => { if (Number(actor.items.get(item.id)?.system.uses?.value ?? 0) <= 0) return endFireBreath(actor); }, 500); return; }
    if (id === "rival-coin") {
      const n = await rollMsg(actor, "1d6", "Rival Coin: even is heads, odd is tails");
      if (n % 2 === 0) { const ts = targetsOf(workflow); if (ts.length) await runAct(item, "rival-coin-heads", ts); return; }
      const dmg = await rollMsg(actor, "1d4", "Rival Coin: tails (Psychic damage to you)");
      return actor.applyDamage([{ value: dmg, type: "psychic" }]);
    }
    if (act.midiProperties?.automationOnly) return;

    // ---- Walloping Ammunition
    const ammo = workflow.ammunition;
    if (ammo && isMagicItem(ammo, "walloping-ammunition")) for (const t of hits(workflow))
      if (await failSave(t.actor, "str", 10)) await addEffect(t.actor, await statusEffect("prone", { name: "Walloping Ammunition: Prone" }));
  } catch (err) { console.warn(`${MODULE_ID} | DMG item RollComplete rules failed`, err); }
});
// Fire Breath ends when its hour is up.
Hooks.on("deleteActiveEffect", (effect) => {
  if (!isGM() || !effect.flags?.world?.cgaFireBreath || !(effect.parent instanceof Actor)) return;
  const feats = effect.parent.items.filter((i) => i.flags?.world?.cgaGrantedBy === "potion-of-fire-breath");
  if (feats.length) effect.parent.deleteEmbeddedDocuments("Item", feats.map((i) => i.id)).catch(() => {});
});

// ------------------------------------------------------------------ Figurines: Obsidian Steed, Goat of Terror
// dnd5e stores the summoning item as the origin and the activity's id beside it.
const summonOrigin = (actor) => { const s = actor?.getFlag?.("dnd5e", "summon"); const o = s?.origin ? fromUuidSync(s.origin) : null; return o?.system?.activities?.get?.(s.activity) ?? null; };
Hooks.on("dnd5e.postSummon", async (activity) => {
  try {
    const item = activity?.item, actor = item?.actor;
    if (!actor || !isMagicItem(item, "figurine-of-wondrous-power-obsidian-steed")) return;
    const r = await rollMsg(actor, "1d10", "Obsidian Steed: on a 1 the nightmare ignores your orders");
    if (r === 1) say(actor, "<strong>Obsidian Steed:</strong> the nightmare ignores your orders this time, including a command to revert. Mounting it now carries you both to a random spot in Hades.");
  } catch (err) { console.warn(`${MODULE_ID} | figurine summon failed`, err); }
});
Hooks.on("updateCombat", async (combat, changes) => {
  try {
    if (!isGM() || !("turn" in changes || "round" in changes)) return;
    const cur = combat.combatant, me = cur?.token;
    if (!me?.actor) return;
    // Mariner's Armor: start the turn underwater at 0 HP.
    const mar = magicItem(me.actor, "mariners-armor");
    if (mar && Number(me.actor.system.attributes?.hp?.value ?? 1) <= 0 && usesLeft(mar, 1) > 0
      && await askOwner(me.actor, `Mariner's Armor: ${me.name}`, `<p>${me.name} starts its turn at 0 HP. Is it underwater? The armor heals 1d4 HP (once per dawn).</p>`)) {
      await spend(mar);
      const heal = await rollMsg(me.actor, "1d4", "Mariner's Armor (healing)");
      await me.actor.applyDamage([{ value: heal, type: "healing" }]);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Mariner's Armor failed`, err); }
});
Hooks.on("updateCombat", async (combat, changes) => {
  try {
    if (!isGM() || !("turn" in changes || "round" in changes)) return;
    const me = combat.combatant?.token;
    if (!me?.actor || !alive(me.actor)) return;
    const immune = Number(me.actor.getFlag("world", "cgaGoatImmune") ?? -1);
    if (immune > game.time.worldTime) return;
    for (const g of sceneTokens(me)) {
      const act = summonOrigin(g.actor);
      if (ident(act) !== "figurine-goat-of-terror" || g === me || edgeDistance(g, me, g.parent) > 30) continue;
      const rider = act.item?.actor;
      // The summoned goat can keep the compendium creature's disposition: judge hostility from the rider.
      if (!hostile(tokensOf(rider)[0] ?? g, me)) continue;
      if (!rider?.effects?.some((e) => e.flags?.world?.cgaGoatTerror && !e.disabled)) continue;
      if (me.actor.effects.some((e) => e.name === "Goat of Terror: Frightened")) return;
      const w = await runAct(act.item, "goat-terror-save", [me]);
      if (w && !Array.from(w.failedSaves ?? []).length) await updateActor(me.actor, { "flags.world.cgaGoatImmune": game.time.worldTime + 86400 });
      return;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Goat of Terror aura failed`, err); }
});
// The goat reverts: the horns go back and the rider dismounts.
Hooks.on("deleteToken", async (token) => {
  try {
    if (!isGM()) return;
    const act = summonOrigin(token.actor);
    if (ident(act) !== "figurine-goat-of-terror") return;
    const rider = act.item?.actor;
    if (!rider) return;
    const horns = rider.items.filter((i) => i.flags?.world?.cgaGoatHorn === act.item.uuid);
    if (horns.length) await rider.deleteEmbeddedDocuments("Item", horns.map((i) => i.id));
    const fx = rider.effects.filter((e) => e.flags?.world?.cgaGoatTerror);
    if (fx.length) await removeEffects(rider, fx.map((e) => e.id));
  } catch (err) { console.warn(`${MODULE_ID} | Goat of Terror revert failed`, err); }
});
