// Champions Guild Automation - priority-3 feats from Arcana Unleashed, Forgotten Realms: Heroes of Faerûn and
// Astarion's Book of Hungers, plus their Epic Boons. Module rules keyed on the feat's identifier or name.
//  General: Harper Teamwork (Inspiring Willpower), Elemental / Otherworldly Familiar (Resistance on summon, Energy
//  Pulse), Soothing Familiar (healing dice 1-2 count as 3 near the familiar), Mythal Touched (Mythal Ward table),
//  Light Bringer (Sun's Healing), Bomber (no long-range Disadvantage with Thrown weapons), Street Justice (Headlock),
//  Spell Subterfuge (Dash + Hide after an action slot spell).
//  Epic Boons: Blazing Dawn (Radiant weapon damage toggle), Bloodshed (Killer's Fortune, Power from Pain), Bountiful
//  Health (+5 temp HP, maximum Hit Dice), Desperate Resilience / Furious Storm (Bloodied Resistance / Immunity),
//  Erupting Spellpower (Spell Overload), Exquisite Radiance (maximize Radiant), Fortune's Favor (save reroll), Misty
//  Escape (1 HP + mist), Poison Mastery (maximize Poison), Revelry / Iron Mind (Concentration kept through damage),
//  Terror (Flee, Fools!), Bright Sun (Fortifying Light), Furious Storm (Disadvantage on saves vs your Lightning/Thunder
//  spells), Soul Drinker (Siphon Life), Dimensional Travel (Teleport activity makes the next move a teleport).
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey, reduceDamage } from "./main.js";
import { canReact, useReaction, say, tokenOf, isGM, chg } from "./item-rules.js";
import { feat, prof, usesLeft, spend } from "./background-feats.js";
import { blinkNextMove } from "./background-feats-p2.js";
import { addEffect, updateActor, castLevel, slotCast, damageTypes, hitDieClasses, spendHitDie, usedThisTurn, markTurn, hpOf, isBloodied } from "./feat-rules-books.js";
import { damagedTokens, statusData } from "./feat-rules-books-p2.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const alive = (a) => Number(hpOf(a).value ?? 0) > 0;
const tokensOf = (actor) => actor?.getActiveTokens?.(false, true) ?? [];
const d20Of = (roll) => roll?.dice?.find((d) => d.faces === 20);
async function removeStatus(actor, status) {
  const ids = actor.effects.filter((e) => e.statuses.has(status)).map((e) => e.id);
  if (!ids.length) return;
  if (actor.isOwner) await actor.deleteEmbeddedDocuments("ActiveEffect", ids).catch(() => {});
  else await asGM("removeEffects", { actorUuid: actor.uuid, effects: ids });
}
async function heal(actor, amount) {
  const hp = hpOf(actor);
  await updateActor(actor, { "system.attributes.hp.value": Math.min(Number(hp.effectiveMax ?? hp.max), Number(hp.value) + amount) });
}
// Re-total a damage roll after its die results were changed.
function retotal(roll) { try { roll._total = roll._evaluateTotal(); } catch (err) { roll._total = roll.terms.reduce((s, t) => s + (Number(t.total) || 0), 0); } }
function setDice(roll, fn) {
  let changed = false;
  for (const d of roll.dice ?? []) for (const r of d.results ?? []) { if (r.active === false || r.discarded) continue; const v = fn(r.result, d.faces); if (v !== r.result) { r.result = v; changed = true; } }
  if (changed) retotal(roll);
  return changed;
}
const isType = (r, type) => r.options?.type === type || (r.options?.types ?? []).includes(type);
// The familiar tokens of `owner` (Find Familiar / Battle Familiar summons).
function familiarsOf(owner, scene) {
  return (scene?.tokens ?? []).filter((t) => {
    const o = t.actor?.flags?.dnd5e?.summon?.origin;
    if (!o) return false;
    const spell = fromUuidSync(o);
    return /find familiar|battle familiar/i.test(spell?.name ?? "") && (spell.actor ?? spell.parent) === owner;
  });
}
const ownerOfFamiliar = (tok) => { const o = tok?.actor?.flags?.dnd5e?.summon?.origin; const s = o ? fromUuidSync(o) : null; return /find familiar|battle familiar/i.test(s?.name ?? "") ? (s.actor ?? s.parent) : null; };

// ------------------------------------------------------------------ Harper Teamwork, Inspiring Willpower
// An over-time save effect that gave Frightened or Paralyzed ends on the feat holder: offer to end it on an ally too.
Hooks.on("deleteActiveEffect", async (effect) => {
  try {
    if (!isGM()) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor) || !feat(actor, "harper-teamwork")) return;
    const status = ["frightened", "paralyzed"].find((s) => effect.statuses?.has(s));
    const overTime = (effect.system?.changes ?? effect.changes ?? []).some((c) => /OverTime/.test(c.key));
    if (!status || !overTime) return;
    await new Promise((r) => setTimeout(r, 750)); // the linked core status effect goes away just after
    if (actor.effects.some((e) => e.statuses.has(status))) return;
    const me = tokensOf(actor)[0];
    if (!me) return;
    const allies = me.parent.tokens.filter((o) => o !== me && o.actor && o.disposition === me.disposition && o.actor.statuses.has(status) && edgeDistance(me, o, me.parent) <= 30);
    if (!allies.length) return;
    const pick = await askChoice(actor, `Inspiring Willpower: ${actor.name}`, `<p>You shook off being ${status}. End it for an ally within 30 ft too?</p>`,
      [...allies.map((o, i) => ({ action: o.id, label: o.name, default: i === 0 })), { action: "none", label: "No" }]);
    const o = allies.find((x) => x.id === pick);
    if (!o) return;
    await removeStatus(o.actor, status);
    say(actor, `<strong>Inspiring Willpower:</strong> ${o.name} is no longer ${status}.`);
  } catch (err) { console.warn(`${MODULE_ID} | Inspiring Willpower failed`, err); }
});

// ------------------------------------------------------------------ Elemental / Otherworldly Familiar: Resistance on summon
const FAMILIAR_IMBUE = [
  { ident: "elemental-familiar", label: "Elemental Energy", types: ["acid", "cold", "fire", "lightning", "thunder"] },
  { ident: "otherworldly-familiar", label: "Otherworldly Power", types: ["necrotic", "poison", "psychic", "radiant", "thunder"] }
];
Hooks.on("dnd5e.postSummon", async (activity, profile, tokens) => {
  try {
    const caster = activity?.actor;
    if (!caster || !/find familiar/i.test(activity.item?.name ?? "")) return;
    for (const rule of FAMILIAR_IMBUE) {
      if (!feat(caster, rule.ident)) continue;
      const pick = await askChoice(caster, `${rule.label}: ${caster.name}`, `<p>Choose your familiar's damage type (Resistance${rule.ident === "elemental-familiar" ? " and Energy Pulse" : ""}).</p>`,
        rule.types.map((t, i) => ({ action: t, label: t[0].toUpperCase() + t.slice(1), default: i === 0 })));
      const type = rule.types.includes(pick) ? pick : rule.types[0];
      if (rule.ident === "elemental-familiar") await caster.setFlag("world", "cgaFamElement", type).catch(() => {});
      for (const t of tokens ?? []) {
        const a = tokenOf(t)?.actor;
        if (a) await addEffect(a, { name: `${rule.label} (${type})`, img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp", transfer: false,
          system: { changes: [chg("system.traits.dr.value", type, "add")] } });
      }
      say(caster, `<strong>${rule.label}:</strong> ${caster.name}'s familiar has Resistance to ${type} damage.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | familiar imbue failed`, err); }
});

// ------------------------------------------------------------------ Elemental Familiar, Energy Pulse
const pulsePending = new Set(); // caster uuid while the burst runs
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, act = workflow?.activity;
    if (!actor) return;
    // the feat's Bonus Action: find the familiar and run the burst around it
    if (act?.midiProperties?.identifier === "energy-pulse") {
      const me = tokenOf(workflow.token);
      const fam = familiarsOf(actor, me?.parent ?? canvas.scene).find((f) => alive(f.actor) && (!me || edgeDistance(me, f, f.parent) <= 120));
      if (!fam) return say(actor, `<strong>Energy Pulse:</strong> no familiar within 120 ft.`);
      if (!canReact(fam.actor)) return say(actor, `<strong>Energy Pulse:</strong> ${fam.name} has already used its Reaction.`);
      await useReaction(fam.actor);
      const targets = fam.parent.tokens.filter((o) => o !== fam && o.actor && alive(o.actor) && edgeDistance(fam, o, fam.parent) <= 5);
      if (!targets.length) return say(actor, `<strong>Energy Pulse:</strong> no creatures within 5 ft of ${fam.name}.`);
      const burst = act.item.system.activities.find((a) => a.midiProperties?.identifier === "energy-pulse-save");
      if (!burst) return;
      pulsePending.add(actor.uuid);
      try {
        await MidiQOL.completeActivityUse(burst, { midiOptions: { targetUuids: targets.map((t) => t.uuid), workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {});
      } finally { pulsePending.delete(actor.uuid); }
      return;
    }
    // the burst: Medium or smaller creatures that failed fall Prone
    if (act?.midiProperties?.identifier === "energy-pulse-save") {
      for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) {
        if (t?.actor && ["tiny", "sm", "med"].includes(t.actor.system.traits?.size ?? "med") && !t.actor.statuses.has("prone")) await addEffect(t.actor, await statusData("prone"));
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Energy Pulse failed`, err); }
});
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    if (workflow?.activity?.midiProperties?.identifier !== "energy-pulse-save") return;
    const type = workflow.actor?.getFlag("world", "cgaFamElement") ?? "fire";
    for (const r of workflow.damageRolls ?? []) { r.options.type = type; r.options.types = [type]; }
    await workflow.setDamageRolls(workflow.damageRolls);
  } catch (err) { console.warn(`${MODULE_ID} | Energy Pulse type failed`, err); }
});

// ------------------------------------------------------------------ Soothing Familiar, Healing Beacon
Hooks.on("dnd5e.preRollDamageV2", (config) => {
  try {
    const activity = config?.subject;
    if (activity?.type !== "heal" && !(config.rolls ?? []).some((r) => r.options?.type === "healing")) return;
    const roller = activity?.actor;
    const tok = tokensOf(roller)[0];
    if (!tok) return;
    const beacon = tok.parent.tokens.some((f) => {
      const owner = ownerOfFamiliar(f);
      if (!owner || !feat(owner, "soothing-familiar") || !alive(f.actor) || edgeDistance(f, tok, tok.parent) > 5) return false;
      const ot = tokensOf(owner)[0];
      return (!ot || edgeDistance(ot, f, f.parent) <= 120) && (!ot || ot.disposition === tok.disposition);
    });
    if (!beacon) return;
    for (const r of config.rolls ?? []) {
      if (r.options?.type && r.options.type !== "healing") continue;
      r.parts = (r.parts ?? []).map((p) => String(p).replace(/(\d*d\d+)(?![\dA-Za-z])/g, "$1min3"));
    }
  } catch (err) { console.warn(`${MODULE_ID} | Healing Beacon failed`, err); }
});

// ------------------------------------------------------------------ Mythal Touched, Mythal Ward
const MYTHAL = (r, level) => r <= 2 ? `You and each creature within 15 ft make a DEX save: ${level}d8 Force, half on a success (by hand).`
  : r <= 7 ? "You and the spell's caster share a telepathic link for 1 hour."
    : r <= 10 ? "Gravity reverses in a 15-ft-radius, 60-ft-tall Cylinder centered on you for 1 minute (Reverse Gravity, by hand)."
      : r <= 13 ? "You and the spell's caster make CON saves or are Stunned until the end of your next turn (by hand)."
        : r <= 17 ? "+2 AC for 1 minute (applied)."
          : r <= 19 ? "Flammable, unattended nonmagical objects within 10 ft of the caster burst into flame (1d4 Fire)."
            : "The spell dissipates with no effect on you (if cast with a slot, the caster gets the slot back - by hand).";
const mythalNull = new WeakMap(); // workflow -> Set of token uuids
const mythalAsked = new WeakMap(); // workflow -> Set of token uuids already offered
async function mythalWard(actor, tDoc, workflow, what) {
  const it = feat(actor, "mythal-touched");
  if (!it || usesLeft(it, prof(actor)) <= 0 || !canReact(actor)) return null;
  if (!(await askOwner(actor, `Mythal Ward: ${actor.name}`, `<p>${what} Use your Reaction to roll on the Mythal-Touched Magic table (${usesLeft(it, prof(actor))} uses left)?</p>`))) return null;
  await spend(it); await useReaction(actor);
  const r = await new Roll("1d20").evaluate();
  const level = Math.max(1, castLevel(workflow));
  await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Mythal Ward (${actor.name}): ${MYTHAL(r.total, level)}` });
  if (r.total >= 14 && r.total <= 17) await addEffect(actor, { name: "Mythal Ward (+2 AC)", img: it.img, transfer: false, duration: { seconds: 60 }, system: { changes: [chg("system.attributes.ac.bonus", "2", "add")] } });
  return r.total;
}
Hooks.on("midi-qol.hitsChecked", async (workflow) => {
  try {
    if (workflow?.item?.type !== "spell" || !workflow.activity?.attack || !workflow.attackRoll) return;
    if (!mythalAsked.has(workflow)) mythalAsked.set(workflow, new Set());
    const asked = mythalAsked.get(workflow); // midi can call hitsChecked more than once per attack
    for (const tObj of Array.from(workflow.hitTargets ?? [])) {
      const t = tokenOf(tObj), a = t?.actor;
      if (!a || a === workflow.actor || asked.has(t?.uuid) || !feat(a, "mythal-touched")) continue;
      asked.add(t.uuid);
      const res = await mythalWard(a, t, workflow, `${workflow.item.name} hits ${a.name} (${workflow.attackRoll.total}).`);
      if (res == null) continue;
      const ac = Number(a.system.attributes.ac.value ?? 10);
      if (res === 20 || (res >= 14 && res <= 17 && !workflow.isCritical && workflow.attackRoll.total < ac + 2)) {
        workflow.hitTargets.delete(tObj);
        say(a, `<strong>Mythal Ward:</strong> ${workflow.item.name} misses ${a.name}.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Mythal Ward (attack) failed`, err); }
});
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (workflow?.item?.type !== "spell" || !workflow.failedSaves?.size) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const tDoc = tokenOf(t), a = tDoc?.actor;
      if (!a || !feat(a, "mythal-touched")) continue;
      const res = await mythalWard(a, tDoc, workflow, `${a.name} fails a save against ${workflow.item.name}.`);
      if (res !== 20) continue;
      workflow.failedSaves.delete(t); workflow.saves?.add?.(t);
      if (!mythalNull.has(workflow)) mythalNull.set(workflow, new Set());
      mythalNull.get(workflow).add(tDoc.uuid);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Mythal Ward (save) failed`, err); }
});
Hooks.on("midi-qol.preTargetDamageApplication", (token, { ditem, workflow }) => {
  try {
    if (!mythalNull.get(workflow)?.has(tokenOf(token)?.uuid)) return;
    reduceDamage(ditem, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
  } catch (err) {}
});

// ------------------------------------------------------------------ Light Bringer, Sun's Healing; Boon of Dimensional Travel
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, act = workflow?.activity;
    if (!actor || !act) return;
    if (act.midiProperties?.identifier === "suns-healing" || /sun.s healing/i.test(act.name ?? "")) {
      const cls = hitDieClasses(actor)[0];
      if (!cls) return say(actor, `<strong>Sun's Healing:</strong> no Hit Point Dice left.`);
      await spendHitDie(cls);
      const r = await new Roll(`1${cls.system.hd.denomination}`).evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Sun's Healing: ${actor.name} regains ${r.total} Hit Points` });
      await heal(actor, r.total);
    }
    if (workflow.item?.type === "feat" && /^boon of dimensional travel/i.test(workflow.item.name ?? "")) await blinkNextMove(actor, "Blink Steps", 30);
  } catch (err) { console.warn(`${MODULE_ID} | P3 activity rules failed`, err); }
});

// ------------------------------------------------------------------ Bomber, Long Shots: no long-range Disadvantage with Thrown weapons
// midi (when it checks range) sets workflow.longRangeAttack before preAttackRoll and turns it into Disadvantage right after.
Hooks.on("midi-qol.preAttackRoll", (workflow) => {
  try {
    if (workflow?.longRangeAttack && workflow.item?.system?.properties?.has?.("thr") && feat(workflow.actor, "bomber")) workflow.longRangeAttack = false;
  } catch (err) {}
});
// Automated Conditions 5e checks range itself: its sharpShooter flag (set in memory for this attack only) treats long range
// as normal. It also drops the adjacent-enemy Disadvantage, so it's only set when no hostile creature is within 5 ft.
const AC5E = "automated-conditions-5e";
Hooks.on("dnd5e.preUseActivity", (activity) => {
  try {
    const actor = activity?.actor;
    if (activity?.type !== "attack" || !activity.item?.system?.properties?.has?.("thr") || !feat(actor, "bomber") || actor.flags?.[AC5E]?.sharpShooter) return;
    const me = tokensOf(actor)[0];
    if (me && me.parent.tokens.some((o) => o.actor && o.disposition !== me.disposition && o.disposition !== 0 && alive(o.actor) && edgeDistance(me, o, me.parent) <= 5)) return;
    foundry.utils.setProperty(actor.flags, `${AC5E}.sharpShooter`, true);
    foundry.utils.setProperty(actor.flags, `${AC5E}.cgaBomber`, true);
    setTimeout(() => clearBomber(actor), 30000);
  } catch (err) { console.warn(`${MODULE_ID} | Long Shots failed`, err); }
});
function clearBomber(actor) { if (actor?.flags?.[AC5E]?.cgaBomber) { delete actor.flags[AC5E].sharpShooter; delete actor.flags[AC5E].cgaBomber; } }
Hooks.on("dnd5e.rollAttackV2", (rolls, { subject }) => clearBomber(subject?.actor));
Hooks.on("midi-qol.RollComplete", (workflow) => clearBomber(workflow?.actor));

// ------------------------------------------------------------------ Street Justice (Headlock), Boon of Bloodshed (Killer's Fortune is an effect)
Hooks.on("midi-qol.preAttackRollConfig", (workflow) => {
  try {
    const actor = workflow?.actor, tracker = workflow?.attackRollModifierTracker?.advantage;
    const target = workflow.targets?.size === 1 ? tokenOf(Array.from(workflow.targets)[0])?.actor : null;
    if (!actor || !target || !tracker?.add || !target.statuses.has("grappled")) return;
    const me = tokenOf(workflow.token);
    const grapplers = target.effects.filter((e) => e.statuses.has("grappled")).map((e) => String(e.origin ?? "")).filter(Boolean);
    const holder = (me?.parent?.tokens ?? []).find((h) => h.actor && h.actor !== actor && h.disposition === me.disposition && feat(h.actor, "street-justice")
      && grapplers.some((o) => o.startsWith(h.actor.uuid)));
    if (holder) tracker.add("cgaHeadlock", `Headlock (${holder.name})`);
  } catch (err) { console.warn(`${MODULE_ID} | Headlock failed`, err); }
});

// ------------------------------------------------------------------ Spell Subterfuge, Shrouding Spells
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    const it = actor && feat(actor, "spell-subterfuge");
    if (!it || !slotCast(workflow) || workflow.activity?.activation?.type !== "action" || usesLeft(it, 1) <= 0 || MidiQOL.hasUsedBonusAction?.(actor)) return;
    if (!(await askOwner(actor, `Shrouding Spells: ${actor.name}`, `<p>Take the Dash and Hide actions as a Bonus Action (${usesLeft(it, 1)} uses left)?</p>`))) return;
    await spend(it); await MidiQOL.setBonusActionUsed?.(actor);
    const walk = Number(actor.system.attributes.movement?.walk ?? 30);
    await addEffect(actor, { name: "Dash (Shrouding Spells)", img: "icons/skills/movement/feet-winged-boots-brown.webp", transfer: false, duration: { seconds: 6 },
      system: { changes: [chg("system.attributes.movement.walk", String(walk), "add")] }, flags: { dae: { stackable: "noneName", specialDuration: ["turnEnd"] } } });
    const rolls = await actor.rollSkill({ skill: "ste" }, { configure: false }).catch(() => null);
    const total = Number(rolls?.[0]?.total ?? 0);
    if (total >= 15) await addEffect(actor, await statusData("invisible", { name: "Hidden (Shrouding Spells)" }));
    say(actor, `<strong>Shrouding Spells:</strong> ${actor.name} Dashes and hides (Stealth ${total}${total >= 15 ? " - Invisible" : " - not hidden"}).`);
  } catch (err) { console.warn(`${MODULE_ID} | Shrouding Spells failed`, err); }
});

// ------------------------------------------------------------------ Damage rolls: Blazing Strike, Power from Pain, Spell Overload, Powerful Radiance, Perfect Poisoner
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !workflow.damageRolls?.length) return;
    let changed = false;
    // Blazing Strike (toggle effect on the boon): weapon damage becomes Radiant
    const bd = feat(actor, "boon-of-blazing-dawn");
    if (bd && item?.type === "weapon" && workflow.activity?.attack && bd.effects.some((e) => /blazing strike/i.test(e.name) && !e.disabled)) {
      for (const r of workflow.damageRolls) { r.options.type = "radiant"; r.options.types = ["radiant"]; }
      changed = true;
    }
    // Power from Pain: once per turn while Bloodied, an attack that hits deals +PB
    if (feat(actor, "boon-of-bloodshed") && workflow.activity?.attack && workflow.hitTargets?.size && isBloodied(actor) && !usedThisTurn("powerFromPain", actor)) {
      markTurn("powerFromPain", actor);
      const first = workflow.damageRolls[0];
      const extra = await new CONFIG.Dice.DamageRoll(String(prof(actor)), {}, { ...foundry.utils.deepClone(first.options ?? {}), flavor: "Power from Pain" }).evaluate();
      workflow.damageRolls.push(extra); changed = true;
    }
    // Spell Overload: slot spell damage - dice of 1-2 become 3 and damaged creatures fall Prone (once, back on Initiative / rest)
    const es = feat(actor, "boon-of-erupting-spellpower");
    if (es && slotCast(workflow) && usesLeft(es, 1, "sr") > 0
      && await askOwner(actor, `Spell Overload: ${actor.name}`, `<p>Surge ${item.name}? Its damage dice of 1-2 become 3s and every creature it damages falls Prone (then not again until you roll Initiative or rest).</p>`)) {
      await spend(es, "sr");
      for (const r of workflow.damageRolls) setDice(r, (v) => Math.max(3, v));
      workflow.cgaOverload = true; changed = true;
    }
    // Powerful Radiance: maximize a Radiant damage roll (1/LR)
    const er = feat(actor, "boon-of-exquisite-radiance");
    if (er && workflow.damageRolls.some((r) => isType(r, "radiant")) && usesLeft(er, 1) > 0
      && await askOwner(actor, `Powerful Radiance: ${actor.name}`, `<p>Maximize the Radiant damage dice of ${item?.name ?? "this roll"} (once per Long Rest)?</p>`)) {
      await spend(er);
      for (const r of workflow.damageRolls.filter((x) => isType(x, "radiant"))) setDice(r, (v, f) => f);
      changed = true;
    }
    // Perfect Poisoner: once per turn, Poison damage dice are maximized
    if (feat(actor, "boon-of-poison-mastery") && workflow.damageRolls.some((r) => isType(r, "poison")) && !usedThisTurn("perfectPoisoner", actor)) {
      markTurn("perfectPoisoner", actor);
      for (const r of workflow.damageRolls.filter((x) => isType(x, "poison"))) setDice(r, (v, f) => f);
      changed = true;
      say(actor, `<strong>Perfect Poisoner:</strong> ${actor.name}'s Poison damage dice are maximized.`);
    }
    if (changed) await workflow.setDamageRolls(workflow.damageRolls);
  } catch (err) { console.warn(`${MODULE_ID} | P3 damage roll rules failed`, err); }
});
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    if (!workflow?.cgaOverload) return;
    for (const t of damagedTokens(workflow)) if (t.actor && alive(t.actor) && !t.actor.statuses.has("prone")) await addEffect(t.actor, await statusData("prone"));
  } catch (err) { console.warn(`${MODULE_ID} | Spell Overload Prone failed`, err); }
});

// ------------------------------------------------------------------ Boon of Bountiful Health: +5 temp HP, Hit Dice heal their maximum
Hooks.on("preUpdateActor", (actor, changes) => {
  try {
    const temp = foundry.utils.getProperty(changes, "system.attributes.hp.temp");
    if (temp == null || !feat(actor, "boon-of-bountiful-health")) return;
    const old = Number(actor.system.attributes.hp.temp ?? 0);
    if (Number(temp) > old && Number(temp) > 0) foundry.utils.setProperty(changes, "system.attributes.hp.temp", Number(temp) + 5);
  } catch (err) {}
});
Hooks.on("dnd5e.preRollHitDieV2", (config) => {
  try {
    if (!feat(config?.subject, "boon-of-bountiful-health")) return;
    const r = config.rolls?.[0];
    if (r?.parts?.length) r.parts[0] = r.parts[0].replace(/(\d*)d(\d+)(min\d+)?(?![\dA-Za-z])/, (m, n, f) => String(Number(n || 1) * Number(f)));
  } catch (err) { console.warn(`${MODULE_ID} | Superior Recuperation failed`, err); }
});

// ------------------------------------------------------------------ Bloodied effects: Desperate Resilience, Eye of the Storm
const BLOODIED_FX = [
  { ident: "boon-of-desperate-resilience", key: "cgaDesperate", name: "Defense of Body and Mind (Bloodied)", img: "icons/magic/defensive/shield-barrier-flaming-pentagon-red.webp",
    changes: () => Object.keys(CONFIG.DND5E.damageTypes).filter((t) => t !== "force").map((t) => chg("system.traits.dr.value", t, "add")) },
  { ident: "boon-of-the-furious-storm", key: "cgaStormEye", name: "Eye of the Storm (Bloodied Immunity)", img: "icons/magic/lightning/bolt-strike-forked-blue.webp",
    changes: () => [chg("system.traits.di.value", "lightning", "add"), chg("system.traits.di.value", "thunder", "add")] }
];
async function syncBloodied(actor) {
  for (const b of BLOODIED_FX) {
    const has = feat(actor, b.ident);
    const cur = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.bloodiedFx === b.key);
    const want = !!has && isBloodied(actor);
    if (!want && cur.length) await actor.deleteEmbeddedDocuments("ActiveEffect", cur.map((e) => e.id)).catch(() => {});
    if (want && !cur.length) await actor.createEmbeddedDocuments("ActiveEffect", [{ name: b.name, img: b.img, transfer: false, system: { changes: b.changes() }, flags: { [MODULE_ID]: { bloodiedFx: b.key } } }]).catch(() => {});
  }
}
Hooks.on("updateActor", (actor, changes, options) => {
  try {
    if (!isGM()) return;
    if (foundry.utils.hasProperty(changes, "system.attributes.hp")) syncBloodied(actor);
    // Killer's Fortune / Siphon Life: a creature dropped to 0
    const now = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if (now === 0 && Number(options?.cgaOldHP ?? 1) > 0) dropped(actor);
  } catch (err) { console.warn(`${MODULE_ID} | P3 HP rules failed`, err); }
});
Hooks.on("preUpdateActor", (actor, changes, options) => { if (foundry.utils.hasProperty(changes, "system.attributes.hp.value")) options.cgaOldHP = Number(actor.system.attributes.hp.value ?? 0); });
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => { if (isGM() && item.parent instanceof Actor && /^boon of (desperate|the furious)/i.test(item.name ?? "")) syncBloodied(item.parent); });

// ------------------------------------------------------------------ A creature drops to 0: Killer's Fortune, Siphon Life
async function dropped(victim) {
  const vt = tokensOf(victim)[0];
  if (!vt) return;
  for (const h of vt.parent.tokens) {
    const a = h.actor;
    if (!a || a === victim || h.disposition === vt.disposition || !alive(a)) continue;
    const bs = feat(a, "boon-of-bloodshed");
    if (bs && !isIncapacitated(a)) {
      await addEffect(a, { name: "Killer's Fortune", img: bs.img, transfer: false, origin: bs.uuid, duration: { value: null, units: "rounds", expiry: "sourceEnd", expired: false },
        system: { changes: [chg("flags.midi-qol.advantage.attack.all", "1")] }, flags: { dae: { stackable: "noneName", specialDuration: ["1Attack"] } } });
      say(a, `<strong>Killer's Fortune:</strong> ${a.name} has Advantage on their next attack roll before the end of their next turn.`);
    }
    const sd = feat(a, "boon-of-the-soul-drinker");
    if (sd && usesLeft(sd, 1, "sr") > 0 && canReact(a) && edgeDistance(h, vt, vt.parent) <= 120
      && await askOwner(a, `Siphon Life: ${a.name}`, `<p>${vt.name} drops to 0 Hit Points. Use your Reaction to regain 50 Hit Points (once per Short Rest)?</p>`)) {
      await spend(sd, "sr"); await useReaction(a);
      await heal(a, 50);
      say(a, `<strong>Siphon Life:</strong> ${a.name} regains 50 Hit Points.`);
    }
  }
}

// ------------------------------------------------------------------ Boon of Erupting Spellpower: the use comes back when you roll Initiative
Hooks.on("updateCombatant", async (combatant, changes) => {
  try {
    if (!isGM() || changes.initiative == null) return;
    const es = feat(combatant.actor, "boon-of-erupting-spellpower");
    if (es?.system?.uses?.max && Number(es.system.uses.spent ?? 0) > 0) await es.update({ "system.uses.spent": 0 });
  } catch (err) {}
});

// ------------------------------------------------------------------ Boon of Fortune's Favor: reroll a failed save (once per round)
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size) return;
    const dc = Number(workflow.activity?.save?.dc?.value ?? workflow.saveDC ?? 0);
    if (!dc) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const tDoc = tokenOf(t), a = tDoc?.actor;
      if (!a || !feat(a, "boon-of-fortunes-favor") || (game.combat?.started && a.getFlag("world", "cgaFortuneUsed"))) continue;
      const roll = workflow.targetSaveDetails?.[tDoc.uuid]?.saveRoll, die = d20Of(roll);
      if (!roll || !die) continue;
      const mods = Number(roll.total) - Number(die.total);
      if (mods + 20 < dc) continue;
      if (!(await askOwner(a, `Fortune's Favor: ${a.name}`, `<p>${a.name} fails a DC ${dc} save (${roll.total}). Reroll it (you must use the new roll)?</p>`))) continue;
      if (game.combat?.started) await updateActor(a, { "flags.world.cgaFortuneUsed": true });
      const r = await new Roll("1d20").evaluate();
      const total = mods + r.total;
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: a }), flavor: `Fortune's Favor: ${a.name} rerolls - ${total} vs DC ${dc}` });
      roll._total = total;
      if (total >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Fortune's Favor failed`, err); }
});

// ------------------------------------------------------------------ Turn start: Fortune's Favor reset, Fortifying Light, Flee Fools!
Hooks.on("updateCombat", async (combat, changed) => {
  try {
    if (!isGM() || !("turn" in changed || "round" in changed)) return;
    const tok = combat.combatant?.token, actor = combat.combatant?.actor;
    if (!actor || !tok) return;
    if (actor.getFlag("world", "cgaFortuneUsed")) await actor.unsetFlag("world", "cgaFortuneUsed").catch(() => {});
    // Fortifying Light: Daylight Presence active - you and allies within 30 ft gain 10 temp HP
    const pres = actor.effects.find((e) => /daylight presence/i.test(e.name) && !e.disabled);
    if (pres && feat(actor, "boon-of-the-bright-sun")) {
      if (isIncapacitated(actor)) await pres.delete().catch(() => {});
      else for (const o of tok.parent.tokens.filter((x) => x.actor && x.disposition === tok.disposition && alive(x.actor) && (x === tok || edgeDistance(tok, x, tok.parent) <= 30))) {
        if (Number(hpOf(o.actor).temp ?? 0) < 10) await o.actor.update({ "system.attributes.hp.temp": 10 }).catch(() => {});
      }
      if (!isIncapacitated(actor)) say(actor, `<strong>Fortifying Light:</strong> ${actor.name} and allies in the Daylight Presence gain 10 Temporary Hit Points.`);
    }
    // Flee, Fools!: a Frightened creature starts its turn within 60 ft of a Boon of Terror holder
    if (actor.statuses.has("frightened")) {
      for (const h of tok.parent.tokens) {
        const it = h.actor && feat(h.actor, "boon-of-terror");
        if (!it || h.disposition === tok.disposition || usesLeft(it, 1, "sr") <= 0 || !canReact(h.actor) || edgeDistance(h, tok, tok.parent) > 60) continue;
        if (!(await askOwner(h.actor, `Flee, Fools!: ${h.name}`, `<p>${tok.name} starts its turn Frightened within 60 ft. Use your Reaction - WIS save or it spends its turn fleeing from you (once per Short Rest)?</p>`))) continue;
        await useReaction(h.actor);
        const act = it.system.activities.find((a) => a.midiProperties?.identifier === "flee-fools") ?? it.system.activities.find((a) => a.type === "save");
        const w = act ? await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [tok.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch(() => null) : null;
        if (w && Array.from(w.failedSaves ?? []).some((x) => tokenOf(x) === tok)) say(h.actor, `<strong>Flee, Fools!:</strong> ${tok.name} must spend its turn moving away from ${h.name} by the fastest means.`);
        break;
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 turn rules failed`, err); }
});

// ------------------------------------------------------------------ Boon of Misty Escape: drop to 1 HP and turn to mist (1/LR)
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem }) => {
  try {
    const actor = token?.actor;
    const it = actor && feat(actor, "boon-of-misty-escape");
    if (!it || !ditem || usesLeft(it, 1) <= 0) return;
    const oldHP = Number(ditem.oldHP ?? actor.system.attributes.hp.value ?? 0);
    if (oldHP <= 0 || (ditem.newHP ?? 1) > 0) return;
    const total = (ditem.damageDetail ?? []).filter((x) => !["temphp", "healing"].includes(x.type) && (x.value ?? 0) > 0).reduce((s, x) => s + x.value, 0) || (ditem.hpDamage ?? 0);
    const oldTemp = Number(ditem.oldTempHP ?? actor.system.attributes.hp.temp ?? 0);
    if (total - oldTemp - oldHP >= Number(actor.system.attributes.hp.max ?? 0)) return; // killed outright
    if (!(await askOwner(actor, `Misty Escape: ${actor.name}`, `<p>${actor.name} would drop to 0 Hit Points. Drop to 1 instead and turn to mist (Gaseous Form, once per Long Rest)?</p>`))) return;
    await spend(it);
    reduceDamage(ditem, total - (oldTemp + oldHP - 1));
    ditem.hpDamage = oldHP - 1; ditem.newHP = 1; ditem.tempDamage = oldTemp; ditem.newTempHP = 0;
    await addEffect(actor, { name: "Misty Escape (Gaseous Form)", img: it.img, transfer: false, origin: it.uuid, duration: { seconds: 3600 },
      system: { changes: [chg("system.attributes.movement.fly", "20", "upgrade"), chg("system.attributes.movement.hover", "1", "override"),
        ...["bludgeoning", "piercing", "slashing"].map((t) => chg("system.traits.dr.value", t, "add")),
        ...["str", "dex", "con"].map((s) => chg(`flags.midi-qol.advantage.save.${s}`, "1")),
        chg("flags.midi-qol.OverTime", "turn=start, damageRoll=10, damageType=healing, label=Misty Escape")] } });
    say(actor, `<strong>Misty Escape:</strong> ${actor.name} drops to 1 Hit Point and turns to mist (Fly 20 ft, regains 10 Hit Points at the start of each turn for 1 hour).`);
  } catch (err) { console.warn(`${MODULE_ID} | Misty Escape failed`, err); }
});

// ------------------------------------------------------------------ Revelry, Iron Mind: Concentration kept through damage
Hooks.on("dnd5e.preRollConcentrationV2", (config) => {
  try {
    const actor = config?.subject;
    if (!actor) return;
    const iron = feat(actor, "boon-of-the-iron-mind");
    const dance = feat(actor, "boon-of-revelry") && Array.from(actor.concentration?.items ?? []).some((i) => /irresistible dance/i.test(i?.name ?? ""));
    if (!iron && !dance) return;
    config.rolls ??= [];
    if (!config.rolls.length) config.rolls.push({ parts: [], data: {} });
    config.rolls[0].parts ??= [];
    config.rolls[0].parts.push("99");
  } catch (err) { console.warn(`${MODULE_ID} | unbreakable Concentration failed`, err); }
});

// ------------------------------------------------------------------ Furious Storm, Storm's Strength: Disadvantage on saves against your Lightning/Thunder spells
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor || workflow.item?.type !== "spell" || !feat(actor, "boon-of-the-furious-storm")) return;
    const types = new Set((workflow.activity?.damage?.parts ?? []).flatMap((p) => Array.from(p.types ?? [])));
    if (!types.has("lightning") && !types.has("thunder")) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      if (t?.actor && t.actor !== actor) await addEffect(t.actor, { name: "Storm's Strength (Disadvantage)", img: "icons/magic/lightning/bolt-strike-forked-blue.webp", transfer: false,
        system: { changes: [chg("flags.midi-qol.disadvantage.save.all", "1")] }, flags: { dae: { stackable: "noneName", specialDuration: ["isSave"] } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Storm's Strength failed`, err); }
});
