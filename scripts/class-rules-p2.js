// Champions Guild Automation - priority-2 class feature rules (2024 Player's Handbook) that run from module hooks.
//  - Relentless Rage: at 0 HP while raging, a CON save (DC 10, +5 each time until a rest) keeps you at 2x Barbarian level.
//  - World Tree: Life-Giving Force temp HP at the start of your raging turn; Branches of the Tree Reaction teleport.
//  - Heroic Warrior: Heroic Inspiration at the start of your turn.
//  - Attack-roll Reactions: Guided Strike (+10), Homing Strikes (psi die), Illusory Self (the attack misses),
//    Restore Balance (cancel Advantage/Disadvantage).
//  - Countercharm: reroll a failed save against Charmed/Frightened with Advantage.
//  - Damage: Multiattack Defense, Bastion of Law ward dice, Projected Ward (Arcane Ward for someone else).
//  - Eldritch Hex: Hex also gives Disadvantage on saves of the hexed ability.
//  - Improved Circle Forms: +WIS to CON saves (and the Radiant option) in Wild Shape.
//  - Cosmic Omen (Weal/Woe) rolled on every Long Rest; Improved Warding Flare recharges on a Short Rest.
//  - Psi-Bolstered Knack and Ambush: optional-bonus effects sized to your current die.
//  - Rage riders (Fanatical Focus) end with the Rage.
import { MODULE_ID, reduceDamage, hasFeat, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey } from "./main.js";
import { classLevel, featItem, superiorityDie, psionicDie, rageEffect } from "./class-rules.js";

const isGM = () => game.users.activeGM?.isSelf;
const tokenOf = (t) => t?.document ?? t;
const say = (actor, html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${html}</p>` });
const usesLeft = (item) => Number(item?.system?.uses?.value ?? 0);
const mod = (actor, a) => Number(actor?.system?.abilities?.[a]?.mod ?? 0);
const reactionFree = (actor) => !MidiQOL.hasUsedReaction?.(actor);
const useReaction = (actor) => MidiQOL.setReactionUsed?.(actor);
const alive = (actor) => (actor?.system?.attributes?.hp?.value ?? 0) > 0;
const canReact = (actor) => actor && alive(actor) && reactionFree(actor) && !isIncapacitated(actor);
async function spendUse(item, n = 1) {
  if (!item) return;
  const v = Number(item.system.uses.spent ?? 0) + n;
  try { await item.update({ "system.uses.spent": v }); }
  catch (err) { await MidiQOL.socket().executeAsGM("updateItems", { actorUuid: item.actor.uuid, updates: [{ _id: item.id, "system.uses.spent": v }] }).catch(() => {}); }
}
const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const channelDivinity = (actor) => ["channel-divinity-cleric", "channel-divinity-paladin", "channel-divinity"].map((i) => featItem(actor, i)).find((i) => usesLeft(i) > 0)
  ?? featItem(actor, "channel-divinity-cleric") ?? featItem(actor, "channel-divinity");
function effectData(name, img, changes, { special = [], seconds = null, statuses = [], origin = null, flags = {} } = {}) {
  return { name, img, transfer: false, origin, statuses, duration: seconds ? { seconds } : { value: null, units: "seconds" },
    system: { changes: changes.map(([key, value, type = "override"]) => ({ key, value, type, priority: 50, phase: "initial" })) },
    flags: { dae: { specialDuration: special, stackable: "noneName" }, ...flags } };
}
const addEffect = (actor, data) => asGM("createEffects", { actorUuid: actor.uuid, effects: [data] });

// ------------------------------------------------------------------ Damage
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  const actor = token?.actor;
  if (!actor || !ditem || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
  const tokenDoc = tokenOf(token);
  const scene = tokenDoc.parent;
  const attacker = workflow?.actor;
  const dealt = () => Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
  const wasHit = !!workflow?.activity?.attack && Array.from(workflow.hitTargets ?? []).some((t) => tokenOf(t) === tokenDoc);
  try {
    // Bastion of Law: spend ward dice (d8s) to reduce the damage
    const ward = actor.effects.find((e) => e.flags?.world?.cgaBastion && !e.disabled);
    const dice = Number(ward?.flags.world.cgaBastion ?? 0);
    if (ward && dice > 0) {
      const pick = await askChoice(actor, `Bastion of Law: ${actor.name}`, `<p>${actor.name} takes ${dealt()} damage. Spend ward dice (d8s, ${dice} left) to reduce it?</p>`,
        [...Array.from({ length: dice }, (_, i) => ({ action: String(i + 1), label: `${i + 1}d8` })), { action: "0", label: "None", default: true }]);
      const n = Number(pick ?? 0);
      if (n > 0) {
        const r = await new Roll(`${n}d8`).evaluate();
        const cut = reduceDamage(ditem, r.total);
        r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Bastion of Law: ${actor.name} reduces the damage by ${cut}` });
        if (dice - n <= 0) asGM("deleteEffectsByUuid", { effectsToDelete: [ward.uuid] });
        else asGM("updateEffects", { actorUuid: actor.uuid, updates: [{ _id: ward.id, "flags.world.cgaBastion": dice - n, name: `Bastion of Law: ${dice - n}d8` }] });
      }
    }
    // Projected Ward: an Abjurer within 30 ft spends Arcane Ward HP (and a Reaction) on someone else
    for (const w of scene?.tokens ?? []) {
      if (dealt() <= 0) break;
      if (!w.actor || w === tokenDoc || w.disposition !== tokenDoc.disposition || !hasFeat(w.actor, "projected-ward") || !canReact(w.actor)) continue;
      const wardItem = featItem(w.actor, "arcane-ward");
      const act = wardItem?.system?.activities?.contents?.[0];
      const hp = Number(act?.uses?.value ?? 0);
      if (hp <= 0 || edgeDistance(w, tokenDoc, scene) > 30) continue;
      if (!(await askOwner(w.actor, `Projected Ward: ${w.name}`, `<p>${tokenDoc.name} takes ${dealt()} damage. Use your Reaction to have your Arcane Ward (${hp} HP) take it?</p>`))) continue;
      const cut = reduceDamage(ditem, Math.min(hp, dealt()));
      await useReaction(w.actor);
      await asGM("updateItems", { actorUuid: w.actor.uuid, updates: [{ _id: wardItem.id, [`system.activities.${act.id}.uses.spent`]: Number(act.uses.spent ?? 0) + cut }] });
      say(w.actor, `<strong>Projected Ward:</strong> ${w.name}'s Arcane Ward absorbs ${cut} damage for ${tokenDoc.name} (${hp - cut} left).`);
      break;
    }
    // Multiattack Defense (Hunter): the attacker has Disadvantage on its other attacks against you this turn
    if (wasHit && attacker && attacker !== actor && featItem(actor, "defensive-tactics")?.getFlag("world", "cgaTactic") === "multiattack") {
      if (!attacker.effects.some((e) => e.flags?.world?.cgaMultiDef === actor.uuid))
        addEffect(attacker, effectData("Multiattack Defense", "icons/skills/melee/shield-block-gray-orange.webp",
          [["flags.midi-qol.disadvantage.attack.all", `targetActorUuid === "${actor.uuid}"`]], { special: ["turnEnd"], seconds: 6, flags: { world: { cgaMultiDef: actor.uuid } } }));
    }
    // Relentless Rage: drop to 0 while raging -> CON save to stay at twice your Barbarian level
    if ((ditem.oldHP ?? 0) > 0 && (ditem.newHP ?? 1) <= 0 && hasFeat(actor, "relentless-rage") && rageEffect(actor)) {
      const dc = Number(actor.getFlag("world", "cgaRelentlessDC") ?? 10);
      const roll = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false }, { data: { flavor: `Relentless Rage (DC ${dc})` } }).catch(() => null);
      const r = Array.isArray(roll) ? roll[0] : roll;
      asGM("updateActor", { actorUuid: actor.uuid, updates: { "flags.world.cgaRelentlessDC": dc + 5 } });
      if (r && r.total >= dc) {
        const keep = 2 * classLevel(actor, "barbarian");
        reduceDamage(ditem, dealt());
        setTimeout(() => asGM("updateActor", { actorUuid: actor.uuid, updates: { "system.attributes.hp.value": keep } }), 600);
        say(actor, `<strong>Relentless Rage:</strong> ${actor.name} refuses to fall and stays at ${keep} Hit Points.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 damage rules failed`, err); }
});

// ------------------------------------------------------------------ Attack-roll Reactions (before hits are checked)
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical || workflow.isFumble) return;
    const tDoc = tokenOf(Array.from(workflow.targets)[0]);
    const atkDoc = tokenOf(workflow.token);
    const ac = Number(tDoc.actor?.system?.attributes?.ac?.value ?? 10);
    const attacker = workflow.actor;
    const roll = workflow.attackRoll;
    const adjust = async (delta) => { roll._total = Number(roll.total) + delta; await workflow.setAttackRoll?.(roll); };
    const scene = atkDoc?.parent;
    // Homing Strikes (Soulknife): a Psychic Blade attack misses -> add a psi die; spent only if it then hits
    const psi = featItem(attacker, "psionic-power");
    if (roll.total < ac && hasFeat(attacker, "soul-blades") && workflow.item?.system?.identifier === "psychic-blades" && usesLeft(psi) > 0) {
      const die = psionicDie(attacker);
      if (roll.total + die >= ac && await askOwner(attacker, `Homing Strikes: ${attacker.name}`, `<p>Your Psychic Blade (${roll.total}) misses. Roll a Psionic Energy Die (d${die}, ${usesLeft(psi)} left) and add it? It's spent only if the attack then hits.</p>`)) {
        const r = await new Roll(`1d${die}`).evaluate();
        r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: attacker }), flavor: "Homing Strikes" });
        await adjust(r.total);
        if (roll.total >= ac) await spendUse(psi);
      }
    }
    // Guided Strike (War Domain): you or a creature within 30 ft misses -> Channel Divinity for +10
    if (roll.total < ac && roll.total + 10 >= ac) {
      for (const c of scene?.tokens ?? []) {
        if (!c.actor || !hasFeat(c.actor, "guided-strike") || isIncapacitated(c.actor) || !alive(c.actor)) continue;
        const self = c.actor === attacker;
        if (!self && (c.disposition !== atkDoc.disposition || edgeDistance(c, atkDoc, scene) > 30 || !reactionFree(c.actor))) continue;
        const cd = channelDivinity(c.actor);
        if (usesLeft(cd) <= 0) continue;
        if (!(await askOwner(c.actor, `Guided Strike: ${c.name}`, `<p>${self ? "Your" : `${atkDoc.name}'s`} attack (${roll.total}) misses ${tDoc.name} (AC ${ac}). Spend Channel Divinity (${usesLeft(cd)} left)${self ? "" : " and your Reaction"} to add +10?</p>`))) continue;
        await spendUse(cd);
        if (!self) await useReaction(c.actor);
        say(c.actor, `<strong>Guided Strike:</strong> +10 to ${atkDoc.name}'s attack.`);
        await adjust(10);
        break;
      }
    }
    // Illusory Self (Illusionist): an attack would hit you -> it misses
    if (roll.total >= ac && hasFeat(tDoc.actor, "illusory-self") && canReact(tDoc.actor)) {
      const it = featItem(tDoc.actor, "illusory-self");
      const slots = tDoc.actor.system.spells ?? {};
      const slotKey = usesLeft(it) > 0 ? null : [2, 3, 4, 5, 6, 7, 8, 9].map((l) => `spell${l}`).find((k) => Number(slots[k]?.value ?? 0) > 0);
      if ((usesLeft(it) > 0 || slotKey) && await askOwner(tDoc.actor, `Illusory Self: ${tDoc.name}`,
        `<p>${atkDoc.name}'s attack (${roll.total}) would hit you. Use your Reaction${usesLeft(it) > 0 ? "" : ` and a ${slotKey.slice(5)}th-level spell slot`} so your illusory duplicate takes it and the attack misses?</p>`)) {
        if (usesLeft(it) > 0) await spendUse(it);
        else asGM("updateActor", { actorUuid: tDoc.actor.uuid, updates: { [`system.spells.${slotKey}.value`]: Number(slots[slotKey].value) - 1 } });
        await useReaction(tDoc.actor);
        say(tDoc.actor, `<strong>Illusory Self:</strong> the attack strikes an illusion of ${tDoc.name} and misses.`);
        await adjust(ac - 1 - roll.total);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 attack reactions failed`, err); }
});

// Restore Balance (Clockwork Sorcery): cancel an enemy's Advantage or an ally's Disadvantage on an attack within 60 ft.
Hooks.on("midi-qol.preAttackRollConfig", async (workflow) => {
  try {
    const tr = workflow?.attackRollModifierTracker;
    const atkDoc = tokenOf(workflow?.token);
    if (!tr || !atkDoc) return;
    // midi has worked out Advantage/Disadvantage by preAttackRollConfig (not yet at preAttackRoll).
    const adv = !!workflow.advantage || !!tr.advantage?.isActive?.(), dis = !!workflow.disadvantage || !!tr.disadvantage?.isActive?.();
    if (adv === dis) return;
    for (const s of atkDoc.parent?.tokens ?? []) {
      if (!s.actor || !hasFeat(s.actor, "restore-balance") || !canReact(s.actor) || s === atkDoc) continue;
      const it = featItem(s.actor, "restore-balance");
      const ally = s.disposition === atkDoc.disposition;
      if ((ally && !dis) || (!ally && !adv) || usesLeft(it) <= 0 || edgeDistance(s, atkDoc, atkDoc.parent) > 60) continue;
      if (!(await askOwner(s.actor, `Restore Balance: ${s.name}`, `<p>${atkDoc.name} is about to attack with ${adv ? "Advantage" : "Disadvantage"}. Use your Reaction (${usesLeft(it)} uses left) to cancel it?</p>`))) continue;
      await spendUse(it); await useReaction(s.actor);
      if (adv) tr.disadvantage?.add?.("restore-balance", "Restore Balance"); else tr.advantage?.add?.("restore-balance", "Restore Balance");
      say(s.actor, `<strong>Restore Balance:</strong> ${atkDoc.name}'s attack is rolled normally.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Restore Balance failed`, err); }
});

// ------------------------------------------------------------------ Countercharm (Bard 7)
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    const statuses = (workflow?.activity?.effects ?? []).flatMap((e) => Array.from(e.effect?.statuses ?? []));
    if (!statuses.some((s) => s === "charmed" || s === "frightened") || !workflow.failedSaves?.size) return;
    const ability = workflow.activity?.save?.ability?.first?.() ?? Array.from(workflow.activity?.save?.ability ?? [])[0] ?? "wis";
    const dc = Number(workflow.activity?.save?.dc?.value ?? workflow.saveDC ?? 10);
    for (const t of Array.from(workflow.failedSaves)) {
      const tDoc = tokenOf(t);
      const bard = (tDoc.parent?.tokens ?? []).find((b) => b.actor && hasFeat(b.actor, "countercharm") && canReact(b.actor)
        && b.disposition === tDoc.disposition && (b === tDoc || edgeDistance(b, tDoc, tDoc.parent) <= 30));
      if (!bard || !(await askOwner(bard.actor, `Countercharm: ${bard.name}`, `<p>${tDoc.name} fails a save against being Charmed or Frightened. Use your Reaction so it rerolls with Advantage?</p>`))) continue;
      await useReaction(bard.actor);
      const res = await tDoc.actor.rollSavingThrow({ ability, target: dc, advantage: true, midiOptions: { advantage: true } }, { configure: false }, { data: { flavor: `Countercharm reroll (DC ${dc})` } }).catch(() => null);
      const r = Array.isArray(res) ? res[0] : res;
      if (r && r.total >= dc) {
        workflow.failedSaves.delete(t);
        workflow.saves?.add?.(t);
        say(bard.actor, `<strong>Countercharm:</strong> ${tDoc.name} succeeds on the reroll (${r.total}).`);
      } else say(bard.actor, `<strong>Countercharm:</strong> ${tDoc.name} still fails (${r?.total ?? "?"}).`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Countercharm failed`, err); }
});

// ------------------------------------------------------------------ Start of turn
Hooks.on("updateCombat", async (combat, changed) => {
  if (!isGM() || !("turn" in changed || "round" in changed) || !combat.started) return;
  const cur = combat.combatant;
  const actor = cur?.actor;
  const tDoc = cur?.token;
  if (!actor || !tDoc) return;
  try {
    // Heroic Warrior (Champion 10)
    if (hasFeat(actor, "heroic-warrior") && !actor.system.attributes.inspiration) {
      await actor.update({ "system.attributes.inspiration": true });
      say(actor, `<strong>Heroic Warrior:</strong> ${actor.name} gains Heroic Inspiration.`);
    }
    // Life-Giving Force (Vitality of the Tree): give Rage-Damage d6s of temp HP to another creature within 10 ft
    if (hasFeat(actor, "vitality-of-the-tree") && rageEffect(actor)) {
      const near = tDoc.parent.tokens.filter((o) => o.actor && o !== tDoc && alive(o.actor) && edgeDistance(tDoc, o, tDoc.parent) <= 10);
      const n = classLevel(actor, "barbarian") >= 16 ? 4 : classLevel(actor, "barbarian") >= 9 ? 3 : 2;
      if (near.length) {
        const pick = await askChoice(actor, `Life-Giving Force: ${actor.name}`, `<p>Give ${n}d6 Temporary Hit Points to a creature within 10 ft (they last until your Rage ends)?</p>`,
          [...near.map((o) => ({ action: o.id, label: o.name })), { action: "none", label: "No one", default: true }]);
        const o = near.find((x) => x.id === pick);
        if (o) {
          const r = await new Roll(`${n}d6`).evaluate();
          await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Life-Giving Force: ${o.name} gains Temporary Hit Points` });
          if (Number(o.actor.system.attributes.hp.temp ?? 0) < r.total) await o.actor.update({ "system.attributes.hp.temp": r.total });
        }
      }
    }
    // Branches of the Tree (World Tree 6): a raging barbarian pulls a creature starting its turn within 30 ft
    for (const b of tDoc.parent.tokens) {
      if (!b.actor || b === tDoc || b.disposition === tDoc.disposition || !hasFeat(b.actor, "branches-of-the-tree") || !rageEffect(b.actor) || !canReact(b.actor)) continue;
      if (edgeDistance(b, tDoc, tDoc.parent) > 30) continue;
      if (!(await askOwner(b.actor, `Branches of the Tree: ${b.name}`, `<p>${tDoc.name} starts its turn within 30 ft. Use your Reaction: STR save or it's teleported next to you and its Speed becomes 0 this turn?</p>`))) continue;
      await useReaction(b.actor);
      const act = featItem(b.actor, "branches-of-the-tree")?.system.activities.find((a) => a.midiProperties?.identifier === "branches-save");
      const w = act ? await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [tDoc.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch(() => null) : null;
      if (!w || !Array.from(w.failedSaves ?? []).some((x) => tokenOf(x) === tDoc)) continue;
      const g = tDoc.parent.grid.size;
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([dx, dy]) => ({ x: b.x + dx * g * (dx > 0 ? b.width : tDoc.width), y: b.y + dy * g * (dy > 0 ? b.height : tDoc.height) }));
      const free = spots.find((p) => !tDoc.parent.tokens.some((o) => o !== tDoc && Math.abs(o.x - p.x) < g * o.width && Math.abs(o.y - p.y) < g * o.height)) ?? spots[0];
      await tDoc.update(free, { animate: false, teleport: true }).catch(() => {});
      await tDoc.actor.createEmbeddedDocuments("ActiveEffect", [effectData("Branches of the Tree: Speed 0", "icons/magic/nature/root-vine-entangle-foot-green.webp",
        ["walk", "fly", "swim", "climb", "burrow"].map((m) => [`system.attributes.movement.${m}`, "0", "override"]), { special: ["turnEnd"], seconds: 6 })]).catch(() => {});
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 turn-start rules failed`, err); }
});

// ------------------------------------------------------------------ Rests
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner) return;
    const long = config?.type === "long" || result?.longRest;
    if (actor.getFlag("world", "cgaRelentlessDC")) await actor.unsetFlag("world", "cgaRelentlessDC");
    // Improved Warding Flare: Warding Flare recharges on a Short Rest too
    if (!long && hasFeat(actor, "improved-warding-flare")) { const wfItem = featItem(actor, "warding-flare"); if (wfItem) await wfItem.update({ "system.uses.spent": 0 }); }
    // Cosmic Omen: even = Weal, odd = Woe
    const omen = featItem(actor, "cosmic-omen");
    if (long && omen) {
      const r = await new Roll("1d20").evaluate();
      const kind = r.total % 2 === 0 ? "weal" : "woe";
      await omen.setFlag("world", "cgaOmen", kind);
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Cosmic Omen: ${kind === "weal" ? "Weal (even) - add 1d6" : "Woe (odd) - subtract 1d6"}` });
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 rest rules failed`, err); }
});

// ------------------------------------------------------------------ Eldritch Hex: Hex also hinders saves of that ability
Hooks.on("createActiveEffect", async (effect) => {
  try {
    if (!isGM() || !(effect.parent instanceof Actor)) return;
    const m = /^Hexed (\w+)/.exec(effect.name ?? "");
    if (m && !effect.flags?.world?.cgaEldritchHex) {
      let src = effect.origin ? fromUuidSync(effect.origin) : null;
      while (src && !(src instanceof Actor)) src = src.parent;
      if (!src || !hasFeat(src, "eldritch-hex")) return;
      const abl = Object.entries(CONFIG.DND5E.abilities).find(([k, v]) => (v.label ?? "").toLowerCase() === m[1].toLowerCase() || k === m[1].toLowerCase().slice(0, 3))?.[0];
      if (!abl) return;
      await effect.update({ "flags.world.cgaEldritchHex": true, "system.changes": [...effect.toObject().system.changes,
        { key: `system.abilities.${abl}.save.roll.mode`, value: -1, type: "add", priority: 20, phase: "initial" }] });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Eldritch Hex failed`, err); }
});
// Rage riders end with the Rage
Hooks.on("deleteActiveEffect", async (effect) => {
  if (!effect.flags?.world?.cgaRage || !(effect.parent instanceof Actor) || !effect.parent.isOwner) return;
  const riders = effect.parent.effects.filter((e) => e.flags?.world?.cgaRageRider);
  if (riders.length) await effect.parent.deleteEmbeddedDocuments("ActiveEffect", riders.map((e) => e.id)).catch(() => {});
});
// Invoke Duplicity: the duplicate vanishes when its effect ends
Hooks.on("deleteActiveEffect", async (effect) => {
  if (!effect.flags?.world?.cgaDuplicity || !isGM()) return;
  const owner = effect.parent?.uuid;
  for (const scene of game.scenes) {
    const dupes = scene.tokens.filter((t) => t.flags?.world?.cgaDuplicate === owner);
    if (dupes.length) await scene.deleteEmbeddedDocuments("Token", dupes.map((t) => t.id)).catch(() => {});
  }
});

// ------------------------------------------------------------------ Improved Circle Forms: in Wild Shape only
Hooks.on("dnd5e.transformActor", (original, source, data) => {
  try {
    if (!hasFeat(original, "improved-circle-forms")) return;
    const it = (data.items ?? []).find((i) => i.system?.identifier === "improved-circle-forms");
    if (!it) return;
    it.effects ??= [];
    it.effects.push({ _id: foundry.utils.randomID(), name: "Improved Circle Forms", img: "icons/magic/nature/wolf-paw-glow-large-green.webp", type: "base", transfer: true, disabled: false,
      system: { changes: [{ key: "system.abilities.con.bonuses.save", value: `+${Math.max(0, mod(original, "wis"))}`, type: "add", priority: 20, phase: "initial" },
        { key: "flags.midi-qol.onUseMacroName", value: "ItemMacro,postDamageRoll", type: "custom", priority: 20, phase: "initial" }] },
      flags: { world: { cgaMoonForm: true } } });
  } catch (err) { console.warn(`${MODULE_ID} | Improved Circle Forms failed`, err); }
});

// ------------------------------------------------------------------ Optional-bonus effects sized to the current die
const dieBusy = new Set();
async function ensureDieEffects(actor) {
  if (!isGM() || !actor?.items || dieBusy.has(actor.uuid)) return;
  dieBusy.add(actor.uuid);
  try {
    const want = [];
    if (featItem(actor, "psionic-power") && classLevel(actor, "rogue") >= 3) {
      const d = `1d${psionicDie(actor)}`;
      want.push({ key: "knack", name: `Psi-Bolstered Knack (${d})`, img: "icons/magic/perception/third-eye-blue-red.webp", changes: [
        ["flags.midi-qol.optional.cgaKnack.label", `Psi-Bolstered Knack: add ${d}`], ["flags.midi-qol.optional.cgaKnack.check.fail.all", d], ["flags.midi-qol.optional.cgaKnack.skill.fail.all", d],
        ["flags.midi-qol.optional.cgaKnack.count", "ItemUses.identifier.psionic-power"]] });
    }
    if ((hasFeat(actor, "maneuver-ambush") || hasFeat(actor, "ambush")) && featItem(actor, "combat-superiority")) {
      const d = `1d${superiorityDie(actor)}`;
      want.push({ key: "ambush", name: `Ambush (${d})`, img: "icons/magic/perception/silhouette-stealth-shadow.webp", changes: [
        ["flags.midi-qol.optional.cgaAmbush.label", `Ambush: spend a Superiority Die (+${d})`], ["flags.midi-qol.optional.cgaAmbush.skill.ste", d],
        ["flags.midi-qol.optional.cgaAmbush.count", "ItemUses.identifier.combat-superiority"]] });
    }
    for (const key of ["knack", "ambush"]) {
      const have = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.dieEffect === key);
      const w = want.find((x) => x.key === key);
      const keep = w ? have.find((e) => e.name === w.name) : null;
      const drop = have.filter((e) => e !== keep);
      if (drop.length) await actor.deleteEmbeddedDocuments("ActiveEffect", drop.map((e) => e.id)).catch(() => {});
      if (w && !keep) await actor.createEmbeddedDocuments("ActiveEffect", [{ ...effectData(w.name, w.img, w.changes, { flags: { [MODULE_ID]: { dieEffect: key } } }) }]).catch(() => {});
    }
  } finally { dieBusy.delete(actor.uuid); }
}
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => { if (item.parent instanceof Actor) ensureDieEffects(item.parent); });
Hooks.on("updateItem", (item, changes) => { if (item.parent instanceof Actor && item.type === "class" && foundry.utils.hasProperty(changes, "system.levels")) ensureDieEffects(item.parent); });
Hooks.once("ready", () => { if (isGM()) for (const a of game.actors) if (a.type === "character") ensureDieEffects(a); });
