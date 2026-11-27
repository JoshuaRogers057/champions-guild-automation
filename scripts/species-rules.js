// Champions Guild Automation - species trait rules (2024 Player's Handbook and other books).
// They find the trait on the character by identifier or name, so they work on D&D Beyond, compendium or CGA traits
// with no Mass Apply.
//  - Save Advantage against a condition: Brave (Frightened), Fey Ancestry (Charmed), Dwarven Resilience and Construct
//    Resilience (Poisoned, plus Poison Resistance). Dual Mind (Advantage on WIS and CHA saves).
//  - Goliath Giant Ancestry: Fire's Burn (+1d10 Fire), Frost's Chill (+1d6 Cold, -10 ft Speed) and Hill's Tumble
//    (Prone) offered after a hit; Stone's Endurance (Reaction, damage -1d12 + CON) and Storm's Thunder (Reaction,
//    1d8 Thunder to the attacker within 60 ft) when damaged. Each spends a use of the trait.
//  - Relentless Endurance: offered when you'd drop to 0 HP (not killed outright) - you drop to 1 instead (1/LR).
//  - Celestial Revelation: once on each of your turns while transformed, +PB damage (Necrotic for Necrotic Shroud,
//    Radiant otherwise) to a target you damage; Inner Radiance burns creatures within 10 ft at the end of your turn;
//    Heavenly Wings gives a Fly Speed equal to your Speed; Necrotic Shroud's save frightens enemies within 10 ft.
//  - Vampiric Bite: after a bite hits a creature that isn't a Construct or Undead, choose Drain or Strengthen (PB/LR).
//  - Breath Weapon: the damage type follows your Draconic Ancestry. Integrated Protection: +1 AC if the trait has no AC effect.
//  - P2: Shifter options while shifted (Beasthide, Swiftstride, Wildhunt), Knowledge from a Past Life (+1d6 to a failed
//    check), Resourceful (Heroic Inspiration on a Long Rest), Escaped Death, Draconic Flight's Fly Speed.
//  - P3: Lethargy Resilience, Feral Pounce (Slashing Unarmed Strikes + once-per-turn Shove), Cold Fire Magic (Cold Flame Blade).
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey, reduceDamage } from "./main.js";
import { isMagicItem, creatureType, spendUse, canReact, useReaction, say, chg, tokenOf, isGM, ON_HIT, PASSIVES } from "./item-rules.js";

const trait = (actor, ident) => actor?.items?.find((i) => i.type === "feat" && isMagicItem(i, ident));
const usesLeft = (item) => (item?.system?.uses?.max ? Number(item.system.uses.value ?? 0) : Infinity);
const prof = (actor) => Number(actor?.system?.attributes?.prof ?? 2);
const hasType = (actor, t) => new RegExp(`\\b${t}`).test(creatureType(actor));
const hits = (wf) => Array.from(wf?.hitTargets ?? []).map(tokenOf).filter((t) => t?.actor);
async function addEffect(actor, effect) {
  return MidiQOL.socket().executeAsGM("createEffects", { actorUuid: actor.uuid, effects: [effect] }).catch((err) => console.warn(`${MODULE_ID} | effect failed`, err));
}
async function gmUpdateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return MidiQOL.socket().executeAsGM("updateActor", { actorUuid: actor.uuid, updates }).catch(() => {});
}

// ------------------------------------------------------------------ Advantage on saves against a condition
const CONDITION_SAVES = [
  { ident: "brave", statuses: ["frightened"], label: "Brave" },
  { ident: "fey-ancestry", statuses: ["charmed"], label: "Fey Ancestry" },
  { ident: "dwarven-resilience", statuses: ["poisoned"], label: "Dwarven Resilience" },
  { ident: "construct-resilience", statuses: ["poisoned"], label: "Construct Resilience" }
];
// The conditions a workflow would apply: its activity's effects (statuses, or the condition's name).
function workflowStatuses(workflow) {
  const out = new Set();
  for (const ref of workflow?.activity?.effects ?? []) {
    const e = ref.effect ?? workflow.item?.effects?.get?.(ref._id);
    for (const s of e?.statuses ?? []) out.add(s);
    for (const s of ["frightened", "charmed", "poisoned"]) if (new RegExp(s, "i").test(e?.name ?? "")) out.add(s);
    for (const c of e?.system?.changes ?? e?.changes ?? []) if (/StatusEffect|macro\.CE/i.test(c.key)) out.add(String(c.value).toLowerCase());
  }
  return out;
}
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const statuses = workflowStatuses(workflow);
    if (!statuses.size) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      const a = t?.actor;
      const rule = a && CONDITION_SAVES.find((r) => trait(a, r.ident) && r.statuses.some((s) => statuses.has(s)));
      if (!rule) continue;
      await addEffect(a, { name: `${rule.label} (Advantage)`, img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp", transfer: false,
        system: { changes: [chg("flags.midi-qol.advantage.save.all", "1")] }, flags: { dae: { specialDuration: ["isSave"] }, [MODULE_ID]: { conditionSave: true } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | condition save advantage failed`, err); }
});
PASSIVES.push(
  { key: "poison-resilience", active: (a) => !!(trait(a, "dwarven-resilience") || trait(a, "construct-resilience")),
    effect: { name: "Poison Resilience", img: "icons/magic/acid/dissolve-bone-white.webp", changes: [chg("system.traits.dr.value", "poison", "add")] } },
  { key: "dual-mind", active: (a) => !!trait(a, "dual-mind"),
    effect: { name: "Dual Mind", img: "icons/magic/perception/third-eye-blue-red.webp", changes: [chg("flags.midi-qol.advantage.save.wis", "1"), chg("flags.midi-qol.advantage.save.cha", "1")] } },
  // Celestial Revelation, Heavenly Wings: a Fly Speed equal to your Speed while transformed.
  { key: "heavenly-wings", active: (a) => a.effects.some((e) => /heavenly wings/i.test(e.name) && !e.disabled && !e.flags?.[MODULE_ID]?.passive),
    effect: (a) => ({ name: "Heavenly Wings: Fly Speed", img: "icons/creatures/abilities/wings-birdlike-blue.webp",
      changes: [chg("system.attributes.movement.fly", String(Number(a.system.attributes.movement?.walk ?? 30) || 30), "upgrade")] }) }
);

// ------------------------------------------------------------------ Goliath: boons after a hit
ON_HIT.push(
  { label: "Fire's Burn", match: (wf) => !!trait(wf.actor, "fires-burn"), bonus: async (wf) => {
      const it = trait(wf.actor, "fires-burn");
      if (usesLeft(it) <= 0 || !(await askOwner(wf.actor, `Fire's Burn: ${wf.actor.name}`, `<p>Hit! Spend a use of Fire's Burn (${usesLeft(it) === Infinity ? "" : usesLeft(it) + " left"}) to deal an extra 1d10 Fire damage?</p>`))) return null;
      await spendUse(it);
      return [{ formula: "1d10", type: "fire" }];
    } },
  { label: "Frost's Chill", match: (wf) => !!trait(wf.actor, "frosts-chill"), bonus: async (wf) => {
      const it = trait(wf.actor, "frosts-chill");
      if (usesLeft(it) <= 0 || !(await askOwner(wf.actor, `Frost's Chill: ${wf.actor.name}`, `<p>Hit! Spend a use of Frost's Chill (${usesLeft(it) === Infinity ? "" : usesLeft(it) + " left"}) for an extra 1d6 Cold damage and -10 ft Speed until the start of your next turn?</p>`))) return null;
      await spendUse(it);
      wf.cgaFrostsChill = true;
      return [{ formula: "1d6", type: "cold" }];
    } }
);
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor || !workflow.activity?.attack) return;
    const targets = hits(workflow);
    if (workflow.cgaFrostsChill) for (const t of targets) {
      await addEffect(t.actor, { name: "Frost's Chill", img: "icons/magic/water/snowflake-ice-blue.webp", transfer: false, duration: { rounds: 1 },
        system: { changes: ["walk", "fly", "swim", "climb", "burrow"].map((m) => chg(`system.attributes.movement.${m}`, "-10", "add")) },
        flags: { dae: { specialDuration: ["turnStartSource"] } } });
    }
    const hill = trait(actor, "hills-tumble");
    const t = targets[0];
    if (hill && t && usesLeft(hill) > 0 && SIZES.indexOf(t.actor.system.traits?.size ?? "med") <= SIZES.indexOf("lg") && !t.actor.statuses.has("prone")
      && await askOwner(actor, `Hill's Tumble: ${actor.name}`, `<p>Hit! Spend a use of Hill's Tumble to knock ${t.name} Prone?</p>`)) {
      await spendUse(hill);
      await addEffect(t.actor, { name: "Prone (Hill's Tumble)", img: "systems/dnd5e/icons/svg/statuses/prone.svg", statuses: ["prone"], transfer: false });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Goliath hit boons failed`, err); }
});

// ------------------------------------------------------------------ Damage taken: Stone's Endurance, Relentless Endurance
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
    const dealt = () => Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
    const stone = trait(actor, "stones-endurance");
    if (stone && usesLeft(stone) > 0 && canReact(actor)) {
      const con = Number(actor.system.abilities.con?.mod ?? 0);
      if (await askOwner(actor, `Stone's Endurance: ${actor.name}`, `<p>${actor.name} takes ${dealt()} damage. Use your Reaction (and a use) to reduce it by 1d12 + ${con}?</p>`)) {
        await spendUse(stone); await useReaction(actor);
        const roll = await new Roll(`1d12 + ${con}`).evaluate();
        const cut = reduceDamage(ditem, Math.max(0, roll.total));
        roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Stone's Endurance: ${actor.name} reduces the damage by ${cut}` });
      }
    }
    // Relentless Endurance: drop to 1 HP instead of 0 unless the damage would kill outright (leftover >= HP maximum).
    const rel = trait(actor, "relentless-endurance");
    const oldHP = Number(ditem.oldHP ?? actor.system.attributes.hp.value ?? 0);
    if (rel && relentlessLeft(actor, rel) > 0 && oldHP > 0 && (ditem.newHP ?? 1) <= 0) {
      // midi caps hpDamage at the HP you have, but applies the damage-detail values: work from their total.
      const total = (ditem.damageDetail ?? []).filter((x) => !["temphp", "healing"].includes(x.type) && (x.value ?? 0) > 0).reduce((s, x) => s + x.value, 0) || (ditem.hpDamage ?? 0);
      const oldTemp = Number(ditem.oldTempHP ?? actor.system.attributes.hp.temp ?? 0);
      const leftover = total - oldTemp - oldHP;
      if (leftover < Number(actor.system.attributes.hp.max ?? 0)
        && await askOwner(actor, `Relentless Endurance: ${actor.name}`, `<p>${actor.name} would drop to 0 Hit Points. Use Relentless Endurance to drop to 1 instead (once per Long Rest)?</p>`)) {
        if (rel.system.uses?.max) await spendUse(rel);
        else await gmUpdateActor(actor, { [`flags.${MODULE_ID}.relentlessUsed`]: true });
        const cut = total - (oldTemp + oldHP - 1);
        reduceDamage(ditem, cut);
        ditem.hpDamage = oldHP - 1; ditem.newHP = 1; ditem.tempDamage = oldTemp; ditem.newTempHP = 0;
        say(actor, `<strong>Relentless Endurance:</strong> ${actor.name} drops to 1 Hit Point instead.`);
      }
      relentlessAsked.set(actor.uuid, Date.now());
    }
  } catch (err) { console.warn(`${MODULE_ID} | species damage rules failed`, err); }
});

// Relentless Endurance when Hit Points reach 0 some other way (damage applied from a chat card or the token, or typed
// on the sheet): offer to go back up to 1. A trait with no uses counts as once per Long Rest, tracked with a flag.
const relentlessAsked = new Map(); // actor uuid -> time the damage hook already handled it
const relentlessLeft = (actor, rel) => (rel.system.uses?.max ? usesLeft(rel) : (actor.getFlag(MODULE_ID, "relentlessUsed") ? 0 : 1));
Hooks.on("preUpdateActor", (actor, changes, options) => {
  if (foundry.utils.getProperty(changes, "system.attributes.hp.value") !== undefined) options.cgaHpBefore = Number(actor.system.attributes.hp.value ?? 0);
});
Hooks.on("updateActor", async (actor, changes, options, userId) => {
  try {
    const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if (hp === undefined || Number(hp) > 0 || userId !== game.user.id) return;
    const before = Number(options?.cgaHpBefore ?? 0);
    if (before <= 0 || Date.now() - (relentlessAsked.get(actor.uuid) ?? 0) < 5000) return;
    const rel = trait(actor, "relentless-endurance");
    if (!rel || relentlessLeft(actor, rel) <= 0) return;
    relentlessAsked.set(actor.uuid, Date.now());
    if (!(await askOwner(actor, `Relentless Endurance: ${actor.name}`, `<p>${actor.name} dropped to 0 Hit Points. Use Relentless Endurance to drop to 1 instead (once per Long Rest)? Say no if the damage would have killed outright.</p>`))) return;
    if (rel.system.uses?.max) await spendUse(rel);
    else await gmUpdateActor(actor, { [`flags.${MODULE_ID}.relentlessUsed`]: true });
    await gmUpdateActor(actor, { "system.attributes.hp.value": 1, "system.attributes.death.success": 0, "system.attributes.death.failure": 0 });
    for (const e of actor.effects.filter((x) => x.statuses?.has("unconscious") || x.statuses?.has("dead"))) await e.delete().catch(() => {});
    say(actor, `<strong>Relentless Endurance:</strong> ${actor.name} drops to 1 Hit Point instead.`);
  } catch (err) { console.warn(`${MODULE_ID} | Relentless Endurance (HP update) failed`, err); }
});
Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
  if (config?.type === "long" && actor?.getFlag?.(MODULE_ID, "relentlessUsed")) actor.unsetFlag(MODULE_ID, "relentlessUsed").catch(() => {});
});

// ------------------------------------------------------------------ Storm's Thunder: Reaction against the creature that damaged you
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const atkTok = tokenOf(workflow?.token);
    if (!atkTok?.actor) return;
    for (const d of workflow.damageList ?? []) {
      if (!((d.hpDamage ?? 0) + (d.tempDamage ?? 0) > 0)) continue;
      const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "");
      const tok = found instanceof Actor ? found.getActiveTokens?.()[0]?.document : (found?.document ?? found);
      const actor = tok?.actor;
      if (!actor || actor === atkTok.actor || Number(actor.system.attributes.hp.value ?? 0) <= 0) continue;
      const storm = trait(actor, "storms-thunder");
      if (!storm || usesLeft(storm) <= 0 || !canReact(actor) || edgeDistance(tok, atkTok, tok.parent) > 60) continue;
      if (!(await askOwner(actor, `Storm's Thunder: ${actor.name}`, `<p>${atkTok.name} damaged ${actor.name}. Use your Reaction (and a use) to deal 1d8 Thunder damage to it?</p>`))) continue;
      await spendUse(storm); await useReaction(actor);
      const roll = await new CONFIG.Dice.DamageRoll("1d8", {}, { type: "thunder", types: ["thunder"] }).evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Storm's Thunder against ${atkTok.name} (Thunder)` });
      await MidiQOL.applyTokenDamage([{ value: roll.total, type: "thunder" }], roll.total, new Set([atkTok.object ?? atkTok]), null, new Set(), {});
    }
  } catch (err) { console.warn(`${MODULE_ID} | Storm's Thunder failed`, err); }
});

// ------------------------------------------------------------------ Celestial Revelation
const revelation = (a) => a?.effects?.find((e) => /heavenly wings|inner radiance|necrotic shroud/i.test(e.name) && !e.disabled && !e.flags?.[MODULE_ID]?.passive && !e.flags?.[MODULE_ID]?.shroudSave);
const revelationUsed = new Map(); // actor uuid -> turn key
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    const form = revelation(actor);
    if (!form || !(workflow.damageRolls?.length)) return;
    if (!(workflow.activity?.attack || workflow.item?.type === "spell")) return;
    if (game.combat?.started && game.combat.combatant?.actor !== actor) return; // "once on each of your turns"
    const key = turnKey();
    if (revelationUsed.get(actor.uuid) === key) return;
    const targets = workflow.activity?.attack ? hits(workflow) : Array.from(workflow.targets ?? []).map(tokenOf);
    if (!targets.length) return;
    revelationUsed.set(actor.uuid, key);
    const type = /necrotic/i.test(form.name) ? "necrotic" : "radiant";
    const roll = await new CONFIG.Dice.DamageRoll(String(prof(actor)), {}, { type, types: [type], flavor: `Celestial Revelation (${type})`, isCritical: false }).evaluate();
    await workflow.setBonusDamageRolls([...(workflow.bonusDamageRolls ?? []), roll]);
  } catch (err) { console.warn(`${MODULE_ID} | Celestial Revelation damage failed`, err); }
});
// Inner Radiance: at the end of each of your turns, each creature within 10 ft takes Radiant damage equal to your PB.
Hooks.on("updateCombat", async (combat, changed) => {
  try {
    if (!isGM() || !("turn" in changed || "round" in changed) || !combat.started) return;
    const prev = combat.combatants.get(combat.previous?.combatantId);
    const actor = prev?.actor, tok = prev?.token;
    if (!actor || !tok || !actor.effects.some((e) => /inner radiance/i.test(e.name) && !e.disabled)) return;
    const near = tok.parent.tokens.filter((t) => t !== tok && t.actor && Number(t.actor.system.attributes.hp.value ?? 0) > 0 && edgeDistance(tok, t, tok.parent) <= 10);
    if (!near.length) return;
    const pb = prof(actor);
    await MidiQOL.applyTokenDamage([{ value: pb, type: "radiant" }], pb, new Set(near.map((t) => t.object ?? t)), null, new Set(), {});
    say(actor, `<strong>Inner Radiance:</strong> ${near.map((t) => t.name).join(", ")} take${near.length === 1 ? "s" : ""} ${pb} Radiant damage.`);
  } catch (err) { console.warn(`${MODULE_ID} | Inner Radiance failed`, err); }
});

// ------------------------------------------------------------------ Vampiric Bite: Drain or Strengthen
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !isMagicItem(item, "vampiric-bite") || !workflow.activity?.attack) return;
    const t = hits(workflow)[0];
    if (!t || hasType(t.actor, "construct") || hasType(t.actor, "undead") || usesLeft(item) <= 0) return;
    const d = (workflow.damageList ?? []).find((x) => (x.targetUuid ?? "") === t.uuid || x.actorUuid === t.actor.uuid);
    const dmg = Math.max(0, (d?.hpDamage ?? 0) + (d?.tempDamage ?? 0)) || Number(workflow.damageTotal ?? 0);
    if (dmg <= 0) return;
    const pick = await askChoice(actor, `Vampiric Bite: ${actor.name}`, `<p>The bite deals ${dmg} Piercing damage. Empower yourself (${usesLeft(item) === Infinity ? "" : usesLeft(item) + " uses left"})?</p>`,
      [{ action: "drain", label: `Drain (regain ${dmg} HP)`, default: true }, { action: "strengthen", label: `Strengthen (+${dmg} to your next check or attack)` }, { action: "none", label: "No" }]);
    if (pick === "drain") {
      await spendUse(item);
      const hp = actor.system.attributes.hp;
      await gmUpdateActor(actor, { "system.attributes.hp.value": Math.min(Number(hp.effectiveMax ?? hp.max), Number(hp.value) + dmg) });
      say(actor, `<strong>Vampiric Bite:</strong> ${actor.name} drains ${dmg} Hit Points.`);
    } else if (pick === "strengthen") {
      await spendUse(item);
      await addEffect(actor, { name: `Vampiric Bite: Strengthen (+${dmg})`, img: item.img, transfer: false, duration: { seconds: 60 },
        system: { changes: ["mwak", "rwak", "msak", "rsak"].map((k) => chg(`system.bonuses.${k}.attack`, `+${dmg}`, "add")).concat(chg("system.bonuses.abilities.check", `+${dmg}`, "add")) },
        flags: { dae: { specialDuration: ["1Attack", "isCheck", "isSkill"] } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Vampiric Bite failed`, err); }
});

// ------------------------------------------------------------------ Necrotic Shroud: the self effect after its save activity
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    if (!isMagicItem(workflow?.item, "celestial-revelation") || !/necrotic shroud/i.test(workflow.activity?.name ?? "")) return;
    const actor = workflow.actor;
    if (actor.effects.some((e) => /necrotic shroud/i.test(e.name) && !e.flags?.[MODULE_ID]?.shroudSave)) return;
    await addEffect(actor, { name: "Necrotic Shroud", img: workflow.item.img, transfer: false, duration: { seconds: 60 }, origin: workflow.item.uuid,
      description: "<p>Celestial Revelation: Necrotic Shroud (+PB Necrotic damage once per turn).</p>" });
  } catch (err) { console.warn(`${MODULE_ID} | Necrotic Shroud failed`, err); }
});

// ------------------------------------------------------------------ Breath Weapon: the damage type follows the Draconic Ancestry
const ANCESTRY = { black: "acid", blue: "lightning", brass: "fire", bronze: "lightning", copper: "acid", gold: "fire", green: "poison", red: "fire", silver: "cold", white: "cold" };
const BREATH_TYPES = ["acid", "cold", "fire", "lightning", "poison"];
function ancestryType(actor) {
  for (const i of actor.items) {
    const m = /\b(black|blue|brass|bronze|copper|gold|green|red|silver|white)\b/i.exec(`${i.name} ${i.system?.identifier ?? ""}`);
    if (m && /draconic|ancestry|dragonborn|breath/i.test(`${i.name} ${i.system?.identifier ?? ""}`)) return ANCESTRY[m[1].toLowerCase()];
  }
  const dr = BREATH_TYPES.filter((t) => actor.system.traits?.dr?.value?.has?.(t));
  return dr.length === 1 ? dr[0] : null;
}
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    if (!isMagicItem(workflow?.item, "breath-weapon") || !workflow.damageRolls?.length) return;
    const type = ancestryType(workflow.actor);
    if (!type) return;
    let changed = false;
    for (const r of workflow.damageRolls) if (BREATH_TYPES.includes(r.options?.type) && r.options.type !== type) { r.options.type = type; r.options.types = [type]; changed = true; }
    if (changed) await workflow.setDamageRolls(workflow.damageRolls);
  } catch (err) { console.warn(`${MODULE_ID} | Breath Weapon type failed`, err); }
});

// ------------------------------------------------------------------ Warforged Integrated Protection: +1 AC (unless the trait already has its own AC effect)
PASSIVES.push({ key: "integrated-protection",
  active: (a) => { const t = trait(a, "integrated-protection"); return !!t && !t.effects.some((e) => !e.disabled && (e.system?.changes ?? e.changes ?? []).some((c) => /attributes\.ac/.test(c.key))); },
  effect: { name: "Integrated Protection", img: "icons/equipment/chest/breastplate-banded-steel-gold.webp", changes: [chg("system.attributes.ac.bonus", "+1", "add")] } });

// ================================================================== Priority 2
// ------------------------------------------------------------------ Shifter options while shifted
// When a "Shifted" effect starts, the module adds the option's benefit for the same time (and removes it with it).
const SHIFT_OPTIONS = [
  { ident: "beasthide", effect: (a) => ({ name: "Beasthide", changes: [chg("system.attributes.ac.bonus", "+1", "add")] }), onShift: async (a) => {
      const r = await new Roll("1d6").evaluate();
      await gmUpdateActor(a, { "system.attributes.hp.temp": Number(a.system.attributes.hp.temp ?? 0) + r.total });
      r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: a }), flavor: "Beasthide: extra Temporary Hit Points" });
    } },
  { ident: "swiftstride", effect: () => ({ name: "Swiftstride", changes: [chg("system.attributes.movement.walk", "10", "add")] }) },
  { ident: "wildhunt", effect: () => ({ name: "Wildhunt", changes: [chg("flags.midi-qol.advantage.check.wis", "1"), chg("flags.midi-qol.grants.noAdvantage.attack.all", "1")] }) },
  { ident: "longtooth", effect: () => ({ name: "Longtooth", changes: [] }) }
];
const isShifted = (e) => /^shifted/i.test(e.name ?? "") && !e.flags?.[MODULE_ID]?.shiftOption;
Hooks.on("createActiveEffect", async (e) => {
  try {
    if (!isGM() || !(e.parent instanceof Actor) || !isShifted(e)) return;
    const a = e.parent;
    for (const o of SHIFT_OPTIONS) {
      if (!trait(a, o.ident)) continue;
      const d = o.effect(a);
      await a.createEmbeddedDocuments("ActiveEffect", [{ name: `${d.name} (shifted)`, img: e.img, transfer: false, duration: foundry.utils.deepClone(e.duration ?? {}),
        system: { changes: d.changes }, flags: { [MODULE_ID]: { shiftOption: e.id } } }]);
      await o.onShift?.(a);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Shifter options failed`, err); }
});
Hooks.on("deleteActiveEffect", async (e) => {
  try {
    if (!isGM() || !(e.parent instanceof Actor) || !isShifted(e)) return;
    const ids = e.parent.effects.filter((x) => x.flags?.[MODULE_ID]?.shiftOption === e.id).map((x) => x.id);
    if (ids.length) await e.parent.deleteEmbeddedDocuments("ActiveEffect", ids);
  } catch (err) { console.warn(`${MODULE_ID} | Shifter option cleanup failed`, err); }
});

// ------------------------------------------------------------------ Knowledge from a Past Life: +1d6 to a failed ability check (PB/LR)
// The check is already on the card, so the module posts the new total after it (only when the check had a DC).
const pastLifeSeen = new WeakSet();
async function pastLife(rolls, data) {
  try {
    const actor = data?.subject;
    const roll = rolls?.[0];
    if (!actor || !roll || pastLifeSeen.has(roll)) return;
    pastLifeSeen.add(roll);
    const it = trait(actor, "knowledge-from-a-past-life");
    const dc = Number(roll.options?.target);
    if (!it || !dc || roll.total >= dc || usesLeft(it) <= 0 || roll.total + 6 < dc) return;
    if (!(await askOwner(actor, `Knowledge from a Past Life: ${actor.name}`, `<p>The check (${roll.total}) fails against DC ${dc}. Spend a use (${usesLeft(it) === Infinity ? "" : usesLeft(it) + " left"}) to add 1d6?</p>`))) return;
    await spendUse(it);
    const d6 = await new Roll("1d6").evaluate();
    const total = roll.total + d6.total;
    await d6.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Knowledge from a Past Life: ${roll.total} + ${d6.total} = ${total} vs DC ${dc} - ${total >= dc ? "success" : "still a failure"}` });
  } catch (err) { console.warn(`${MODULE_ID} | Knowledge from a Past Life failed`, err); }
}
for (const h of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"]) Hooks.on(h, (rolls, data) => { if (/save/i.test(rolls?.[0]?.options?.rollType ?? "")) return; pastLife(rolls, data); });

// ------------------------------------------------------------------ Resourceful: Heroic Inspiration when you finish a Long Rest
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!(config?.type === "long" || result?.longRest) || !actor.isOwner || !trait(actor, "resourceful") || actor.system.attributes.inspiration) return;
    await actor.update({ "system.attributes.inspiration": true });
    say(actor, `<strong>Resourceful:</strong> ${actor.name} gains Heroic Inspiration.`);
  } catch (err) { console.warn(`${MODULE_ID} | Resourceful failed`, err); }
});

// ------------------------------------------------------------------ Passives
PASSIVES.push(
  // Reborn, Escaped Death: Advantage on Death Saving Throws.
  { key: "escaped-death", active: (a) => !!trait(a, "escaped-death"),
    effect: { name: "Escaped Death", img: "icons/magic/death/skull-energy-light-white.webp", changes: [chg("system.attributes.death.roll.mode", "1", "upgrade")] } },
  // Dragonborn, Draconic Flight: the compendium effect has no Fly Speed - a Fly Speed equal to your Speed while it lasts.
  { key: "draconic-flight", active: (a) => a.effects.some((e) => /draconic flight/i.test(e.name) && !e.disabled && !e.flags?.[MODULE_ID]?.passive),
    effect: (a) => ({ name: "Draconic Flight: Fly Speed", img: "icons/creatures/abilities/wing-batlike-red-pink.webp",
      changes: [chg("system.attributes.movement.fly", String(Number(a.system.attributes.movement?.walk ?? 30) || 30), "upgrade")] }) }
);

// ================================================================== Priority 3
// ------------------------------------------------------------------ Khoravar Lethargy Resilience: a failed save vs Unconscious succeeds
// Once used, it's back after 1d4 Long Rests (counted down on each Long Rest).
const LETHARGY_FLAG = "cgaLethargyRests";
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size || !workflowStatuses(workflow).has("unconscious")) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const actor = tokenOf(t)?.actor;
      const it = actor && trait(actor, "lethargy-resilience");
      if (!it || Number(it.getFlag("world", LETHARGY_FLAG) ?? 0) > 0) continue;
      if (!(await askOwner(actor, `Lethargy Resilience: ${actor.name}`, `<p>${actor.name} fails a save against falling Unconscious. Use Lethargy Resilience to succeed instead (back after 1d4 Long Rests)?</p>`))) continue;
      const r = await new Roll("1d4").evaluate();
      await it.setFlag("world", LETHARGY_FLAG, r.total).catch(() => MidiQOL.socket().executeAsGM("updateItems", { actorUuid: actor.uuid, updates: [{ _id: it.id, [`flags.world.${LETHARGY_FLAG}`]: r.total }] }));
      workflow.failedSaves.delete(t);
      workflow.saves?.add?.(t);
      say(actor, `<strong>Lethargy Resilience:</strong> ${actor.name} succeeds instead (usable again after ${r.total} Long Rest${r.total > 1 ? "s" : ""}).`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Lethargy Resilience failed`, err); }
});
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!(config?.type === "long" || result?.longRest) || !actor.isOwner) return;
    const it = trait(actor, "lethargy-resilience");
    const n = Number(it?.getFlag("world", LETHARGY_FLAG) ?? 0);
    if (n > 0) await it.setFlag("world", LETHARGY_FLAG, n - 1);
  } catch (err) {}
});

// ------------------------------------------------------------------ Lupin Feral Pounce: Slashing Unarmed Strikes; once per turn, Damage and Shove
const isUnarmed = (item) => item?.system?.identifier === "unarmed-strike" || /unarmed strike/i.test(item?.name ?? "");
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    if (!isUnarmed(workflow?.item) || !trait(workflow.actor, "feral-pounce") || !workflow.damageRolls?.length) return;
    let changed = false;
    for (const r of workflow.damageRolls) if (r.options?.type === "bludgeoning") { r.options.type = "slashing"; r.options.types = ["slashing"]; changed = true; }
    if (changed) await workflow.setDamageRolls(workflow.damageRolls);
  } catch (err) { console.warn(`${MODULE_ID} | Feral Pounce damage type failed`, err); }
});
const pounceUsed = new Map(); // actor uuid -> turn key
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!isUnarmed(workflow?.item) || !trait(actor, "feral-pounce")) return;
    const t = hits(workflow)[0];
    if (!t || (game.combat?.started && game.combat.combatant?.actor !== actor) || pounceUsed.get(actor.uuid) === turnKey()) return;
    if (SIZES.indexOf(t.actor.system.traits?.size ?? "med") > SIZES.indexOf(actor.system.traits?.size ?? "med") + 1) return; // Shove: no more than one size larger
    const pick = await askChoice(actor, `Feral Pounce: ${actor.name}`, `<p>Your Unarmed Strike hits ${t.name}. Also Shove it (STR or DEX save, DC ${8 + Number(actor.system.abilities.str?.mod ?? 0) + prof(actor)})?</p>`,
      [{ action: "prone", label: "Knock Prone" }, { action: "push", label: "Push 5 ft" }, { action: "none", label: "No", default: true }]);
    if (pick !== "prone" && pick !== "push") return;
    pounceUsed.set(actor.uuid, turnKey());
    const dc = 8 + Number(actor.system.abilities.str?.mod ?? 0) + prof(actor);
    const ability = Number(t.actor.system.abilities.dex?.mod ?? 0) > Number(t.actor.system.abilities.str?.mod ?? 0) ? "dex" : "str";
    const res = await t.actor.rollSavingThrow({ ability, target: dc }, { configure: false }, { data: { flavor: `Shove (Feral Pounce, DC ${dc})` } }).catch(() => null);
    const r = Array.isArray(res) ? res[0] : res;
    if (!r || r.total >= dc) { say(actor, `<strong>Feral Pounce:</strong> ${t.name} resists the Shove.`); return; }
    if (pick === "prone") await addEffect(t.actor, { name: "Prone (Feral Pounce)", img: "systems/dnd5e/icons/svg/statuses/prone.svg", statuses: ["prone"], transfer: false });
    say(actor, `<strong>Feral Pounce:</strong> ${t.name} ${pick === "prone" ? "is knocked Prone" : "is pushed 5 ft away (move its token)"}.`);
  } catch (err) { console.warn(`${MODULE_ID} | Feral Pounce shove failed`, err); }
});

// ------------------------------------------------------------------ Rimekin Cold Fire Magic: Flame Blade deals Cold damage
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const item = workflow?.item;
    if (!workflow.damageRolls?.length || !trait(workflow.actor, "cold-fire-magic")) return;
    if (!/flame blade/i.test(`${item?.name ?? ""} ${item?.system?.identifier ?? ""} ${workflow.activity?.name ?? ""}`)) return;
    let changed = false;
    for (const r of workflow.damageRolls) if (r.options?.type === "fire") { r.options.type = "cold"; r.options.types = ["cold"]; changed = true; }
    if (changed) await workflow.setDamageRolls(workflow.damageRolls);
  } catch (err) { console.warn(`${MODULE_ID} | Cold Fire Magic failed`, err); }
});
