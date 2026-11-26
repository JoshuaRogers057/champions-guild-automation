// Champions Guild Automation - rules for spells from Arcana Unleashed and Forgotten Realms: Heroes of Faerûn that the
// CGA spell items can't do on their own. Keyed on the spell's identifier or name.
//  - Wardaway: Constructs and Undead succeed on the save automatically.
//  - Death Armor: once per turn, a creature within 5 ft that hits the warded creature with a melee attack takes 2d4 Necrotic.
//  - Syluné's Viper: the spell ends when its Temporary Hit Points are gone.
//  - Cacophonic Shield: the caster gets Thunder Resistance and Disadvantage on ranged attacks against them while it lasts.
//  - Spellfire Flare: its attacks ignore Half and Three-Quarters Cover (midi-qol Spell Sniper cover rule, during its attacks only).
import { MODULE_ID, edgeDistance, turnKey } from "./main.js";
import { isMagicItem, say, tokenOf, isGM, chg, creatureType } from "./item-rules.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const spellIs = (item, ident) => item?.type === "spell" && isMagicItem(item, ident);

// ------------------------------------------------------------------ Wardaway: Constructs and Undead succeed
Hooks.on("midi-qol.preSavesComplete", (workflow) => {
  try {
    if (!spellIs(workflow?.item, "wardaway") || !workflow.failedSaves?.size) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const a = tokenOf(t)?.actor;
      if (!a || !/construct|undead/.test(creatureType(a))) continue;
      workflow.failedSaves.delete(t);
      workflow.saves?.add?.(t);
      say(a, `<strong>Wardaway:</strong> ${a.name} (${/undead/.test(creatureType(a)) ? "Undead" : "Construct"}) succeeds automatically.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Wardaway failed`, err); }
});

// ------------------------------------------------------------------ Death Armor: melee hitters within 5 ft take 2d4 Necrotic (once per turn)
const armorUsed = new Map(); // warded actor uuid -> turn key
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const atk = tokenOf(workflow?.token);
    const act = workflow?.activity;
    if (!atk?.actor || !act?.attack || !workflow.hitTargets?.size) return;
    if (!["mwak", "msak"].includes(act.actionType ?? workflow.item?.system?.actionType) && act.attack?.type?.value !== "melee") return;
    for (const t of Array.from(workflow.hitTargets).map(tokenOf)) {
      const def = t?.actor;
      if (!def || def === atk.actor || !def.effects.some((e) => /^Death Armor/.test(e.name) && !e.disabled)) continue;
      if (armorUsed.get(def.uuid) === turnKey() || edgeDistance(atk, t, t.parent) > 5) continue;
      armorUsed.set(def.uuid, turnKey());
      const r = await new Roll("2d4").evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: def }), flavor: `Death Armor: ${atk.name} takes Necrotic damage for striking ${t.name}` });
      await MidiQOL.applyTokenDamage([{ value: r.total, type: "necrotic" }], r.total, new Set([atk.object ?? atk]), null, new Set(), {});
    }
  } catch (err) { console.warn(`${MODULE_ID} | Death Armor failed`, err); }
});

// ------------------------------------------------------------------ Syluné's Viper: ends when the Temporary Hit Points are gone
Hooks.on("updateActor", async (actor, changes) => {
  try {
    if (!isGM() || foundry.utils.getProperty(changes, "system.attributes.hp.temp") === undefined) return;
    if (Number(actor.system.attributes.hp.temp ?? 0) > 0) return;
    const fx = actor.effects.filter((e) => /^Syl/.test(e.name) && /Viper/.test(e.name) && !/Poisoned/.test(e.name));
    if (!fx.length) return;
    await actor.deleteEmbeddedDocuments("ActiveEffect", fx.map((e) => e.id)).catch(() => {});
    say(actor, `<strong>Syluné's Viper</strong> fades: its Temporary Hit Points are gone.`);
  } catch (err) { console.warn(`${MODULE_ID} | Syluné's Viper failed`, err); }
});

// ------------------------------------------------------------------ Cacophonic Shield: the caster's own benefits, tied to the concentration
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor || !spellIs(workflow.item, "cacophonic-shield") || workflow.activity?._id !== "dnd5eactivity000") return;
    const old = actor.effects.filter((e) => e.flags?.[MODULE_ID]?.cacophonic);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id)).catch(() => {});
    const src = workflow.item.effects.find((e) => e.name === "Cacophonic Shield");
    const data = { name: "Cacophonic Shield", img: workflow.item.img, transfer: false, origin: workflow.item.uuid, duration: { seconds: 600 },
      system: { changes: (src?.system?.changes ?? src?.changes)?.map(({ key, value, type, priority }) => ({ key, value, type, priority, phase: "initial" })) ?? [chg("system.traits.dr.value", "thunder", "add"), chg("flags.midi-qol.grants.disadvantage.attack.rwak", "1"), chg("flags.midi-qol.grants.disadvantage.attack.rsak", "1")] },
      flags: { [MODULE_ID]: { cacophonic: true } } };
    const [fx] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    const conc = actor.effects.find((e) => e.statuses?.has("concentrating") && (e.origin === workflow.item.uuid || (e.flags?.dnd5e?.item?.id ?? "") === workflow.item.id))
      ?? actor.effects.find((e) => e.statuses?.has("concentrating"));
    if (fx && conc?.addDependent) await conc.addDependent(fx);
  } catch (err) { console.warn(`${MODULE_ID} | Cacophonic Shield failed`, err); }
});

// ------------------------------------------------------------------ Spellfire Flare: ignore Half and Three-Quarters Cover
// midi-qol drops Half/Three-Quarters Cover for ranged spell attacks when flags.dnd5e.spellSniper is set (dnd5e stores it as
// true/false, so no condition is possible). The flag is switched on only for the spell's own attack workflows - after the
// range check - and off again when each one ends. Skipped when the caster already has Spell Sniper.
Hooks.on("midi-qol.preWaitForAttackRoll", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor || !spellIs(workflow.item, "spellfire-flare") || !workflow.activity?.attack || actor.flags?.dnd5e?.spellSniper) return;
    await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Spellfire Flare (ignores cover)", img: workflow.item.img, transfer: false,
      system: { changes: [chg("flags.dnd5e.spellSniper", "true")] }, flags: { [MODULE_ID]: { flareCover: true } } }]);
  } catch (err) { console.warn(`${MODULE_ID} | Spellfire Flare cover failed`, err); }
});
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  const fx = workflow?.actor?.effects?.filter((e) => e.flags?.[MODULE_ID]?.flareCover) ?? [];
  if (fx.length) await workflow.actor.deleteEmbeddedDocuments("ActiveEffect", fx.map((e) => e.id)).catch(() => {});
});

// ------------------------------------------------------------------ Cast level for activities used later (Conjure Constructs, Syluné's Viper)
// Their Magic-action activities scale with the slot the spell was cast with, which @item.level no longer knows; the cast
// level is kept on the caster (flags.world.cgaSpellLevel.<key>) and the activities' formulas read it.
const LEVEL_KEYS = { "conjure-constructs": "conjureConstructs", "sylunes-viper": "sylunesViper" };
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const item = workflow?.item;
    const key = item?.type === "spell" && Object.entries(LEVEL_KEYS).find(([ident]) => isMagicItem(item, ident))?.[1];
    if (!key || workflow.activity?.consumption?.spellSlot === false) return;
    const level = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? item.system.level) || item.system.level;
    await workflow.actor.update({ [`flags.world.cgaSpellLevel.${key}`]: level }).catch(() => asGM("updateActor", { actorUuid: workflow.actor.uuid, updates: { [`flags.world.cgaSpellLevel.${key}`]: level } }));
  } catch (err) { console.warn(`${MODULE_ID} | spell cast level failed`, err); }
});
