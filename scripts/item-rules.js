// Champions Guild Automation - magic item rules (2024 Dungeon Master's Guide).
// These run from module hooks and find the item on the character by its identifier (or name), so they work on the
// character's own D&D Beyond, compendium or hand-made item - whatever base weapon it is - with no Mass Apply.
// An item that requires attunement only counts while attuned; worn/wielded items only while equipped.
//  - Holy Avenger: +2d10 Radiant when it hits a Fiend or an Undead; while it's equipped, you and friendly creatures in a
//    10-ft Emanation (30 ft at Paladin 17) have Advantage on saves against spells and magical effects.
//  - Defender: the first attack with it on each of your turns, choose how much of its +3 moves to your AC until the
//    start of your next turn.
//  - Luck Blade: once per Long Rest, reroll a failed attack roll or saving throw (asked when it fails; the second roll
//    stands).
//  - Gloves of Missile Snaring: Reaction when hit by a Ranged or Thrown weapon attack - reduce the damage by
//    1d10 + DEX.
//  - Ring of Evasion: Reaction when you fail a DEX save - spend a charge to succeed instead.
//  - Sun Blade: +1d8 Radiant against Undead. Sword of Wounding: +2d6 Necrotic and a DC 15 CON save or no regaining HP.
//  - Holy Water only harms Fiends and Undead. Dagger of Venom: a coated blade rolls its Poison Save on the next hit.
//  - Passive effects: Mantle of Spell Resistance, Adamantine Armor (no crits against you), Bracers of Defense (off in
//    armor or with a Shield). Boots of Speed: Opportunity Attacks against you have Disadvantage while they are active.
import { MODULE_ID, reduceDamage, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey } from "./main.js";

export const isGM = () => game.users.activeGM?.isSelf;
export const tokenOf = (t) => t?.document ?? t;
export const say = (actor, html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${html}</p>` });
const slug = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export const reactionFree = (actor) => !MidiQOL.hasUsedReaction?.(actor);
export const useReaction = (actor) => MidiQOL.setReactionUsed?.(actor);
export const canReact = (actor) => actor && reactionFree(actor) && !isIncapacitated(actor) && Number(actor.system.attributes?.hp?.value ?? 1) > 0;

// Does this item count as the magic item `ident`? Matches the identifier (also "holy-avenger-longsword" style) or name.
export function isMagicItem(item, ident) {
  const id = item?.system?.identifier ?? "";
  return id === ident || id.startsWith(`${ident}-`) || slug(item?.name).startsWith(ident);
}
export const attuned = (i) => i.system?.attunement !== "required" || !!i.system?.attuned;
export const equipped = (i) => i.system?.equipped !== false;
export function magicItem(actor, ident, { worn = true } = {}) {
  return actor?.items?.find((i) => isMagicItem(i, ident) && attuned(i) && (!worn || equipped(i)));
}
export async function spendUse(item, n = 1) {
  try { await item.update({ "system.uses.spent": Number(item.system.uses.spent ?? 0) + n }); }
  catch (err) { await MidiQOL.socket().executeAsGM("updateItems", { actorUuid: item.actor.uuid, updates: [{ _id: item.id, "system.uses.spent": Number(item.system.uses.spent ?? 0) + n }] }).catch(() => {}); }
}
// Creature type of an NPC, or the species of a character.
export function creatureType(actor) {
  const t = actor?.system?.details?.type;
  const v = typeof t === "object" ? `${t?.value ?? ""} ${t?.custom ?? ""} ${t?.subtype ?? ""}` : String(t ?? "");
  const race = actor?.system?.details?.race;
  return `${v} ${typeof race === "string" ? race : race?.name ?? ""}`.toLowerCase();
}

// ------------------------------------------------------------------ Bonus damage on hit (Holy Avenger)
// Added as a midi bonus damage roll once the weapon's own damage is rolled, so it shows on the card and doubles on a crit.
export const ON_HIT = [
  { ident: "holy-avenger", label: "Holy Avenger", formula: "2d10", type: "radiant",
    when: (target) => /\b(fiend|undead)\b/.test(creatureType(target)),
    // A D&D Beyond import may already carry the 2d10 Radiant on the weapon: don't add it twice.
    builtIn: (item) => hasPart(item, 2, 10, "radiant") },
  { ident: "sun-blade", label: "Sun Blade", formula: "1d8", type: "radiant",
    when: (target) => /\bundead\b/.test(creatureType(target)), builtIn: (item) => hasPart(item, 1, 8, "radiant", true) },
  // Sword of Wounding (2024): +2d6 Necrotic, then a DC 15 CON save or no regaining HP (see woundTargets below).
  // midi-qol's sample "Longsword of Wounding" is the 2014 item with its own macro: leave that one alone.
  { ident: "sword-of-wounding", label: "Sword of Wounding", formula: "2d6", type: "necrotic", when: () => true,
    builtIn: (item) => !!(item.flags?.["midi-qol"]?.onUseMacroName || item.flags?.dae?.macro?.command) }
];
// Does one of the item's activities already roll this extra damage die (not counting the weapon's own first part)?
export function hasPart(item, number, denomination, type, extraOnly = false) {
  return Object.values(item.system.activities?.contents ?? item.system.activities ?? {}).some((a) => (a.damage?.parts ?? [])
    .some((p, i) => (!extraOnly || i > 0 || a.type !== "attack") && p.number === number && p.denomination === denomination && (p.types?.has?.(type) || p.types?.includes?.(type))));
}
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const item = workflow?.item;
    if (!item || !workflow.activity?.attack || !workflow.hitTargets?.size) return;
    // A rule matches the attacking item by identifier, or by its own match(workflow) (e.g. an effect on the attacker).
    // It adds { formula, type } when when(target) holds for a creature hit, or whatever its async bonus(workflow) returns.
    for (const rule of ON_HIT) {
      if (rule.match ? !rule.match(workflow) : (!isMagicItem(item, rule.ident) || !attuned(item))) continue;
      if (rule.builtIn?.(item, workflow)) continue;
      const parts = rule.bonus ? ((await rule.bonus(workflow, item)) ?? [])
        : Array.from(workflow.hitTargets).some((t) => rule.when(tokenOf(t).actor, workflow)) ? [{ formula: rule.formula, type: rule.type }] : [];
      for (const p of parts) {
        const type = typeof p.type === "function" ? p.type(workflow) : p.type;
        const roll = await new CONFIG.Dice.DamageRoll(p.formula, item.getRollData(), { type, types: [type], flavor: `${p.label ?? rule.label} (${type})`, isCritical: p.crit ?? !!workflow.isCritical }).evaluate();
        await workflow.setBonusDamageRolls([...(workflow.bonusDamageRolls ?? []), roll]);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | item bonus damage failed`, err); }
});

// ------------------------------------------------------------------ Item auras (Holy Avenger)
export const chg = (key, value, type = "override") => ({ key, value, type, priority: 20, phase: "initial" });
const ITEM_AURAS = [
  { ident: "holy-avenger", key: "holy-avenger", range: (a) => (Number(a.classes?.paladin?.system?.levels ?? 0) >= 17 ? 30 : 10),
    effect: () => ({ name: "Holy Avenger Aura", img: "icons/magic/holy/barrier-shield-winged-blue.webp",
      description: "<p>Advantage on saving throws against spells and other magical effects (Holy Avenger).</p>",
      changes: [chg("flags.midi-qol.magicResistance.all", "1")] }) }
];
const auraTimers = new Map();
function scheduleItemAuras(scene) {
  if (!scene || !isGM()) return;
  clearTimeout(auraTimers.get(scene.id));
  auraTimers.set(scene.id, setTimeout(() => sweepItemAuras(scene).catch((err) => console.warn(`${MODULE_ID} | item aura sweep failed`, err)), 450));
}
async function sweepItemAuras(scene) {
  const tokens = scene.tokens.filter((t) => t.actor);
  const want = new Map();
  for (const src of tokens) {
    for (const aura of ITEM_AURAS) {
      const item = magicItem(src.actor, aura.ident);
      if (!item || isIncapacitated(src.actor) || Number(src.actor.system.attributes.hp.value ?? 0) <= 0) continue;
      const range = aura.range(src.actor);
      for (const t of tokens) {
        if (t !== src && (t.disposition !== src.disposition || edgeDistance(src, t, scene) > range)) continue;
        if (!want.has(`${t.id}|${aura.key}`)) want.set(`${t.id}|${aura.key}`, { t, aura, src, item });
      }
    }
  }
  for (const t of tokens) {
    const have = t.actor.effects.filter((e) => e.flags?.[MODULE_ID]?.itemAura);
    for (const aura of ITEM_AURAS) {
      const w = want.get(`${t.id}|${aura.key}`);
      const cur = have.filter((e) => e.flags[MODULE_ID].itemAura.key === aura.key);
      const keep = w ? cur.find((e) => e.flags[MODULE_ID].itemAura.source === w.src.actor.uuid) : null;
      const drop = cur.filter((e) => e !== keep);
      if (drop.length) await t.actor.deleteEmbeddedDocuments("ActiveEffect", drop.map((e) => e.id)).catch(() => {});
      if (w && !keep) {
        const data = w.aura.effect(w.src.actor);
        await t.actor.createEmbeddedDocuments("ActiveEffect", [{ name: data.name, img: data.img, description: data.description, transfer: false, origin: w.item.uuid,
          system: { changes: data.changes }, flags: { [MODULE_ID]: { itemAura: { key: aura.key, source: w.src.actor.uuid } } } }]).catch(() => {});
      }
    }
  }
}
for (const h of ["moveToken", "createToken", "deleteToken"]) Hooks.on(h, (doc) => scheduleItemAuras(doc.parent));
Hooks.on("updateToken", (doc, changes) => { if (["disposition", "hidden", "x", "y", "elevation"].some((k) => k in changes)) scheduleItemAuras(doc.parent); });
const rescanActor = (actor) => { if (actor instanceof Actor) for (const t of actor.getActiveTokens?.() ?? []) scheduleItemAuras(t.document.parent); };
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => rescanActor(item.parent));
Hooks.on("updateItem", (item, changes) => { if (foundry.utils.hasProperty(changes, "system.equipped") || foundry.utils.hasProperty(changes, "system.attuned")) rescanActor(item.parent); });
Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes, "system.attributes.hp.value")) rescanActor(actor); });
for (const h of ["createActiveEffect", "deleteActiveEffect"]) Hooks.on(h, (e) => { if (e.statuses?.size && !e.flags?.[MODULE_ID]?.itemAura) rescanActor(e.parent); });
Hooks.on("canvasReady", () => scheduleItemAuras(canvas.scene));

// ------------------------------------------------------------------ Defender (first attack each turn)
const defenderAsked = new Map(); // actor uuid -> turn key
Hooks.on("midi-qol.preAttackRoll", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !isMagicItem(item, "defender") || !attuned(item)) return;
    const combat = game.combat;
    if (!combat?.started || combat.combatant?.actor !== actor) return; // "on each of your turns"
    const key = turnKey();
    if (defenderAsked.get(actor.uuid) === key) return;
    defenderAsked.set(actor.uuid, key);
    const old = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.defender);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id)).catch(() => {});
    const pick = await askChoice(actor, `Defender: ${actor.name}`, `<p>First attack with Defender this turn. Move how much of its +3 bonus to your Armor Class until the start of your next turn?</p>`,
      [0, 1, 2, 3].map((n) => ({ action: String(n), label: n ? `+${n} AC (+${3 - n} to hit)` : "Keep +3 to hit", default: n === 0 })));
    const n = Number(pick ?? 0);
    if (!n) return;
    await actor.createEmbeddedDocuments("ActiveEffect", [{ name: `Defender (+${n} AC)`, img: item.img || "icons/weapons/swords/greatsword-guard-jewel-green.webp", origin: item.uuid, transfer: false,
      description: `<p>${n} of Defender's +3 bonus moved to AC until the start of your next turn.</p>`,
      system: { changes: [chg("system.attributes.ac.bonus", `+${n}`, "add"), chg("system.bonuses.mwak.attack", `-${n}`, "add"), chg("system.bonuses.mwak.damage", `-${n}`, "add")] },
      duration: { rounds: 1 }, flags: { [MODULE_ID]: { defender: true }, dae: { specialDuration: ["turnStart"] } } }]);
  } catch (err) { console.warn(`${MODULE_ID} | Defender failed`, err); }
});
// Fallback cleanup if DAE didn't expire it: the Defender AC effect ends when its owner's next turn starts.
Hooks.on("updateCombat", async (combat, changed) => {
  if (!isGM() || !("turn" in changed || "round" in changed) || !combat.started) return;
  const actor = combat.combatant?.actor;
  const old = actor?.effects?.filter((e) => e.flags?.[MODULE_ID]?.defender) ?? [];
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id)).catch(() => {});
});

// ------------------------------------------------------------------ Luck Blade (reroll a failed attack roll)
const luckReady = (actor) => {
  const blade = magicItem(actor, "luck-blade", { worn: false });
  return blade && !blade.getFlag("world", "cgaLuckUsed") && !isIncapacitated(actor) ? blade : null;
};
async function useLuck(blade) {
  try { await blade.setFlag("world", "cgaLuckUsed", true); }
  catch (err) { await MidiQOL.socket().executeAsGM("updateItems", { actorUuid: blade.actor.uuid, updates: [{ _id: blade.id, "flags.world.cgaLuckUsed": true }] }).catch(() => {}); }
}
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical) return;
    const attacker = workflow.actor;
    const blade = luckReady(attacker);
    if (!blade) return;
    const tDoc = tokenOf(Array.from(workflow.targets)[0]);
    const ac = Number(tDoc.actor?.system?.attributes?.ac?.value ?? 10);
    const roll = workflow.attackRoll;
    const die = roll.dice?.[0];
    const kept = die?.results?.find((r) => r.active && !r.discarded);
    if (!kept || (roll.total >= ac && !workflow.isFumble)) return;
    if (!(await askOwner(attacker, `Luck Blade: ${attacker.name}`, `<p>The attack (${roll.total}) misses ${tDoc.name}. Call on the Luck Blade's luck to reroll the d20 (once per Long Rest; you must use the new roll)?</p>`))) return;
    await useLuck(blade);
    const r = await new Roll("1d20").evaluate();
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: attacker }), flavor: `Luck Blade: rerolled d20 (was ${kept.result})` });
    kept.result = r.total;
    roll._total = roll._evaluateTotal();
    if (r.total === 20) workflow.isCritical = true;
    workflow.isFumble = r.total === 1;
    await workflow.setAttackRoll?.(roll);
  } catch (err) { console.warn(`${MODULE_ID} | Luck Blade attack reroll failed`, err); }
});

// ------------------------------------------------------------------ Failed saves: Luck Blade reroll, Ring of Evasion
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size) return;
    const ability = workflow.activity?.save?.ability?.first?.() ?? Array.from(workflow.activity?.save?.ability ?? [])[0] ?? workflow.saveActivity?.save?.ability?.first?.();
    const dc = Number(workflow.activity?.save?.dc?.value ?? workflow.saveDC ?? 10);
    const succeed = (t) => { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); };
    for (const t of Array.from(workflow.failedSaves)) {
      const actor = tokenOf(t)?.actor;
      if (!actor) continue;
      // Ring of Evasion: a failed DEX save, Reaction + 1 charge
      const ring = ability === "dex" ? magicItem(actor, "ring-of-evasion") : null;
      const hasCharges = ring && (!ring.system.uses?.max || Number(ring.system.uses.value ?? 0) > 0);
      if (hasCharges && canReact(actor)
        && await askOwner(actor, `Ring of Evasion: ${actor.name}`, `<p>${actor.name} fails a DC ${dc} Dexterity save. Use your Reaction and a charge of the Ring of Evasion${ring.system.uses?.max ? ` (${ring.system.uses.value} left)` : ""} to succeed instead?</p>`)) {
        if (ring.system.uses?.max) await spendUse(ring);
        await useReaction(actor);
        succeed(t);
        say(actor, `<strong>Ring of Evasion:</strong> ${actor.name} succeeds on the Dexterity save instead.`);
        continue;
      }
      // Luck Blade: reroll the failed save (the second roll stands)
      const blade = luckReady(actor);
      if (blade && ability && await askOwner(actor, `Luck Blade: ${actor.name}`, `<p>${actor.name} fails a DC ${dc} ${CONFIG.DND5E.abilities[ability]?.label ?? ability} save. Call on the Luck Blade's luck to reroll it (once per Long Rest; you must use the new roll)?</p>`)) {
        await useLuck(blade);
        const res = await actor.rollSavingThrow({ ability, target: dc }, { configure: false }, { data: { flavor: `Luck Blade reroll (DC ${dc})` } }).catch(() => null);
        const r = Array.isArray(res) ? res[0] : res;
        if (r && r.total >= dc) { succeed(t); say(actor, `<strong>Luck Blade:</strong> ${actor.name} succeeds on the reroll (${r.total}).`); }
        else say(actor, `<strong>Luck Blade:</strong> ${actor.name} still fails (${r?.total ?? "?"}).`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | failed-save item rules failed`, err); }
});
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!(config?.type === "long" || result?.longRest) || !actor.isOwner) return;
    for (const i of actor.items.filter((x) => x.getFlag("world", "cgaLuckUsed"))) await i.unsetFlag("world", "cgaLuckUsed");
  } catch (err) { console.warn(`${MODULE_ID} | Luck Blade reset failed`, err); }
});

// ------------------------------------------------------------------ Gloves of Missile Snaring
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
    const tokenDoc = tokenOf(token);
    const act = workflow?.activity;
    const ranged = act?.actionType === "rwak" || workflow?.attackMode === "thrown" || act?.attack?.type?.value === "ranged";
    const weapon = act?.attack?.type?.classification === "weapon" || workflow?.item?.type === "weapon" || ["mwak", "rwak"].includes(act?.actionType);
    if (!act?.attack || !ranged || !weapon) return;
    if (!Array.from(workflow.hitTargets ?? []).some((t) => tokenOf(t) === tokenDoc)) return;
    if (!magicItem(actor, "gloves-of-missile-snaring") || !canReact(actor)) return;
    const dex = Number(actor.system.abilities.dex?.mod ?? 0);
    const dealt = Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
    if (!(await askOwner(actor, `Gloves of Missile Snaring: ${actor.name}`, `<p>${workflow.actor?.name ?? "A ranged attack"} hits ${actor.name} for ${dealt} damage. Use your Reaction to reduce it by 1d10 + ${dex}?</p>`))) return;
    const roll = await new Roll(`1d10 + ${dex}`).evaluate();
    const cut = reduceDamage(ditem, Math.max(0, roll.total));
    await useReaction(actor);
    const caught = Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0)) === 0;
    roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Gloves of Missile Snaring: ${actor.name} reduces the damage by ${cut}${caught ? " and can catch the missile" : ""}` });
  } catch (err) { console.warn(`${MODULE_ID} | Gloves of Missile Snaring failed`, err); }
});

// ------------------------------------------------------------------ Sword of Wounding (2024): save or no regaining HP
// After the hit, each creature hit makes a DC 15 CON save; on a failure it can't regain Hit Points for 1 hour and repeats
// the save at the end of each of its turns (midi OverTime ends the effect on a success).
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const item = workflow?.item;
    if (!item || !workflow.activity?.attack || !workflow.hitTargets?.size || !attuned(item)) return;
    if (isMagicItem(item, "sword-of-wounding") && !ON_HIT.find((r) => r.ident === "sword-of-wounding").builtIn(item)) {
      for (const t of Array.from(workflow.hitTargets)) {
        const target = tokenOf(t).actor;
        if (!target || Number(target.system.attributes?.hp?.value ?? 0) <= 0) continue;
        const res = await target.rollSavingThrow({ ability: "con", target: 15 }, { configure: false }, { data: { flavor: "Sword of Wounding (DC 15)" } }).catch(() => null);
        const r = Array.isArray(res) ? res[0] : res;
        if (!r || r.total >= 15) continue;
        const effect = { name: "Wounded (can't regain HP)", img: "icons/skills/wounds/blood-drip-droplet-red.webp", origin: item.uuid, transfer: false,
          description: "<p>Can't regain Hit Points (Sword of Wounding). DC 15 CON save at the end of each of your turns ends it.</p>",
          duration: { seconds: 3600 }, system: { changes: [chg(`flags.${MODULE_ID}.noHealing`, "1"),
            chg("flags.midi-qol.OverTime", "turn=end, saveAbility=con, saveDC=15, label=Sword of Wounding", "custom")] },
          flags: { dae: { stackable: "noneName" } } };
        await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: target.uuid, effects: [effect] }).catch((err) => console.warn(`${MODULE_ID} | Wounded effect failed`, err));
      }
    }
    // Dagger of Venom (compendium version): a coated blade poisons the first creature it hits, then the coat is used up.
    if (isMagicItem(item, "dagger-of-venom")) {
      // The applied coat (an enchantment the Coat Blade activity put on the dagger), not the item's own definition of it.
      const coat = item.effects.find((e) => /poison coat/i.test(e.name) && !e.disabled && e.type === "enchantment" && /\.Activity\./.test(e.origin ?? ""));
      const save = item.system.activities.find((a) => a.type === "save" && /poison/i.test(a.name));
      const t = Array.from(workflow.hitTargets)[0];
      if (coat && save && t) {
        await coat.delete().catch(() => {});
        await MidiQOL.completeActivityUse(save, { midiOptions: { targetUuids: [tokenOf(t).uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {})
          .catch((err) => console.warn(`${MODULE_ID} | Dagger of Venom save failed`, err));
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | on-hit item saves failed`, err); }
});

// ------------------------------------------------------------------ Damage application: Holy Water, no-healing effects
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem) return;
    // Holy Water only harms Fiends and Undead.
    if (isMagicItem(workflow?.item, "holy-water") && !/\b(fiend|undead)\b/.test(creatureType(actor)) && (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) > 0) {
      reduceDamage(ditem, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
    }
    // Can't regain Hit Points (Sword of Wounding).
    const blocked = actor.effects.some((e) => !e.disabled && (e.system?.changes ?? e.changes ?? []).some((c) => c.key === `flags.${MODULE_ID}.noHealing`));
    if (blocked && (ditem.hpDamage ?? 0) < 0) {
      ditem.hpDamage = 0;
      ditem.newHP = ditem.oldHP;
      for (const d of ditem.damageDetail ?? []) if (d.type === "healing") d.value = 0;
      say(actor, `<strong>Wounded:</strong> ${actor.name} can't regain Hit Points.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | item damage rules failed`, err); }
});

// ------------------------------------------------------------------ Passive item effects kept up to date by the module
//  - Mantle of Spell Resistance: Advantage on saves against spells.
//  - Adamantine Armor (worn armor with the Adamantine property): Critical Hits against you become normal hits.
//  - Bracers of Defense: their +2 AC switches off while you wear armor or hold a Shield.
export const PASSIVES = [
  { key: "mantle", active: (a) => !!magicItem(a, "mantle-of-spell-resistance"),
    effect: { name: "Mantle of Spell Resistance", img: "icons/equipment/back/cloak-collared-blue.webp",
      changes: [chg("flags.midi-qol.advantage.save.all", 'workflow?.item?.type === "spell"')] } },
  { key: "adamantine", active: (a) => a.items.some((i) => i.type === "equipment" && i.system.equipped && ["light", "medium", "heavy"].includes(i.system.type?.value)
      && (i.system.properties?.has?.("ada") || isMagicItem(i, "adamantine"))),
    effect: { name: "Adamantine Armor", img: "icons/equipment/chest/breastplate-layered-steel.webp", changes: [chg("flags.midi-qol.grants.noCritical.all", "1")] } }
];
export const inArmorOrShield = (a) => a.items.some((i) => i.type === "equipment" && i.system.equipped && ["light", "medium", "heavy", "shield"].includes(i.system.type?.value));
const passiveTimers = new Map();
function schedulePassives(actor) {
  if (!(actor instanceof Actor) || !isGM()) return;
  clearTimeout(passiveTimers.get(actor.uuid));
  passiveTimers.set(actor.uuid, setTimeout(() => syncPassives(actor).catch((err) => console.warn(`${MODULE_ID} | passive item sync failed`, err)), 300));
}
async function syncPassives(actor) {
  for (const p of PASSIVES) {
    const cur = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.passive === p.key);
    const want = p.active(actor);
    // effect may be a function of the actor (e.g. a climb speed equal to the walking speed): replace it when it changes.
    const eff = want ? (typeof p.effect === "function" ? p.effect(actor) : p.effect) : null;
    const sig = eff ? JSON.stringify(eff.changes) : "";
    const stale = cur.filter((e) => !want || (e.flags[MODULE_ID].sig ?? sig) !== sig);
    if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map((e) => e.id));
    if (want && cur.length === stale.length) await actor.createEmbeddedDocuments("ActiveEffect", [{ name: eff.name, img: eff.img, transfer: false, system: { changes: eff.changes }, flags: { [MODULE_ID]: { passive: p.key, sig } } }]);
  }
  // Switch an item's own effects (D&D Beyond or compendium item) on and off: off(actor) says when they should be off.
  for (const t of ITEM_TOGGLES) {
    const off = t.off(actor);
    for (const it of actor.items.filter((i) => isMagicItem(i, t.ident))) {
      const upd = it.effects.filter((e) => e.type !== "enchantment" && (e.system?.changes ?? e.changes ?? []).some((c) => t.keys.includes(c.key)) && e.disabled !== off)
        .map((e) => ({ _id: e.id, disabled: off }));
      if (upd.length) await it.updateEmbeddedDocuments("ActiveEffect", upd);
    }
  }
}
export const wearsArmor = (a) => a.items.some((i) => i.type === "equipment" && i.system.equipped && ["light", "medium", "heavy"].includes(i.system.type?.value));
export const ITEM_TOGGLES = [
  // Bracers of Defense: +2 AC only with no armor and no Shield.
  { ident: "bracers-of-defense", keys: ["system.attributes.ac.bonus"], off: inArmorOrShield }
];
export const refreshPassives = (actor) => schedulePassives(actor);
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => schedulePassives(item.parent));
Hooks.on("updateItem", (item, changes) => { if (foundry.utils.hasProperty(changes, "system.equipped") || foundry.utils.hasProperty(changes, "system.attuned") || foundry.utils.hasProperty(changes, "system.properties")) schedulePassives(item.parent); });
Hooks.once("ready", () => { if (isGM()) for (const a of game.actors.filter((x) => x.type === "character")) schedulePassives(a); });

// ------------------------------------------------------------------ Boots of Speed: Opportunity Attacks against you have Disadvantage
Hooks.on("midi-qol.preAttackRollConfig", (workflow) => {
  try {
    if (!workflow?.AoO || workflow.targets?.size !== 1) return;
    const target = tokenOf(Array.from(workflow.targets)[0])?.actor;
    if (!target?.effects?.some((e) => /boots of speed/i.test(e.name) && !e.disabled && !e.isSuppressed)) return;
    workflow.attackRollModifierTracker?.disadvantage?.add?.("bootsOfSpeed", "Boots of Speed");
  } catch (err) { console.warn(`${MODULE_ID} | Boots of Speed failed`, err); }
});
