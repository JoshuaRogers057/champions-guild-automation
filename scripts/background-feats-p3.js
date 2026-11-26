// Champions Guild Automation - Origin feats from non-PHB backgrounds, priority 3.
//  - Arcane Artist, Inspiring Magic: after you cast an Illusion spell, choose an ally within 30 ft to gain Heroic
//    Inspiration (1/LR).
//  - Familiar Friend: Fortified Familiar (your Find Familiar familiar gets +2 x character level HP) and Helpful Friend
//    (Advantage on a proficient skill check while your familiar is within 5 ft; PB/LR, counted only when the roll used it).
//  - Tireless Reveler: when an ally within 60 ft expends Heroic Inspiration, you can gain it if you lack it (PB/Short Rest).
//  - Tyro of the Gauntlet, Stand as One: when an ally within 5 ft is pushed or pulled (forced movement), your Reaction
//    puts it back. Vigilant and Sharp Eye are CGA item activities.
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, gmUpdateTokens } from "./main.js";
import { canReact, useReaction, say, tokenOf, isGM } from "./item-rules.js";
import { feat, prof, usesLeft, spend } from "./background-feats.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
async function updateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return asGM("updateActor", { actorUuid: actor.uuid, updates });
}
const level = (a) => Number(a?.system?.details?.level ?? a?.system?.details?.cr ?? 1) || 1;
const isFamiliarSpell = (item) => item?.system?.identifier === "find-familiar" || /find familiar/i.test(item?.name ?? "");

// ------------------------------------------------------------------ Arcane Artist, Inspiring Magic
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || item?.type !== "spell" || item.system.school !== "ill") return;
    const it = feat(actor, "arcane-artist");
    const me = tokenOf(workflow.token);
    if (!it || !me || usesLeft(it, 1) <= 0) return;
    const allies = me.parent.tokens.filter((o) => o !== me && o.actor && o.disposition === me.disposition && !o.actor.system.attributes?.inspiration
      && o.actor.type === "character" && edgeDistance(me, o, me.parent) <= 30);
    if (!allies.length) return;
    const pick = await askChoice(actor, `Inspiring Magic: ${actor.name}`, `<p>You cast ${item.name}. Give an ally within 30 ft Heroic Inspiration (once per Long Rest)?</p>`,
      [...allies.map((o, i) => ({ action: o.id, label: o.name, default: i === 0 })), { action: "none", label: "Not now" }]);
    const o = allies.find((x) => x.id === pick);
    if (!o) return;
    await spend(it);
    await updateActor(o.actor, { "system.attributes.inspiration": true });
    say(actor, `<strong>Inspiring Magic:</strong> ${o.name} gains Heroic Inspiration.`);
  } catch (err) { console.warn(`${MODULE_ID} | Inspiring Magic failed`, err); }
});

// ------------------------------------------------------------------ Familiar Friend
// Fortified Familiar: the summoned familiar's HP maximum and current HP go up by twice your character level.
Hooks.on("dnd5e.postSummon", async (activity, profile, tokens) => {
  try {
    const caster = activity?.actor;
    if (!caster || !isFamiliarSpell(activity.item) || !feat(caster, "familiar-friend")) return;
    const bonus = 2 * level(caster);
    for (const t of tokens ?? []) {
      const a = tokenOf(t)?.actor;
      if (!a) continue;
      const hp = a.system.attributes.hp;
      await a.update({ "system.attributes.hp.max": Number(hp.max ?? 0) + bonus, "system.attributes.hp.value": Number(hp.value ?? 0) + bonus });
      say(caster, `<strong>Fortified Familiar:</strong> ${a.name} has ${bonus} extra Hit Points (${a.system.attributes.hp.value}/${a.system.attributes.hp.max}).`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Fortified Familiar failed`, err); }
});
// Helpful Friend: Advantage on a check with a proficient skill while your familiar is within 5 ft (PB/LR). The roll is set
// to Advantage; a use is spent only if the check was rolled with it.
const familiarNear = (actor) => {
  const me = actor.getActiveTokens?.(false, true)?.[0];
  if (!me) return false;
  return me.parent.tokens.some((t) => {
    const origin = t.actor?.flags?.dnd5e?.summon?.origin ?? "";
    return origin.startsWith(`${actor.uuid}.Item.`) && isFamiliarSpell(fromUuidSync(origin)) && edgeDistance(me, t, me.parent) <= 5;
  });
};
const helpfulPending = new Map(); // actor uuid -> time
Hooks.on("dnd5e.preRollSkillV2", (config) => {
  try {
    const actor = config?.subject;
    if (!(actor instanceof Actor) || config.advantage) return;
    const it = feat(actor, "familiar-friend");
    if (!it || Number(actor.system.skills?.[config.skill]?.proficient ?? actor.system.skills?.[config.skill]?.value ?? 0) < 1) return;
    if (usesLeft(it, prof(actor)) <= 0 || !familiarNear(actor)) return;
    config.advantage = true;
    helpfulPending.set(actor.uuid, Date.now());
  } catch (err) { console.warn(`${MODULE_ID} | Helpful Friend failed`, err); }
});
Hooks.on("dnd5e.rollSkillV2", async (rolls, data) => {
  try {
    const actor = data?.subject;
    const t = actor && helpfulPending.get(actor.uuid);
    if (!t) return;
    helpfulPending.delete(actor.uuid);
    const r = Array.isArray(rolls) ? rolls[0] : rolls;
    if (Date.now() - t > 120000 || !r?.hasAdvantage) return;
    const it = feat(actor, "familiar-friend");
    await spend(it);
    say(actor, `<strong>Helpful Friend:</strong> ${actor.name}'s familiar helps - Advantage (${usesLeft(it, prof(actor))} uses left).`);
  } catch (err) { console.warn(`${MODULE_ID} | Helpful Friend failed`, err); }
});

// ------------------------------------------------------------------ Tireless Reveler: an ally spends Heroic Inspiration
Hooks.on("updateActor", async (actor, changes) => {
  try {
    if (!isGM() || foundry.utils.getProperty(changes, "system.attributes.inspiration") !== false) return;
    const spender = actor.getActiveTokens?.(false, true)?.[0];
    if (!spender) return;
    for (const h of spender.parent.tokens) {
      if (h === spender || !h.actor || h.actor === actor || h.disposition !== spender.disposition) continue;
      const it = feat(h.actor, "tireless-reveler");
      if (!it || h.actor.system.attributes?.inspiration || usesLeft(it, prof(h.actor), "sr") <= 0 || isIncapacitated(h.actor)) continue;
      if (edgeDistance(h, spender, h.parent) > 60) continue;
      if (!(await askOwner(h.actor, `Tireless Reveler: ${h.name}`, `<p>${spender.name} spent Heroic Inspiration. Gain Heroic Inspiration yourself?</p>`))) continue;
      await spend(it, "sr");
      await h.actor.update({ "system.attributes.inspiration": true });
      say(h.actor, `<strong>Tireless Reveler:</strong> ${h.name} gains Heroic Inspiration.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Tireless Reveler failed`, err); }
});

// ------------------------------------------------------------------ Tyro of the Gauntlet, Stand as One: undo a push or pull
const FORCED = ["catForce", "wm5ePush", "displace"];
Hooks.on("moveToken", async (doc, movement) => {
  try {
    if (!isGM() || !doc.actor || isIncapacitated(doc.actor)) return;
    if (!(movement?.passed?.waypoints ?? []).some((w) => FORCED.includes(w.action))) return;
    const o = movement.origin, to = movement.destination;
    if (!o || !to || (o.x === to.x && o.y === to.y)) return;
    const at = { x: o.x, y: o.y, width: doc.width, height: doc.height };
    for (const h of doc.parent.tokens) {
      if (h === doc || !h.actor || h.disposition !== doc.disposition || !feat(h.actor, "tyro-of-the-gauntlet") || !canReact(h.actor)) continue;
      if (edgeDistance(h, at, doc.parent) > 5) continue;
      if (!(await askOwner(h.actor, `Stand as One: ${h.name}`, `<p>${doc.name} is being pushed or pulled. Use your Reaction to keep it in place?</p>`))) continue;
      await useReaction(h.actor);
      await gmUpdateTokens(doc.parent, [{ _id: doc.id, x: o.x, y: o.y }], { movement: { [doc.id]: { waypoints: [{ x: o.x, y: o.y, action: "blink" }] } } });
      say(h.actor, `<strong>Stand as One:</strong> ${h.name} keeps ${doc.name} from being moved.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Stand as One failed`, err); }
});
