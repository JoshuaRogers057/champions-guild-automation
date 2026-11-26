// Champions Guild Automation - general feats from Arcana Unleashed, Forgotten Realms: Heroes of Faerûn and
// Astarion's Book of Hungers (priority 2). Module rules keyed on the feat's identifier or name.
//  - Conjuration Adept, Persistent Conjuration: + spellcasting modifier to Concentration saves for a Conjuration spell.
//  - Divination Adept, Prescient Intervention: Reaction, a second d20 (Advantage / Disadvantage) when it can change an
//    ally's failed save or miss, or an enemy's hit or successful save, within 60 ft (1/LR; a slot Divination spell refreshes it).
//  - Necromancy Adept, Life Manipulation: a slot Necromancy spell - roll up to two Hit Dice, heal total + slot level (asked).
//  - Transmutation Adept, Magical Augmentation: a slot Transmutation spell on your turn - +5 ft x slot level Speed this turn.
//  - Spellfire Adept, Fueled Spellfire: once per turn, up to two Hit Dice added to a spell's Radiant damage (asked).
//  - Love Bites (Charmed), Putrefy (Poisoned), Rebuke (Prone): after your melee / Necrotic / Radiant damage (1/SR, asked).
//  - Zhentarim Tactics, Retaliate: Reaction Opportunity Attack against a creature within 5 ft that hits you in melee.
//  - Order's Resilience, Stronger Together: you and an adjacent ally have Advantage on STR saves.
//  - Lordly Resolve, Standard Bearer: the activity's targets stand up from Prone.
//  - Dragonscarred, Fearsome Power: Dragon's Terror offered as a Bonus Action after you deal damage with an action on your turn.
//  - Warlike Familiar, Intercept Attack: your familiar's Reaction adds your Proficiency Bonus to the AC of a creature
//    within 5 ft of it that's hit.
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated } from "./main.js";
import { canReact, useReaction, say, tokenOf, chg } from "./item-rules.js";
import { feat, prof, usesLeft, spend } from "./background-feats.js";
import { addEffect, castLevel, slotCast, damageTypes, hitDieClasses, spendHitDie, usedThisTurn, markTurn, hpOf } from "./feat-rules-books.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const alive = (a) => Number(hpOf(a).value ?? 0) > 0;
const myTurn = (actor) => !game.combat?.started || game.combat.combatant?.actor === actor;
const d20Of = (roll) => roll?.dice?.find((d) => d.faces === 20);
const single = (die) => die && die.results.filter((r) => r.active !== false && !r.discarded).length === 1 && die.results.length === 1;
// The tokens that took damage from this workflow (midi's damage list).
function damagedTokens(workflow) {
  const out = [];
  for (const d of workflow?.damageList ?? []) {
    if (!((d.hpDamage ?? 0) + (d.tempDamage ?? 0) > 0)) continue;
    const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "");
    const doc = found instanceof Actor ? found.getActiveTokens?.(false, true)?.[0] : (found?.document ?? found);
    if (doc?.actor && !out.includes(doc)) out.push(doc);
  }
  return out;
}
// Status effect data (the core one, so the token HUD can remove it) with a duration and origin.
async function statusData(id, extra = {}) {
  const fx = (await ActiveEffect.implementation.fromStatusEffect(id)).toObject();
  delete fx._id;
  return foundry.utils.mergeObject(fx, extra);
}
// Roll Hit Point Dice (largest first) and spend them; returns { formula, total } or null.
async function rollHitDice(actor, n, flavor) {
  const dice = [];
  for (const c of hitDieClasses(actor)) { const k = Math.min(n - dice.length, Number(c.system.hd.value)); for (let i = 0; i < k; i++) dice.push(c); if (dice.length >= n) break; }
  if (!dice.length) return null;
  for (const c of dice) await spendHitDie(actor.items.get(c.id) ?? c);
  const formula = dice.map((c) => `1${c.system.hd.denomination}`).join(" + ");
  return { formula, dice };
}
async function askDice(actor, title, html) {
  const avail = hitDieClasses(actor).reduce((s, c) => s + Number(c.system.hd.value), 0);
  if (!avail) return 0;
  const pick = await askChoice(actor, title, `${html}<p>(${avail} Hit Point Dice left)</p>`,
    [{ action: "1", label: "1 Hit Point Die", default: true }, ...(avail >= 2 ? [{ action: "2", label: "2 Hit Point Dice" }] : []), { action: "none", label: "No" }]);
  return Number(pick) || 0;
}

// ------------------------------------------------------------------ Conjuration Adept, Persistent Conjuration
Hooks.on("dnd5e.preRollConcentrationV2", (config) => {
  try {
    const actor = config?.subject;
    if (!feat(actor, "conjuration-adept")) return;
    const items = Array.from(actor.concentration?.items ?? []);
    if (!items.some((i) => i?.system?.school === "con")) return;
    const ab = actor.system.attributes.spellcasting || "int";
    const bonus = Number(actor.system.abilities?.[ab]?.mod ?? 0);
    if (!bonus) return;
    config.rolls ??= [];
    if (!config.rolls.length) config.rolls.push({ parts: [], data: {} });
    config.rolls[0].parts ??= [];
    config.rolls[0].parts.push(String(bonus));
  } catch (err) { console.warn(`${MODULE_ID} | Persistent Conjuration failed`, err); }
});

// ------------------------------------------------------------------ Divination Adept, Prescient Intervention
// A diviner within 60 ft of the roller: friendly = on the roller's side (Advantage) or against it (Disadvantage).
async function prescient(rollerTok, friendly, text) {
  for (const h of rollerTok.parent.tokens) {
    const it = h.actor && feat(h.actor, "divination-adept");
    if (!it || usesLeft(it, 1) <= 0 || !canReact(h.actor)) continue;
    if ((h.disposition === rollerTok.disposition) !== friendly) continue;
    if (h !== rollerTok && edgeDistance(h, rollerTok, rollerTok.parent) > 60) continue;
    if (!(await askOwner(h.actor, `Prescient Intervention: ${h.name}`, `<p>${text} Use your Reaction to give it ${friendly ? "Advantage" : "Disadvantage"} (once per Long Rest)?</p>`))) continue;
    await spend(it); await useReaction(h.actor);
    return h;
  }
  return null;
}
async function secondDie(h, label) {
  const r = await new Roll("1d20").evaluate();
  await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: h.actor }), flavor: `Prescient Intervention: ${label}` });
  return r.total;
}
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    const dc = Number(workflow?.activity?.save?.dc?.value ?? workflow?.saveDC ?? 0);
    const caster = tokenOf(workflow?.token);
    if (!dc || !caster) return;
    const details = (t) => workflow.targetSaveDetails?.[tokenOf(t)?.uuid]?.saveRoll;
    // an ally of the saver turns a failure into a success (Advantage)
    for (const t of Array.from(workflow.failedSaves ?? [])) {
      const tDoc = tokenOf(t), roll = details(t), die = d20Of(roll);
      if (!tDoc?.actor || !single(die) || tDoc.disposition === caster.disposition) continue;
      const mods = Number(roll.total) - Number(die.total);
      if (mods + 20 < dc) continue;
      const h = await prescient(tDoc, true, `${tDoc.name} fails a DC ${dc} save (${roll.total}).`);
      if (!h) continue;
      const total = mods + Math.max(die.total, await secondDie(h, `${tDoc.name}'s save with Advantage`));
      roll._total = total;
      if (total >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); }
      say(h.actor, `<strong>Prescient Intervention:</strong> ${tDoc.name}'s save is ${total} (DC ${dc}).`);
    }
    // an ally of the caster turns an enemy's success into a failure (Disadvantage)
    for (const t of Array.from(workflow.saves ?? [])) {
      const tDoc = tokenOf(t), roll = details(t), die = d20Of(roll);
      if (!tDoc?.actor || !single(die) || tDoc.disposition === caster.disposition) continue;
      const mods = Number(roll.total) - Number(die.total);
      if (mods + 1 >= dc) continue;
      const h = await prescient(tDoc, false, `${tDoc.name} succeeds on a DC ${dc} save (${roll.total}).`);
      if (!h) continue;
      const total = mods + Math.min(die.total, await secondDie(h, `${tDoc.name}'s save with Disadvantage`));
      roll._total = total;
      if (total < dc) { workflow.saves.delete(t); workflow.failedSaves?.add?.(t); }
      say(h.actor, `<strong>Prescient Intervention:</strong> ${tDoc.name}'s save is ${total} (DC ${dc}).`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Prescient Intervention (saves) failed`, err); }
});
Hooks.on("midi-qol.hitsChecked", async (workflow) => {
  try {
    if (!workflow?.activity?.attack || workflow.targets?.size !== 1 || !workflow.attackRoll) return;
    const tObj = Array.from(workflow.targets)[0], t = tokenOf(tObj), atk = tokenOf(workflow.token);
    if (!t?.actor || !atk || t === atk) return;
    const roll = workflow.attackRoll, die = d20Of(roll);
    if (!single(die)) return;
    const mods = Number(roll.total) - Number(die.total), ac = Number(t.actor.system.attributes.ac.value ?? 10);
    const hit = Array.from(workflow.hitTargets ?? []).some((x) => tokenOf(x) === t);
    if (hit && die.total !== 20 && mods + 1 < ac) {
      const h = await prescient(atk, false, `${atk.name} hits ${t.name} (${roll.total} vs AC ${ac}).`);
      if (!h) return;
      const d = Math.min(die.total, await secondDie(h, `${atk.name}'s attack with Disadvantage`));
      const total = mods + d;
      try { roll._total = total; } catch (err) {}
      if (d !== 20 && (d === 1 || total < ac)) { workflow.hitTargets.delete(tObj); workflow.isCritical = false; }
      say(h.actor, `<strong>Prescient Intervention:</strong> ${atk.name}'s attack is ${total} - it ${workflow.hitTargets.has(tObj) ? "still hits" : "misses"} ${t.name}.`);
    } else if (!hit && die.total !== 1 && mods + 20 >= ac) {
      const h = await prescient(atk, true, `${atk.name} misses ${t.name} (${roll.total} vs AC ${ac}).`);
      if (!h) return;
      const d = Math.max(die.total, await secondDie(h, `${atk.name}'s attack with Advantage`));
      const total = mods + d;
      try { roll._total = total; } catch (err) {}
      if (d === 20 || total >= ac) { workflow.hitTargets.add(tObj); if (d === 20) workflow.isCritical = true; }
      say(h.actor, `<strong>Prescient Intervention:</strong> ${atk.name}'s attack is ${total} - it ${workflow.hitTargets.has(tObj) ? "hits" : "still misses"} ${t.name}.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Prescient Intervention (attacks) failed`, err); }
});

// ------------------------------------------------------------------ Slot spells: Divination refresh, Life Manipulation, Magical Augmentation
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !slotCast(workflow)) return;
    const school = item.system.school, level = castLevel(workflow);
    const div = school === "div" && feat(actor, "divination-adept");
    if (div && div.system.uses?.max && Number(div.system.uses.spent ?? 0) > 0) {
      await div.update({ "system.uses.spent": 0 }).catch(() => {});
      say(actor, `<strong>Prescient Intervention:</strong> casting ${item.name} with a slot gives ${actor.name} the use back.`);
    }
    if (school === "nec" && feat(actor, "necromancy-adept") && Number(hpOf(actor).value) < Number(hpOf(actor).effectiveMax ?? hpOf(actor).max)) {
      const n = await askDice(actor, `Life Manipulation: ${actor.name}`, `<p>You cast ${item.name} with a level ${level} slot. Roll Hit Point Dice to regain Hit Points (total + ${level})?</p>`);
      const hd = n ? await rollHitDice(actor, n) : null;
      if (hd) {
        const r = await new Roll(`${hd.formula} + ${level}`).evaluate();
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Life Manipulation: ${actor.name} regains ${r.total} Hit Points` });
        const hp = hpOf(actor);
        await actor.update({ "system.attributes.hp.value": Math.min(Number(hp.effectiveMax ?? hp.max), Number(hp.value) + r.total) });
      }
    }
    if (school === "trs" && feat(actor, "transmutation-adept") && myTurn(actor)) {
      const mv = actor.system.attributes.movement ?? {};
      const changes = ["walk", "fly", "swim", "climb", "burrow"].filter((m) => Number(mv[m] ?? 0) > 0).map((m) => chg(`system.attributes.movement.${m}`, String(5 * level), "add"));
      if (changes.length) {
        await addEffect(actor, { name: `Magical Augmentation (+${5 * level} ft)`, img: "icons/magic/movement/trail-streak-impact-blue.webp", transfer: false, duration: { seconds: 6 },
          system: { changes }, flags: { dae: { stackable: "noneName", specialDuration: ["turnEnd"] } } });
        say(actor, `<strong>Magical Augmentation:</strong> ${actor.name}'s Speed is ${5 * level} ft higher until the end of the turn.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 slot spell feats failed`, err); }
});

// ------------------------------------------------------------------ Spellfire Adept, Fueled Spellfire
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || item?.type !== "spell" || !damageTypes(workflow).has("radiant") || !feat(actor, "spellfire-adept") || usedThisTurn("fueledSpellfire", actor)) return;
    const n = await askDice(actor, `Fueled Spellfire: ${actor.name}`, `<p>${item.name} deals Radiant damage. Roll Hit Point Dice and add them to it?</p>`);
    if (!n) return;
    markTurn("fueledSpellfire", actor);
    const hd = await rollHitDice(actor, n);
    if (!hd) return;
    const first = workflow.damageRolls.find((r) => r.options?.type === "radiant" || (r.options?.types ?? []).includes("radiant")) ?? workflow.damageRolls[0];
    const extra = await new CONFIG.Dice.DamageRoll(hd.formula, {}, { ...foundry.utils.deepClone(first.options ?? {}), type: "radiant", types: ["radiant"], flavor: "Fueled Spellfire" }).evaluate();
    await workflow.setDamageRolls([...workflow.damageRolls, extra]);
    say(actor, `<strong>Fueled Spellfire:</strong> ${actor.name} adds ${hd.formula} (${extra.total}) Radiant damage to ${item.name}.`);
  } catch (err) { console.warn(`${MODULE_ID} | Fueled Spellfire failed`, err); }
});

// ------------------------------------------------------------------ After your damage: Love Bites, Putrefy, Rebuke, Fearsome Power
const SIZES_TO_HUGE = ["tiny", "sm", "med", "lg", "huge"];
async function pickDamaged(actor, title, html, cands) {
  if (!cands.length) return null;
  const pick = await askChoice(actor, title, html, [...cands.map((t, i) => ({ action: t.id, label: t.name, default: i === 0 })), { action: "none", label: "No" }]);
  return cands.find((t) => t.id === pick) ?? null;
}
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, me = tokenOf(workflow?.token);
    if (!actor || !me) return;
    const damaged = damagedTokens(workflow).filter((t) => t !== me && alive(t.actor));
    if (!damaged.length) return;
    const types = damageTypes(workflow);
    const origin = (it) => it.uuid;
    // Love Bites: a Melee weapon or Unarmed Strike - Bonus Action, Charmed until the start of your next turn or damaged
    const lb = feat(actor, "love-bites");
    const att = workflow.activity?.attack;
    if (lb && att && workflow.item?.type === "weapon" && att.type?.value === "melee" && usesLeft(lb, 1, "sr") > 0 && !MidiQOL.hasUsedBonusAction?.(actor)) {
      const t = await pickDamaged(actor, `Endearing Pain: ${actor.name}`, `<p>Use your Bonus Action to Charm the creature you damaged (until the start of your next turn or until it takes damage; once per Short Rest)?</p>`, damaged);
      if (t) {
        await spend(lb, "sr"); await MidiQOL.setBonusActionUsed?.(actor);
        await addEffect(t.actor, await statusData("charmed", { name: "Charmed (Endearing Pain)", origin: origin(lb), duration: { value: null, units: "rounds", expiry: "sourceStart", expired: false },
          flags: { dae: { stackable: "noneName", specialDuration: ["isDamaged"] } } }));
        say(actor, `<strong>Endearing Pain:</strong> ${t.name} is Charmed by ${actor.name}.`);
      }
    }
    // Putrefy: Necrotic damage - Poisoned until the start of your next turn
    const pu = feat(actor, "putrefy");
    if (pu && types.has("necrotic") && usesLeft(pu, 1, "sr") > 0) {
      const cands = damaged.filter((t) => !t.actor.statuses.has("poisoned"));
      const t = await pickDamaged(actor, `Necrosis: ${actor.name}`, `<p>Your Necrotic damage can Poison one creature that took it until the start of your next turn (once per Short Rest). Which?</p>`, cands);
      if (t) {
        await spend(pu, "sr");
        await addEffect(t.actor, await statusData("poisoned", { name: "Poisoned (Necrosis)", origin: origin(pu), duration: { value: null, units: "rounds", expiry: "sourceStart", expired: false } }));
        say(actor, `<strong>Necrosis:</strong> ${t.name} is Poisoned until the start of ${actor.name}'s next turn.`);
      }
    }
    // Rebuke: Radiant damage - a Huge or smaller creature falls Prone
    const rb = feat(actor, "rebuke");
    if (rb && types.has("radiant") && usesLeft(rb, 1, "sr") > 0) {
      const cands = damaged.filter((t) => !t.actor.statuses.has("prone") && SIZES_TO_HUGE.includes(t.actor.system.traits?.size ?? "med"));
      const t = await pickDamaged(actor, `Radiant Strike: ${actor.name}`, `<p>Your Radiant damage can knock one Huge or smaller creature that took it Prone (once per Short Rest). Which?</p>`, cands);
      if (t) {
        await spend(rb, "sr");
        await addEffect(t.actor, await statusData("prone", { origin: origin(rb) }));
        say(actor, `<strong>Radiant Strike:</strong> ${t.name} is knocked Prone.`);
      }
    }
    // Dragonscarred, Fearsome Power: damage with an action on your turn - Dragon's Terror as a Bonus Action
    const ds = feat(actor, "dragonscarred"), cult = feat(actor, "cult-of-the-dragon-initiate");
    const terror = cult?.system?.activities?.find((a) => /dragon.s terror/i.test(a.name ?? "") && a.type === "save");
    if (ds && terror && workflow.activity?.activation?.type === "action" && myTurn(actor) && !usedThisTurn("fearsome", actor) && !MidiQOL.hasUsedBonusAction?.(actor)) {
      const near = me.parent.tokens.filter((o) => o.actor && o.disposition !== me.disposition && alive(o.actor) && edgeDistance(me, o, me.parent) <= 30);
      const ordered = [...damaged.filter((t) => near.includes(t)), ...near.filter((t) => !damaged.includes(t))];
      const t = await pickDamaged(actor, `Fearsome Power: ${actor.name}`, `<p>Use Dragon's Terror as a Bonus Action this turn? Pick a creature within 30 ft.</p>`, ordered);
      if (t) {
        markTurn("fearsome", actor);
        await MidiQOL.setBonusActionUsed?.(actor);
        await MidiQOL.completeActivityUse(terror, { midiOptions: { targetUuids: [t.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch((err) => console.warn(`${MODULE_ID} | Fearsome Power failed`, err));
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 damage feats failed`, err); }
});

// ------------------------------------------------------------------ Zhentarim Tactics, Retaliate
const retaliating = new Set();
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const atk = tokenOf(workflow?.token);
    if (!atk?.actor || workflow.activity?.attack?.type?.value !== "melee" || !workflow.hitTargets?.size || retaliating.has(atk.actor.uuid)) return;
    for (const def of Array.from(workflow.hitTargets).map(tokenOf)) {
      const a = def?.actor;
      if (!a || a === atk.actor || !feat(a, "zhentarim-tactics") || !canReact(a) || !alive(atk.actor) || edgeDistance(def, atk, def.parent) > 5) continue;
      const weapon = a.items.find((i) => i.type === "weapon" && i.system.equipped && i.isOwner && i.system.activities?.some((x) => x.type === "attack" && x.attack?.type?.value === "melee"));
      if (!weapon) continue;
      if (!(await askOwner(a, `Retaliate: ${a.name}`, `<p>${atk.name} hits ${a.name} with a melee attack. Use your Reaction for an Opportunity Attack with ${weapon.name}?</p>`))) continue;
      await useReaction(a);
      retaliating.add(a.uuid);
      try {
        const act = weapon.system.activities.find((x) => x.type === "attack" && x.attack?.type?.value === "melee");
        await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [atk.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {});
      } finally { retaliating.delete(a.uuid); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Retaliate failed`, err); }
});

// ------------------------------------------------------------------ Order's Resilience, Stronger Together: Advantage on STR saves
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const abil = workflow?.activity?.save?.ability;
    if (!(abil?.has?.("str") || (Array.isArray(abil) && abil.includes("str")))) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      const a = t?.actor;
      if (!a || isIncapacitated(a)) continue;
      const near = t.parent.tokens.filter((o) => o !== t && o.actor && o.disposition === t.disposition && !isIncapacitated(o.actor) && alive(o.actor) && edgeDistance(t, o, t.parent) <= 5);
      const source = feat(a, "orders-resilience") && near.length ? a : near.find((o) => feat(o.actor, "orders-resilience"))?.actor;
      if (!source) continue;
      await addEffect(a, { name: "Stronger Together (Advantage)", img: "icons/skills/melee/shield-block-bash-blue.webp", transfer: false,
        system: { changes: [chg("flags.midi-qol.advantage.save.str", "1")] }, flags: { dae: { stackable: "noneName", specialDuration: ["isSave"] } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Stronger Together failed`, err); }
});

// ------------------------------------------------------------------ Lordly Resolve, Standard Bearer: targets stand up
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    if (workflow?.activity?.midiProperties?.identifier !== "standard-bearer" && !/standard bearer/i.test(workflow?.activity?.name ?? "")) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      const a = t?.actor;
      if (!a?.statuses?.has("prone") || !(Number(a.system.attributes.movement?.walk ?? 0) > 0)) continue;
      const ids = a.effects.filter((e) => e.statuses.has("prone")).map((e) => e.id);
      if (a.isOwner) await a.deleteEmbeddedDocuments("ActiveEffect", ids).catch(() => {});
      else await asGM("removeEffects", { actorUuid: a.uuid, effects: ids });
      say(a, `<strong>Standard Bearer:</strong> ${a.name} rights itself.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Standard Bearer failed`, err); }
});

// ------------------------------------------------------------------ Warlike Familiar, Intercept Attack
const FAMILIAR_SPELLS = /find familiar|battle familiar/i;
function familiarOwner(tok) {
  const origin = tok?.actor?.flags?.dnd5e?.summon?.origin;
  if (!origin) return null;
  const spell = fromUuidSync(origin);
  return spell && FAMILIAR_SPELLS.test(spell.name ?? "") ? spell.actor ?? spell.parent : null;
}
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical) return;
    const t = tokenOf(Array.from(workflow.targets)[0]), def = t?.actor;
    if (!def) return;
    const roll = workflow.attackRoll, ac = Number(def.system.attributes.ac.value ?? 10);
    if (roll.total < ac) return;
    for (const f of t.parent.tokens) {
      if (f === t || !f.actor || !alive(f.actor)) continue;
      const owner = familiarOwner(f);
      if (!owner || !feat(owner, "warlike-familiar") || !canReact(f.actor) || edgeDistance(f, t, t.parent) > 5) continue;
      const pb = prof(owner);
      if (roll.total >= ac + pb) continue;
      if (!(await askOwner(owner, `Intercept Attack: ${f.name}`, `<p>${workflow.actor?.name ?? "An attack"} hits ${t.name} (${roll.total} vs AC ${ac}). Use ${f.name}'s Reaction to add ${pb} to ${t.name}'s AC against it?</p>`))) continue;
      await useReaction(f.actor);
      roll._total = Number(roll.total) - pb;
      await workflow.setAttackRoll?.(roll);
      say(owner, `<strong>Intercept Attack:</strong> ${f.name} adds +${pb} AC - the attack misses ${t.name}.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Intercept Attack failed`, err); }
});
