// Champions Guild Automation - magic items from Arcana Unleashed and Eberron: Forge of the Artificer. Module rules match
// the character's own item (D&D Beyond or CGA) by identifier or name, so they work without Mass Apply; the CGA items in
// cga-items add the activities (casts, saves, charges).
//  Riders and reactions: Dazzling Weapon, Repulsion Shield, Mind Sharpener / Scholar's Anchoring Bangle / Ring of
//  Dedicated Focus (Concentration), Blood Amulet, Dispelling / Goading Ammunition, Grave Reaper, Lucky Foot, Mage Breaker,
//  Martialist's Quarterstaff (Trip), Diamond Staff (Stunning Hit), Keyholes Dagger (reroll), Namer's Needle (Named
//  Target), Prismatic Rune, Spell Duelist's Trophy (Dispelling Touch), Staff of Skulls (Chattering), Boon Companions'
//  Bands, Dream Weaver, Dissuader (aura, Repel), Workshop Wrecker, Tramontane Armor (helper feature, tendrils pull).
//  Passives: Helm of Awareness, Idol of Good Fortunes, Wave-Swept Weapon, Diamond Staff, Staff of Skulls, Dream Weaver.
//  Activities: Boots of the Winding Path, Orb of Sorcery, Spell-Refueling Ring.
import { MODULE_ID, askOwner, askChoice, edgeDistance, gmRollSave } from "./main.js";
import { magicItem, isMagicItem, attuned, spendUse, canReact, useReaction, say, tokenOf, isGM, chg, ON_HIT, PASSIVES, hasPart, refreshPassives } from "./item-rules.js";
import { usesLeft, spend } from "./background-feats.js";
import { blinkNextMove } from "./background-feats-p2.js";
import { addEffect, updateActor, hpOf, hitDieClasses, spendHitDie } from "./feat-rules-books.js";
import { runAct, hits, targetsOf, sceneTokens, tokensOf, hostile, alive, isAttack, meleeAttack, statusEffect, spItem, rollTypes, removeEffects, cap } from "./class-rules-books.js";

const later = (fn, ms = 900) => setTimeout(() => Promise.resolve(fn()).catch((err) => console.warn(`${MODULE_ID} | item follow-up failed`, err)), ms);
const rare = (i) => ["rare", "veryRare", "legendary"].includes(i?.system?.rarity) || /tarnished|golden|chattering|pulverizing|aquatic|ascendant|flowering|somniferous/i.test(i?.name ?? "");
const veryRare = (i) => ["veryRare", "legendary"].includes(i?.system?.rarity) || /golden|pulverizing|ascendant|somniferous|\bmany\b/i.test(i?.name ?? "");
const charges = (item, max) => usesLeft(item, max);
const daily = (item) => usesLeft(item, 1);
const turnEndFx = (name, img, statuses, extra = {}) => ({ name, img, statuses, transfer: false, flags: { dae: { stackable: "noneName", specialDuration: ["turnEnd"] } }, ...extra });
async function failSave(actor, ability, dc) { return (await gmRollSave(actor, ability, dc)) === false; }
const slots = (a, maxLevel = 9) => Object.entries(a.system.spells ?? {}).filter(([k, s]) => /^spell\d$/.test(k)).map(([k, s]) => ({ key: k, level: Number(k.slice(5)), value: Number(s.value), max: Number(s.max) })).filter((s) => s.level <= maxLevel);

// ------------------------------------------------------------------ Passives and on-hit damage
PASSIVES.push(
  { key: "helm-of-awareness", active: (a) => !!magicItem(a, "helm-of-awareness"),
    effect: { name: "Helm of Awareness (Initiative Advantage)", img: "icons/equipment/head/helm-barbute-steel.webp", changes: [chg("system.attributes.init.roll.mode", "1", "add")] } },
  { key: "idol-of-good-fortunes", active: (a) => { const i = magicItem(a, "idol-of-good-fortunes", { worn: false }); return !!i && rare(i) && !!i.system.attuned; },
    effect: { name: "Idol of Good Fortunes (+1 AC)", img: "icons/commodities/treasure/figurine-idol.webp", changes: [chg("system.attributes.ac.bonus", "+1", "add")] } },
  { key: "wave-swept", active: (a) => { const i = magicItem(a, "wave-swept-weapon"); return !!i && rare(i); },
    effect: (a) => { const i = magicItem(a, "wave-swept-weapon"); return { name: `Wave-Swept Weapon (${veryRare(i) ? "Swim and Fly 30 ft" : "Swim 30 ft"})`, img: "icons/magic/water/wave-water-blue.webp",
      changes: [chg("system.attributes.movement.swim", "30", "upgrade"), ...(veryRare(i) ? [chg("system.attributes.movement.fly", "30", "upgrade")] : [])] }; } },
  { key: "diamond-staff", active: (a) => !!magicItem(a, "diamond-staff"),
    effect: { name: "Diamond Staff (Arcana Advantage)", img: "icons/weapons/staves/staff-ornate-jeweled-blue.webp", changes: [chg("flags.midi-qol.advantage.skill.arc", "1")] } },
  { key: "staff-of-skulls", active: (a) => !!magicItem(a, "staff-of-skulls"),
    effect: { name: "Staff of Skulls (Intimidation Advantage)", img: "icons/weapons/staves/staff-skull-brown.webp", changes: [chg("flags.midi-qol.advantage.skill.itm", "1")] } },
  { key: "dream-weaver", active: (a) => !!magicItem(a, "dream-weaver", { worn: false }) && a.statuses.has("unconscious"),
    effect: { name: "Dream Weaver: Mind Wall", img: "icons/sundries/documents/document-sealed-brown-red.webp",
      changes: ["int", "wis", "cha"].map((k) => chg(`flags.midi-qol.advantage.save.${k}`, "1")) } }
);
ON_HIT.push({ ident: "grave-reaper", label: "Grave Reaper", formula: "2d8", type: "necrotic", when: () => true, builtIn: (item) => hasPart(item, 2, 8, "necrotic", true) });

// ------------------------------------------------------------------ Concentration: Scholar's Anchoring Bangle, Mind Sharpener, Ring of Dedicated Focus
function concentrationItems(rolls, { subject: actor } = {}) {
  try {
    const roll = rolls?.[0], dc = Number(roll?.options?.target ?? 10);
    if (!actor || !roll || Number(roll.total) >= dc) return;
    const bangle = magicItem(actor, "scholars-anchoring-bangle"), sharp = magicItem(actor, "mind-sharpener"), ring = magicItem(actor, "ring-of-dedicated-focus");
    if (bangle && daily(bangle) > 0 && canReact(actor)) { roll._total = dc; spend(bangle); useReaction(actor); return say(actor, `<strong>Single-Minded Focus:</strong> ${actor.name} keeps Concentration (${bangle.name}).`); }
    if (sharp && charges(sharp, 4) > 0 && canReact(actor)) { roll._total = dc; spend(sharp); useReaction(actor); return say(actor, `<strong>Mind Sharpener:</strong> ${actor.name} keeps Concentration (a charge is spent).`); }
    if (ring) {
      const dice = [];
      for (const c of hitDieClasses(actor)) for (let i = 0; i < Number(c.system.hd.value) && dice.length < 2; i++) dice.push(c);
      let sum = 0; const used = [];
      for (const c of dice) { if (Number(roll.total) + sum >= dc) break; const faces = Number(String(c.system.hd.denomination).slice(1)); sum += Math.ceil(CONFIG.Dice.randomUniform() * faces); used.push(c); }
      if (used.length && Number(roll.total) + sum >= dc) {
        roll._total = Number(roll.total) + sum;
        (async () => { for (const c of used) await spendHitDie(c); })();
        return say(actor, `<strong>Ring of Dedicated Focus:</strong> ${used.length} Hit ${used.length > 1 ? "Dice" : "Die"} add ${sum} - ${actor.name} keeps Concentration (${roll._total} vs DC ${dc}).`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Concentration items failed`, err); }
}
// midi-qol ends Concentration from the legacy dnd5e.rollConcentration hook: run first so a rescued roll counts as a success.
Hooks.on("dnd5e.rollConcentration", concentrationItems);
Hooks.once("ready", () => setTimeout(() => { const arr = Hooks.events?.["dnd5e.rollConcentration"]; const i = arr?.findIndex((h) => h.fn === concentrationItems); if (arr && i > 0) arr.unshift(...arr.splice(i, 1)); }, 500));

// ------------------------------------------------------------------ Workflow done: reactions to hits, ammunition, activities
const bloodTargets = new WeakMap();
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item, act = workflow?.activity;
    if (!actor || !act) return;
    const id = act.midiProperties?.identifier ?? "";
    const me = tokenOf(workflow.token) ?? tokensOf(actor)[0];

    // ---- item activities
    if (id === "winding-path") return blinkNextMove(actor, "Boots of the Winding Path (a space you occupied this turn)", 15);
    if (id === "sorcerous-reservoir") {
      const sp = spItem(actor);
      if (!sp) return say(actor, "<strong>Sorcerous Reservoir:</strong> no Sorcery Points on the sheet.");
      await sp.update({ "system.uses.spent": Math.max(0, Number(sp.system.uses.spent ?? 0) - 2) });
      return say(actor, "<strong>Sorcerous Reservoir:</strong> up to 2 Sorcery Points regained.");
    }
    if (id === "spell-refuel") {
      const miss = slots(actor, 3).filter((s) => s.value < s.max);
      if (!miss.length) return say(actor, "<strong>Spell-Refueling Ring:</strong> no expended slot of level 3 or lower.");
      const p = await askChoice(actor, `Spell-Refueling Ring: ${actor.name}`, "<p>Recover which spell slot?</p>", miss.map((s, i) => ({ action: s.key, label: `Level ${s.level}`, default: i === miss.length - 1 })));
      const s = miss.find((x) => x.key === p) ?? miss[miss.length - 1];
      await actor.update({ [`system.spells.${s.key}.value`]: s.value + 1 });
      return say(actor, `<strong>Spell-Refueling Ring:</strong> a level ${s.level} slot is recovered.`);
    }
    if (id === "dissuader-repel" && me) {
      const foes = sceneTokens(me).filter((o) => o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(me, o, me.parent) <= 30);
      const w = foes.length ? await runAct(item, "dissuader-repel-save", foes) : null;
      for (const t of Array.from(w?.failedSaves ?? []).map(tokenOf)) if (t?.object) await MidiQOL.moveTokenAwayFromPoint(t.object, 30, me.object?.center ?? me.center, { animate: false }).catch(() => {});
      return;
    }
    if (id === "workshop-wrecker" && me) {
      const p = await askChoice(actor, `Workshop Wrecker: ${actor.name}`, "<p>How big is the area the ball bounces around in?</p>",
        [["15", "15-ft area (DC 18, 6d6+5)"], ["30", "30-ft area (DC 17, 4d6+4)"], ["50", "50-ft area (DC 15, 2d6+2)"], ["100", "100-ft area (DC 14, 1d6+1)"]].map(([k, l], i) => ({ action: k, label: l, default: i === 1 })));
      await actor.setFlag("world", "cgaWreckerSize", ["15", "30", "50", "100"].includes(p) ? p : "30");
      await actor.setFlag("world", "cgaWreckerItem", item.uuid);
      return wreckerPulse(actor, me);
    }
    if (id === "tramontane-grasp" && me) {
      for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) if (t) await pullToward(t, me, 20);
      return;
    }
    if (act.midiProperties?.automationOnly) return;

    // ---- the attack's targets react to hits: Dazzling Weapon, Repulsion Shield
    if (isAttack(workflow) && me) for (const t of hits(workflow)) {
      const ta = t.actor;
      const dz = magicItem(ta, "dazzling-weapon");
      if (dz && charges(dz, 4) > 0 && canReact(ta) && alive(actor)
        && await askOwner(ta, `Dazzling Weapon: ${t.name}`, `<p>${me.name} hits you. Use your Reaction and a charge - DC 15 CON save or ${me.name} is Blinded until the end of its next turn?</p>`)) {
        await spend(dz); await useReaction(ta);
        if (await failSave(actor, "con", 15)) await addEffect(actor, turnEndFx("Dazzling Weapon: Blinded", dz.img, ["blinded"]));
      }
      const rs = magicItem(ta, "repulsion-shield");
      const size = actor.system.traits?.size ?? "med";
      if (rs && meleeAttack(workflow) && charges(rs, 4) > 0 && canReact(ta) && ["tiny", "sm", "med", "lg"].includes(size) && edgeDistance(me, t, t.parent) <= 5
        && await askOwner(ta, `Repulsion Shield: ${t.name}`, `<p>${me.name} hits you in melee. Use your Reaction and a charge to push it 15 ft away?</p>`)) {
        await spend(rs); await useReaction(ta);
        if (me.object) await MidiQOL.moveTokenAwayFromPoint(me.object, 15, t.object?.center ?? t.center, { animate: false }).catch(() => {});
      }
    }

    // ---- ammunition: Goading, Dispelling
    const ammo = workflow.ammunition;
    const damaged = (workflow.damageList ?? []).filter((d) => Number(d.hpDamage ?? 0) + Number(d.tempDamage ?? 0) > 0).map((d) => { const f = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? ""); return f instanceof Actor ? tokensOf(f)[0] : tokenOf(f); }).filter((t) => t?.actor);
    if (ammo && damaged.length) {
      if (isMagicItem(ammo, "goading-ammunition")) for (const t of damaged)
        if (await failSave(t.actor, "cha", 13)) await addEffect(t.actor, { name: "Goading Ammunition (no Reactions)", img: ammo.img, transfer: false,
          system: { changes: [chg("flags.midi-qol.actions.reaction", "true"), chg("flags.midi-qol.actions.reactionsUsed", "1")] }, flags: { dae: { stackable: "noneName", specialDuration: ["turnStart"] } } });
      if (isMagicItem(ammo, "dispelling-ammunition")) for (const t of damaged) await dispelLow(t.actor, 3, actor);
    }
    // ---- Martialist's Quarterstaff: Trip
    if (id === "martialist-trip") for (const t of hits(workflow))
      if (await failSave(t.actor, "str", 13)) await addEffect(t.actor, await statusEffect("prone", { name: "Trip: Prone" }));
    // ---- Diamond Staff: Stunning Hit
    if (isAttack(workflow) && meleeAttack(workflow) && isMagicItem(item, "diamond-staff") && hits(workflow).length && Number(item.system.uses?.value ?? 0) >= 2) {
      const t = hits(workflow)[0];
      if (await askOwner(actor, `Stunning Hit: ${actor.name}`, `<p>Spend 2 charges - DC 17 CON save or ${t.name} is Stunned until the end of your next turn?</p>`)) {
        await spendUse(item, 2);
        if (await failSave(t.actor, "con", 17)) await addEffect(t.actor, await statusEffect("stunned", { name: "Stunning Hit: Stunned", origin: item.uuid, duration: { value: null, units: "rounds", expiry: "sourceEnd" } }));
      }
    }
    // ---- Blood Amulet: the save after the extra damage
    for (const t of bloodTargets.get(workflow) ?? []) {
      if (alive(t.actor) && await failSave(t.actor, "con", 15)) {
        await updateActor(t.actor, { "system.attributes.exhaustion": Math.min(6, Number(t.actor.system.attributes.exhaustion ?? 0) + 1) });
        say(actor, `<strong>Blood Amulet:</strong> ${t.name} gains 1 Exhaustion level.`);
      }
    }
    // ---- Spell Duelist's Trophy: Dispelling Touch
    const trophy = magicItem(actor, "spell-duelists-trophy");
    const touch = trophy?.system.activities?.find((a) => a.midiProperties?.identifier === "dispelling-touch");
    if (trophy && isAttack(workflow) && act.attack?.type?.value === "melee" && act.attack?.type?.classification === "spell" && hits(workflow).length) {
      const t = hits(workflow)[0];
      if (touch && Number(touch.uses?.value ?? 1) > 0 && await askOwner(actor, `Dispelling Touch: ${actor.name}`, `<p>Cast Dispel Magic on ${t.name} as part of the attack?</p>`))
        later(() => MidiQOL.completeActivityUse(touch, { midiOptions: { targetUuids: [t.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 800);
      else if (!touch && daily(trophy) > 0 && await askOwner(actor, `Dispelling Touch: ${actor.name}`, `<p>Dispel spells of level 3 or lower on ${t.name} (Dispel Magic, once per dawn)?</p>`)) { await spend(trophy); await dispelLow(t.actor, 3, actor); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | book item RollComplete rules failed`, err); }
});
// End spells of level `max` or lower on a creature (their effects and its Concentration).
async function dispelLow(actor, max, by) {
  const lvl = (e) => { const o = e.origin ? fromUuidSync(e.origin) : null; const it = o?.item ?? o; return it?.type === "spell" ? Number(e.flags?.dnd5e?.spellLevel ?? it.flags?.dnd5e?.scaling ?? 0) + Number(it.system.level ?? 0) : null; };
  const fx = actor.effects.filter((e) => { const l = lvl(e); return l !== null && l <= max; });
  if (fx.length) await removeEffects(actor, fx.map((e) => e.id));
  const conc = Array.from(actor.concentration?.effects ?? []).filter((e) => { const it = fromUuidSync(e.origin ?? "")?.item ?? fromUuidSync(e.origin ?? ""); return it?.type === "spell" && Number(it.system.level) <= max; });
  for (const e of conc) await actor.endConcentration?.(e).catch(() => {});
  say(by, `<strong>Dispelled:</strong> ${fx.length + conc.length} spell effect(s) of level ${max} or lower end on ${actor.name}.`);
}
async function pullToward(t, to, feet) {
  const scene = t.parent, gs = scene.grid.size, per = gs / scene.grid.distance;
  const tc = { x: t.x + (t.width * gs) / 2, y: t.y + (t.height * gs) / 2 }, oc = { x: to.x + (to.width * gs) / 2, y: to.y + (to.height * gs) / 2 };
  const dist = Math.hypot(oc.x - tc.x, oc.y - tc.y), move = Math.min(feet * per, Math.max(0, edgeDistance(t, to, scene) - 5) * per);
  if (move <= 0 || !dist) return;
  const { gmUpdateTokens } = await import("./main.js");
  await gmUpdateTokens(scene, [{ _id: t.id, x: Math.round((t.x + ((oc.x - tc.x) / dist) * move) / gs) * gs, y: Math.round((t.y + ((oc.y - tc.y) / dist) * move) / gs) * gs }], { animate: false, teleport: true });
}

// ------------------------------------------------------------------ Damage rolls: Blood Amulet, Prismatic Rune
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !workflow.damageRolls?.length || workflow.activity?.midiProperties?.automationOnly) return;
    const types = workflow.damageRolls.flatMap(rollTypes);
    if (types.every((t) => ["healing", "temphp"].includes(t))) return;
    const ts = workflow.activity?.type === "attack" ? hits(workflow) : targetsOf(workflow);
    const ba = magicItem(actor, "blood-amulet");
    if (ba && ts.length === 1 && charges(ba, 3) > 0 && await askOwner(actor, `Blood Amulet: ${actor.name}`, `<p>Spend a charge: +2d10 Necrotic to ${ts[0].name} and a DC 15 CON save or 1 Exhaustion?</p>`)) {
      await spend(ba);
      const roll = await new CONFIG.Dice.DamageRoll("2d10", {}, { type: "necrotic", types: ["necrotic"], flavor: "Blood Amulet" }).evaluate();
      await workflow.setBonusDamageRolls([...(workflow.bonusDamageRolls ?? []), roll]);
      bloodTargets.set(workflow, ts);
    }
    const pr = magicItem(actor, "prismatic-rune");
    const rune = pr?.getFlag("world", "cgaRune");
    if (pr && rune && item?.type === "spell" && charges(pr, 6) > 0 && !types.includes(rune)
      && await askOwner(actor, `Prismatic Rune: ${actor.name}`, `<p>Spend a charge to change ${item.name}'s damage to ${cap(rune)}?</p>`)) {
      await spend(pr);
      for (const r of workflow.damageRolls) { if (rollTypes(r).some((t) => ["healing", "temphp"].includes(t))) continue; r.options.type = rune; r.options.types = [rune]; }
      await workflow.setDamageRolls(workflow.damageRolls);
    }
  } catch (err) { console.warn(`${MODULE_ID} | book item damage rules failed`, err); }
});

// ------------------------------------------------------------------ Damage taken: Mage Breaker (Disadvantage on the Concentration save)
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const t = token?.actor;
    if (!t || !isMagicItem(workflow?.item, "mage-breaker") || !attuned(workflow.item) || !hits(workflow).some((h) => h.uuid === tokenOf(token)?.uuid)) return;
    if ((ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0 || !t.statuses.has("concentrating")) return;
    await addEffect(t, { name: "Mage Breaker (Disadvantage on Concentration)", img: workflow.item.img, transfer: false,
      system: { changes: [chg("flags.midi-qol.disadvantage.concentration", "1")] }, flags: { dae: { stackable: "noneName", specialDuration: ["isSave"] } }, duration: { seconds: 6 } });
  } catch (err) { console.warn(`${MODULE_ID} | Mage Breaker failed`, err); }
});

// ------------------------------------------------------------------ Attacks: Staff of Skulls (Chattering), Keyholes Dagger (reroll), Namer's Needle (crit)
Hooks.on("midi-qol.preAttackRollConfig", async (workflow) => {
  try {
    const tr = workflow?.attackRollModifierTracker, atk = tokenOf(workflow?.token);
    if (!tr || !atk || tr.disadvantage?.isActive?.()) return;
    // Martialist's Quarterstaff Trip: Advantage
    if (workflow.activity?.midiProperties?.identifier === "martialist-trip") tr.advantage?.add?.("martialist-trip", "Trip");
    for (const h of sceneTokens(atk)) {
      const st = h.actor && magicItem(h.actor, "staff-of-skulls");
      if (!st || !rare(st) || h === atk || !hostile(h, atk) || !canReact(h.actor) || edgeDistance(h, atk, h.parent) > 30) continue;
      if (!(await askOwner(h.actor, `Chattering Skulls: ${h.name}`, `<p>${atk.name} attacks. Use your Reaction to give the attack Disadvantage?</p>`))) continue;
      await useReaction(h.actor);
      tr.disadvantage?.add?.("staff-of-skulls", "Chattering Skulls");
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Staff of Skulls failed`, err); }
});
const rerolled = new WeakSet(), named = new WeakSet();
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item, roll = workflow?.attackRoll, t = targetsOf(workflow)[0];
    if (!actor || !roll || !t || rerolled.has(workflow) || !isMagicItem(item, "keyholes-dagger") || !veryRare(item)) return;
    const ac = Number(t.actor.system.attributes.ac?.value ?? 10);
    if (Number(roll.total) >= ac || item.getFlag("world", "cgaKeyholeUsed")) return;
    rerolled.add(workflow);
    if (!(await askOwner(actor, `Keyholes Dagger: ${actor.name}`, `<p>Your attack (${roll.total}) misses (AC ${ac}). Reroll it? (once per dawn)</p>`))) return;
    await item.setFlag("world", "cgaKeyholeUsed", true);
    const die = roll.dice?.find((d) => d.faces === 20)?.total ?? 10, r = await new Roll("1d20").evaluate();
    roll._total = Number(roll.total) - die + r.total; await workflow.setAttackRoll?.(roll);
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Keyholes Dagger reroll: the attack is now ${roll._total}` });
  } catch (err) { console.warn(`${MODULE_ID} | Keyholes Dagger failed`, err); }
});
Hooks.on("midi-qol.hitsChecked", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || named.has(workflow) || !isMagicItem(item, "namers-needle") || !hits(workflow).length || workflow.isCritical || item.getFlag("world", "cgaNamedUsed")) return;
    named.add(workflow);
    if (!(await askOwner(actor, `Named Target: ${actor.name}`, `<p>Speak ${hits(workflow)[0].name}'s name to turn the hit into a Critical Hit? (once per dawn)</p>`))) return;
    await item.setFlag("world", "cgaNamedUsed", true);
    workflow.isCritical = true;
    say(actor, "<strong>Named Target:</strong> the hit becomes a Critical Hit.");
  } catch (err) { console.warn(`${MODULE_ID} | Namer's Needle failed`, err); }
});

// ------------------------------------------------------------------ Saves: Boon Companions' Bands, Lucky Foot
const banded = new WeakMap();
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const caster = workflow?.actor, mine = magicItem(caster, "boon-companions-bands");
    if (!mine || daily(mine) < 1) return;
    for (const t of targetsOf(workflow)) {
      const theirs = t.actor !== caster && magicItem(t.actor, "boon-companions-bands");
      if (!theirs) continue;
      if (!(await askOwner(caster, `Boon Companions' Bands: ${caster.name}`, `<p>Protect ${t.name} (wearing the matching band) from this effect - automatic success and no damage? (once per dawn)</p>`))) return;
      await spend(mine); if (daily(theirs) > 0) await spend(theirs);
      await addEffect(t.actor, { name: "Boon Companions' Bands (protected)", img: mine.img, transfer: false, system: { changes: [chg("flags.midi-qol.superSaver.all", "1")] }, flags: { dae: { specialDuration: ["isSave"] } } });
      banded.set(workflow, [...(banded.get(workflow) ?? []), t.uuid]);
      return;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Boon Companions' Bands failed`, err); }
});
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    const dc = Number(workflow?.activity?.save?.dc?.value ?? workflow?.saveDC ?? 0);
    for (const t of Array.from(workflow?.failedSaves ?? [])) {
      const tDoc = tokenOf(t);
      if ((banded.get(workflow) ?? []).includes(tDoc?.uuid)) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); continue; }
      const roll = workflow.targetSaveDetails?.[tDoc?.uuid]?.saveRoll, die = roll?.dice?.find((d) => d.faces === 20);
      const foot = tDoc?.actor && magicItem(tDoc.actor, "lucky-foot", { worn: false });
      if (!foot || !roll || die?.total !== 1) continue;
      if (!(await askOwner(tDoc.actor, `Lucky Foot: ${tDoc.name}`, `<p>You rolled a 1 on the save. Use the Lucky Foot to reroll it (it disintegrates)?</p>`))) continue;
      const r = await new Roll("1d20").evaluate();
      roll._total = Number(roll.total) - 1 + r.total;
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: tDoc.actor }), flavor: `Lucky Foot: the save is now ${roll._total}${dc ? ` (DC ${dc})` : ""}` });
      await consumeOne(foot);
      if (dc && roll._total >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | book item save rules failed`, err); }
});
// Boon Companions' Bands: the protected creature takes no damage from the effect
Hooks.on("midi-qol.preTargetDamageApplication", (token, { ditem, workflow }) => {
  if (!(banded.get(workflow) ?? []).includes(tokenOf(token)?.uuid)) return;
  for (const d of (ditem.calculatedDamages ?? ditem.damageDetail) ?? []) if (!["healing", "temphp"].includes(d.type)) d.value = 0;
  ditem.hpDamage = 0; ditem.tempDamage = 0; ditem.totalDamage = 0; ditem.newHP = ditem.oldHP; ditem.newTempHP = ditem.oldTempHP;
});
async function consumeOne(item) { if (Number(item.system.quantity ?? 1) > 1) await item.update({ "system.quantity": Number(item.system.quantity) - 1 }); else await item.delete(); }
const footSeen = new WeakSet();
for (const h of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"]) Hooks.on(h, async (rolls, data) => {
  try {
    const roll = rolls?.[0], actor = data?.subject;
    if (!roll || !actor || footSeen.has(roll) || /save/i.test(roll.options?.rollType ?? "")) return;
    footSeen.add(roll);
    const foot = magicItem(actor, "lucky-foot", { worn: false });
    if (!foot || roll.dice?.find((d) => d.faces === 20)?.total !== 1) return;
    if (!(await askOwner(actor, `Lucky Foot: ${actor.name}`, "<p>You rolled a 1 on the check. Use the Lucky Foot to reroll it (it disintegrates)?</p>"))) return;
    const r = await new Roll("1d20").evaluate();
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Lucky Foot: the check is now ${Number(roll.total) - 1 + r.total}` });
    await consumeOne(foot);
  } catch (err) { console.warn(`${MODULE_ID} | Lucky Foot (check) failed`, err); }
});

// ------------------------------------------------------------------ Rests: Prismatic Rune type, Dream Weaver, once-per-dawn flags
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner || !(config?.type === "long" || result?.longRest)) return;
    for (const i of actor.items.filter((x) => x.getFlag("world", "cgaKeyholeUsed") || x.getFlag("world", "cgaNamedUsed")))
      await i.update({ "flags.world.-=cgaKeyholeUsed": null, "flags.world.-=cgaNamedUsed": null });
    const pr = magicItem(actor, "prismatic-rune", { worn: false });
    if (pr) {
      const types = ["acid", "cold", "fire", "lightning", "thunder"];
      const p = await askChoice(actor, `Prismatic Rune: ${actor.name}`, "<p>Imbue the rune with which damage type until your next Long Rest?</p>", types.map((t, i) => ({ action: t, label: cap(t), default: i === 0 })));
      await pr.setFlag("world", "cgaRune", types.includes(p) ? p : "fire");
    }
    if (magicItem(actor, "dream-weaver", { worn: false })) {
      const r = await new Roll("1d20").evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Dream Wisdom: ${actor.name} can replace one D20 Test with ${r.total} before the next Long Rest (choose before rolling - by hand)` });
    }
  } catch (err) { console.warn(`${MODULE_ID} | book item rest rules failed`, err); }
});

// ------------------------------------------------------------------ Turns: Workshop Wrecker, Dissuading Aura
async function wreckerPulse(actor, me) {
  const it = fromUuidSync(actor.getFlag("world", "cgaWreckerItem") ?? ""), size = actor.getFlag("world", "cgaWreckerSize") ?? "30";
  if (!it || !me) return;
  const ts = sceneTokens(me).filter((o) => o.actor && o !== me && alive(o.actor) && edgeDistance(me, o, me.parent) <= Number(size) / 2);
  if (ts.length) await runAct(it, `wrecker-${size}`, ts);
}
Hooks.on("updateCombat", async (combat, changes) => {
  try {
    if (!isGM() || !("turn" in changes || "round" in changes)) return;
    const cur = combat.combatant;
    if (cur?.actor?.effects?.some((e) => e.flags?.world?.cgaWrecker && !e.disabled)) await wreckerPulse(cur.actor, cur.token);
    const prev = combat.previous?.combatantId ? combat.combatants.get(combat.previous.combatantId) : null, ended = prev?.token;
    if (!ended?.actor || !alive(ended.actor)) return;
    for (const h of sceneTokens(ended)) {
      const d = h.actor && magicItem(h.actor, "dissuader");
      if (!d || !h.actor.effects.some((e) => e.flags?.world?.cgaDissuade && !e.disabled) || !hostile(h, ended) || edgeDistance(h, ended, h.parent) > 30) continue;
      if (await askOwner(h.actor, `Dissuading Aura: ${h.name}`, `<p>${ended.name} ends its turn in your aura. Force a DC 15 WIS save (Frightened until its next turn)?</p>`)) await runAct(d, "dissuader-aura-save", [ended]);
    }
  } catch (err) { console.warn(`${MODULE_ID} | book item turn rules failed`, err); }
});

// ------------------------------------------------------------------ Tramontane Armor: grant the helper feature while it's worn
const TRAM_UUID = `Compendium.${MODULE_ID}.cga-features.Item.cgaIbTramFeat000`;
const tramBusy = new Set();
async function syncTramontane(actor) {
  if (!(actor instanceof Actor) || !isGM() || tramBusy.has(actor.uuid)) return;
  tramBusy.add(actor.uuid);
  try {
    const want = actor.items.some((i) => i.type !== "feat" && isMagicItem(i, "tramontane-armor") && attuned(i) && i.system?.equipped !== false);
    const have = actor.items.filter((i) => i.flags?.world?.cgaGrantedBy === "tramontane-armor");
    if (!want && have.length) await actor.deleteEmbeddedDocuments("Item", have.map((i) => i.id));
    if (want && !have.length) {
      const src = await fromUuid(TRAM_UUID);
      if (src) { const data = src.toObject(); delete data._id; foundry.utils.setProperty(data, "flags.world.cgaGrantedBy", "tramontane-armor"); await actor.createEmbeddedDocuments("Item", [data]); }
    }
  } finally { tramBusy.delete(actor.uuid); }
}
for (const h of ["createItem", "deleteItem"]) Hooks.on(h, (item) => { if (item.parent instanceof Actor && item.flags?.world?.cgaGrantedBy !== "tramontane-armor") setTimeout(() => syncTramontane(item.parent), 300); });
Hooks.on("updateItem", (item, changes) => { if (item.parent instanceof Actor && ["system.equipped", "system.attuned"].some((k) => foundry.utils.hasProperty(changes, k))) setTimeout(() => syncTramontane(item.parent), 300); });
Hooks.once("ready", () => { if (isGM()) for (const a of game.actors) if (a.type === "character") syncTramontane(a); });
