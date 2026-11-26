// Champions Guild Automation - priority-3 magic item rules (2024 Dungeon Master's Guide).
// Like item-rules.js these find the item on the character by identifier or name (no Mass Apply needed).
//  - Curses: Berserker Axe and Sword of Vengeance (Disadvantage with other weapons; WIS 15 save when damaged or go
//    berserk / must attack the creature that hurt you).
//  - Ring of Warmth (Cold damage -2d8), Shield of Missile Attraction (Resistance to ranged weapon attacks).
//  - Scarab of Protection (Advantage on saves vs spells; Reaction + charge to succeed on a failed save vs a Necromancy
//    spell or an Undead), Clockwork Amulet (once per dawn, a missed attack's d20 becomes a 10).
//  - Ring of Elemental Command (Elemental Bane, and the ring's plane benefits by its name: air/earth/fire/water).
//  - Spell cancelling: Ioun Stone of Absorption (level 4 or lower) / Greater Absorption (level 8 or lower), Rod of
//    Absorption (a spell targeting only you) - Reaction when a creature casts, using the item's charges as levels.
//  - Auras: Weapon of Warning (you and allies within 30 ft: Advantage on Initiative), Candle of Invocation (lit:
//    creatures within 30 ft have Advantage on D20 Tests), Rod of Alertness (planted: allies within 60 ft +1 AC/saves),
//    Rod of Alertness held: Advantage on Perception and Initiative.
//  - Talisman of Pure Good / Ultimate Evil: a failed save against the fissure destroys the target (Fiends/Undead, or
//    Celestials, roll with Disadvantage); a success takes the 4d6 Psychic.
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, reduceDamage } from "./main.js";
import { isMagicItem, magicItem, attuned, creatureType, spendUse, canReact, useReaction, say, chg, tokenOf, isGM,
  ON_HIT, PASSIVES, ITEM_AURAS } from "./item-rules.js";

const hasType = (actor, t) => new RegExp(`\\b${t}`).test(creatureType(actor));
const usesLeft = (item) => (item?.system?.uses?.max ? Number(item.system.uses.value ?? 0) : Infinity);
const isRangedWeapon = (wf) => wf?.activity?.actionType === "rwak" || (wf?.attackMode === "thrown" && wf?.item?.type === "weapon");
async function addEffect(actor, effect) {
  return MidiQOL.socket().executeAsGM("createEffects", { actorUuid: actor.uuid, effects: [effect] }).catch((err) => console.warn(`${MODULE_ID} | effect failed`, err));
}
async function gmUpdateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return MidiQOL.socket().executeAsGM("updateActor", { actorUuid: actor.uuid, updates }).catch(() => {});
}
const CURSES = [
  { ident: "berserker-axe", label: "Berserker Axe", effect: "Berserk", fail: (a) => `${a.name} goes berserk: they attack the nearest creature they can see or hear (the berserk state ends when they start a turn with no creature within 60 ft they can see or hear).`, combatOnly: false },
  { ident: "sword-of-vengeance", label: "Sword of Vengeance", effect: "Vengeful", fail: (a, src) => `${a.name} must attack ${src?.name ?? "the creature that damaged them"} until one of them drops to 0 HP or it's out of reach.`, combatOnly: true }
];

// ------------------------------------------------------------------ Curses: Disadvantage with other weapons
Hooks.on("midi-qol.preAttackRollConfig", (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item ?? workflow?.activity?.item;
    if (!actor || item?.type !== "weapon") return;
    for (const c of CURSES) {
      const cursed = actor.items.find((i) => isMagicItem(i, c.ident) && attuned(i));
      if (cursed && cursed.id !== item.id) workflow.attackRollModifierTracker?.disadvantage?.add?.(c.ident, `${c.label} curse`);
    }
    // Ring of Elemental Command: Advantage against Elementals, and Elementals have Disadvantage against the wearer.
    const target = tokenOf(Array.from(workflow.targets ?? [])[0])?.actor;
    if (magicItem(actor, "ring-of-elemental-command") && target && hasType(target, "elemental")) workflow.attackRollModifierTracker?.advantage?.add?.("elemental-bane", "Elemental Bane");
    if (target && hasType(actor, "elemental") && magicItem(target, "ring-of-elemental-command")) workflow.attackRollModifierTracker?.disadvantage?.add?.("elemental-bane", "Elemental Bane");
  } catch (err) { console.warn(`${MODULE_ID} | P3 attack rules failed`, err); }
});

// ------------------------------------------------------------------ Damage taken: curses, Ring of Warmth, Shield of Missile Attraction
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem) return;
    const dealt = () => (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0);
    // Ring of Warmth: Cold damage reduced by 2d8.
    if (dealt() > 0 && magicItem(actor, "ring-of-warmth") && (ditem.damageDetail ?? []).some((d) => d.type === "cold" && (d.value ?? 0) > 0)) {
      const roll = await new Roll("2d8").evaluate();
      const cut = reduceDamage(ditem, roll.total, ["cold"]);
      roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Ring of Warmth: ${actor.name} takes ${cut} less Cold damage` });
    }
    // Shield of Missile Attraction: Resistance to damage from Ranged weapon attacks (skipped if already resistant).
    if (dealt() > 0 && isRangedWeapon(workflow) && magicItem(actor, "shield-of-missile-attraction")) {
      const dr = actor.system.traits?.dr?.value ?? new Set();
      const half = (ditem.damageDetail ?? []).filter((d) => (d.value ?? 0) > 0 && !dr.has?.(d.type) && ["bludgeoning", "piercing", "slashing", "force", "fire", "cold", "lightning", "acid", "poison", "necrotic", "radiant", "thunder", "psychic"].includes(d.type))
        .reduce((s, d) => s + Math.ceil(d.value / 2), 0);
      if (half > 0) { const cut = reduceDamage(ditem, half); say(actor, `<strong>Shield of Missile Attraction:</strong> Resistance - ${actor.name} takes ${cut} less damage.`); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 damage rules failed`, err); }
});
// The curse saves come after the damage lands (the creature that hurt you is the workflow's actor).
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const src = workflow?.actor;
    for (const d of workflow?.damageList ?? []) {
      if (!((d.hpDamage ?? 0) + (d.tempDamage ?? 0) > 0)) continue;
      const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? d.actorUuid ?? "");
      const actor = found instanceof Actor ? found : (found?.actor ?? found?.document?.actor);
      if (!actor || actor === src || Number(actor.system.attributes.hp.value ?? 0) <= 0) continue;
      for (const c of CURSES) {
        if (!actor.items.some((i) => isMagicItem(i, c.ident) && attuned(i))) continue;
        if (c.combatOnly && !game.combat?.started) continue;
        if (actor.effects.some((e) => e.flags?.[MODULE_ID]?.curse === c.ident)) continue;
        const res = await actor.rollSavingThrow({ ability: "wis", target: 15 }, { configure: false }, { data: { flavor: `${c.label} curse (DC 15)` } }).catch(() => null);
        const r = Array.isArray(res) ? res[0] : res;
        if (!r || r.total >= 15) continue;
        await addEffect(actor, { name: `${c.effect} (${c.label})`, img: "icons/magic/control/fear-fright-monster-red.webp", transfer: false,
          description: `<p>${c.fail(actor, src)}</p>`, flags: { [MODULE_ID]: { curse: c.ident } } });
        say(actor, `<strong>${c.label}:</strong> ${c.fail(actor, src)}`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | curse rules failed`, err); }
});

// ------------------------------------------------------------------ Scarab of Protection: rescue a failed save vs Necromancy / Undead
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    if (!workflow?.failedSaves?.size) return;
    const nec = workflow.item?.type === "spell" && workflow.item.system?.school === "nec";
    const undead = workflow.actor && hasType(workflow.actor, "undead");
    if (!nec && !undead) return;
    for (const t of Array.from(workflow.failedSaves)) {
      const actor = tokenOf(t)?.actor;
      const scarab = actor && magicItem(actor, "scarab-of-protection", { worn: false });
      if (!scarab || usesLeft(scarab) <= 0 || !canReact(actor)) continue;
      if (!(await askOwner(actor, `Scarab of Protection: ${actor.name}`, `<p>${actor.name} fails a save against ${nec ? "a Necromancy spell" : "an Undead"}. Use your Reaction and a charge (${usesLeft(scarab)} left) to succeed instead?</p>`))) continue;
      await spendUse(scarab);
      await useReaction(actor);
      workflow.failedSaves.delete(t);
      workflow.saves?.add?.(t);
      say(actor, `<strong>Scarab of Protection:</strong> ${actor.name} succeeds on the save instead.${usesLeft(scarab) - 1 <= 0 ? " The scarab crumbles to powder." : ""}`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Scarab of Protection failed`, err); }
});

// ------------------------------------------------------------------ Clockwork Amulet: a missed attack's d20 becomes a 10 (once per dawn)
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical) return;
    const actor = workflow.actor;
    const amulet = magicItem(actor, "clockwork-amulet");
    if (!amulet || amulet.getFlag("world", "cgaClockworkUsed")) return;
    const roll = workflow.attackRoll;
    const kept = roll.dice?.[0]?.results?.find((r) => r.active && !r.discarded);
    const ac = Number(tokenOf(Array.from(workflow.targets)[0])?.actor?.system?.attributes?.ac?.value ?? 10);
    if (!kept || kept.result >= 10 || roll.total >= ac || roll.total - kept.result + 10 < ac) return;
    if (!(await askOwner(actor, `Clockwork Amulet: ${actor.name}`, `<p>The attack (${roll.total}) misses. Use the Clockwork Amulet to treat the d20 as a 10 (total ${roll.total - kept.result + 10}, a hit; once per dawn)?</p>`))) return;
    await amulet.setFlag("world", "cgaClockworkUsed", true).catch(() => {});
    kept.result = 10;
    roll._total = roll._evaluateTotal();
    workflow.isFumble = false;
    await workflow.setAttackRoll?.(roll);
    say(actor, `<strong>Clockwork Amulet:</strong> the d20 counts as a 10.`);
  } catch (err) { console.warn(`${MODULE_ID} | Clockwork Amulet failed`, err); }
});
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!(config?.type === "long" || result?.longRest) || !actor.isOwner) return;
    for (const i of actor.items.filter((x) => x.getFlag("world", "cgaClockworkUsed"))) await i.unsetFlag("world", "cgaClockworkUsed");
  } catch (err) {}
});

// ------------------------------------------------------------------ Cancel a spell as it's cast (Absorption Ioun Stones, Rod of Absorption)
// Charges are levels: the item's uses count down by the spell's level.
const ABSORBERS = [
  { ident: "absorption-ioun-stone", alt: "ioun-stone-of-absorption", label: "Ioun Stone of Absorption", maxLevel: 4 },
  { ident: "greater-absorption-ioun-stone", alt: "ioun-stone-of-greater-absorption", label: "Ioun Stone of Greater Absorption", maxLevel: 8 },
  { ident: "rod-of-absorption", label: "Rod of Absorption", maxLevel: 9, onlyMe: true }
];
Hooks.on("midi-qol.targetingComplete", async (workflow) => {
  try {
    const item = workflow?.item, caster = workflow?.actor;
    if (item?.type !== "spell" || !caster) return;
    const level = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? item.system.level ?? 0);
    if (level < 1) return;
    const casterTok = tokenOf(workflow.token);
    const targets = Array.from(workflow.targets ?? []).map(tokenOf);
    for (const tok of casterTok?.parent?.tokens ?? []) {
      const actor = tok.actor;
      if (!actor || actor === caster || tok.disposition === casterTok.disposition || !canReact(actor)) continue;
      for (const ab of ABSORBERS) {
        const it = actor.items.find((i) => (isMagicItem(i, ab.ident) || (ab.alt && isMagicItem(i, ab.alt))) && attuned(i) && i.system.equipped !== false);
        if (!it || level > ab.maxLevel || usesLeft(it) < level) continue;
        if (ab.onlyMe && !(targets.length === 1 && targets[0]?.uuid === tok.uuid && !workflow.activity?.target?.template?.type)) continue;
        if (!(await askOwner(actor, `${ab.label}: ${actor.name}`, `<p>${caster.name} casts ${item.name} (level ${level})${ab.onlyMe ? " at you" : ""}. Use your Reaction to ${ab.onlyMe ? "absorb" : "cancel"} it (${usesLeft(it)} levels left)?</p>`))) continue;
        await spendUse(it, level);
        await useReaction(actor);
        say(actor, `<strong>${ab.label}:</strong> ${actor.name} ${ab.onlyMe ? "absorbs" : "cancels"} ${caster.name}'s ${item.name}.`);
        return false;
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | spell absorption failed`, err); }
});

// ------------------------------------------------------------------ Talismans: the fissure destroys a creature that fails
const FISSURES = [{ ident: "talisman-of-pure-good", act: /pure rebuke/i, weak: ["fiend", "undead"] }, { ident: "talisman-of-ultimate-evil", act: /ultimate end/i, weak: ["celestial"] }];
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const f = FISSURES.find((x) => isMagicItem(workflow?.item, x.ident) && x.act.test(workflow.activity?.name ?? ""));
    if (!f) return;
    for (const t of Array.from(workflow.targets ?? []).map(tokenOf)) {
      if (t?.actor && f.weak.some((w) => hasType(t.actor, w)))
        await addEffect(t.actor, { name: "Fissure: Disadvantage", img: "icons/magic/fire/barrier-wall-explosion-orange.webp", transfer: false,
          system: { changes: [chg("flags.midi-qol.disadvantage.save.dex", "1")] }, flags: { dae: { specialDuration: ["isSave"] } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | talisman disadvantage failed`, err); }
});
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const f = FISSURES.find((x) => isMagicItem(workflow?.item, x.ident) && x.act.test(workflow.activity?.name ?? ""));
    if (!f) return;
    for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) {
      if (!t?.actor) continue;
      await gmUpdateActor(t.actor, { "system.attributes.hp.value": 0 });
      say(t.actor, `<strong>${workflow.item.name}:</strong> ${t.name} falls into the fissure and is destroyed.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | talisman fissure failed`, err); }
});

// ------------------------------------------------------------------ Auras
const ADV = (key) => chg(key, "1", "upgrade");
ITEM_AURAS.push(
  { ident: "weapon-of-warning", key: "weapon-of-warning", range: () => 30,
    effect: () => ({ name: "Weapon of Warning", img: "icons/magic/perception/eye-ringed-glow-angry-small-teal.webp", changes: [ADV("system.attributes.init.roll.mode")] }) },
  { ident: "candle-of-invocation", key: "candle-of-invocation", range: () => 30, targets: "all", worn: false,
    active: (a, item) => a.effects.some((e) => /lit candle/i.test(e.name) && !e.disabled) || item.effects.some((e) => /lit candle/i.test(e.name) && !e.disabled && !e.transfer),
    effect: () => ({ name: "Candle of Invocation", img: "icons/sundries/lights/candle-lit-yellow.webp", changes: [chg("flags.midi-qol.advantage.all", "1")] }) },
  { ident: "rod-of-alertness", key: "rod-of-alertness", range: () => 60, worn: false,
    active: (a) => a.effects.some((e) => /protective aura|rod of alertness template/i.test(e.name) && !e.disabled && !e.flags?.[MODULE_ID]),
    effect: () => ({ name: "Rod of Alertness: Protective Aura", img: "icons/magic/defensive/shield-barrier-glowing-blue.webp",
      changes: [chg("system.attributes.ac.bonus", "+1", "add"), chg("system.bonuses.abilities.save", "+1", "add")] }) }
);

// ------------------------------------------------------------------ Passive effects
const ELEMENTAL_FOCUS = {
  air: [chg("system.traits.dr.value", "lightning", "add"), chg("system.traits.languages.value", "auran", "add")],
  earth: [chg("system.traits.dr.value", "acid", "add"), chg("system.traits.languages.value", "terran", "add")],
  fire: [chg("system.traits.di.value", "fire", "add"), chg("system.traits.languages.value", "ignan", "add")],
  water: [chg("system.attributes.movement.swim", "60", "upgrade"), chg("system.traits.languages.value", "aquan", "add")]
};
PASSIVES.push(
  { key: "scarab", active: (a) => !!magicItem(a, "scarab-of-protection", { worn: false }),
    effect: { name: "Scarab of Protection: Spell Resistance", img: "icons/equipment/neck/necklace-animal-scarab.webp", changes: [chg("flags.midi-qol.advantage.save.all", 'workflow?.item?.type === "spell"')] } },
  { key: "alertness", active: (a) => !!magicItem(a, "rod-of-alertness"),
    effect: { name: "Rod of Alertness", img: "icons/weapons/wands/wand-gem-teal.webp", changes: [chg("flags.midi-qol.advantage.skill.prc", "1"), ADV("system.attributes.init.roll.mode")] } },
  { key: "elemental-command", active: (a) => !!magicItem(a, "ring-of-elemental-command"),
    effect: (a) => {
      const ring = magicItem(a, "ring-of-elemental-command");
      const plane = Object.keys(ELEMENTAL_FOCUS).find((p) => new RegExp(`\\b${p}\\b`, "i").test(`${ring.name} ${ring.system.identifier}`));
      const changes = [...(plane ? ELEMENTAL_FOCUS[plane] : [])];
      if (plane === "air") changes.push(chg("system.attributes.movement.fly", String(Number(a.system.attributes.movement?.walk ?? 30) || 30), "upgrade"), chg("system.attributes.movement.hover", "true", "override"));
      return { name: `Ring of Elemental Command${plane ? ` (${plane})` : ""}`, img: "icons/equipment/finger/ring-band-engraved-scrolls-gold.webp", changes };
    } }
);

// ------------------------------------------------------------------ Enchantment templates that only rename the item
// The compendium's Ring of Resistance, Armor of Resistance and Wand of the War Mage are enchantments: applied to a
// ring, armor or wand they change its name but give no resistance / spell attack bonus. This reads the type or bonus
// from the item's name (or its applied enchantment's name) and adds it - unless the item already has its own effect
// (as a D&D Beyond item does).
const DAMAGE = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];
const RING_GEMS = { pearl: "acid", tourmaline: "cold", garnet: "fire", sapphire: "force", citrine: "lightning", jet: "necrotic", amethyst: "poison", jade: "psychic", topaz: "radiant", spinel: "thunder" };
const ownChanges = (item, keys) => item.effects.some((e) => e.type !== "enchantment" && !e.disabled && (e.system?.changes ?? e.changes ?? []).some((c) => keys.some((k) => c.key === k)));
const labels = (item) => [item.name, ...item.effects.filter((e) => e.type === "enchantment").map((e) => e.name)].join(" | ");
function resistanceOf(item) {
  const text = labels(item);
  if (!/resistance/i.test(text) || !/\b(ring|armor|armour|mail|plate|leather|hide|breastplate|shirt|scale|splint)\b/i.test(`${text} ${item.system.type?.value ?? ""}`)) return null;
  if (item.type !== "equipment" || !item.system.equipped || !attuned(item) || ownChanges(item, ["system.traits.dr.value"])) return null;
  const named = DAMAGE.find((d) => new RegExp(`\\b${d}\\b`, "i").test(text));
  if (named) return named;
  const gem = Object.keys(RING_GEMS).find((g) => new RegExp(`\\b${g}\\b`, "i").test(text));
  return gem ? RING_GEMS[gem] : null;
}
function warMageBonus(item) {
  const m = /war mage,?\s*\+([123])/i.exec(labels(item));
  if (!m || !item.system.equipped || !attuned(item) || ownChanges(item, ["system.bonuses.rsak.attack", "system.bonuses.msak.attack"])) return 0;
  return Number(m[1]);
}
// Rod of the Pact Keeper (DMG-only): +1/+2/+3 (by name, else rarity) to spell attacks and spell save DCs while held.
function pactKeeperBonus(item) {
  if (!/pact keeper/i.test(labels(item)) && item.system.identifier !== "rod-of-the-pact-keeper") return 0;
  if (!item.system.equipped || !attuned(item) || ownChanges(item, ["system.bonuses.rsak.attack", "system.bonuses.msak.attack", "system.bonuses.spell.dc"])) return 0;
  const m = /\+([123])/.exec(labels(item));
  return m ? Number(m[1]) : ({ uncommon: 1, rare: 2, veryRare: 3, "very rare": 3 }[item.system.rarity] ?? 1);
}
PASSIVES.push(
  { key: "pact-keeper", active: (a) => a.items.some((i) => pactKeeperBonus(i) > 0),
    effect: (a) => { const n = Math.max(...a.items.map(pactKeeperBonus)); return { name: `Rod of the Pact Keeper (+${n})`, img: "icons/weapons/staves/staff-ornate-purple.webp",
      changes: [chg("system.bonuses.msak.attack", `+${n}`, "add"), chg("system.bonuses.rsak.attack", `+${n}`, "add"), chg("system.bonuses.spell.dc", `+${n}`, "add")] }; } },
  { key: "resistance-items", active: (a) => a.items.some((i) => resistanceOf(i)),
    effect: (a) => ({ name: "Ring / Armor of Resistance", img: "icons/equipment/finger/ring-faceted-gold-purple.webp",
      changes: [...new Set(a.items.map(resistanceOf).filter(Boolean))].map((t) => chg("system.traits.dr.value", t, "add")) }) },
  { key: "war-mage", active: (a) => a.items.some((i) => warMageBonus(i) > 0),
    effect: (a) => { const n = Math.max(...a.items.map(warMageBonus)); return { name: `Wand of the War Mage (+${n})`, img: "icons/weapons/wands/wand-gem-violet.webp",
      changes: [chg("system.bonuses.msak.attack", `+${n}`, "add"), chg("system.bonuses.rsak.attack", `+${n}`, "add")] }; } }
);
