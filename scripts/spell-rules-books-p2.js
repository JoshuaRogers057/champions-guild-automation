// Champions Guild Automation - priority-2 spells from Arcana Unleashed, Heroes of Faerûn and Forge of the Artificer:
// the parts their CGA spell items can't do alone. Keyed on the spell's identifier or name.
//  - Backlash: offered as a Reaction when you take damage (lowest 4th+ slot): damage -(level)d6 - mod, then the attacker
//    within 60 ft makes the CON save for (level)d6 Force.
//  - Alustriel's Mooncloak: Liberation (Reaction: a failed save against Frightened/Grappled/Restrained succeeds) and
//    Respite both end the spell.
//  - Enervation: you regain half the Necrotic damage it deals; a successful save against the cast ends the spell.
//  - Negative Energy Flood: an Undead target takes no damage and gains 3d10 Temporary Hit Points instead.
//  - Songal's Elemental Suffusion: asks for the Resistance element; Fly 30 ft (hover) and the Resistance last while you concentrate.
//  - Spirit Lantern: enemies dying within 60 ft of you add soul fragments (the spell's uses, up to your modifier).
//  - Waves of Exhaustion: a failed save adds an Exhaustion level (never above 4); they go away when the spell ends.
//  - Mordenkainen's Lucubration: asks which expended slots to recover.
//  - Spellfire Storm: a creature casting a spell inside it makes a CON save or the spell fails (slot refunded).
import { MODULE_ID, edgeDistance, askOwner, askChoice, reduceDamage } from "./main.js";
import { saveStatuses } from "./background-feats.js";
import { isMagicItem, say, tokenOf, isGM, chg, creatureType, canReact, useReaction } from "./item-rules.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const spellIs = (item, ident) => item?.type === "spell" && isMagicItem(item, ident);
const spellOf = (actor, ident) => actor?.items?.find((i) => spellIs(i, ident));
const tokenFor = (actor) => actor?.getActiveTokens?.(false, true)?.[0] ?? null;
const castLevel = (wf) => Number(wf?.castData?.castLevel ?? wf?.spellLevel ?? wf?.item?.system?.level) || 1;
// The concentration effect that belongs to a spell (by origin, item id or name).
function concentrationOn(actor, item) {
  if (!actor || !item) return null;
  return actor.effects.find((e) => e.statuses?.has("concentrating") && (e.origin === item.uuid || e.flags?.dnd5e?.item?.id === item.id || (e.name ?? "").includes(item.name))) ?? null;
}
async function endConcentration(actor, item) {
  const c = concentrationOn(actor, item);
  if (!c) return;
  try { await c.delete(); } catch (err) { await asGM("removeEffects", { actorUuid: actor.uuid, effects: [c.id] }); }
}
async function updateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return asGM("updateActor", { actorUuid: actor.uuid, updates });
}
async function heal(token, amount, type = "healing") {
  if (amount > 0) await MidiQOL.applyTokenDamage([{ value: amount, type }], amount, new Set([token.object ?? token]), null, new Set(), {});
}
// Self effect tied to the spell's concentration (Songal's).
async function concentrationBuff(actor, item, data) {
  const [fx] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  const c = concentrationOn(actor, item);
  if (fx && c?.addDependent) await c.addDependent(fx);
  return fx;
}

// ------------------------------------------------------------------ Damage application: Backlash, Negative Energy Flood
const SLOT_KEYS = [4, 5, 6, 7, 8, 9].map((l) => [`spell${l}`, l]);
function lowestSlot(actor, min = 4) {
  const s = actor.system.spells ?? {};
  const opts = SLOT_KEYS.filter(([k, l]) => l >= min && Number(s[k]?.value ?? 0) > 0).map(([k, l]) => ({ key: k, level: l }));
  if (Number(s.pact?.value ?? 0) > 0 && Number(s.pact?.level ?? 0) >= min) opts.push({ key: "pact", level: Number(s.pact.level) });
  return opts.sort((a, b) => a.level - b.level)[0] ?? null;
}
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem) return;
    const dealt = Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
    // Negative Energy Flood: Undead take nothing and gain 3d10 temp HP
    if (spellIs(workflow?.item, "negative-energy-flood") && /undead/.test(creatureType(actor))) {
      if (dealt > 0) reduceDamage(ditem, dealt);
      const r = await new Roll("3d10").evaluate();
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Negative Energy Flood: ${actor.name} (Undead) gains Temporary Hit Points` });
      setTimeout(() => { if (Number(actor.system.attributes.hp.temp ?? 0) < r.total) updateActor(actor, { "system.attributes.hp.temp": r.total }); }, 500);
      return;
    }
    // Backlash
    if (dealt <= 0 || workflow?.actor === actor) return;
    const spell = spellOf(actor, "backlash");
    const slot = spell && canReact(actor) ? lowestSlot(actor) : null;
    if (!slot) return;
    if (!(await askOwner(actor, `Backlash: ${actor.name}`, `<p>${actor.name} takes ${dealt} damage. Use your Reaction and a level ${slot.level} slot to reduce it by ${slot.level}d6 + your spellcasting modifier${workflow?.token ? ` and strike back at ${tokenOf(workflow.token).name}` : ""}?</p>`))) return;
    await updateActor(actor, { [`system.spells.${slot.key}.value`]: Number(actor.system.spells[slot.key].value) - 1, "flags.world.cgaSpellLevel.backlash": slot.level });
    await useReaction(actor);
    const mod = Number(spell.getRollData()?.mod ?? actor.system.attributes?.spell?.mod ?? 0);
    const r = await new Roll(`${slot.level}d6 + ${mod}`).evaluate();
    const cut = reduceDamage(ditem, r.total);
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Backlash: ${actor.name} takes ${cut} less damage` });
    const atk = tokenOf(workflow?.token);
    const me = tokenOf(token);
    if (!atk?.actor || edgeDistance(me, atk, me.parent) > 60) return;
    const act = spell.system.activities.find((a) => a.type === "save");
    if (!act || !spell.isOwner) { say(actor, `<strong>Backlash:</strong> ${atk.name} makes a CON save against your spell save DC: ${slot.level}d6 Force, half on a success (roll it from the spell).`); return; }
    setTimeout(() => MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [atk.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch((err) => console.warn(`${MODULE_ID} | Backlash strike failed`, err)), 400);
  } catch (err) { console.warn(`${MODULE_ID} | P2 spell damage rules failed`, err); }
});

// ------------------------------------------------------------------ Alustriel's Mooncloak, Liberation: succeed on a failed save, ending the spell
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size) return;
    const st = saveStatuses(workflow);
    if (!["frightened", "grappled", "restrained"].some((s) => st.has(s))) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const a = tokenOf(t)?.actor;
      const spell = spellOf(a, "alustriels-mooncloak");
      if (!spell || !concentrationOn(a, spell) || !canReact(a)) continue;
      if (!(await askOwner(a, `Liberation: ${a.name}`, `<p>${a.name} fails the save against ${workflow.item?.name}. Use your Reaction to succeed instead, ending Alustriel's Mooncloak?</p>`))) continue;
      await useReaction(a);
      workflow.failedSaves.delete(t); workflow.saves?.add?.(t);
      await endConcentration(a, spell);
      say(a, `<strong>Liberation:</strong> ${a.name} succeeds on the save; Alustriel's Mooncloak ends.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Liberation failed`, err); }
});

// ------------------------------------------------------------------ After a workflow
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item, aid = workflow?.activity?._id;
    if (!actor || item?.type !== "spell") return;
    // Mooncloak, Respite: ends the spell
    if (spellIs(item, "alustriels-mooncloak") && aid === "cgaMooncloakResp") { await endConcentration(actor, item); say(actor, "<strong>Respite:</strong> Alustriel's Mooncloak ends."); }
    // Enervation: heal half the Necrotic dealt; a successful save against the cast ends it
    if (spellIs(item, "enervation")) {
      const dealt = (workflow.damageList ?? []).reduce((s, d) => s + Math.max(0, Number(d.hpDamage ?? 0) + Number(d.tempDamage ?? 0)), 0);
      const me = tokenOf(workflow.token) ?? tokenFor(actor);
      if (dealt > 0 && me) await heal(me, Math.floor(dealt / 2));
      if (aid === "dnd5eactivity000" && workflow.saves?.size && !workflow.failedSaves?.size) { await endConcentration(actor, item); say(actor, "<strong>Enervation</strong> ends: the target succeeded on its save."); }
    }
    // Songal's Elemental Suffusion: choose the Resistance; Fly 30 ft hover while concentrating
    if (spellIs(item, "songals-elemental-suffusion") && aid === "dnd5eactivity000") {
      const ELEM = ["acid", "cold", "fire", "lightning", "thunder"];
      const pick = await askChoice(actor, `Elemental Immunity: ${actor.name}`, "<p>Choose the damage type you resist while the spell lasts.</p>",
        ELEM.map((e, i) => ({ action: e, label: CONFIG.DND5E.damageTypes[e]?.label ?? e, default: i === 0 })), 60) ?? "fire";
      const old = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.songal);
      if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id)).catch(() => {});
      await concentrationBuff(actor, item, { name: "Songal’s Elemental Suffusion", img: item.img, transfer: false, origin: item.uuid, duration: { seconds: 60 },
        system: { changes: [chg("system.attributes.movement.fly", "30", "upgrade"), chg("system.attributes.movement.hover", "true"), chg("system.traits.dr.value", pick, "add")] },
        flags: { [MODULE_ID]: { songal: true } } });
      say(actor, `<strong>Songal's Elemental Suffusion:</strong> ${actor.name} resists ${CONFIG.DND5E.damageTypes[pick]?.label ?? pick} damage and can fly 30 ft (hover).`);
    }
    // Spirit Lantern: the lantern starts empty
    if (spellIs(item, "spirit-lantern") && aid === "dnd5eactivity000") await item.update({ "system.uses.spent": Number(item.system.uses.max ?? 0) }).catch(() => {});
    // Waves of Exhaustion: +1 Exhaustion on a failed save (never above 4); the levels it gave are counted per caster
    // (flags.world.cgaWaves.<caster id>) and taken back when the caster's concentration on it ends.
    if (spellIs(item, "waves-of-exhaustion") && aid === "cgaWavesWaveAct0") {
      for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) {
        const a = t?.actor; if (!a) continue;
        const cur = Number(a.system.attributes?.exhaustion ?? 0);
        if (cur >= 4) continue;
        const given = Number(a.getFlag("world", `cgaWaves.${actor.id}`) ?? 0);
        await updateActor(a, { "system.attributes.exhaustion": cur + 1, [`flags.world.cgaWaves.${actor.id}`]: given + 1 });
        say(a, `<strong>Waves of Exhaustion:</strong> ${a.name} gains an Exhaustion level (${cur + 1}).`);
      }
    }
    // Mordenkainen's Lucubration: recover up to two expended slots
    if (spellIs(item, "mordenkainens-lucubration")) {
      const lvl = castLevel(workflow);
      const max = lvl >= 8 ? 4 : lvl >= 6 ? 3 : 2;
      const s = actor.system.spells;
      const rows = [1, 2, 3, 4].filter((l) => l <= max && Number(s[`spell${l}`]?.max ?? 0) > Number(s[`spell${l}`]?.value ?? 0));
      if (!rows.length) { say(actor, "<strong>Mordenkainen's Lucubration:</strong> no expended slots of a level it can recover."); return; }
      const opts = `<option value="">-</option>` + rows.map((l) => `<option value="${l}">Level ${l} (${Number(s[`spell${l}`].max) - Number(s[`spell${l}`].value)} expended)</option>`).join("");
      const res = await askChoice(actor, `Mordenkainen's Lucubration: ${actor.name}`, `<p>Recover up to two expended spell slots (level ${max} or lower).</p><div class="form-group"><label>First slot</label><select name="a">${opts}</select></div><div class="form-group"><label>Second slot</label><select name="b">${opts}</select></div>`,
        [{ action: "ok", label: "Recover", form: true, default: true }, { action: "none", label: "Cancel" }], 90);
      if (!res || typeof res !== "object") return;
      const upd = {};
      for (const l of [res.a, res.b].filter(Boolean).map(Number)) {
        const k = `system.spells.spell${l}.value`;
        const cur = upd[k] ?? Number(s[`spell${l}`].value);
        if (cur < Number(s[`spell${l}`].max)) upd[k] = cur + 1;
      }
      if (Object.keys(upd).length) { await updateActor(actor, upd); say(actor, `<strong>Mordenkainen's Lucubration:</strong> recovered ${[res.a, res.b].filter(Boolean).map((l) => `a level ${l}`).join(" and ")} slot.`); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 spell after-workflow rules failed`, err); }
});

// ------------------------------------------------------------------ Spirit Lantern: soul fragments
Hooks.on("updateActor", async (actor, changes) => {
  try {
    if (!isGM() || foundry.utils.getProperty(changes, "system.attributes.hp.value") === undefined || Number(actor.system.attributes.hp.value) > 0) return;
    const dead = tokenFor(actor);
    if (!dead) return;
    for (const t of dead.parent.tokens) {
      const c = t.actor;
      if (!c || c === actor || t.disposition === dead.disposition || !c.effects.some((e) => e.name === "Spirit Lantern" && !e.disabled)) continue;
      const spell = spellOf(c, "spirit-lantern");
      if (!spell || Number(spell.system.uses.spent ?? 0) <= 0 || edgeDistance(t, dead, t.parent) > 60) continue;
      await spell.update({ "system.uses.spent": Number(spell.system.uses.spent) - 1 });
      say(c, `<strong>Spirit Lantern:</strong> a fragment of ${dead.name}'s soul flies into the lantern (${spell.system.uses.value} held).`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Spirit Lantern failed`, err); }
});
Hooks.on("deleteActiveEffect", async (effect) => {
  try {
    if (effect.name !== "Spirit Lantern" || !(effect.parent instanceof Actor) || !effect.parent.isOwner) return;
    const spell = spellOf(effect.parent, "spirit-lantern");
    if (spell) await spell.update({ "system.uses.spent": Number(spell.system.uses.max ?? 0) });
  } catch (err) {}
});

// ------------------------------------------------------------------ Spellfire Storm: casting inside the Cylinder needs a CON save
// The spell's area is a Region named after the spell (dnd5e on Foundry v14) and a dependent of the caster's Concentration.
function stormsAt(tok) {
  const c = { x: tok.x + (tok.width * tok.parent.grid.size) / 2, y: tok.y + (tok.height * tok.parent.grid.size) / 2, elevation: tok.elevation ?? 0 };
  const out = [];
  for (const r of tok.parent.regions ?? []) {
    if (!/^Spellfire Storm/.test(r.name ?? "")) continue;
    let inside = false;
    try { inside = r.testPoint ? r.testPoint(c) : !!r.object?.testPoint?.(c); } catch (err) {}
    if (!inside) continue;
    const conc = (t) => t.actor?.effects?.filter((e) => e.statuses?.has("concentrating")) ?? [];
    const owner = tok.parent.tokens.find((t) => conc(t).some((e) => (e.getDependents?.() ?? []).includes(r)))
      ?? tok.parent.tokens.find((t) => conc(t).some((e) => /Spellfire Storm/.test(e.name ?? "")));
    out.push({ region: r, caster: owner?.actor ?? null, casterTok: owner ?? null });
  }
  return out;
}
Hooks.on("midi-qol.targetingComplete", async (workflow) => {
  try {
    const item = workflow?.item, actor = workflow?.actor;
    const tok = tokenOf(workflow?.token) ?? tokenFor(actor);
    if (item?.type !== "spell" || !actor || !tok || spellIs(item, "spellfire-storm")) return;
    for (const s of stormsAt(tok)) {
      if (s.caster === actor || (s.casterTok && s.casterTok.disposition === tok.disposition)) continue; // the caster's allies are unaffected
      const dc = Number(s.caster?.system?.attributes?.spell?.dc ?? spellOf(s.caster, "spellfire-storm")?.getRollData?.()?.attributes?.spell?.dc ?? 15);
      const res = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false }, { data: { flavor: `Spellfire Storm: CON save (DC ${dc}) to cast ${item.name}` } });
      const roll = Array.isArray(res) ? res[0] : res;
      if (roll && roll.total >= dc) continue;
      const level = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? item.system.level ?? 0);
      if (level >= 1) {
        const sp = actor.system.spells;
        const key = Number(sp[`spell${level}`]?.value ?? 0) < Number(sp[`spell${level}`]?.max ?? 0) ? `spell${level}` : (Number(sp.pact?.level) === level ? "pact" : null);
        if (key) setTimeout(() => updateActor(actor, { [`system.spells.${key}.value`]: Math.min(Number(actor.system.spells[key].max ?? 99), Number(actor.system.spells[key].value ?? 0) + 1) }), 800);
      }
      say(actor, `<strong>Spellfire Storm:</strong> ${actor.name}'s ${item.name} dissipates with no effect${level >= 1 ? " (the spell slot isn't expended)" : ""}.`);
      return false;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Spellfire Storm casting check failed`, err); }
});

// Waves of Exhaustion ends: remove the Exhaustion levels it gave.
Hooks.on("deleteActiveEffect", async (effect) => {
  try {
    if (!isGM() || !effect.statuses?.has("concentrating") || !/Waves of Exhaustion/.test(effect.name ?? "") || !(effect.parent instanceof Actor)) return;
    const caster = effect.parent;
    for (const t of canvas.scene?.tokens ?? []) {
      const a = t.actor;
      const given = Number(a?.getFlag("world", `cgaWaves.${caster.id}`) ?? 0);
      if (!given) continue;
      await a.update({ "system.attributes.exhaustion": Math.max(0, Number(a.system.attributes.exhaustion ?? 0) - given), [`flags.world.cgaWaves.-=${caster.id}`]: null });
      say(a, `<strong>Waves of Exhaustion</strong> ends: ${a.name} loses the ${given} Exhaustion level${given > 1 ? "s" : ""} it caused.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Waves of Exhaustion cleanup failed`, err); }
});
