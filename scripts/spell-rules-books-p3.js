// Champions Guild Automation - priority-3 spells from Arcana Unleashed and Heroes of Faerûn: the parts their CGA spell
// items can't do alone. Keyed on the spell's identifier or name.
//  - Zone of Amicability: Deception/Intimidation/Performance/Persuasion d20 rolls of 9 or lower count as 10.
//  - Elminster's Effulgent Spheres: sphere count set on the cast; Absorb Energy offered on elemental damage; ends when empty.
//  - Power Word Pain: no Charm above 100 HP; a Charmed creature makes a CON save to cast (or the spell fails, slot refunded).
//  - Reweave Fate / Moment of Prescience: Reactions offered on failed saves and on attacks (miss / hit).
//  - Simbul's Synostodweomer: casting with a slot offers Hit Point Dice healing.
//  - Transfix: 4d8 Psychic (+1d8 per level above 7) when the target ends its turn within 5 ft of you.
//  - Holy Star of Mystra: Three-Quarters Cover while it lasts. Iron Body: ends Paralyzed/Petrified/Poisoned.
//  - Detonate: the Explosion's saves have Disadvantage if the seed dropped its target to 0.
//  - Vision of Elapsing Eons: each failed repeat save adds an Exhaustion level.
//  - Wail of the Banshee: targets with 50 HP or fewer die.
//  - True Resurrection (midi-qol item): also ends Poisoned, Diseased and Cursed.
import { MODULE_ID, edgeDistance, askOwner, reduceDamage } from "./main.js";
import { isMagicItem, say, tokenOf, isGM, chg, canReact, useReaction } from "./item-rules.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const spellIs = (item, ident) => item?.type === "spell" && isMagicItem(item, ident);
const spellOf = (actor, ident) => actor?.items?.find((i) => spellIs(i, ident));
const tokenFor = (actor) => actor?.getActiveTokens?.(false, true)?.[0] ?? null;
const castLevel = (wf) => Number(wf?.castData?.castLevel ?? wf?.spellLevel ?? wf?.item?.system?.level) || 0;
const hasFx = (actor, name) => actor?.effects?.find((e) => e.name === name && !e.disabled);
async function updateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return asGM("updateActor", { actorUuid: actor.uuid, updates });
}
async function addEffect(actor, data) {
  try { if (actor.isOwner) return await actor.createEmbeddedDocuments("ActiveEffect", [data]); } catch (err) {}
  return asGM("createEffects", { actorUuid: actor.uuid, effects: [data] });
}
function lowestSlot(actor, min) {
  const s = actor.system.spells ?? {};
  const opts = [];
  for (let l = min; l <= 9; l++) if (Number(s[`spell${l}`]?.value ?? 0) > 0) opts.push({ key: `spell${l}`, level: l });
  if (Number(s.pact?.value ?? 0) > 0 && Number(s.pact?.level ?? 0) >= min) opts.push({ key: "pact", level: Number(s.pact.level) });
  return opts.sort((a, b) => a.level - b.level)[0] ?? null;
}
const spendSlot = (actor, slot) => updateActor(actor, { [`system.spells.${slot.key}.value`]: Number(actor.system.spells[slot.key].value) - 1 });
function refundSlot(actor, level) {
  if (level < 1) return;
  const sp = actor.system.spells;
  const key = Number(sp[`spell${level}`]?.value ?? 0) < Number(sp[`spell${level}`]?.max ?? 0) ? `spell${level}` : (Number(sp.pact?.level) === level ? "pact" : null);
  if (key) setTimeout(() => updateActor(actor, { [`system.spells.${key}.value`]: Math.min(Number(actor.system.spells[key].max ?? 99), Number(actor.system.spells[key].value ?? 0) + 1) }), 800);
}
const d20Of = (roll) => roll?.dice?.find((d) => d.faces === 20);

// ------------------------------------------------------------------ Zone of Amicability
Hooks.on("dnd5e.preRollSkillV2", (config) => {
  try {
    const actor = config?.subject;
    if (!(actor instanceof Actor) || !["dec", "itm", "per", "prf"].includes(config.skill) || !hasFx(actor, "Zone of Amicability") || !config.rolls?.length) return;
    config.rolls[0].options = { ...(config.rolls[0].options ?? {}), minimum: Math.max(10, Number(config.rolls[0].options?.minimum ?? 0)) };
  } catch (err) { console.warn(`${MODULE_ID} | Zone of Amicability failed`, err); }
});

// ------------------------------------------------------------------ Damage: Effulgent Spheres' Absorb Energy
const ELEM = ["acid", "cold", "fire", "lightning", "thunder"];
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem || !hasFx(actor, "Elminster’s Effulgent Spheres") || !canReact(actor)) return;
    const spell = spellOf(actor, "elminsters-effulgent-spheres");
    if (!spell || Number(spell.system.uses.value ?? 0) <= 0) return;
    const by = {}; for (const d of ditem.damageDetail ?? []) if (ELEM.includes(d.type) && (d.value ?? 0) > 0) by[d.type] = (by[d.type] ?? 0) + d.value;
    const type = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
    if (!type) return;
    if (!(await askOwner(actor, `Absorb Energy: ${actor.name}`, `<p>${actor.name} takes ${by[type]} ${type} damage. Spend a sphere (${spell.system.uses.value} left) and your Reaction for Resistance to ${type} until the start of your next turn?</p>`))) return;
    await useReaction(actor);
    await spell.update({ "system.uses.spent": Number(spell.system.uses.spent ?? 0) + 1 });
    const cut = reduceDamage(ditem, Math.floor(by[type] / 2), [type]);
    await addEffect(actor, { name: `Absorb Energy (${type})`, img: spell.img, transfer: false, duration: { rounds: 1 }, system: { changes: [chg("system.traits.dr.value", type, "add")] },
      flags: { dae: { specialDuration: ["turnStart"] } } });
    say(actor, `<strong>Absorb Energy:</strong> ${actor.name} resists ${type} damage until the start of their next turn (${cut} less now).`);
  } catch (err) { console.warn(`${MODULE_ID} | Absorb Energy failed`, err); }
});
// The spheres are gone: the spell ends
Hooks.on("updateItem", async (item, changes) => {
  try {
    if (!spellIs(item, "elminsters-effulgent-spheres") || foundry.utils.getProperty(changes, "system.uses.spent") === undefined || Number(item.system.uses.value ?? 1) > 0) return;
    const actor = item.parent;
    if (!actor || !isGM()) return;
    const fx = actor.effects.filter((e) => e.name === "Elminster’s Effulgent Spheres");
    if (fx.length) { await actor.deleteEmbeddedDocuments("ActiveEffect", fx.map((e) => e.id)); say(actor, "<strong>Elminster's Effulgent Spheres</strong> end: no spheres remain."); }
  } catch (err) {}
});

// ------------------------------------------------------------------ Saves: Reweave Fate, Moment of Prescience
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size) return;
    const dc = Number(workflow.activity?.save?.dc?.value ?? workflow.saveDC ?? 0);
    for (const t of Array.from(workflow.failedSaves)) {
      const tDoc = tokenOf(t); const saver = tDoc?.actor;
      const roll = workflow.targetSaveDetails?.[tDoc?.uuid]?.saveRoll;
      if (!saver || !roll || !dc) continue;
      const die = d20Of(roll);
      const mods = Number(roll.total) - Number(die?.total ?? 0);
      let total = Number(roll.total), done = false;
      // Moment of Prescience (the saver's own spell): the failed d20 becomes a 20
      const mop = spellOf(saver, "moment-of-prescience"); const mopSlot = mop && canReact(saver) ? lowestSlot(saver, 8) : null;
      if (mopSlot && mods + 20 >= dc && await askOwner(saver, `Moment of Prescience: ${saver.name}`, `<p>${saver.name} fails a DC ${dc} save (${total}). Use your Reaction and a level ${mopSlot.level} slot to turn the d20 into a 20?</p>`)) {
        await spendSlot(saver, mopSlot); await useReaction(saver);
        total = mods + 20; done = true;
        say(saver, `<strong>Moment of Prescience:</strong> ${saver.name}'s save becomes ${total} (DC ${dc}).`);
      }
      // Reweave Fate (a caster within 60 ft of the saver): reroll with Advantage; a success gives 6d10 temp HP
      if (!done) for (const h of tDoc.parent.tokens) {
        const rf = h.actor && spellOf(h.actor, "reweave-fate");
        if (!rf || h.disposition !== tDoc.disposition || !canReact(h.actor) || edgeDistance(h, tDoc, tDoc.parent) > 60) continue;
        const slot = lowestSlot(h.actor, 7); if (!slot) continue;
        if (!(await askOwner(h.actor, `Reweave Fate: ${h.name}`, `<p>${tDoc.name} fails a DC ${dc} save (${total}). Use your Reaction and a level ${slot.level} slot so it rerolls with Advantage?</p>`))) continue;
        await spendSlot(h.actor, slot); await useReaction(h.actor);
        const r = await new Roll("2d20kh").evaluate();
        total = mods + r.total;
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: h.actor }), flavor: `Reweave Fate: ${tDoc.name} rerolls with Advantage - ${total} vs DC ${dc}` });
        if (total >= dc) { const th = await new Roll("6d10").evaluate(); await th.toMessage({ speaker: ChatMessage.getSpeaker({ actor: h.actor }), flavor: `Reweave Fate: ${tDoc.name} gains Temporary Hit Points` });
          if (Number(saver.system.attributes.hp.temp ?? 0) < th.total) await updateActor(saver, { "system.attributes.hp.temp": th.total }); }
        done = true; break;
      }
      if (done && total >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); roll._total = total; }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 save reactions failed`, err); }
});

// ------------------------------------------------------------------ Attacks: Moment of Prescience (a hit becomes a 1), Reweave Fate (a miss rerolls)
// midi can call hitsChecked more than once per attack: offer these once per workflow.
const attackReacted = new WeakSet();
Hooks.on("midi-qol.hitsChecked", async (workflow) => {
  try {
    if (!workflow?.activity?.attack || workflow.targets?.size !== 1 || !workflow.attackRoll || attackReacted.has(workflow)) return;
    attackReacted.add(workflow);
    const tObj = Array.from(workflow.targets)[0]; const t = tokenOf(tObj); const def = t?.actor;
    const atk = tokenOf(workflow.token);
    if (!def || !atk) return;
    const roll = workflow.attackRoll, die = d20Of(roll), mods = Number(roll.total) - Number(die?.total ?? 0);
    const hit = Array.from(workflow.hitTargets ?? []).some((x) => tokenOf(x) === t);
    if (hit && def !== workflow.actor) {
      const mop = spellOf(def, "moment-of-prescience"); const slot = mop && canReact(def) ? lowestSlot(def, 8) : null;
      if (slot && await askOwner(def, `Moment of Prescience: ${def.name}`, `<p>${atk.name} hits ${def.name} (${roll.total}). Use your Reaction and a level ${slot.level} slot to turn the attack roll into a 1?</p>`)) {
        await spendSlot(def, slot); await useReaction(def);
        workflow.hitTargets.delete(tObj); workflow.isCritical = false;
        try { roll._total = mods + 1; } catch (err) {}
        say(def, `<strong>Moment of Prescience:</strong> ${atk.name}'s attack roll becomes a 1 - it misses ${def.name}.`);
      }
      return;
    }
    if (hit) return;
    const ac = Number(def.system.attributes.ac.value ?? 10);
    if (mods + 20 < ac) return;
    for (const h of atk.parent.tokens) {
      const rf = h.actor && spellOf(h.actor, "reweave-fate");
      if (!rf || h.disposition !== atk.disposition || !canReact(h.actor) || edgeDistance(h, atk, atk.parent) > 60) continue;
      const slot = lowestSlot(h.actor, 7); if (!slot) continue;
      if (!(await askOwner(h.actor, `Reweave Fate: ${h.name}`, `<p>${atk.name} misses ${t.name} (${roll.total} vs AC ${ac}). Use your Reaction and a level ${slot.level} slot so it rerolls with Advantage?</p>`))) continue;
      await spendSlot(h.actor, slot); await useReaction(h.actor);
      const r = await new Roll("2d20kh").evaluate();
      const total = mods + r.total;
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: h.actor }), flavor: `Reweave Fate: ${atk.name} rerolls the attack with Advantage - ${total} vs AC ${ac}` });
      if (total >= ac) {
        workflow.hitTargets.add(tObj);
        try { roll._total = total; } catch (err) {}
        const th = await new Roll("6d10").evaluate(); await th.toMessage({ speaker: ChatMessage.getSpeaker({ actor: h.actor }), flavor: `Reweave Fate: ${atk.name} gains Temporary Hit Points` });
        if (Number(atk.actor.system.attributes.hp.temp ?? 0) < th.total) await updateActor(atk.actor, { "system.attributes.hp.temp": th.total });
      }
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 attack reactions failed`, err); }
});

// ------------------------------------------------------------------ Casting checks: Power Word Pain (CON save or the spell fails)
Hooks.on("midi-qol.targetingComplete", async (workflow) => {
  try {
    const item = workflow?.item, actor = workflow?.actor;
    const fx = actor && hasFx(actor, "Power Word Pain");
    if (item?.type !== "spell" || !fx) return;
    const src = fx.origin ? await fromUuid(fx.origin).catch(() => null) : null;
    const dc = Number((src?.actor ?? src?.parent)?.system?.attributes?.spell?.dc ?? fx.flags?.world?.cgaDc ?? 15);
    const res = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false }, { data: { flavor: `Power Word Pain: CON save (DC ${dc}) to cast ${item.name}` } });
    const roll = Array.isArray(res) ? res[0] : res;
    if (roll && roll.total >= dc) return;
    refundSlot(actor, castLevel(workflow));
    say(actor, `<strong>Power Word Pain:</strong> ${actor.name}'s ${item.name} dissipates with no effect.`);
    return false;
  } catch (err) { console.warn(`${MODULE_ID} | Power Word Pain casting check failed`, err); }
});

// ------------------------------------------------------------------ After a workflow
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item, aid = workflow?.activity?._id;
    if (!actor || item?.type !== "spell") return;
    const level = castLevel(workflow);
    // Effulgent Spheres: 6 spheres + 1 per level above 6
    if (spellIs(item, "elminsters-effulgent-spheres") && aid === "dnd5eactivity000") await item.update({ "system.uses.max": String(6 + Math.max(0, level - 6)), "system.uses.spent": 0 });
    // Power Word Pain: above 100 HP (before the damage), no Charm
    if (spellIs(item, "power-word-pain") && aid === "dnd5eactivity000") {
      for (const d of workflow.damageList ?? []) {
        const a = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "")?.actor ?? fromUuidSync(d.actorUuid ?? "");
        if (!a) continue;
        const before = Number(a.system.attributes.hp.value ?? 0) + Number(d.hpDamage ?? 0);
        if (before <= 100) continue;
        const fx = a.effects.filter((e) => e.name === "Power Word Pain");
        if (fx.length) await asGM("removeEffects", { actorUuid: a.uuid, effects: fx.map((e) => e.id) });
        say(a, `<strong>Power Word Pain:</strong> ${a.name} had more than 100 Hit Points - it only takes the damage.`);
      }
    }
    // Transfix: remember the caster and the slot level on the target's effect
    if (spellIs(item, "transfix")) for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) {
      const fx = t?.actor?.effects?.find((e) => e.name === "Transfix");
      if (fx) await (fx.isOwner ? fx.update({ "flags.world.cgaTransfix": { caster: actor.uuid, level: Math.max(7, level || 7) } }) : asGM("updateEffects", { actorUuid: t.actor.uuid, updates: [{ _id: fx.id, "flags.world.cgaTransfix": { caster: actor.uuid, level: Math.max(7, level || 7) } }] }));
    }
    // Simbul's: keep the caster's modifier on the target's effect
    if (spellIs(item, "simbuls-synostodweomer")) for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      const fx = t?.actor?.effects?.find((e) => e.name === "Simbul’s Synostodweomer");
      if (fx) await asGM("updateEffects", { actorUuid: t.actor.uuid, updates: [{ _id: fx.id, "flags.world.cgaSimbulMod": Number(actor.system.attributes?.spell?.mod ?? 0) }] });
    }
    // Holy Star of Mystra: Three-Quarters Cover while the mote lasts (ends with the concentration - origin is the spell)
    if (spellIs(item, "holy-star-of-mystra") && aid === "dnd5eactivity000" && !actor.effects.some((e) => e.flags?.[MODULE_ID]?.holyStar)) {
      await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Holy Star of Mystra", img: item.img, transfer: false, origin: item.uuid, statuses: ["coverThreeQuarters"], duration: { seconds: 60 }, flags: { [MODULE_ID]: { holyStar: true } } }]);
    }
    // Iron Body: Paralyzed, Petrified and Poisoned end
    if (spellIs(item, "iron-body")) for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      const a = t?.actor; if (!a) continue;
      const bad = a.effects.filter((e) => e.name !== "Iron Body" && ["paralyzed", "petrified", "poisoned"].some((s) => e.statuses?.has(s)));
      if (bad.length) await asGM("removeEffects", { actorUuid: a.uuid, effects: bad.map((e) => e.id) });
    }
    // Detonate: did the seed drop its target to 0?
    if (spellIs(item, "detonate") && aid === "dnd5eactivity000") {
      const t = tokenOf(Array.from(workflow.targets ?? [])[0]);
      await actor.setFlag("world", "cgaDetonateKill", Number(t?.actor?.system?.attributes?.hp?.value ?? 1) <= 0).catch(() => {});
    }
    // Vision of Elapsing Eons: a failed repeat save adds an Exhaustion level
    if (spellIs(item, "vision-of-elapsing-eons") && aid === "visionEonsOTSave") for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) {
      const a = t?.actor; if (!a) continue;
      await updateActor(a, { "system.attributes.exhaustion": Math.min(6, Number(a.system.attributes.exhaustion ?? 0) + 1) });
      say(a, `<strong>Vision of Elapsing Eons:</strong> ${a.name} gains an Exhaustion level.`);
    }
    // Simbul's Synostodweomer: the effect's holder cast with a slot - offer Hit Point Dice healing
    const simbul = hasFx(actor, "Simbul’s Synostodweomer");
    if (simbul && level >= 1 && item.system.level >= 1 && workflow.activity?.consumption?.spellSlot !== false) {
      const classes = actor.itemTypes?.class?.filter((c) => Number(c.system.hd?.value ?? 0) > 0).sort((x, y) => Number(String(y.system.hd.denomination).slice(1)) - Number(String(x.system.hd.denomination).slice(1))) ?? [];
      const avail = classes.reduce((s, c) => s + Number(c.system.hd.value), 0);
      const n = Math.min(level, avail);
      if (n > 0 && await askOwner(actor, `Simbul's Synostodweomer: ${actor.name}`, `<p>You cast with a level ${level} slot. Roll ${n} Hit Point ${n > 1 ? "Dice" : "Die"} and regain that much + ${Number(simbul.flags?.world?.cgaSimbulMod ?? 0)} Hit Points?</p>`)) {
        let left = n; const parts = []; const upd = [];
        for (const c of classes) { const k = Math.min(left, Number(c.system.hd.value)); if (!k) continue; parts.push(`${k}${c.system.hd.denomination}`); upd.push([c, k]); left -= k; if (!left) break; }
        const r = await new Roll(`${parts.join(" + ")} + ${Number(simbul.flags?.world?.cgaSimbulMod ?? 0)}`).evaluate();
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Simbul's Synostodweomer: Hit Point Dice healing" });
        for (const [c, k] of upd) await c.update({ "system.hd.spent": Number(c.system.hd.spent ?? 0) + k });
        const me = tokenOf(workflow.token) ?? tokenFor(actor);
        if (me) await MidiQOL.applyTokenDamage([{ value: r.total, type: "healing" }], r.total, new Set([me.object ?? me]), null, new Set(), {});
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 spell after-workflow rules failed`, err); }
});

// ------------------------------------------------------------------ Before saves: Wail of the Banshee kills, Detonate's Explosion Disadvantage
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const item = workflow?.item;
    if (spellIs(item, "wail-of-the-banshee")) {
      for (const t of Array.from(workflow.targets ?? [])) {
        const a = tokenOf(t)?.actor; const hp = Number(a?.system?.attributes?.hp?.value ?? 999);
        if (!a || hp > 50) continue;
        workflow.targets.delete(t);
        await MidiQOL.applyTokenDamage([{ value: hp, type: "psychic" }], hp, new Set([t.object ?? t]), null, new Set(), {});
        say(a, `<strong>Wail of the Banshee:</strong> ${a.name} (${hp} Hit Points) dies.`);
      }
    }
    if (spellIs(item, "detonate") && workflow.activity?._id === "cgaDetonateBoom0" && workflow.actor?.getFlag("world", "cgaDetonateKill")) {
      for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
        if (!t?.actor) continue;
        await addEffect(t.actor, { name: "Detonate (Disadvantage)", img: item.img, transfer: false, system: { changes: [chg("flags.midi-qol.disadvantage.save.dex", "1")] }, flags: { dae: { specialDuration: ["isSave"] } } });
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 pre-save rules failed`, err); }
});

// ------------------------------------------------------------------ Transfix: 4d8 Psychic when the target ends its turn within 5 ft of the caster
Hooks.on("updateCombat", async (combat, changed) => {
  try {
    if (!isGM() || !("turn" in changed || "round" in changed)) return;
    const prev = combat.previous;
    const ended = prev?.combatantId ? combat.combatants.get(prev.combatantId) : null;
    const a = ended?.actor;
    const fx = a?.effects?.find((e) => e.name === "Transfix" && e.flags?.world?.cgaTransfix);
    if (!fx) return;
    const caster = fromUuidSync(fx.flags.world.cgaTransfix.caster);
    const ct = tokenFor(caster), tt = ended.token;
    if (!ct || !tt || edgeDistance(ct, tt, tt.parent) > 5) return;
    const lvl = Number(fx.flags.world.cgaTransfix.level ?? 7);
    const r = await new Roll(`${4 + Math.max(0, lvl - 7)}d8`).evaluate();
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: caster }), flavor: `Transfix: ${tt.name} ends its turn beside ${ct.name}` });
    await MidiQOL.applyTokenDamage([{ value: r.total, type: "psychic" }], r.total, new Set([tt.object ?? tt]), null, new Set(), {});
  } catch (err) { console.warn(`${MODULE_ID} | Transfix failed`, err); }
});

// ------------------------------------------------------------------ True Resurrection (midi-qol's item): also neutralize poison, disease and curses
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    if (workflow?.item?.type !== "spell" || !isMagicItem(workflow.item, "true-resurrection")) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      const a = t?.actor; if (!a) continue;
      const bad = a.effects.filter((e) => ["poisoned", "diseased", "cursed"].some((s) => e.statuses?.has(s)));
      if (bad.length) await asGM("removeEffects", { actorUuid: a.uuid, effects: bad.map((e) => e.id) });
    }
  } catch (err) { console.warn(`${MODULE_ID} | True Resurrection cleanup failed`, err); }
});
