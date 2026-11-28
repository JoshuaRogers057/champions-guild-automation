// Champions Guild Automation - Origin feats granted by non-PHB backgrounds (Arcana Unleashed, Eberron, Ravenloft,
// Forgotten Realms: Heroes of Faerûn, Lorwyn, Astarion's Book of Hungers). Module rules keyed on the feat's
// identifier or name, so a D&D Beyond or hand-made feat works with no Mass Apply.
//  - Add to a failed save (Reaction, asked): Arcane Omens (+1d4, you or a creature within 30 ft, PB/LR), Aberrant
//    Dragonmark (+1d4 to a CON save, 1/LR), Transmuted Anatomy (+1d4 to a CON save, PB/LR), Survivor's Steel Yourself
//    (+PB vs Charmed/Frightened, 1/LR), Symbiotic Being (spend your largest Hit Die and add it, PB/LR).
//  - Survivor's Hypervigilance: an Initiative d20 of 9 or lower is rerolled.
//  - Gathered Whispers' Unearthly Scream: Reaction +PB AC against a hit (PB/LR).
//  - Spellfire Spark: once per turn, damage from a spell or magic item is reduced by 1d4.
//  - Vampire Hunter's Vitality Ward: Reaction, Necrotic damage reduced by (PB)d6 (1/Short Rest).
//  - Shadowmoor Hexer's Curse Magic: a creature you've Hexed that hits you takes Psychic damage = PB (once per turn).
//  - Cult of the Dragon Initiate: Dragon's Terror (item activity); Inspired by Fear - Heroic Inspiration when you
//    frighten a creature (1/Short Rest).
// Uses come from the feat item's own uses when it has them; otherwise the module counts them on the item.
import { MODULE_ID, askOwner, edgeDistance, isIncapacitated, turnKey, reduceDamage } from "./main.js";
import { isMagicItem, canReact, useReaction, say, tokenOf, isGM } from "./item-rules.js";

export const feat = (actor, ident) => actor?.items?.find((i) => i.type === "feat" && isMagicItem(i, ident));
export const prof = (actor) => Number(actor?.system?.attributes?.prof ?? 2);
// Uses: the item's own, or a module counter (max, reset period "lr" / "sr").
export function usesLeft(item, max, period = "lr") {
  if (item?.system?.uses?.max) return Number(item.system.uses.value ?? 0);
  return Math.max(0, max - Number(item?.getFlag("world", "cgaUsed") ?? 0));
}
export async function spend(item, period = "lr") {
  try {
    if (item.system.uses?.max) return await item.update({ "system.uses.spent": Number(item.system.uses.spent ?? 0) + 1 });
    await item.update({ "flags.world.cgaUsed": Number(item.getFlag("world", "cgaUsed") ?? 0) + 1, "flags.world.cgaUsedPeriod": period });
  } catch (err) {
    const upd = item.system.uses?.max ? { "system.uses.spent": Number(item.system.uses.spent ?? 0) + 1 } : { "flags.world.cgaUsed": Number(item.getFlag("world", "cgaUsed") ?? 0) + 1, "flags.world.cgaUsedPeriod": period };
    await MidiQOL.socket().executeAsGM("updateItems", { actorUuid: item.actor.uuid, updates: [{ _id: item.id, ...upd }] }).catch(() => {});
  }
}
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner) return;
    const long = config?.type === "long" || result?.longRest;
    for (const i of actor.items.filter((x) => x.getFlag("world", "cgaUsed"))) {
      if (long || i.getFlag("world", "cgaUsedPeriod") === "sr") await i.update({ "flags.world.-=cgaUsed": null, "flags.world.-=cgaUsedPeriod": null });
    }
  } catch (err) {}
});

// ------------------------------------------------------------------ Failed saves: add a die (or PB)
const SAVE_BONUSES = [
  { ident: "aberrant-dragonmark", label: "Aberrant Fortitude", ability: "con", die: () => "1d4", max: () => 1 },
  { ident: "transmuted-anatomy", label: "Resilient Anatomy", ability: "con", die: () => "1d4", max: (a) => prof(a) },
  { ident: "survivor", label: "Steel Yourself", statuses: ["charmed", "frightened"], die: (a) => String(prof(a)), max: () => 1 },
  { ident: "arcane-omens", label: "Helpful Premonition", range: 30, die: () => "1d4", max: (a) => prof(a) },
  { ident: "symbiotic-being", label: "Sustained Symbiosis", die: (a) => { const c = bestHitDie(a); return c ? `1${c.system.hd.denomination}` : null; }, max: (a) => prof(a),
    pay: async (a) => { const c = bestHitDie(a); if (c) await c.update({ "system.hd.spent": Number(c.system.hd.spent ?? 0) + 1 }).catch(() => {}); } }
];
// The class with the largest unspent Hit Die (Sustained Symbiosis).
function bestHitDie(actor) {
  return actor.itemTypes?.class?.filter((c) => Number(c.system.hd?.value ?? 0) > 0).sort((x, y) => Number(String(y.system.hd.denomination).slice(1)) - Number(String(x.system.hd.denomination).slice(1)))[0] ?? null;
}
const maxOf = (f) => { const m = /^(\d*)d(\d+)$/.exec(f); return m ? Number(m[1] || 1) * Number(m[2]) : Number(f); };
export function saveStatuses(workflow) {
  const out = new Set();
  for (const ref of workflow?.activity?.effects ?? []) {
    const e = ref.effect ?? workflow.item?.effects?.get?.(ref._id);
    for (const s of e?.statuses ?? []) out.add(s);
    for (const s of ["charmed", "frightened", "grappled", "restrained", "blinded"]) if (new RegExp(s, "i").test(e?.name ?? "")) out.add(s);
  }
  return out;
}
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size) return;
    const ability = workflow.activity?.save?.ability?.first?.() ?? Array.from(workflow.activity?.save?.ability ?? [])[0];
    const dc = Number(workflow.activity?.save?.dc?.value ?? workflow.saveDC ?? 0);
    const statuses = saveStatuses(workflow);
    for (const t of Array.from(workflow.failedSaves)) {
      const tDoc = tokenOf(t);
      const saver = tDoc?.actor;
      const roll = workflow.targetSaveDetails?.[tDoc.uuid]?.saveRoll;
      if (!saver || !roll || !dc) continue;
      let total = Number(roll.total ?? 0);
      for (const b of SAVE_BONUSES) {
        if (total >= dc) break;
        if (b.ability && b.ability !== ability) continue;
        if (b.statuses && !b.statuses.some((s) => statuses.has(s))) continue;
        // who can help: the saver, or (Arcane Omens) a creature within 30 ft that can see it
        const helpers = b.range ? (tDoc.parent?.tokens ?? []).filter((h) => h.actor && (h === tDoc || (h.disposition === tDoc.disposition && edgeDistance(h, tDoc, tDoc.parent) <= b.range))) : [tDoc];
        for (const h of helpers) {
          const it = feat(h.actor, b.ident);
          if (!it || usesLeft(it, b.max(h.actor)) <= 0 || !canReact(h.actor)) continue;
          const bonusText = b.die(h.actor);
          if (!bonusText) continue;
          const maxGain = maxOf(bonusText);
          if (total + maxGain < dc) continue; // it can't turn this failure into a success
          if (!(await askOwner(h.actor, `${b.label}: ${h.name}`, `<p>${tDoc.name} fails a DC ${dc} save (${total}). Use your Reaction${h === tDoc ? "" : ` (${it.name})`} to add ${bonusText}?</p>`))) continue;
          await spend(it);
          await useReaction(h.actor);
          if (b.pay) await b.pay(h.actor);
          const r = await new Roll(bonusText).evaluate();
          total += r.total;
          await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: h.actor }), flavor: `${b.label}: ${tDoc.name}'s save is now ${total} (DC ${dc})` });
          if (total >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); roll._total = total; }
          break;
        }
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | origin feat save bonuses failed`, err); }
});

// ------------------------------------------------------------------ Survivor, Hypervigilance: reroll an Initiative d20 of 9 or lower
// Applied to the Initiative roll itself, so it covers the combat tracker too (it skips dnd5e.preRollInitiative).
function hypervigilance(actor, roll) {
  try {
    if (!feat(actor, "survivor") || !roll?.terms?.length) return;
    const d = roll.terms[0];
    if (d?.faces !== 20 || (d.modifiers ?? []).some((m) => /^r/.test(m))) return;
    d.modifiers.unshift("r<10");
    roll._formula = roll.constructor.getFormula(roll.terms);
  } catch (err) { console.warn(`${MODULE_ID} | Hypervigilance failed`, err); }
}
Hooks.on("dnd5e.preRollInitiative", hypervigilance);
Hooks.once("setup", () => {
  const proto = CONFIG.Actor.documentClass.prototype;
  const orig = proto.getInitiativeRoll;
  if (typeof orig !== "function") return;
  proto.getInitiativeRoll = function (...args) { const roll = orig.apply(this, args); hypervigilance(this, roll); return roll; };
});

// ------------------------------------------------------------------ Gathered Whispers, Unearthly Scream: Reaction +PB AC against a hit
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical) return;
    const tDoc = tokenOf(Array.from(workflow.targets)[0]);
    const def = tDoc?.actor;
    const it = def && feat(def, "gathered-whispers");
    if (!it || def === workflow.actor || usesLeft(it, prof(def)) <= 0 || !canReact(def)) return;
    const roll = workflow.attackRoll, ac = Number(def.system.attributes.ac.value ?? 10), pb = prof(def);
    if (roll.total < ac || roll.total >= ac + pb) return;
    if (!(await askOwner(def, `Unearthly Scream: ${def.name}`, `<p>${workflow.actor?.name ?? "An attack"} hits ${def.name} (${roll.total} vs AC ${ac}). Use your Reaction to add ${pb} to your AC against it?</p>`))) return;
    await spend(it); await useReaction(def);
    roll._total = Number(roll.total) - pb;
    await workflow.setAttackRoll?.(roll);
    say(def, `<strong>Unearthly Scream:</strong> +${pb} AC - the attack misses ${def.name}.`);
  } catch (err) { console.warn(`${MODULE_ID} | Unearthly Scream failed`, err); }
});

// ------------------------------------------------------------------ Damage taken: Spellfire Spark, Vampire Hunter
const sparkUsed = new Map(); // actor uuid -> turn key
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
    // Spellfire Spark: once per turn, damage from a spell or magical effect -1d4
    const magical = workflow?.item?.type === "spell" || workflow?.item?.system?.properties?.has?.("mgc");
    if (magical && feat(actor, "spellfire-spark") && !isIncapacitated(actor) && sparkUsed.get(actor.uuid) !== turnKey()) {
      sparkUsed.set(actor.uuid, turnKey());
      const r = await new Roll("1d4").evaluate();
      const cut = reduceDamage(ditem, r.total);
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Magic Absorption (Spellfire Spark): ${actor.name} takes ${cut} less damage` });
    }
    // Vampire Hunter: Reaction, Necrotic damage reduced by (PB)d6 (1/Short Rest)
    const vh = feat(actor, "vampire-hunter");
    const nec = ((ditem.calculatedDamages ?? ditem.damageDetail) ?? []).filter((d) => d.type === "necrotic" && (d.value ?? 0) > 0).reduce((s, d) => s + d.value, 0);
    if (vh && nec > 0 && usesLeft(vh, 1, "sr") > 0 && canReact(actor)
      && await askOwner(actor, `Vitality Ward: ${actor.name}`, `<p>${actor.name} takes ${nec} Necrotic damage. Use your Reaction to reduce it by ${prof(actor)}d6 (once per Short Rest)?</p>`)) {
      await spend(vh, "sr"); await useReaction(actor);
      const r = await new Roll(`${prof(actor)}d6`).evaluate();
      const cut = reduceDamage(ditem, r.total, ["necrotic"]);
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Vitality Ward: ${actor.name} takes ${cut} less Necrotic damage` });
    }
  } catch (err) { console.warn(`${MODULE_ID} | origin feat damage rules failed`, err); }
});

// ------------------------------------------------------------------ Shadowmoor Hexer, Curse Magic: a creature you've Hexed hits you
const curseUsed = new Map(); // attacker uuid -> turn key
// Checked once the hit is known and before its damage lands (the damage can break your concentration on Hex).
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const atk = tokenOf(workflow?.token);
    if (!atk?.actor || !workflow.activity?.attack || !workflow.hitTargets?.size) return;
    for (const t of Array.from(workflow.hitTargets).map(tokenOf)) {
      const def = t?.actor;
      if (!def || !feat(def, "shadowmoor-hexer") || curseUsed.get(atk.actor.uuid) === turnKey()) continue;
      // Hex's effect on the attacker came from you (its origin is your concentration effect or your Hex spell).
      const hexed = atk.actor.effects.some((e) => /hex/i.test(e.name) && !e.disabled && (e.origin ?? "").startsWith(def.uuid));
      if (!hexed) continue;
      curseUsed.set(atk.actor.uuid, turnKey());
      const pb = prof(def);
      await MidiQOL.applyTokenDamage([{ value: pb, type: "psychic" }], pb, new Set([atk.object ?? atk]), null, new Set(), {});
      say(def, `<strong>Curse Magic:</strong> ${atk.name} takes ${pb} Psychic damage for striking ${def.name}.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Curse Magic failed`, err); }
});

// ------------------------------------------------------------------ Cult of the Dragon Initiate, Inspired by Fear
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    const it = actor && feat(actor, "cult-of-the-dragon-initiate");
    if (!it || actor.system.attributes.inspiration || usesLeft(it, 1, "sr") <= 0 || !workflow.failedSaves?.size) return;
    const frightens = (workflow.activity?.effects ?? []).some((r) => (r.effect ?? workflow.item?.effects?.get?.(r._id))?.statuses?.has?.("frightened"));
    if (!frightens) return;
    if (!(await askOwner(actor, `Inspired by Fear: ${actor.name}`, `<p>You frightened a creature. Gain Heroic Inspiration (once per Short or Long Rest)?</p>`))) return;
    await spend(it, "sr");
    await actor.update({ "system.attributes.inspiration": true }).catch(() => MidiQOL.socket().executeAsGM("updateActor", { actorUuid: actor.uuid, updates: { "system.attributes.inspiration": true } }));
    say(actor, `<strong>Inspired by Fear:</strong> ${actor.name} gains Heroic Inspiration.`);
  } catch (err) { console.warn(`${MODULE_ID} | Inspired by Fear failed`, err); }
});
