// Champions Guild Automation - Origin feats from non-PHB backgrounds, priority 2. Module rules keyed on the feat's
// identifier or name (no Mass Apply needed); CGA feat items add the activities.
//  - +1d4 to skill and tool checks: the Dragonmark feats' Intuition, Arcane Eloquence (Deception, Intimidation,
//    Persuasion) and Arcane Undertaker (History, Medicine).
//  - Dark Gifts: right after a D20 Test with a natural 1, the save (DC 13 + PB) is rolled for you and its condition
//    applied - Aberrant Anatomy (Stunned), Echoing Soul (Incapacitated, half Speed), Gathered Whispers (Deafened, Disadvantage
//    on checks and attacks), Living Shadow (Incapacitated, then the Shadow's Will table), Symbiotic Being (Charmed 1d12 hours),
//    Watchers (Disadvantage on D20 Tests for 1 minute, WIS save at the end of each turn).
//  - Passives: Mark of Passage and Transmuted Anatomy +5 ft Speed, Mark of Storm Lightning Resistance, Touch of Death
//    Disadvantage on Death Saving Throws.
//  - Arcane Overload's Power Surge (+PB to an Evocation spell's damage, 1/LR), Touch of Death (Chill Touch ignores Necrotic
//    Resistance), Child of the Sun (Advantage on saves against Blinded within 10 ft of you).
//  - Reactions, asked: Mark of Sentinel's Vigilant Guardian (swap places with an ally that is hit and take the hit, PB/LR),
//    Mist Walker's Mist Walk (teleport 15 ft after damage or a failed save against Grappled/Restrained, PB/LR).
//  - Lords' Alliance Agent: Inspiring Strike (a Critical Hit gives an ally Heroic Inspiration) and Reassert Honor (Advantage
//    on your next attack against an enemy that hurt an ally within 5 ft of you).
//  - Purple Dragon Rook's Rallying Cry and Zhentarim Ruffian's Family First on Initiative; Exploit Opening (roll Opportunity
//    Attack damage twice and keep either).
//  - Portal Jumper's Portal Step and Mist Walk switch your token to teleport (blink) for its next move.
//  - Vampire's Plaything's Decanting: a Potion of Healing or Antitoxin on a Long Rest (it evaporates on the next one).
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey, gmUpdateTokens } from "./main.js";
import { canReact, useReaction, say, tokenOf, isGM, chg, PASSIVES } from "./item-rules.js";
import { feat, prof, usesLeft, spend, saveStatuses } from "./background-feats.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
async function addEffect(actor, effect) {
  try { if (actor.isOwner) return await actor.createEmbeddedDocuments("ActiveEffect", [effect]); } catch (err) {}
  return asGM("createEffects", { actorUuid: actor.uuid, effects: [effect] });
}
async function updateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return asGM("updateActor", { actorUuid: actor.uuid, updates });
}
const giveInspiration = (actor) => updateActor(actor, { "system.attributes.inspiration": true });
const MOVES = ["walk", "fly", "swim", "climb", "burrow"];
const actorTokens = (actor) => actor?.getActiveTokens?.(false, true) ?? [];
const sceneTokenOf = (actor) => actorTokens(actor)[0] ?? null;

// ------------------------------------------------------------------ "Until the end of your next turn" (removed by the module)
// The effect carries the combat round whose end-of-turn removes it; outside combat it lasts 12 seconds.
function endOfNextTurn(actor) {
  const c = game.combat;
  const mine = c?.started ? c.combatants.find((x) => x.actor === actor || x.actorId === actor.id) : null;
  if (!mine) return { duration: { seconds: 12 }, flags: {} };
  const idx = c.turns.findIndex((t) => t.id === mine.id);
  const round = c.combatant?.id === mine.id || idx < c.turn ? c.round + 1 : c.round;
  return { duration: { rounds: 2 }, flags: { [MODULE_ID]: { endTurnRound: round } } };
}
Hooks.on("updateCombat", async (combat, changed) => {
  try {
    if (!isGM() || !("turn" in changed || "round" in changed)) return;
    const prev = combat.previous;
    const ended = prev?.combatantId ? combat.combatants.get(prev.combatantId)?.actor : null;
    if (ended) {
      const old = ended.effects.filter((e) => Number(e.flags?.[MODULE_ID]?.endTurnRound ?? Infinity) <= Number(prev.round ?? 0));
      if (old.length) await ended.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id)).catch(() => {});
    }
    // Living Shadow, Ominous Will: at the start of your turn, roll on the Shadow's Will table
    const now = combat.combatant?.actor;
    if (now?.getFlag("world", "cgaShadowWill")) {
      await now.unsetFlag("world", "cgaShadowWill").catch(() => {});
      const r = await new Roll("1d8").evaluate();
      const dir = ["north", "east", "south", "west"][Math.ceil(Math.random() * 4) - 1];
      const text = r.total === 1 ? `No action or Bonus Action; ${now.name} uses all its movement to move ${dir}.`
        : r.total <= 6 ? `No movement or Bonus Action; ${now.name} takes the Attack action to make one melee attack against a random creature within reach (no action if none).`
          : `${now.name} has the Prone condition and its turn ends.`;
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: now }), flavor: `<strong>Shadow's Will</strong> (Living Shadow): ${text}` });
      if (r.total >= 7) await now.toggleStatusEffect("prone", { active: true }).catch(() => {});
    }
  } catch (err) { console.warn(`${MODULE_ID} | origin feat turn rules failed`, err); }
});

// ------------------------------------------------------------------ +1d4 to skill and tool checks
const ARTISAN = ["alchemist", "brewer", "calligrapher", "carpenter", "cartographer", "cobbler", "cook", "glassblower", "jeweler", "leatherworker", "mason", "painter", "potter", "smith", "tinker", "weaver", "woodcarver"];
const CHECK_BONUSES = [
  { ident: "arcane-eloquence", label: "Smooth Talker", skills: ["dec", "itm", "per"] },
  { ident: "arcane-undertaker", label: "Knowledge from the Dead", skills: ["his", "med"] },
  { ident: "mark-of-detection", label: "Deductive Intuition", skills: ["inv", "ins"] },
  { ident: "mark-of-finding", label: "Hunter's Intuition", skills: ["prc", "sur"] },
  { ident: "mark-of-handling", label: "Wild Intuition", skills: ["nat", "ani"] },
  { ident: "mark-of-healing", label: "Medical Intuition", skills: ["med"], tools: ["herb"] },
  { ident: "mark-of-hospitality", label: "Ever Hospitable", skills: ["per"], tools: ["brewer", "cook"] },
  { ident: "mark-of-making", label: "Artisan's Intuition", skills: ["arc"], tools: ARTISAN },
  { ident: "mark-of-passage", label: "Intuitive Motion", skills: ["ath", "acr"] },
  { ident: "mark-of-scribing", label: "Gifted Scribe", skills: ["his"], tools: ["calligrapher"] },
  { ident: "mark-of-sentinel", label: "Sentinel's Intuition", skills: ["ins", "prc"] },
  { ident: "mark-of-shadow", label: "Cunning Intuition", skills: ["ste", "prf"] },
  { ident: "mark-of-storm", label: "Windwright's Intuition", skills: ["acr"], tools: ["navg"] },
  { ident: "mark-of-warding", label: "Warder's Intuition", skills: ["inv"], tools: ["thief"] }
];
function addCheckDie(config, kind) {
  try {
    const actor = config?.subject;
    const key = kind === "skill" ? config.skill : config.tool;
    if (!(actor instanceof Actor) || !key || !config.rolls?.length) return;
    const rule = CHECK_BONUSES.find((r) => (r[kind === "skill" ? "skills" : "tools"] ?? []).includes(key) && feat(actor, r.ident));
    if (!rule) return;
    const r0 = config.rolls[0];
    r0.parts = [...(r0.parts ?? []), "1d4"];
  } catch (err) { console.warn(`${MODULE_ID} | origin feat check bonus failed`, err); }
}
Hooks.on("dnd5e.preRollSkillV2", (config) => addCheckDie(config, "skill"));
Hooks.on("dnd5e.preRollToolV2", (config) => addCheckDie(config, "tool"));

// ------------------------------------------------------------------ Dark Gifts: a natural 1 on a D20 Test
const DARK_GIFTS = [
  { ident: "aberrant-anatomy", label: "Warping Flesh", ability: "con", fx: (a) => ({ name: "Stunned (Warping Flesh)", statuses: ["stunned"], ...endOfNextTurn(a) }) },
  { ident: "echoing-soul", label: "Intrusive Echoes", ability: "con", fx: (a) => ({ name: "Incapacitated (Intrusive Echoes)", statuses: ["incapacitated"], ...endOfNextTurn(a),
      changes: MOVES.map((m) => chg(`system.attributes.movement.${m}`, "0.5", "multiply")) }) },
  { ident: "gathered-whispers", label: "Voices from Beyond", ability: "wis", fx: (a) => ({ name: "Deafened (Voices from Beyond)", statuses: ["deafened"], ...endOfNextTurn(a),
      changes: [chg("flags.midi-qol.disadvantage.check.all", "1"), chg("flags.midi-qol.disadvantage.attack.all", "1")] }) },
  { ident: "living-shadow", label: "Ominous Will", ability: "wis", shadow: true, fx: () => ({ name: "Incapacitated (Ominous Will)", statuses: ["incapacitated"],
      duration: { rounds: 1 }, special: ["turnStart"] }) },
  { ident: "symbiotic-being", label: "Symbiotic Agenda", ability: "cha", fx: async () => { const r = await new Roll("1d12").evaluate();
      return { name: `Charmed by the symbiote (${r.total} hours)`, statuses: ["charmed"], duration: { seconds: r.total * 3600 } }; } },
  { ident: "watchers", label: "Incessant Watchers", ability: "wis", fx: (a, dc) => ({ name: "Paranoia (Incessant Watchers)", duration: { seconds: 60 },
      changes: [chg("flags.midi-qol.disadvantage.all", "1"), chg("flags.midi-qol.OverTime", `turn=end,saveAbility=wis,saveDC=${dc},label=Incessant Watchers`)] }) }
];
const giftRolling = new Set();
async function darkGift(rolls, data) {
  try {
    const s = data?.subject;
    const actor = s instanceof Actor ? s : s?.actor;
    if (!actor?.isOwner || giftRolling.has(actor.uuid)) return;
    const d = (Array.isArray(rolls) ? rolls[0] : rolls)?.dice?.[0];
    if (d?.faces !== 20 || d.total !== 1) return;
    for (const g of DARK_GIFTS) {
      if (!feat(actor, g.ident)) continue;
      const dc = 13 + prof(actor);
      giftRolling.add(actor.uuid);
      let res;
      try { res = await actor.rollSavingThrow({ ability: g.ability, target: dc }, { configure: false }, { data: { flavor: `${g.label}: ${CONFIG.DND5E.abilities[g.ability]?.label} save (DC ${dc}) after a natural 1` } }); }
      finally { setTimeout(() => giftRolling.delete(actor.uuid), 500); }
      const roll = Array.isArray(res) ? res[0] : res;
      if (!roll || roll.total >= dc) { say(actor, `<strong>${g.label}:</strong> ${actor.name} resists (${roll?.total ?? "?"} vs DC ${dc}).`); continue; }
      const fx = await g.fx(actor, dc);
      await addEffect(actor, { name: fx.name, img: feat(actor, g.ident).img, transfer: false, statuses: fx.statuses ?? [], duration: fx.duration ?? {},
        system: { changes: fx.changes ?? [] }, flags: { dae: { specialDuration: fx.special ?? [], stackable: "noneName" }, ...(fx.flags ?? {}) } });
      if (g.shadow && game.combat?.started) await actor.setFlag("world", "cgaShadowWill", true).catch(() => {});
      say(actor, `<strong>${g.label}:</strong> ${actor.name} fails the DC ${dc} save - ${fx.name}.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Dark Gift failed`, err); }
}
for (const h of ["rollAttackV2", "rollAbilityCheckV2", "rollSavingThrowV2", "rollSkillV2", "rollToolCheckV2", "rollDeathSaveV2"]) Hooks.on(`dnd5e.${h}`, darkGift);

// ------------------------------------------------------------------ Passives
const ownChange = (item, re) => item?.effects?.some((e) => !e.disabled && (e.system?.changes ?? e.changes ?? []).some((c) => re.test(c.key + " " + c.value)));
PASSIVES.push(
  { key: "origin-speed", active: (a) => ["mark-of-passage", "transmuted-anatomy"].some((i) => { const f = feat(a, i); return f && !ownChange(f, /movement\.walk/); }),
    effect: { name: "Speed +5 ft (Origin feat)", img: "icons/skills/movement/feet-winged-boots-brown.webp", changes: [chg("system.attributes.movement.walk", "5", "add")] } },
  { key: "storms-boon", active: (a) => { const f = feat(a, "mark-of-storm"); return !!f && !ownChange(f, /traits\.dr.*lightning/); },
    effect: { name: "Storm's Boon", img: "icons/magic/lightning/bolt-strike-blue.webp", changes: [chg("system.traits.dr.value", "lightning", "add")] } },
  { key: "pull-of-the-grave", active: (a) => !!feat(a, "touch-of-death"),
    effect: { name: "Pull of the Grave", img: "icons/magic/death/skull-horned-goat-pentagram-red.webp", changes: [chg("system.attributes.death.roll.mode", "-1", "add")] } }
);

// ------------------------------------------------------------------ Damage rolls: Power Surge, Touch of Death, Exploit Opening
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !workflow.damageRolls?.length) return;
    // Arcane Overload, Power Surge: +PB to one damage roll of an Evocation spell (1/LR)
    const ao = feat(actor, "arcane-overload");
    if (ao && item?.type === "spell" && item.system.school === "evo" && usesLeft(ao, 1) > 0
      && await askOwner(actor, `Power Surge: ${actor.name}`, `<p>Add your Proficiency Bonus (${prof(actor)}) to ${item.name}'s damage (once per Long Rest)?</p>`)) {
      await spend(ao);
      const type = workflow.damageRolls[0].options?.type ?? "force";
      const roll = await new CONFIG.Dice.DamageRoll(String(prof(actor)), {}, { type, types: [type], flavor: `Power Surge (${type})` }).evaluate();
      await workflow.setBonusDamageRolls([...(workflow.bonusDamageRolls ?? []), roll]);
    }
    // Touch of Death: Chill Touch's Necrotic damage ignores Resistance (removed when the workflow ends)
    if (feat(actor, "touch-of-death") && /chill touch/i.test(item?.name ?? "") && !actor.effects.some((e) => e.flags?.[MODULE_ID]?.deathTouch)) {
      await addEffect(actor, { name: "Death Touch", img: item.img, transfer: false, system: { changes: [chg("system.traits.idr.value", "necrotic", "add")] }, flags: { [MODULE_ID]: { deathTouch: true } } });
    }
    // Zhentarim Ruffian, Exploit Opening: roll an Opportunity Attack's damage twice and use either
    if (feat(actor, "zhentarim-ruffian") && workflow.activity?.attack && (workflow.AoO || (game.combat?.started && game.combat.combatant && game.combat.combatant.actor !== actor))) {
      // an attack outside your turn: Opportunity Attacks (and the odd readied attack - the prompt lets you keep the first roll)
      const again = [];
      for (const r of workflow.damageRolls) again.push(await new CONFIG.Dice.DamageRoll(r.formula, r.data ?? {}, foundry.utils.deepClone(r.options)).evaluate());
      const t1 = workflow.damageRolls.reduce((s, r) => s + r.total, 0), t2 = again.reduce((s, r) => s + r.total, 0);
      const pick = await askChoice(actor, `Exploit Opening: ${actor.name}`, `<p>Opportunity Attack damage rolled twice: <strong>${t1}</strong> or <strong>${t2}</strong>. Which do you use?</p>`,
        [{ action: "first", label: `${t1}`, default: t1 >= t2 }, { action: "second", label: `${t2}`, default: t2 > t1 }]);
      if (pick === "second") { await workflow.setDamageRolls(again); say(actor, `<strong>Exploit Opening:</strong> ${actor.name} uses the second damage roll (${t2}).`); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | origin feat damage roll rules failed`, err); }
});

// ------------------------------------------------------------------ Child of the Sun, Eyes of Eirdu: Advantage on saves against Blinded
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    if (!saveStatuses(workflow).has("blinded")) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      if (!t?.actor) continue;
      const near = t.parent.tokens.some((h) => h.actor && feat(h.actor, "child-of-the-sun") && (h === t || (h.disposition === t.disposition && edgeDistance(h, t, t.parent) <= 10)));
      if (!near) continue;
      await addEffect(t.actor, { name: "Eyes of Eirdu (Advantage)", img: "icons/magic/light/explosion-star-glow-yellow.webp", transfer: false,
        system: { changes: [chg("flags.midi-qol.advantage.save.all", "1")] }, flags: { dae: { specialDuration: ["isSave"] } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Eyes of Eirdu failed`, err); }
});

// ------------------------------------------------------------------ Mark of Sentinel, Vigilant Guardian: swap places and take the hit
const guardAsked = new WeakSet(); // midi can call hitsChecked more than once per attack
Hooks.on("midi-qol.hitsChecked", async (workflow) => {
  try {
    if (!workflow?.activity?.attack || workflow.hitTargets?.size !== 1 || guardAsked.has(workflow)) return;
    guardAsked.add(workflow);
    const tObj = Array.from(workflow.hitTargets)[0];
    const t = tokenOf(tObj);
    const atk = tokenOf(workflow.token);
    if (!t?.actor || !atk) return;
    for (const g of t.parent.tokens) {
      if (g === t || g === atk || !g.actor || g.disposition !== t.disposition) continue;
      const it = feat(g.actor, "mark-of-sentinel");
      if (!it || usesLeft(it, prof(g.actor)) <= 0 || !canReact(g.actor) || edgeDistance(g, t, t.parent) > 5) continue;
      if (!(await askOwner(g.actor, `Vigilant Guardian: ${g.name}`, `<p>${atk.name} hits ${t.name}. Use your Reaction to swap places with ${t.name} and take the hit instead?</p>`))) continue;
      await spend(it); await useReaction(g.actor);
      await gmUpdateTokens(t.parent, [{ _id: g.id, x: t.x, y: t.y }, { _id: t.id, x: g.x, y: g.y }], { animate: false, teleport: true });
      workflow.hitTargets.delete(tObj);
      workflow.hitTargets.add(g.object ?? g);
      try { workflow.targets.delete?.(tObj); workflow.targets.add?.(g.object ?? g); } catch (err) {}
      say(g.actor, `<strong>Vigilant Guardian:</strong> ${g.name} swaps places with ${t.name} and is hit instead.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Vigilant Guardian failed`, err); }
});

// ------------------------------------------------------------------ Teleport for the next move (Portal Step, Mist Walk)
export async function blinkNextMove(actor, label, feet) {
  const tok = sceneTokenOf(actor);
  if (!tok) return;
  const prev = tok.movementAction ?? "walk";
  await gmUpdateTokens(tok.parent, [{ _id: tok.id, movementAction: "blink", "flags.world.cgaBlinkPrev": prev === "blink" ? "walk" : prev }]);
  say(actor, `<strong>${label}:</strong> move ${tok.name} up to ${feet} ft to an unoccupied space you can see - the next move is a teleport.`);
}
Hooks.on("updateToken", (doc, changes, options, userId) => {
  if (userId !== game.user.id || !("x" in changes || "y" in changes) || !doc.getFlag("world", "cgaBlinkPrev")) return;
  gmUpdateTokens(doc.parent, [{ _id: doc.id, movementAction: doc.getFlag("world", "cgaBlinkPrev"), "flags.world.-=cgaBlinkPrev": null }]);
});

// ------------------------------------------------------------------ After a workflow: Mist Walk, Inspiring Strike, Reassert Honor, Portal Step, Death Touch cleanup
const strikeUsed = new Map();
const damagedBy = (workflow) => (workflow.damageList ?? []).filter((d) => Number(d.hpDamage ?? 0) + Number(d.tempDamage ?? 0) > 0 || Number(d.totalDamage ?? 0) > 0)
  .map((d) => fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "")).map((x) => (x instanceof Actor ? x.getActiveTokens?.(false, true)?.[0]?.document : tokenOf(x))).filter((t) => t?.actor);
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor) return;
    const fx = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.deathTouch);
    if (fx.length) await actor.deleteEmbeddedDocuments("ActiveEffect", fx.map((e) => e.id)).catch(() => asGM("removeEffects", { actorUuid: actor.uuid, effects: fx.map((e) => e.id) }));
    const atk = tokenOf(workflow.token);
    const damaged = damagedBy(workflow);
    // Portal Jumper, Portal Step (the CGA activity)
    if (/portal step/i.test(workflow.activity?.name ?? "")) await blinkNextMove(actor, "Portal Step", 15);
    // Mist Walker: after taking damage, or failing a save against Grappled/Restrained
    const st = saveStatuses(workflow);
    const failedHold = (st.has("grappled") || st.has("restrained")) ? Array.from(workflow.failedSaves ?? []).map(tokenOf) : [];
    for (const t of [...new Set([...damaged, ...failedHold])]) {
      const it = t?.actor && t.actor !== actor && feat(t.actor, "mist-walker");
      if (!it || usesLeft(it, prof(t.actor)) <= 0 || !canReact(t.actor)) continue;
      const why = failedHold.includes(t) ? `failed the save against ${workflow.item?.name}` : "took damage";
      if (!(await askOwner(t.actor, `Mist Walk: ${t.name}`, `<p>${t.name} ${why}. Use your Reaction to teleport up to 15 ft to an unoccupied space you can see?</p>`))) continue;
      await spend(it); await useReaction(t.actor);
      if (failedHold.includes(t)) {
        const holds = t.actor.effects.filter((e) => ["grappled", "restrained"].some((s) => e.statuses?.has(s)) && (e.origin ?? "").startsWith(workflow.item?.uuid ?? "-"));
        if (holds.length) await asGM("removeEffects", { actorUuid: t.actor.uuid, effects: holds.map((e) => e.id) });
      }
      await blinkNextMove(t.actor, "Mist Walk", 15);
    }
    // Lords' Alliance Agent, Inspiring Strike: a Critical Hit gives an ally within 30 ft Heroic Inspiration (once per turn)
    if (workflow.isCritical && workflow.hitTargets?.size && atk && feat(actor, "lords-alliance-agent") && strikeUsed.get(actor.uuid) !== turnKey()) {
      const allies = atk.parent.tokens.filter((o) => o !== atk && o.actor && o.disposition === atk.disposition && !o.actor.system.attributes?.inspiration
        && o.actor.type === "character" && edgeDistance(atk, o, atk.parent) <= 30);
      if (allies.length) {
        const pick = await askChoice(actor, `Inspiring Strike: ${actor.name}`, `<p>Critical Hit! Which ally gains Heroic Inspiration?</p>`,
          [...allies.map((o, i) => ({ action: o.id, label: o.name, default: i === 0 })), { action: "none", label: "No one" }]);
        const o = allies.find((x) => x.id === pick);
        if (o) { strikeUsed.set(actor.uuid, turnKey()); await giveInspiration(o.actor); say(actor, `<strong>Inspiring Strike:</strong> ${o.name} gains Heroic Inspiration.`); }
      }
    }
    // Lords' Alliance Agent, Reassert Honor: an enemy damages an ally within 5 ft of you
    if (atk) for (const t of damaged) {
      for (const h of t.parent.tokens) {
        if (h === t || !h.actor || h.disposition !== t.disposition || h.disposition === atk.disposition || !feat(h.actor, "lords-alliance-agent")) continue;
        if (edgeDistance(h, t, t.parent) > 5) continue;
        const until = endOfNextTurn(h.actor).flags?.[MODULE_ID]?.endTurnRound ?? null;
        await updateActor(h.actor, { [`flags.world.cgaReassert.${actor.id}`]: { uuid: actor.uuid, round: until, time: Date.now() } });
        say(h.actor, `<strong>Reassert Honor:</strong> ${h.name} has Advantage on the next attack against ${atk.name} before the end of its next turn.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | origin feat after-workflow rules failed`, err); }
});
Hooks.on("midi-qol.preAttackRollConfig", async (workflow) => {
  try {
    const actor = workflow?.actor;
    const marks = actor?.getFlag("world", "cgaReassert");
    if (!marks || workflow.targets?.size !== 1) return;
    const target = tokenOf(Array.from(workflow.targets)[0])?.actor;
    const key = Object.keys(marks).find((k) => marks[k]?.uuid === target?.uuid || k === target?.id);
    if (!key) return;
    const m = marks[key];
    const c = game.combat;
    const valid = m.round == null ? Date.now() - m.time < 12000 : !!c?.started && (c.round < m.round || (c.round === m.round && c.combatant?.actor === actor));
    if (valid) workflow.attackRollModifierTracker?.advantage?.add?.("reassert-honor", "Reassert Honor");
    actor.update({ [`flags.world.cgaReassert.-=${key}`]: null }).catch(() => {});
  } catch (err) { console.warn(`${MODULE_ID} | Reassert Honor failed`, err); }
});

// ------------------------------------------------------------------ Initiative: Rallying Cry, Family First
// Offered (once per combat) when your combatant's Initiative is set - sheet, token or combat tracker roll alike.
Hooks.on("updateCombatant", async (cbt, changes) => {
  try {
    if (!isGM() || changes.initiative == null) return;
    const actor = cbt.actor;
    const it = actor && feat(actor, "purple-dragon-rook");
    if (!it || isIncapacitated(actor) || usesLeft(it, 1) <= 0 || cbt.parent.getFlag("world", `cgaRallied.${actor.id}`)) return;
    await cbt.parent.setFlag("world", `cgaRallied.${actor.id}`, true);
    const me = cbt.token ?? sceneTokenOf(actor);
    if (!me) return;
    const near = me.parent.tokens.filter((o) => o.actor && o.disposition === me.disposition && edgeDistance(me, o, me.parent) <= 30);
    const n = prof(actor);
    const html = `<p>Rallying Cry: choose up to ${n} creatures within 30 ft to gain Heroic Inspiration (once per Long Rest).</p>`
      + near.map((o) => `<div><label><input type="checkbox" name="${o.id}"> ${o.name}${o.actor.system.attributes?.inspiration ? " (already inspired)" : ""}</label></div>`).join("");
    const res = await askChoice(actor, `Rallying Cry: ${actor.name}`, html, [{ action: "ok", label: "Rally", form: true, default: true }, { action: "none", label: "Not now" }], 45);
    if (!res || typeof res !== "object") return;
    const chosen = near.filter((o) => res[o.id]).slice(0, n);
    if (!chosen.length) return;
    await spend(it);
    for (const o of chosen) await giveInspiration(o.actor);
    say(actor, `<strong>Rallying Cry:</strong> ${chosen.map((o) => o.name).join(", ")} gain Heroic Inspiration.`);
  } catch (err) { console.warn(`${MODULE_ID} | Rallying Cry failed`, err); }
});
// Zhentarim Ruffian, Family First: asked when your token joins a combat while you have Heroic Inspiration; on a yes,
// you and your allies roll Initiative with Advantage in that combat.
Hooks.on("createCombatant", async (cbt) => {
  try {
    if (!isGM()) return;
    const actor = cbt.actor;
    const combat = cbt.parent;
    if (!actor || !feat(actor, "zhentarim-ruffian") || !actor.system.attributes?.inspiration || combat.getFlag("world", `cgaFamilyFirst.${actor.id}`) !== undefined) return;
    await combat.setFlag("world", `cgaFamilyFirst.${actor.id}`, false);
    if (!(await askOwner(actor, `Family First: ${actor.name}`, `<p>Expend your Heroic Inspiration so you and your allies have Advantage on Initiative?</p>`))) return;
    await actor.update({ "system.attributes.inspiration": false });
    await combat.setFlag("world", `cgaFamilyFirst.${actor.id}`, cbt.token?.disposition ?? 1);
    say(actor, `<strong>Family First:</strong> ${actor.name} and allies roll Initiative with Advantage.`);
  } catch (err) { console.warn(`${MODULE_ID} | Family First failed`, err); }
});
// Fires for every Initiative roll (the combat tracker's too, which skips dnd5e.preRollInitiative).
Hooks.on("dnd5e.preConfigureInitiative", (actor, rollConfig) => {
  try {
    const ff = game.combat?.getFlag("world", "cgaFamilyFirst");
    if (!ff || !rollConfig?.options) return;
    const disp = sceneTokenOf(actor)?.disposition ?? game.combat.combatants.find((c) => c.actor === actor)?.token?.disposition;
    if (Object.values(ff).some((v) => v !== false && v === disp)) rollConfig.options.advantage = true;
  } catch (err) { console.warn(`${MODULE_ID} | Family First roll failed`, err); }
});

// ------------------------------------------------------------------ Vampire's Plaything, Decanting: a Potion of Healing or Antitoxin on a Long Rest
const DECANT = { potion: "Compendium.dnd5e.equipment24.Item.phbagPotionofHea", antitoxin: "Compendium.dnd5e.equipment24.Item.phbagAntitoxin00" };
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner || !(config?.type === "long" || result?.longRest) || !feat(actor, "vampires-plaything")) return;
    const old = actor.items.filter((i) => i.getFlag("world", "cgaDecanted"));
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((i) => i.id));
    const pick = await askChoice(actor, `Decanting: ${actor.name}`, `<p>${old.length ? "Your last decanted liquid evaporated. " : ""}Create a Potion of Healing or an Antitoxin (needs an empty vial or flask)?</p>`,
      [{ action: "potion", label: "Potion of Healing", default: true }, { action: "antitoxin", label: "Antitoxin" }, { action: "none", label: "Neither" }], 60);
    if (!DECANT[pick]) return;
    const src = await fromUuid(DECANT[pick]);
    if (!src) return;
    const data = src.toObject();
    delete data._id;
    data.system.quantity = 1;
    data.name = `${data.name} (Decanted)`;
    foundry.utils.setProperty(data, "flags.world.cgaDecanted", true);
    await actor.createEmbeddedDocuments("Item", [data]);
    say(actor, `<strong>Decanting:</strong> ${actor.name} creates ${data.name}. It evaporates at the end of the next Long Rest.`);
  } catch (err) { console.warn(`${MODULE_ID} | Decanting failed`, err); }
});
