// Champions Guild Automation - class feature rules that don't fit on an item (2024 Player's Handbook).
// They run from module hooks, so they work as soon as the module updates (the feature items still need Mass Apply).
//  - Auras: Aura of Protection (+CHA to saves for you and allies in 10 ft / 30 ft at 18; one paladin aura per creature).
//  - Damage-reduction Reactions offered to the owner: Deflect Attacks (Monk, with Redirect), Parry (Battle Master),
//    Protective Field (Psi Warrior).
//  - Attack-roll Reactions before hits are checked: Precision Attack (Battle Master), Cutting Words (College of Lore).
//  - Dark One's Blessing (Fiend warlock temp HP when an enemy drops to 0 near you or by you).
//  - Portent: two (three at 14) d20s rolled on every Long Rest.
//  - Rage upkeep: a Rage that wasn't extended this turn (attack, forced save or the Bonus Action) ends at the end of the
//    Barbarian's turn (not from level 15, Persistent Rage).
//  - Martial Arts: Monk weapons and the Unarmed Strike get the Finesse property (an enchantment on each weapon).
import { MODULE_ID, reduceDamage, hasFeat, askOwner, edgeDistance, isIncapacitated, turnKey } from "./main.js";

export const classLevel = (actor, cls) => Number(actor?.classes?.[cls]?.system?.levels ?? 0);
export const featItem = (actor, identifier) => actor?.items?.find((i) => i.system?.identifier === identifier);
const isGM = () => game.users.activeGM?.isSelf;
const tokenOf = (t) => t?.document ?? t;
const say = (actor, html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${html}</p>` });
const usesLeft = (item) => Number(item?.system?.uses?.value ?? 0);
async function spendUse(item, n = 1) {
  if (!item) return;
  try { await item.update({ "system.uses.spent": Number(item.system.uses.spent ?? 0) + n }); }
  catch (err) { await MidiQOL.socket().executeAsGM("updateItems", { actorUuid: item.actor.uuid, updates: [{ _id: item.id, "system.uses.spent": Number(item.system.uses.spent ?? 0) + n }] }).catch(() => {}); }
}
const reactionFree = (actor) => !MidiQOL.hasUsedReaction?.(actor);
const useReaction = (actor) => MidiQOL.setReactionUsed?.(actor);
export const superiorityDie = (actor) => { const l = classLevel(actor, "fighter"); return l >= 18 ? 12 : l >= 10 ? 10 : 8; };
export const psionicDie = (actor) => { const l = Math.max(classLevel(actor, "fighter"), classLevel(actor, "rogue")); return l >= 17 ? 12 : l >= 11 ? 10 : l >= 5 ? 8 : 6; };
export const martialArtsDie = (actor) => { const l = classLevel(actor, "monk"); return l >= 17 ? 12 : l >= 11 ? 10 : l >= 5 ? 8 : 6; };
export const bardicDie = (actor) => { const l = classLevel(actor, "bard"); return l >= 15 ? 12 : l >= 10 ? 10 : l >= 5 ? 8 : 6; };

// ------------------------------------------------------------------ Auras
const AURAS = [
  { feature: "aura-of-protection", key: "paladin-aura", range: (a) => (classLevel(a, "paladin") >= 18 ? 30 : 10),
    value: (a) => Math.max(1, Number(a.system.abilities.cha?.mod ?? 0)),
    effect: (a, v) => ({ name: `Aura of Protection (+${v})`, img: "icons/magic/holy/barrier-shield-winged-blue.webp",
      changes: [{ key: "system.bonuses.abilities.save", value: `+${v}`, type: "add", priority: 20, phase: "initial" }] }) }
];
const auraTimers = new Map();
function scheduleAuras(scene) {
  if (!scene || !isGM()) return;
  clearTimeout(auraTimers.get(scene.id));
  auraTimers.set(scene.id, setTimeout(() => sweepAuras(scene).catch((err) => console.warn(`${MODULE_ID} | aura sweep failed`, err)), 400));
}
async function sweepAuras(scene) {
  const tokens = scene.tokens.filter((t) => t.actor);
  // Desired aura effect per token and key: the strongest source wins.
  const want = new Map();
  for (const src of tokens) {
    for (const aura of AURAS) {
      if (!hasFeat(src.actor, aura.feature) || isIncapacitated(src.actor) || (src.actor.system.attributes.hp.value ?? 0) <= 0) continue;
      const v = aura.value(src.actor), range = aura.range(src.actor);
      for (const t of tokens) {
        if (t !== src && (t.disposition !== src.disposition || edgeDistance(src, t, scene) > range)) continue;
        const k = `${t.id}|${aura.key}`;
        if ((want.get(k)?.v ?? -Infinity) >= v) continue;
        want.set(k, { t, aura, v, src });
      }
    }
  }
  for (const t of tokens) {
    const have = t.actor.effects.filter((e) => e.flags?.[MODULE_ID]?.aura);
    for (const aura of AURAS) {
      const w = want.get(`${t.id}|${aura.key}`);
      const cur = have.filter((e) => e.flags[MODULE_ID].aura.key === aura.key);
      const keep = w ? cur.find((e) => e.flags[MODULE_ID].aura.source === w.src.actor.uuid && e.flags[MODULE_ID].aura.value === w.v) : null;
      const drop = cur.filter((e) => e !== keep);
      if (drop.length) await t.actor.deleteEmbeddedDocuments("ActiveEffect", drop.map((e) => e.id)).catch(() => {});
      if (w && !keep) {
        const data = w.aura.effect(w.src.actor, w.v);
        await t.actor.createEmbeddedDocuments("ActiveEffect", [{ ...data, transfer: false, origin: featItem(w.src.actor, aura.feature)?.uuid,
          system: { changes: data.changes }, flags: { [MODULE_ID]: { aura: { key: aura.key, source: w.src.actor.uuid, value: w.v } } } }]).catch(() => {});
      }
    }
  }
}
for (const h of ["moveToken", "createToken", "deleteToken"]) Hooks.on(h, (doc) => scheduleAuras(doc.parent));
Hooks.on("updateToken", (doc, changes) => { if (["disposition", "hidden", "x", "y", "elevation"].some((k) => k in changes)) scheduleAuras(doc.parent); });
for (const h of ["createActiveEffect", "deleteActiveEffect"]) Hooks.on(h, (e) => {
  if (e.flags?.[MODULE_ID]?.aura || !(e.parent instanceof Actor) || !e.statuses?.size) return;
  for (const t of e.parent.getActiveTokens?.() ?? []) scheduleAuras(t.document.parent);
});
Hooks.on("updateActor", (actor, changes) => {
  if (!foundry.utils.hasProperty(changes, "system.attributes.hp.value") && !foundry.utils.hasProperty(changes, "system.abilities")) return;
  for (const t of actor.getActiveTokens?.() ?? []) scheduleAuras(t.document.parent);
});
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => { if (item.parent instanceof Actor) for (const t of item.parent.getActiveTokens?.() ?? []) scheduleAuras(t.document.parent); });
Hooks.on("canvasReady", () => scheduleAuras(canvas.scene));

// ------------------------------------------------------------------ Damage-reduction Reactions
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  const actor = token?.actor;
  if (!actor || !ditem || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
  const tokenDoc = tokenOf(token);
  const attacker = workflow?.actor;
  const wasHit = !!workflow?.activity?.attack && Array.from(workflow.hitTargets ?? []).some((t) => tokenOf(t) === tokenDoc);
  const dealt = () => Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
  try {
    // Deflect Attacks (Monk 3; Deflect Energy at 13 = any damage type)
    const types = new Set((ditem.damageDetail ?? []).filter((d) => (d.value ?? 0) > 0).map((d) => d.type));
    if (wasHit && hasFeat(actor, "deflect-attacks") && reactionFree(actor) && !isIncapacitated(actor)
      && (hasFeat(actor, "deflect-energy") || classLevel(actor, "monk") >= 13 || ["bludgeoning", "piercing", "slashing"].some((t) => types.has(t)))) {
      const bonus = Number(actor.system.abilities.dex?.mod ?? 0) + classLevel(actor, "monk");
      if (await askOwner(actor, `Deflect Attacks: ${actor.name}`, `<p>${attacker?.name ?? "An attack"} hits ${actor.name} for ${dealt()} damage. Use your Reaction to reduce it by 1d10 + ${bonus}?</p>`)) {
        const roll = await new Roll(`1d10 + ${bonus}`).evaluate();
        const cut = reduceDamage(ditem, roll.total);
        await useReaction(actor);
        roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Deflect Attacks: ${actor.name} reduces the damage by ${cut}` });
        const focus = featItem(actor, "monks-focus");
        const attackerToken = workflow.token ?? attacker?.getActiveTokens?.()[0];
        if (dealt() === 0 && usesLeft(focus) > 0 && attackerToken && attacker !== actor
          && await askOwner(actor, `Deflect Attacks: ${actor.name}`, `<p>The damage is reduced to 0. Spend 1 Focus Point to redirect it at ${attackerToken.name} (DEX save or two Martial Arts dice + DEX)?</p>`)) {
          await spendUse(focus);
          // The redirect save has no damage of its own; the two Martial Arts dice + DEX are applied here on a failure.
          const act = featItem(actor, "deflect-attacks")?.system.activities.find((a) => a.midiProperties?.identifier === "deflect-redirect");
          const tgt = tokenOf(attackerToken);
          const w = act ? await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [tgt.uuid], workflowOptions: { targetConfirmation: "none" } },
            consume: { resources: false, spellSlot: false } }, { configure: false }, {}).catch((err) => console.warn(`${MODULE_ID} | Redirect failed`, err)) : null;
          if (w && Array.from(w.failedSaves ?? []).some((x) => tokenOf(x) === tgt)) {
            const type = ["bludgeoning", "piercing", "slashing"].find((t) => types.has(t)) ?? [...types][0] ?? "bludgeoning";
            const dmg = await new Roll(`2d${martialArtsDie(actor)} + ${Number(actor.system.abilities.dex?.mod ?? 0)}`).evaluate();
            await dmg.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Deflect Attacks: Redirect (${type})` });
            await MidiQOL.applyTokenDamage([{ value: dmg.total, type }], dmg.total, new Set([tgt.object ?? tgt]), null, new Set(), {});
          }
        }
        return;
      }
    }
    // Parry (Battle Master maneuver): melee attack damage, reduce by die + STR or DEX
    const sup = featItem(actor, "combat-superiority");
    if (wasHit && workflow.activity?.actionType === "mwak" && (hasFeat(actor, "maneuver-parry") || hasFeat(actor, "parry")) && sup && usesLeft(sup) > 0
      && reactionFree(actor) && !isIncapacitated(actor)) {
      const die = superiorityDie(actor), mod = Math.max(Number(actor.system.abilities.str?.mod ?? 0), Number(actor.system.abilities.dex?.mod ?? 0));
      if (await askOwner(actor, `Parry: ${actor.name}`, `<p>${attacker?.name ?? "A melee attack"} hits ${actor.name} for ${dealt()} damage. Spend a Superiority Die (${usesLeft(sup)} left) and your Reaction to reduce it by 1d${die} + ${mod}?</p>`)) {
        await spendUse(sup);
        const roll = await new Roll(`1d${die} + ${mod}`).evaluate();
        const cut = reduceDamage(ditem, roll.total);
        await useReaction(actor);
        roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Parry: ${actor.name} reduces the damage by ${cut}` });
        return;
      }
    }
    // Protective Field (Psi Warrior): you or a creature within 30 ft takes damage
    for (const g of tokenDoc.parent?.tokens ?? []) {
      const psi = g.actor && featItem(g.actor, "psionic-power");
      if (!psi || classLevel(g.actor, "fighter") < 3 || usesLeft(psi) <= 0 || !reactionFree(g.actor) || isIncapacitated(g.actor)) continue;
      if (g !== tokenDoc && (g.disposition !== tokenDoc.disposition || edgeDistance(g, tokenDoc, tokenDoc.parent) > 30)) continue;
      const die = psionicDie(g.actor), int = Number(g.actor.system.abilities.int?.mod ?? 0);
      if (!(await askOwner(g.actor, `Protective Field: ${g.name}`, `<p>${tokenDoc.name} takes ${dealt()} damage. Spend a Psionic Energy Die (${usesLeft(psi)} left) and your Reaction to reduce it by 1d${die} + ${int}?</p>`))) continue;
      await spendUse(psi);
      const roll = await new Roll(`1d${die} + ${int}`).evaluate();
      const cut = reduceDamage(ditem, Math.max(1, roll.total));
      await useReaction(g.actor);
      roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: g.actor }), flavor: `Protective Field: ${g.name} reduces the damage to ${tokenDoc.name} by ${cut}` });
      break;
    }
    // Dark One's Blessing: an enemy drops to 0 HP by you, or within 10 ft of you
    if ((ditem.oldHP ?? 0) > 0 && (ditem.newHP ?? 1) <= 0) {
      for (const w of tokenDoc.parent?.tokens ?? []) {
        if (!w.actor || !hasFeat(w.actor, "dark-ones-blessing") || w.disposition === tokenDoc.disposition) continue;
        if (attacker !== w.actor && edgeDistance(w, tokenDoc, tokenDoc.parent) > 10) continue;
        const temp = Math.max(1, Number(w.actor.system.abilities.cha?.mod ?? 0) + classLevel(w.actor, "warlock"));
        if (Number(w.actor.system.attributes.hp.temp ?? 0) >= temp) continue;
        await MidiQOL.socket().executeAsGM("updateActor", { actorUuid: w.actor.uuid, updates: { "system.attributes.hp.temp": temp } }).catch(() => {});
        say(w.actor, `<strong>Dark One's Blessing:</strong> ${w.name} gains ${temp} Temporary Hit Points.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | class damage rules failed`, err); }
});

// ------------------------------------------------------------------ Attack-roll Reactions (before hits are checked)
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical || workflow.isFumble) return;
    const target = Array.from(workflow.targets)[0];
    const tDoc = tokenOf(target);
    const ac = Number(tDoc.actor?.system?.attributes?.ac?.value ?? 10);
    const attacker = workflow.actor;
    const roll = workflow.attackRoll;
    const adjust = async (delta) => { roll._total = Number(roll.total) + delta; await workflow.setAttackRoll?.(roll); };
    // Precision Attack: the attacker's own miss
    const sup = featItem(attacker, "combat-superiority");
    if ((hasFeat(attacker, "maneuver-precision-attack") || hasFeat(attacker, "precision-attack")) && usesLeft(sup) > 0) {
      const die = superiorityDie(attacker);
      if (roll.total < ac && roll.total + die >= ac
        && await askOwner(attacker, `Precision Attack: ${attacker.name}`, `<p>The attack (${roll.total}) misses ${tDoc.name}. Spend a Superiority Die (${usesLeft(sup)} left) to add 1d${die}?</p>`)) {
        await spendUse(sup);
        const r = await new Roll(`1d${die}`).evaluate();
        r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: attacker }), flavor: "Precision Attack" });
        await adjust(r.total);
      }
    }
    // Cutting Words: a bard within 60 ft of the attacker subtracts the Bardic Inspiration die from a hit
    const atkDoc = tokenOf(workflow.token);
    for (const b of atkDoc?.parent?.tokens ?? []) {
      if (!b.actor || b.disposition === atkDoc.disposition || !hasFeat(b.actor, "cutting-words") || !reactionFree(b.actor) || isIncapacitated(b.actor)) continue;
      const insp = featItem(b.actor, "bardic-inspiration");
      if (usesLeft(insp) <= 0 || edgeDistance(b, atkDoc, atkDoc.parent) > 60) continue;
      const die = bardicDie(b.actor);
      if (!(roll.total >= ac && roll.total - die < ac)) continue;
      if (!(await askOwner(b.actor, `Cutting Words: ${b.name}`, `<p>${atkDoc.name}'s attack (${roll.total}) hits ${tDoc.name} (AC ${ac}). Spend a Bardic Inspiration (${usesLeft(insp)} left) and your Reaction to subtract 1d${die}?</p>`))) continue;
      await spendUse(insp);
      await useReaction(b.actor);
      const r = await new Roll(`1d${die}`).evaluate();
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: b.actor }), flavor: `Cutting Words against ${atkDoc.name}` });
      await adjust(-r.total);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | attack-roll reactions failed`, err); }
});

// ------------------------------------------------------------------ Portent (Long Rest)
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!(config?.type === "long" || result?.longRest) || !actor.isOwner) return;
    const portent = featItem(actor, "portent");
    if (!portent) return; // the hook runs on the client that took the rest
    const n = classLevel(actor, "wizard") >= 14 || hasFeat(actor, "greater-portent") ? 3 : 2;
    const roll = await new Roll(`${n}d20`).evaluate();
    const dice = roll.dice[0].results.map((r) => r.result);
    await portent.setFlag("world", "cgaPortent", dice);
    roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Portent: foretelling rolls ${dice.join(", ")}` }, { rollMode: "gmroll" });
  } catch (err) { console.warn(`${MODULE_ID} | Portent roll failed`, err); }
});

// ------------------------------------------------------------------ Rage upkeep
export const rageEffect = (actor) => actor?.effects?.find((e) => e.flags?.world?.cgaRage && !e.disabled);
Hooks.on("updateCombat", async (combat, changed) => {
  if (!isGM() || !("turn" in changed || "round" in changed)) return;
  const prevId = combat.previous?.combatantId;
  const prev = prevId ? combat.combatants.get(prevId) : null;
  const actor = prev?.actor;
  const rage = rageEffect(actor);
  if (!rage || classLevel(actor, "barbarian") >= 15) return;
  const prevKey = `${combat.id}:${combat.previous.round}:${combat.previous.turn}`;
  if (actor.getFlag("world", "cgaRageKept") === prevKey || rage.getFlag("world", "cgaRageStart") === prevKey) return;
  await rage.delete().catch(() => {});
  say(actor, `<strong>Rage:</strong> ${actor.name}'s Rage ends (no attack, forced save or Bonus Action to extend it this turn).`);
});
export const rageKeyNow = turnKey;

// ------------------------------------------------------------------ Martial Arts: Finesse on Monk weapons
const monkWeapon = (i) => i.type === "weapon" && (i.system.identifier === "unarmed-strike" || /unarmed strike/i.test(i.name)
  || i.system.type?.value === "simpleM" || (i.system.type?.value === "martialM" && i.system.properties?.has("lgt")));
const martialBusy = new Set();
// Finesse, and the better of STR/DEX as the attack ability (the Unarmed Strike's attack is fixed to Strength otherwise).
const maChanges = (actor) => {
  const best = Number(actor.system.abilities.dex?.mod ?? 0) > Number(actor.system.abilities.str?.mod ?? 0) ? "dex" : "str";
  return [{ key: "system.properties", value: "fin", type: "add", priority: 20, phase: "initial" },
    { key: "activities[attack].attack.ability", value: best, type: "override", priority: 20, phase: "initial" }];
};
async function ensureMartialArts(actor) {
  if (!isGM() || !actor?.items || martialBusy.has(actor.uuid)) return;
  const feature = featItem(actor, "martial-arts");
  if (!feature) return;
  martialBusy.add(actor.uuid);
  const MA_CHANGES = maChanges(actor);
  try {
    for (const w of actor.items.filter(monkWeapon)) {
      const mine = w.effects.filter((e) => e.flags?.[MODULE_ID]?.martialArts);
      if (mine.length > 1) await w.deleteEmbeddedDocuments("ActiveEffect", mine.slice(1).map((e) => e.id)).catch(() => {});
      if (mine.length && (mine[0].origin !== feature.uuid || !mine[0].transfer || JSON.stringify((mine[0].system?.changes ?? []).map((c) => c.value)) !== JSON.stringify(MA_CHANGES.map((c) => c.value))))
        await mine[0].update({ origin: feature.uuid, transfer: true, "system.changes": MA_CHANGES }).catch(() => {});
      if (mine.length || w.system.properties?.has("fin")) continue;
      // dnd5e applies an enchantment to its item only when it is a transfer effect with an origin.
      await w.createEmbeddedDocuments("ActiveEffect", [{ name: "Martial Arts (Dexterous Attacks)", type: "enchantment", img: "icons/skills/melee/unarmed-punch-fist.webp",
        transfer: true, origin: feature.uuid, system: { changes: MA_CHANGES }, flags: { [MODULE_ID]: { martialArts: true } } }]).catch((err) => console.warn(`${MODULE_ID} | Martial Arts enchantment failed`, err));
    }
  } finally { martialBusy.delete(actor.uuid); }
}
Hooks.on("createItem", (item) => { if (item.parent instanceof Actor) ensureMartialArts(item.parent); });
Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes, "system.abilities.dex") || foundry.utils.hasProperty(changes, "system.abilities.str")) ensureMartialArts(actor); });
Hooks.once("ready", () => { if (isGM()) for (const a of game.actors) if (a.type === "character") ensureMartialArts(a); });

// ------------------------------------------------------------------ Starry Form light, Primal Companion, browser
// Starry Form sheds light while active: put the token's light back when the form's effect ends.
Hooks.on("deleteActiveEffect", async (effect) => {
  if (!effect.flags?.world?.cgaStarry || !(effect.parent instanceof Actor)) return;
  if (effect.parent.effects.some((e) => e.id !== effect.id && e.flags?.world?.cgaStarry)) return; // changed constellation
  for (const t of effect.parent.getActiveTokens?.() ?? []) {
    const prev = t.document.getFlag("world", "cgaStarryLight");
    if (!prev || !t.document.isOwner) continue;
    await t.document.update({ "light.bright": prev.bright ?? 0, "light.dim": prev.dim ?? 0, "flags.world.-=cgaStarryLight": null }).catch(() => {});
  }
});
// Primal Companion: summoning a new beast makes the old one vanish.
Hooks.on("createToken", async (tokenDoc) => {
  if (!isGM()) return;
  const origin = tokenDoc.actor?.flags?.dnd5e?.summon?.origin;
  if (!origin || fromUuidSync(origin)?.system?.identifier !== "primal-companion") return;
  for (const scene of game.scenes) {
    const old = scene.tokens.filter((t) => t.id !== tokenDoc.id && t.actor?.flags?.dnd5e?.summon?.origin === origin);
    if (old.length) await scene.deleteEmbeddedDocuments("Token", old.map((t) => t.id)).catch(() => {});
  }
});
// Keep the module's summoned creatures out of dnd5e's Compendium Browser (so they aren't offered as Wild Shape forms).
// Set once; a DM who turns the pack back on in "Compendium Browser Sources" keeps that choice.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const key = `${MODULE_ID}.cga-summons`;
  const cfg = foundry.utils.deepClone(game.settings.get("dnd5e", "packSourceConfiguration") ?? {});
  if (key in cfg) return;
  cfg[key] = false;
  await game.settings.set("dnd5e", "packSourceConfiguration", cfg).catch(() => {});
});
