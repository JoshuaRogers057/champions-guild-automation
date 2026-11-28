// Champions Guild Automation - general feats from Arcana Unleashed, Forgotten Realms: Heroes of Faerûn and
// Astarion's Book of Hungers (priority 1). Module rules keyed on the feat's identifier or name, so a D&D Beyond or
// hand-made feat works with no Mass Apply.
//  - Spell Resistant, Magic Resistant: +1d6 to a failed save against a spell or magic item (PB/LR, asked).
//  - Bloodlust: Powerful Recovery (Hit Point Dice of 1-2 count as 3); Sanguine Feast - once per turn on a hit against
//    a Bloodied creature that isn't a Construct or Undead, spend a Hit Point Die to heal die + CON (PB/LR, asked).
//  - Cold Caster, Frostbite: once per turn, a hit that deals Cold damage - the target subtracts 1d4 from its next save
//    before the end of your next turn.
//  - Fairy Trickster, Flustering Strike: after a hit, the feat's WIS save activity (PB/LR, asked).
//  - Delicious Pain, Toughened Flesh: Reaction after B/P/S damage - B/P/S Resistance until your next turn (1/SR, asked).
//  - Purple Dragon Commandant, Last Stand: Advantage on attack rolls while Bloodied.
//  - Treacherous Allure, Inevitable Betrayal: Advantage on attack rolls against Charmed creatures.
//  - Abjuration Adept, Protective Ward: a slot Abjuration spell gives you or a creature within 30 ft 2 x slot level
//    Temporary Hit Points (asked who).
//  - Defense (Fighting Style): the feat's +1 AC effect switches off while you wear no Light, Medium or Heavy armor.
//  - Evocation Adept, Fueled Evocation: once per turn, add up to two Hit Point Dice to an Evocation spell's damage (asked).
import { MODULE_ID, askOwner, askChoice, edgeDistance, turnKey, reduceDamage } from "./main.js";
import { canReact, useReaction, say, tokenOf, creatureType, ITEM_TOGGLES, wearsArmor } from "./item-rules.js";
import { feat, prof, usesLeft, spend } from "./background-feats.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
export async function addEffect(actor, effect) {
  try { if (actor.isOwner) return await actor.createEmbeddedDocuments("ActiveEffect", [effect]); } catch (err) {}
  return asGM("createEffects", { actorUuid: actor.uuid, effects: [effect] });
}
export async function updateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return asGM("updateActor", { actorUuid: actor.uuid, updates });
}
export const hpOf = (a) => a?.system?.attributes?.hp ?? {};
export const isBloodied = (a) => { const hp = hpOf(a); const max = Number(hp.effectiveMax ?? hp.max ?? 0); return max > 0 && Number(hp.value ?? 0) > 0 && Number(hp.value) <= max / 2; };
export const living = (a) => !/construct|undead/.test(creatureType(a));
const isMagical = (item) => item?.type === "spell" || !!item?.system?.properties?.has?.("mgc");
export const castLevel = (wf) => Number(wf?.castData?.castLevel ?? wf?.spellLevel ?? wf?.item?.system?.level) || 0;
export const slotCast = (wf) => wf?.item?.type === "spell" && Number(wf.item.system.level ?? 0) >= 1 && castLevel(wf) >= 1 && wf.activity?.consumption?.spellSlot !== false;
export const damageTypes = (wf) => new Set((wf?.damageRolls ?? []).flatMap((r) => [r.options?.type, ...(r.options?.types ?? [])]).filter(Boolean));
// Hit Point Dice: classes with unspent dice, largest first.
export const hitDieClasses = (a) => (a?.itemTypes?.class ?? []).filter((c) => Number(c.system.hd?.value ?? 0) > 0)
  .sort((x, y) => Number(String(y.system.hd.denomination).slice(1)) - Number(String(x.system.hd.denomination).slice(1)));
export async function spendHitDie(cls) {
  const upd = { "system.hd.spent": Number(cls.system.hd.spent ?? 0) + 1 };
  try { await cls.update(upd); } catch (err) { await asGM("updateItems", { actorUuid: cls.actor.uuid, updates: [{ _id: cls.id, ...upd }] }); }
}
const once = new Map(); // `${rule}:${actor uuid}` -> turn key
export const usedThisTurn = (rule, actor) => once.get(`${rule}:${actor.uuid}`) === turnKey();
export const markTurn = (rule, actor) => once.set(`${rule}:${actor.uuid}`, turnKey());
// "Until the end of your next turn": dnd5e 6 ends a sourceEnd effect at the end of its source's next turn.
const untilSourceTurnEnd = { value: null, units: "rounds", expiry: "sourceEnd", expired: false };

// ------------------------------------------------------------------ Spell Resistant, Magic Resistant
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size || !isMagical(workflow.item)) return;
    const dc = Number(workflow.activity?.save?.dc?.value ?? workflow.saveDC ?? 0);
    if (!dc) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const tDoc = tokenOf(t), saver = tDoc?.actor;
      const it = saver && feat(saver, "spell-resistant");
      const roll = workflow.targetSaveDetails?.[tDoc?.uuid]?.saveRoll;
      if (!it || !roll || usesLeft(it, prof(saver)) <= 0) continue;
      const total = Number(roll.total ?? 0);
      if (total >= dc || total + 6 < dc) continue; // already a success, or 1d6 can't make it one
      if (!(await askOwner(saver, `Magic Resistant: ${saver.name}`, `<p>${saver.name} fails a DC ${dc} save against ${workflow.item.name} (${total}). Roll 1d6 and add it (${usesLeft(it, prof(saver))} uses left)?</p>`))) continue;
      await spend(it);
      const r = await new Roll("1d6").evaluate();
      const now = total + r.total;
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: saver }), flavor: `Magic Resistant: ${saver.name}'s save is now ${now} (DC ${dc})` });
      roll._total = now;
      if (now >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Magic Resistant failed`, err); }
});

// ------------------------------------------------------------------ Bloodlust, Powerful Recovery: Hit Point Dice of 1-2 count as 3
Hooks.on("dnd5e.preRollHitDieV2", (config) => {
  try {
    if (!feat(config?.subject, "bloodlust")) return;
    const r = config.rolls?.[0];
    if (!r?.parts?.length || /min3/.test(r.parts[0])) return;
    r.parts[0] = r.parts[0].replace(/(\d*d\d+)(?![\dA-Za-z])/, "$1min3");
  } catch (err) { console.warn(`${MODULE_ID} | Powerful Recovery failed`, err); }
});

// ------------------------------------------------------------------ Hits: Sanguine Feast, Frostbite, Flustering Strike
// Who was Bloodied when the attack hit (before its damage).
Hooks.on("midi-qol.hitsChecked", (workflow) => {
  try {
    if (!workflow?.actor || !feat(workflow.actor, "bloodlust")) return;
    workflow.cgaBloodied = Array.from(workflow.hitTargets ?? []).map(tokenOf).filter((t) => t?.actor && isBloodied(t.actor) && living(t.actor)).map((t) => t.uuid);
  } catch (err) {}
});
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor || !workflow.activity?.attack || !workflow.hitTargets?.size) return;
    const hits = Array.from(workflow.hitTargets).map(tokenOf).filter((t) => t?.actor);
    // Sanguine Feast
    const bl = feat(actor, "bloodlust");
    if (bl && workflow.cgaBloodied?.length && !usedThisTurn("sanguine", actor) && usesLeft(bl, prof(actor)) > 0) {
      const hp = hpOf(actor), cls = hitDieClasses(actor)[0];
      if (cls && Number(hp.value) < Number(hp.effectiveMax ?? hp.max)
        && await askOwner(actor, `Sanguine Feast: ${actor.name}`, `<p>You hit a Bloodied creature. Spend a Hit Point Die (${cls.system.hd.denomination}) to regain Hit Points (${usesLeft(bl, prof(actor))} uses left)?</p>`)) {
        markTurn("sanguine", actor);
        await spend(bl); await spendHitDie(cls);
        const r = await new Roll(`1${cls.system.hd.denomination}min3 + @abilities.con.mod`, actor.getRollData()).evaluate();
        const gain = Math.max(0, r.total);
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Sanguine Feast: ${actor.name} regains ${gain} Hit Points` });
        const cur = hpOf(actor);
        await updateActor(actor, { "system.attributes.hp.value": Math.min(Number(cur.effectiveMax ?? cur.max), Number(cur.value) + gain) });
      }
    }
    // Frostbite: once per turn, a hit dealing Cold damage
    const cc = feat(actor, "cold-caster");
    if (cc && !usedThisTurn("frostbite", actor) && damageTypes(workflow).has("cold")) {
      const t = hits[0];
      markTurn("frostbite", actor);
      await addEffect(t.actor, { name: "Frostbite (Cold Caster)", img: "icons/magic/water/snowflake-ice-blue-white.webp", transfer: false, origin: cc.uuid,
        duration: untilSourceTurnEnd, system: { changes: [{ key: "system.bonuses.abilities.save", value: "-1d4", type: "add", priority: 20, phase: "initial" }] },
        flags: { dae: { stackable: "noneName", specialDuration: ["isSave"] } } });
      say(actor, `<strong>Frostbite:</strong> ${t.name} subtracts 1d4 from its next saving throw before the end of ${actor.name}'s next turn.`);
    }
    // Flustering Strike (the feat's save activity)
    const ft = feat(actor, "fairy-trickster");
    const act = ft?.system?.activities?.find((a) => a.midiProperties?.identifier === "flustering-strike") ?? ft?.system?.activities?.find((a) => a.type === "save");
    if (act && usesLeft(ft, prof(actor)) > 0) {
      const t = hits.find((h) => Number(hpOf(h.actor).value ?? 0) > 0 && !h.actor.effects.some((e) => /flustered/i.test(e.name)));
      if (t && await askOwner(actor, `Flustering Strike: ${actor.name}`, `<p>You hit ${t.name}. Fluster it - Wisdom save or Disadvantage on saving throws until the end of your next turn (${usesLeft(ft, prof(actor))} uses left)?</p>`))
        await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [t.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch((err) => console.warn(`${MODULE_ID} | Flustering Strike failed`, err));
    }
  } catch (err) { console.warn(`${MODULE_ID} | P1 feat hit rules failed`, err); }
});

// ------------------------------------------------------------------ Delicious Pain, Toughened Flesh
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem }) => {
  try {
    const actor = token?.actor;
    const it = actor && feat(actor, "delicious-pain");
    if (!it || !ditem || usesLeft(it, 1, "sr") <= 0 || !canReact(actor)) return;
    const bps = ((ditem.calculatedDamages ?? ditem.damageDetail) ?? []).filter((d) => ["bludgeoning", "piercing", "slashing"].includes(d.type) && (d.value ?? 0) > 0).reduce((s, d) => s + d.value, 0);
    if (bps <= 0 || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0 || actor.effects.some((e) => e.name === "Toughened Flesh")) return;
    if (!(await askOwner(actor, `Toughened Flesh: ${actor.name}`, `<p>${actor.name} takes Bludgeoning, Piercing or Slashing damage. Use your Reaction for Resistance to those types until the start of your next turn (once per Short Rest)?</p>`))) return;
    await spend(it, "sr"); await useReaction(actor);
    await addEffect(actor, { name: "Toughened Flesh", img: "icons/magic/defensive/armor-skin-stone-brown.webp", transfer: false, origin: it.uuid, duration: { seconds: 6 },
      system: { changes: ["bludgeoning", "piercing", "slashing"].map((t) => ({ key: "system.traits.dr.value", value: t, type: "add", priority: 20, phase: "initial" })) },
      flags: { dae: { stackable: "noneName", specialDuration: ["turnStart"] } } });
    say(actor, `<strong>Toughened Flesh:</strong> ${actor.name} has Resistance to Bludgeoning, Piercing and Slashing damage until the start of their next turn.`);
  } catch (err) { console.warn(`${MODULE_ID} | Toughened Flesh failed`, err); }
});

// ------------------------------------------------------------------ Last Stand, Inevitable Betrayal: Advantage on attacks
Hooks.on("midi-qol.preAttackRollConfig", (workflow) => {
  try {
    const actor = workflow?.actor, tracker = workflow?.attackRollModifierTracker?.advantage;
    if (!actor || !tracker?.add) return;
    if (feat(actor, "purple-dragon-commandant") && isBloodied(actor)) tracker.add("cgaLastStand", "Last Stand");
    const target = workflow.targets?.size === 1 ? tokenOf(Array.from(workflow.targets)[0])?.actor : null;
    if (target?.statuses?.has("charmed") && feat(actor, "treacherous-allure")) tracker.add("cgaInevitableBetrayal", "Inevitable Betrayal");
  } catch (err) { console.warn(`${MODULE_ID} | feat Advantage rules failed`, err); }
});

// ------------------------------------------------------------------ Spell casts: Protective Ward, Fueled Evocation
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || item?.system?.school !== "abj" || !slotCast(workflow) || !feat(actor, "abjuration-adept")) return;
    const me = tokenOf(workflow.token);
    const amount = 2 * castLevel(workflow);
    const near = me ? me.parent.tokens.filter((o) => o !== me && o.actor && o.disposition === me.disposition && Number(hpOf(o.actor).value ?? 0) > 0 && edgeDistance(me, o, me.parent) <= 30) : [];
    const pick = await askChoice(actor, `Protective Ward: ${actor.name}`, `<p>You cast ${item.name} with a level ${castLevel(workflow)} slot. Who gains ${amount} Temporary Hit Points?</p>`,
      [{ action: "self", label: actor.name, default: true }, ...near.map((o) => ({ action: o.id, label: o.name })), { action: "none", label: "No one" }]);
    const who = pick === "self" ? actor : near.find((o) => o.id === pick)?.actor;
    if (!who) return;
    if (Number(hpOf(who).temp ?? 0) < amount) await updateActor(who, { "system.attributes.hp.temp": amount });
    say(actor, `<strong>Protective Ward:</strong> ${who.name} has ${Math.max(amount, Number(hpOf(who).temp ?? 0))} Temporary Hit Points.`);
  } catch (err) { console.warn(`${MODULE_ID} | Protective Ward failed`, err); }
});
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || item?.type !== "spell" || item.system.school !== "evo" || !workflow.damageRolls?.length) return;
    if (!feat(actor, "evocation-adept") || usedThisTurn("fueled", actor)) return;
    const classes = hitDieClasses(actor);
    const avail = classes.reduce((s, c) => s + Number(c.system.hd.value), 0);
    if (!avail) return;
    const buttons = [{ action: "1", label: "1 Hit Point Die", default: true }, ...(avail >= 2 ? [{ action: "2", label: "2 Hit Point Dice" }] : []), { action: "none", label: "No" }];
    const pick = await askChoice(actor, `Fueled Evocation: ${actor.name}`, `<p>${item.name} deals damage. Roll Hit Point Dice (${avail} left) and add them to its damage?</p>`, buttons);
    const n = Number(pick) || 0;
    if (!n) return;
    markTurn("fueled", actor);
    const dice = [];
    for (const c of classes) { const k = Math.min(n - dice.length, Number(c.system.hd.value)); for (let i = 0; i < k; i++) dice.push(c); if (dice.length >= n) break; }
    for (const c of dice) await spendHitDie(actor.items.get(c.id) ?? c);
    const first = workflow.damageRolls[0];
    const type = first.options?.type ?? "force";
    const formula = dice.map((c) => `1${c.system.hd.denomination}`).join(" + ");
    const extra = await new CONFIG.Dice.DamageRoll(formula, {}, { ...foundry.utils.deepClone(first.options ?? {}), type, types: [type], flavor: "Fueled Evocation" }).evaluate();
    await workflow.setDamageRolls([...workflow.damageRolls, extra]);
    say(actor, `<strong>Fueled Evocation:</strong> ${actor.name} adds ${formula} (${extra.total}) ${type} damage to ${item.name}.`);
  } catch (err) { console.warn(`${MODULE_ID} | Fueled Evocation failed`, err); }
});

// ------------------------------------------------------------------ Defense: +1 AC only while wearing armor
// The dnd5e (and D&D Beyond) Defense feat adds +1 AC unconditionally; the module switches that effect off with no armor on.
ITEM_TOGGLES.push({ ident: "defense", keys: ["system.attributes.ac.bonus"], off: (a) => !wearsArmor(a) });
