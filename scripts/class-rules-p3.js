// Champions Guild Automation - priority-3 class feature rules (2024 Player's Handbook) that run from module hooks.
//  - Initiative: Superior Inspiration (Bardic Inspiration back to 2), Perfect Focus (Focus back to 4), Tandem Footwork.
//  - Damage: Rage of the Gods' Revivification, Undying Sentinel, Beguiling Defenses, Thought Shield, Spell Resistance.
//  - Attacks: Unbreakable Majesty, Glorious Defense (before hits are checked), Shadowy Dodge, Improved Duplicity.
//  - Start of turn: Avenging Angel's frightful aura, Searing Vengeance.
//  - Relentless Hunter (damage doesn't break Hunter's Mark concentration), Indomitable Might (STR score floor).
//  - Rests: Celestial Resilience temp HP, Overchannel resets. Light from Corona of Light goes back when it ends.
import { MODULE_ID, reduceDamage, hasFeat, askOwner, askChoice, edgeDistance, isIncapacitated } from "./main.js";
import { classLevel, featItem, bardicDie, rageEffect } from "./class-rules.js";

const isGM = () => game.users.activeGM?.isSelf;
const tokenOf = (t) => t?.document ?? t;
const say = (actor, html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${html}</p>` });
const usesLeft = (item) => Number(item?.system?.uses?.value ?? 0);
const mod = (actor, a) => Number(actor?.system?.abilities?.[a]?.mod ?? 0);
const alive = (actor) => (actor?.system?.attributes?.hp?.value ?? 0) > 0;
const reactionFree = (actor) => !MidiQOL.hasUsedReaction?.(actor);
const useReaction = (actor) => MidiQOL.setReactionUsed?.(actor);
const canReact = (actor) => actor && alive(actor) && reactionFree(actor) && !isIncapacitated(actor);
const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
async function spendUse(item, n = 1) {
  if (!item) return;
  const v = Number(item.system.uses.spent ?? 0) + n;
  try { await item.update({ "system.uses.spent": v }); }
  catch (err) { await asGM("updateItems", { actorUuid: item.actor.uuid, updates: [{ _id: item.id, "system.uses.spent": v }] }); }
}
const setUsesValue = (item, value) => asGM("updateItems", { actorUuid: item.actor.uuid, updates: [{ _id: item.id, "system.uses.spent": Math.max(0, Number(item.system.uses.max ?? 0) - value) }] });
const turnKey = () => (game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : `t${Math.floor(Date.now() / 6000)}`);
async function runSaveAct(owner, ident, targetDoc) {
  const act = owner?.system?.activities?.find((a) => a.midiProperties?.identifier === ident);
  if (!act) return false;
  const w = await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [targetDoc.uuid], workflowOptions: { targetConfirmation: "none" } },
    consume: { resources: false, spellSlot: false } }, { configure: false }, {}).catch(() => null);
  return !!w && Array.from(w.failedSaves ?? []).some((x) => tokenOf(x) === targetDoc);
}

// ------------------------------------------------------------------ Initiative refills and Tandem Footwork
Hooks.on("updateCombatant", async (combatant, changes) => {
  if (!isGM() || !("initiative" in changes) || changes.initiative == null || foundry.utils.hasProperty(changes, "flags.world.cgaTandem")) return; // not our own Tandem bump
  const actor = combatant.actor;
  if (!actor) return;
  try {
    const bi = featItem(actor, "bardic-inspiration");
    if (hasFeat(actor, "superior-inspiration") && bi && usesLeft(bi) < 2) { await setUsesValue(bi, Math.min(2, Number(bi.system.uses.max ?? 2))); say(actor, `<strong>Superior Inspiration:</strong> ${actor.name} has 2 Bardic Inspiration uses.`); }
    const focus = featItem(actor, "monks-focus");
    if (hasFeat(actor, "perfect-focus") && focus && usesLeft(focus) < 4) { await setUsesValue(focus, Math.min(4, Number(focus.system.uses.max ?? 4))); say(actor, `<strong>Perfect Focus:</strong> ${actor.name} has 4 Focus Points.`); }
    // Tandem Footwork (Dance 6): spend Bardic Inspiration to add the roll to your and nearby allies' Initiative
    const bi2 = featItem(actor, "bardic-inspiration");
    const tDoc = combatant.token;
    if (hasFeat(actor, "tandem-footwork") && usesLeft(bi2) > 0 && tDoc && !combatant.getFlag?.("world", "cgaTandem")
      && await askOwner(actor, `Tandem Footwork: ${actor.name}`, `<p>Spend a Bardic Inspiration (${usesLeft(bi2)} left) to roll it and add the roll to your Initiative and that of allies within 30 ft?</p>`)) {
      await spendUse(bi2);
      const r = await new Roll(`1d${bardicDie(actor)}`).evaluate();
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Tandem Footwork: Initiative bonus" });
      const updates = combatant.parent.combatants.filter((c) => c.token && c.initiative != null && c.token.disposition === tDoc.disposition && (c === combatant || edgeDistance(c.token, tDoc, tDoc.parent) <= 30))
        .map((c) => ({ _id: c.id, initiative: Number(c.initiative) + r.total, "flags.world.cgaTandem": true }));
      if (updates.length) await combatant.parent.updateEmbeddedDocuments("Combatant", updates);
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 initiative rules failed`, err); }
});

// ------------------------------------------------------------------ Damage
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  const actor = token?.actor;
  if (!actor || !ditem || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
  const tokenDoc = tokenOf(token);
  const scene = tokenDoc.parent;
  const attacker = workflow?.actor;
  const atkDoc = tokenOf(workflow?.token);
  const dealt = () => Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
  const wasHit = !!workflow?.activity?.attack && Array.from(workflow.hitTargets ?? []).some((t) => tokenOf(t) === tokenDoc);
  try {
    // Spell Resistance (Abjurer 14): Resistance to the damage of spells
    if (hasFeat(actor, "spell-resistance") && workflow?.item?.type === "spell") reduceDamage(ditem, Math.ceil(dealt() / 2));
    // Beguiling Defenses (Archfey 10): Reaction when a creature hits you - halve the damage, WIS save or it takes psychic
    const bd = featItem(actor, "beguiling-defenses");
    if (wasHit && bd && attacker && attacker !== actor && canReact(actor) && usesLeft(bd) > 0 && dealt() > 1
      && await askOwner(actor, `Beguiling Defenses: ${actor.name}`, `<p>${attacker.name} hits you for ${dealt()} damage. Use your Reaction to halve it, and have ${attacker.name} make a WIS save or take the damage you take as Psychic damage?</p>`)) {
      await spendUse(bd); await useReaction(actor);
      reduceDamage(ditem, Math.floor(dealt() / 2));
      const taken = dealt();
      if (atkDoc && await runSaveAct(bd, "beguiling-defenses-save", atkDoc))
        await MidiQOL.applyTokenDamage([{ value: taken, type: "psychic" }], taken, new Set([atkDoc.object]), null, new Set(), {});
    }
    // Thought Shield (Great Old One 10): psychic damage you take is dealt back to its source
    const psychic = (ditem.damageDetail ?? []).filter((d) => d.type === "psychic").reduce((s, d) => s + Number(d.value ?? 0), 0);
    if (psychic > 0 && hasFeat(actor, "thought-shield") && atkDoc && attacker !== actor) {
      setTimeout(() => MidiQOL.applyTokenDamage([{ value: psychic, type: "psychic" }], psychic, new Set([atkDoc.object]), null, new Set(), {}), 300);
      say(actor, `<strong>Thought Shield:</strong> ${atkDoc.name} takes ${psychic} Psychic damage back.`);
    }
    if (!((ditem.oldHP ?? 0) > 0 && (ditem.newHP ?? 1) <= 0)) return;
    // Undying Sentinel (Ancients 15): once per Long Rest drop to 1 HP instead and regain 3x Paladin level
    const us = featItem(actor, "undying-sentinel");
    if (us && usesLeft(us) > 0) {
      await spendUse(us);
      reduceDamage(ditem, dealt());
      const hp = Math.min(Number(actor.system.attributes.hp.max), 1 + 3 * classLevel(actor, "paladin"));
      setTimeout(() => asGM("updateActor", { actorUuid: actor.uuid, updates: { "system.attributes.hp.value": hp } }), 600);
      say(actor, `<strong>Undying Sentinel:</strong> ${actor.name} drops to 1 Hit Point instead and regains ${hp - 1}.`);
      return;
    }
    // Revivification (Rage of the Gods): an ally within 30 ft drops to 0 - spend a Rage use, it's at your Barbarian level
    for (const z of scene?.tokens ?? []) {
      if (!z.actor || z === tokenDoc || z.disposition !== tokenDoc.disposition || !canReact(z.actor)) continue;
      if (!z.actor.effects.some((e) => e.flags?.world?.cgaRageOfGods && !e.disabled) || edgeDistance(z, tokenDoc, scene) > 30) continue;
      const rage = featItem(z.actor, "rage");
      if (usesLeft(rage) <= 0 || !(await askOwner(z.actor, `Revivification: ${z.name}`, `<p>${tokenDoc.name} drops to 0 Hit Points. Use your Reaction and a Rage use so it's at ${classLevel(z.actor, "barbarian")} Hit Points instead?</p>`))) continue;
      await spendUse(rage); await useReaction(z.actor);
      reduceDamage(ditem, dealt());
      const hp = classLevel(z.actor, "barbarian");
      setTimeout(() => asGM("updateActor", { actorUuid: actor.uuid, updates: { "system.attributes.hp.value": hp } }), 600);
      say(z.actor, `<strong>Revivification:</strong> ${tokenDoc.name} stays up at ${hp} Hit Points.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 damage rules failed`, err); }
});

// ------------------------------------------------------------------ Attack rolls (before hits are checked)
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical || workflow.isFumble) return;
    const tDoc = tokenOf(Array.from(workflow.targets)[0]);
    const atkDoc = tokenOf(workflow.token);
    const target = tDoc.actor, attacker = workflow.actor;
    if (!target || !atkDoc) return;
    const ac = Number(target.system.attributes.ac?.value ?? 10);
    const roll = workflow.attackRoll;
    const adjust = async (delta) => { roll._total = Number(roll.total) + delta; await workflow.setAttackRoll?.(roll); };
    // Unbreakable Majesty (Glamour 14): the first hit on you each turn - the attacker makes a CHA save or misses
    const um = featItem(target, "unbreakable-majesty");
    if (roll.total >= ac && um && target.effects.some((e) => e.flags?.world?.cgaMajesty && !e.disabled) && target.getFlag("world", "cgaMajestyTurn") !== turnKey()) {
      await asGM("updateActor", { actorUuid: target.uuid, updates: { "flags.world.cgaMajestyTurn": turnKey() } });
      if (await runSaveAct(um, "majesty-save", atkDoc)) { say(target, `<strong>Unbreakable Majesty:</strong> ${atkDoc.name} falters and misses.`); await adjust(ac - 1 - roll.total); return; }
    }
    // Glorious Defense (Glory 15): you or a creature within 10 ft is hit - Reaction, +CHA to AC; attack back on a miss
    if (roll.total >= ac) {
      for (const g of tDoc.parent?.tokens ?? []) {
        const gd = g.actor && featItem(g.actor, "glorious-defense");
        if (!gd || usesLeft(gd) <= 0 || !canReact(g.actor) || g.disposition !== tDoc.disposition || (g !== tDoc && edgeDistance(g, tDoc, tDoc.parent) > 10)) continue;
        const cha = Math.max(1, mod(g.actor, "cha"));
        if (roll.total >= ac + cha) continue;
        if (!(await askOwner(g.actor, `Glorious Defense: ${g.name}`, `<p>${atkDoc.name}'s attack (${roll.total}) hits ${tDoc.name} (AC ${ac}). Use your Reaction to add +${cha} to its AC (the attack then misses)?</p>`))) continue;
        await spendUse(gd); await useReaction(g.actor);
        await adjust(ac + cha - 1 - roll.total);
        say(g.actor, `<strong>Glorious Defense:</strong> the attack misses ${tDoc.name}.`);
        const w = g.actor.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.activities.some((a) => a.type === "attack"));
        if (w && edgeDistance(g, atkDoc, tDoc.parent) <= (w.system.range?.reach ?? 5) + 0) setTimeout(() => MidiQOL.completeActivityUse(w.system.activities.find((a) => a.type === "attack"),
          { midiOptions: { targetUuids: [atkDoc.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch(() => {}), 800);
        break;
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 attack reactions failed`, err); }
});

// Shadowy Dodge (Gloom Stalker 15) and Improved Duplicity (Trickery 17): once Advantage/Disadvantage is known.
Hooks.on("midi-qol.preAttackRollConfig", async (workflow) => {
  try {
    const tr = workflow?.attackRollModifierTracker;
    const atkDoc = tokenOf(workflow?.token);
    const tDoc = tokenOf(Array.from(workflow?.targets ?? [])[0]);
    if (!tr || !atkDoc || !tDoc?.actor) return;
    const target = tDoc.actor;
    if (hasFeat(target, "shadowy-dodge") && canReact(target) && workflow.actor !== target && !tr.disadvantage?.isActive?.()
      && await askOwner(target, `Shadowy Dodge: ${tDoc.name}`, `<p>${atkDoc.name} attacks you. Use your Reaction to give the attack Disadvantage (and teleport up to 30 ft afterwards - move your token)?</p>`)) {
      await useReaction(target);
      tr.disadvantage?.add?.("shadowy-dodge", "Shadowy Dodge");
    }
    // Improved Duplicity: allies have Advantage against a creature within 5 ft of your illusory duplicate
    for (const dupe of atkDoc.parent.tokens.filter((t) => t.flags?.world?.cgaDuplicate)) {
      const owner = fromUuidSync(dupe.flags.world.cgaDuplicate);
      if (!owner || owner === workflow.actor || !hasFeat(owner, "improved-duplicity")) continue;
      const ownerTok = owner.getActiveTokens?.()[0]?.document;
      if (ownerTok?.disposition !== atkDoc.disposition || edgeDistance(dupe, tDoc, tDoc.parent) > 5) continue;
      tr.advantage?.add?.("improved-duplicity", "Improved Duplicity");
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 attack config rules failed`, err); }
});
// Improved Duplicity: when the duplicate vanishes, a creature within 5 ft of it regains HP equal to your Cleric level
Hooks.on("deleteToken", async (doc) => {
  try {
    if (!isGM() || !doc.flags?.world?.cgaDuplicate) return;
    const owner = fromUuidSync(doc.flags.world.cgaDuplicate);
    if (!owner || !hasFeat(owner, "improved-duplicity")) return;
    const near = doc.parent.tokens.filter((t) => t.actor && t.id !== doc.id && alive(t.actor) && edgeDistance(doc, t, doc.parent) <= 5);
    if (!near.length) return;
    const pick = await askChoice(owner, `Improved Duplicity: ${owner.name}`, `<p>Your illusion vanishes. Which creature within 5 ft of it regains ${classLevel(owner, "cleric")} Hit Points?</p>`,
      [...near.map((t, i) => ({ action: t.id, label: t.name, default: i === 0 })), { action: "none", label: "No one" }]);
    const t = near.find((x) => x.id === pick);
    if (t) await MidiQOL.applyTokenDamage([{ value: classLevel(owner, "cleric"), type: "healing" }], classLevel(owner, "cleric"), new Set([t.object]), null, new Set(), {});
  } catch (err) { console.warn(`${MODULE_ID} | Improved Duplicity heal failed`, err); }
});

// ------------------------------------------------------------------ Start of turn
Hooks.on("updateCombat", async (combat, changed) => {
  if (!isGM() || !("turn" in changed || "round" in changed) || !combat.started) return;
  const tDoc = combat.combatant?.token;
  const actor = tDoc?.actor;
  if (!actor) return;
  try {
    // Searing Vengeance (Celestial 14): at 0 HP, rise with half your HP and burst with radiant light
    const sv = featItem(actor, "searing-vengeance");
    if (sv && usesLeft(sv) > 0 && !alive(actor) && Number(actor.system.attributes.death?.failure ?? 0) < 3
      && await askOwner(actor, `Searing Vengeance: ${actor.name}`, `<p>Instead of a Death Saving Throw, regain half your Hit Points and blast enemies within 30 ft with radiant light?</p>`)) {
      await spendUse(sv);
      await actor.update({ "system.attributes.hp.value": Math.floor(Number(actor.system.attributes.hp.max) / 2), "system.attributes.death.success": 0, "system.attributes.death.failure": 0 });
      for (const s of ["prone", "unconscious"]) await actor.toggleStatusEffect(s, { active: false }).catch(() => {});
      const act = sv.system.activities.find((a) => a.midiProperties?.identifier === "searing-burst");
      if (act) await MidiQOL.completeActivityUse(act, { midiOptions: { workflowOptions: { targetConfirmation: "none" } }, consume: { resources: false } }, { configure: false }, {}).catch(() => {});
    }
    // Avenging Angel (Vengeance 20): an enemy starting its turn within 30 ft makes a WIS save or is Frightened
    for (const a of tDoc.parent.tokens) {
      if (!a.actor || a === tDoc || a.disposition === tDoc.disposition || !a.actor.effects.some((e) => e.flags?.world?.cgaAngel && !e.disabled)) continue;
      if (edgeDistance(a, tDoc, tDoc.parent) > 30 || actor.effects.some((e) => e.flags?.world?.cgaAngelFear)) continue;
      if (await runSaveAct(featItem(a.actor, "avenging-angel"), "angel-save", tDoc))
        await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Avenging Angel: Frightened", img: "icons/magic/holy/angel-winged-humanoid-blue.webp", statuses: ["frightened"], transfer: false,
          duration: { seconds: 60 }, flags: { world: { cgaAngelFear: true }, dae: { specialDuration: ["isDamaged"] } } }]).catch(() => {});
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 turn-start rules failed`, err); }
});

// ------------------------------------------------------------------ Relentless Hunter: no Concentration check for Hunter's Mark
Hooks.on("preUpdateActor", (actor, changes, options) => {
  if (!hasFeat(actor, "relentless-hunter") || !foundry.utils.hasProperty(changes, "system.attributes.hp")) return;
  const conc = Array.from(actor.concentration?.effects ?? []);
  if (conc.length && conc.every((e) => /hunter'?s mark/i.test(e.name ?? "") || /hunter'?s mark/i.test(fromUuidSync(e.origin ?? "")?.name ?? ""))) {
    options.noConcentrationCheck = true;
    foundry.utils.setProperty(options, "dnd5e.concentrationCheck", false);
  }
});

// ------------------------------------------------------------------ Indomitable Might: STR checks/saves never below your STR score
for (const h of ["dnd5e.rollAbilityCheck", "dnd5e.rollSavingThrow"]) Hooks.on(h, (rolls, { ability, subject } = {}) => {
  if (ability !== "str" || !hasFeat(subject, "indomitable-might") || !rolls?.length) return;
  const score = Number(subject.system.abilities.str?.value ?? 0);
  if (Number(rolls[0].total) >= score) return;
  rolls[0]._total = score;
  say(subject, `<strong>Indomitable Might:</strong> the Strength roll counts as ${score}.`);
});

// ------------------------------------------------------------------ Rests and light
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner) return;
    const long = config?.type === "long" || result?.longRest;
    if (long) { const oc = featItem(actor, "overchannel"); if (oc?.getFlag("world", "cgaOverchannelUses")) await oc.unsetFlag("world", "cgaOverchannelUses"); }
    // Celestial Resilience (Celestial 10): temp HP = Warlock level + CHA after a Short or Long Rest
    if (hasFeat(actor, "celestial-resilience")) {
      const temp = classLevel(actor, "warlock") + mod(actor, "cha");
      if (Number(actor.system.attributes.hp.temp ?? 0) < temp) await actor.update({ "system.attributes.hp.temp": temp });
      say(actor, `<strong>Celestial Resilience:</strong> ${actor.name} gains ${temp} Temporary Hit Points; up to five allies can each get ${Math.floor(classLevel(actor, "warlock") / 2) + mod(actor, "cha")} (give them by hand).`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 rest rules failed`, err); }
});
Hooks.on("deleteActiveEffect", async (effect) => {
  if (effect.flags?.world?.cgaAuraSource !== "corona" || !(effect.parent instanceof Actor)) return;
  for (const t of effect.parent.getActiveTokens?.() ?? []) {
    const prev = t.document.getFlag("world", "cgaLightPrev");
    if (!prev || !t.document.isOwner) continue;
    await t.document.update({ "light.bright": prev.bright ?? 0, "light.dim": prev.dim ?? 0, "flags.world.-=cgaLightPrev": null }).catch(() => {});
  }
});
