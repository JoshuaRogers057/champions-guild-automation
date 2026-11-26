// Champions Guild Automation - priority-2 magic item rules (2024 Dungeon Master's Guide / Player's Handbook).
// Like item-rules.js these find the item on the character by identifier or name (no Mass Apply needed).
//  - Extra damage on a hit: Executioner's Axe (Humanoids, +temp HP), Giant Slayer (Giants, STR save or Prone),
//    Dwarven Thrower (thrown, +1d8 more vs Giants), Mace of Smiting (a 20: +7, or +14 and destroy vs Constructs),
//    Oathbow (sworn enemy +3d6, Advantage; Disadvantage with other weapons), Staff of Striking (spend up to 3
//    charges, +1d6 Force each), Potion of Pugilism (Unarmed Strikes +1d6 Force), Basic Poison (+1d4 Poison once),
//    Vorpal Sword (a 20: cut off the head, or +30 Slashing; ignores Slashing Resistance).
//  - Ammunition of Slaying: the right creature type makes a DC 17 CON save, 6d10 Force (half on a success).
//  - Saves after a hit: Hammer of Thunderbolts (Hurl: CON 17 or Stunned within 30 ft of the target; Giant's Bane),
//    Nine Lives Stealer (a 20 vs fewer than 100 HP: CON 15 or slain), Staff of Withering and Staff of Thunder and
//    Lightning (offered after a hit), Tentacle Rod (three tentacle hits on one creature: DEX 15 or Restrained).
//  - Defence: Arrow-Catching Shield (+2 AC vs ranged attacks only), Quarterstaff of the Acrobat (Reaction +5 AC),
//    Spellguard Shield, Robe of the Archmagi, Staff of the Magi, Ring of Spell Turning (Advantage on saves vs spells;
//    a saved spell of level 7 or lower has no effect), Periapt of Wound Closure (death saves of 9 or lower count as
//    10, Hit Point Dice heal double), Sword of Answering (Reaction attack with Advantage at a creature that damages you).
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey, reduceDamage } from "./main.js";
import { isMagicItem, magicItem, attuned, creatureType, spendUse, canReact, useReaction, say, chg, tokenOf, isGM,
  ON_HIT, PASSIVES, ITEM_TOGGLES, wearsArmor } from "./item-rules.js";

const hasType = (actor, t) => new RegExp(`\\b${t}`).test(creatureType(actor));
const hits = (workflow) => Array.from(workflow?.hitTargets ?? []).map(tokenOf).filter((t) => t?.actor);
const natural20 = (workflow) => workflow?.attackRoll?.dice?.[0]?.results?.find((r) => r.active && !r.discarded)?.result === 20;
const isMelee = (workflow) => ["mwak", "msak"].includes(workflow?.activity?.actionType) && workflow?.attackMode !== "thrown";
const isRanged = (workflow) => ["rwak", "rsak"].includes(workflow?.activity?.actionType) || workflow?.attackMode === "thrown";
const weaponType = (workflow) => workflow?.damageRolls?.[0]?.options?.type ?? "slashing";
const usesLeft = (item) => (item?.system?.uses?.max ? Number(item.system.uses.value ?? 0) : Infinity);
async function gmUpdateActor(actor, updates) {
  try { if (actor.isOwner) return await actor.update(updates); } catch (err) {}
  return MidiQOL.socket().executeAsGM("updateActor", { actorUuid: actor.uuid, updates }).catch(() => {});
}
async function addEffect(actor, effect) {
  return MidiQOL.socket().executeAsGM("createEffects", { actorUuid: actor.uuid, effects: [effect] }).catch((err) => console.warn(`${MODULE_ID} | effect failed`, err));
}
const statusEffect = (status, name, origin, extra = {}) => ({ name, img: CONFIG.statusEffects.find((s) => s.id === status)?.img ?? "icons/svg/aura.svg",
  statuses: [status], origin, transfer: false, ...extra });
async function save(actor, ability, dc, flavor) {
  const res = await actor.rollSavingThrow({ ability, target: dc }, { configure: false }, { data: { flavor: `${flavor} (DC ${dc})` } }).catch(() => null);
  const r = Array.isArray(res) ? res[0] : res;
  return !!r && r.total >= dc;
}
async function runActivity(activity, targetDoc) {
  return MidiQOL.completeActivityUse(activity, { midiOptions: { targetUuids: [targetDoc.uuid], workflowOptions: { targetConfirmation: "none" } }, create: { measuredTemplate: false } },
    { configure: false }, {}).catch((err) => console.warn(`${MODULE_ID} | ${activity?.name} failed`, err));
}
const findActivity = (item, rx, type) => item?.system?.activities?.find((a) => rx.test(a.name ?? "") && (!type || a.type === type));
const activityUsesLeft = (a) => (a?.uses?.max ? Number(a.uses.value ?? 0) : Infinity);
const killMessage = (actor, why) => say(actor, `<strong>${why}:</strong> ${actor.name} is slain.`);

// ------------------------------------------------------------------ Oathbow sworn enemy
// The sworn enemy is the creature carrying a "Sworn Enemy" effect that came from this archer's Oathbow.
function swornEnemyOf(attacker) {
  const bow = attacker?.items?.find((i) => isMagicItem(i, "oathbow"));
  if (!bow) return null;
  for (const t of canvas.scene?.tokens ?? []) {
    const e = t.actor?.effects?.find((x) => /sworn enemy/i.test(x.name) && (x.origin ?? "").startsWith(bow.uuid));
    if (e && Number(t.actor.system.attributes?.hp?.value ?? 0) > 0) return { token: t, bow };
  }
  return null;
}

// ------------------------------------------------------------------ Extra damage on a hit
ON_HIT.push(
  { ident: "executioners-axe", label: "Executioner's Axe", formula: "2d6", type: "slashing", when: (t) => hasType(t, "humanoid") },
  { ident: "giant-slayer", label: "Giant Slayer", formula: "2d6", type: weaponType, when: (t) => hasType(t, "giant"),
    builtIn: (item, wf) => /giant/i.test(wf?.activity?.name ?? "") },
  { ident: "dwarven-thrower", label: "Dwarven Thrower (Giant)", formula: "1d8", type: "force", when: (t, wf) => isRanged(wf) && hasType(t, "giant") },
  // The compendium mace carries the +7 (or +14 on its "Attack Construct" activity) as a critical bonus: add only what's missing.
  { ident: "mace-of-smiting", label: "Mace of Smiting", bonus: async (wf) => {
      if (!natural20(wf)) return null;
      const want = hits(wf).some((t) => hasType(t.actor, "construct")) ? 14 : 7;
      const have = Number(wf.activity?.damage?.critical?.bonus || 0) || 0;
      return want > have ? [{ formula: String(want - have), type: "bludgeoning", crit: false }] : null;
    } },
  { ident: "oathbow", label: "Oathbow (sworn enemy)", formula: "3d6", type: "piercing",
    when: (t, wf) => isRanged(wf) && swornEnemyOf(wf.actor)?.token.actor?.uuid === t?.uuid, builtIn: (item, wf) => /sworn/i.test(wf?.activity?.name ?? "") },
  { ident: "staff-of-striking", label: "Staff of Striking", bonus: async (wf, item) => {
      if (!isMelee(wf) || usesLeft(item) <= 0) return null;
      const max = Math.min(3, usesLeft(item));
      const pick = Number(await askChoice(wf.actor, `Staff of Striking: ${wf.actor.name}`, `<p>Hit! Spend charges (${usesLeft(item)} left) for +1d6 Force damage each?</p>`,
        [0, 1, 2, 3].filter((n) => n <= max).map((n) => ({ action: String(n), label: n ? `${n} charge${n > 1 ? "s" : ""}` : "None", default: n === 0 }))) ?? 0);
      if (!pick) return null;
      await spendUse(item, pick);
      return [{ formula: `${pick}d6`, type: "force" }];
    } },
  { label: "Potion of Pugilism", match: (wf) => wf?.item?.system?.identifier === "unarmed-strike" && wf.actor?.effects?.some((e) => /potion of pugilism/i.test(e.name) && !e.disabled),
    formula: "1d6", type: "force", when: () => true },
  { label: "Basic Poison", match: (wf) => wf?.item?.type === "weapon" && wf.actor?.effects?.some((e) => e.flags?.[MODULE_ID]?.basicPoison && !e.disabled),
    bonus: async (wf) => {
      const types = new Set((wf.damageRolls ?? []).flatMap((r) => [r.options?.type, ...(r.options?.types ?? [])]));
      if (!types.has("piercing") && !types.has("slashing")) return null;
      const coat = wf.actor.effects.find((e) => e.flags?.[MODULE_ID]?.basicPoison);
      await coat?.delete().catch(() => {});
      return [{ formula: "1d4", type: "poison" }];
    } },
  { ident: "vorpal-sword", label: "Vorpal Sword", bonus: async (wf) => {
      if (!natural20(wf)) return null;
      const t = hits(wf)[0];
      if (!t) return null;
      const immune = (t.actor.system.traits?.di?.value ?? new Set()).has?.("slashing");
      const pick = immune ? "damage" : await askChoice(wf.actor, `Vorpal Sword: ${wf.actor.name}`,
        `<p>You rolled a 20 against ${t.name}. Cut off its head? (The DM decides if it has a head it can lose, if it's too big, or if it uses Legendary Resistance - then it takes 30 extra Slashing damage instead.)</p>`,
        [{ action: "head", label: "Cut off its head", default: true }, { action: "damage", label: "+30 Slashing instead" }]);
      if (pick === "head") { wf.cgaVorpal = t; return null; }
      return [{ formula: "30", type: "slashing", crit: false }];
    } }
);

// Before damage is applied: remember HP (Nine Lives Stealer checks the HP the creature had when attacked).
Hooks.on("midi-qol.DamageRollComplete", (workflow) => {
  try { workflow.cgaHpBefore = new Map(hits(workflow).map((t) => [t.uuid, Number(t.actor.system.attributes?.hp?.value ?? 0)])); } catch (err) {}
});

// ------------------------------------------------------------------ After the hit: saves, conditions, offers
const tentacleHits = new Map(); // `${attacker}|${target}|${turn}` -> hits with the Tentacle Rod this turn
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  const item = workflow?.item, actor = workflow?.actor;
  if (!item || !actor || !workflow.activity?.attack) return;
  const targets = hits(workflow);
  try {
    // Executioner's Axe: temporary HP equal to the extra damage.
    if (isMagicItem(item, "executioners-axe") && targets.length) {
      const extra = (workflow.bonusDamageRolls ?? []).filter((r) => /Executioner/.test(r.options?.flavor ?? "")).reduce((s, r) => s + r.total, 0);
      if (extra > Number(actor.system.attributes.hp.temp ?? 0)) { await gmUpdateActor(actor, { "system.attributes.hp.temp": extra }); say(actor, `<strong>Executioner's Axe:</strong> ${actor.name} gains ${extra} Temporary Hit Points.`); }
    }
    // Giant Slayer: a Giant hit makes a DC 15 STR save or falls Prone.
    if (isMagicItem(item, "giant-slayer")) for (const t of targets.filter((x) => hasType(x.actor, "giant"))) {
      if (!(await save(t.actor, "str", 15, "Giant Slayer"))) await addEffect(t.actor, statusEffect("prone", "Prone (Giant Slayer)", item.uuid));
    }
    // Mace of Smiting: a Construct at 25 HP or fewer after a 20 is destroyed.
    if (isMagicItem(item, "mace-of-smiting") && natural20(workflow)) for (const t of targets.filter((x) => hasType(x.actor, "construct"))) {
      if (Number(t.actor.system.attributes.hp.value ?? 0) <= 25) { await gmUpdateActor(t.actor, { "system.attributes.hp.value": 0 }); say(t.actor, `<strong>Mace of Smiting:</strong> ${t.name} is destroyed.`); }
    }
    // Vorpal Sword: the head comes off.
    if (workflow.cgaVorpal) { await gmUpdateActor(workflow.cgaVorpal.actor, { "system.attributes.hp.value": 0 }); say(actor, `<strong>Vorpal Sword:</strong> ${workflow.cgaVorpal.name} loses its head.`); }
    // Nine Lives Stealer: a 20 against a creature with fewer than 100 HP - CON 15 or slain (Constructs and Undead are immune).
    if (isMagicItem(item, "nine-lives-stealer") && attuned(item) && natural20(workflow)) {
      const life = findActivity(item, /life steal/i);
      const charges = life?.uses?.max ? activityUsesLeft(life) : usesLeft(item);
      for (const t of targets) {
        const hpBefore = workflow.cgaHpBefore?.get(t.uuid) ?? Number(t.actor.system.attributes.hp.value ?? 0);
        if (charges <= 0 || hpBefore >= 100 || hasType(t.actor, "construct") || hasType(t.actor, "undead") || Number(t.actor.system.attributes.hp.value ?? 0) <= 0) continue;
        if (await save(t.actor, "con", 15, "Nine Lives Stealer")) continue;
        await gmUpdateActor(t.actor, { "system.attributes.hp.value": 0 });
        if (life?.uses?.max) await life.update({ "uses.spent": Number(life.uses.spent ?? 0) + 1 }).catch(() => {});
        else if (item.system.uses?.max) await spendUse(item);
        killMessage(t.actor, "Nine Lives Stealer");
      }
    }
    // Hammer of Thunderbolts: a hurled hit - the target and every creature within 30 ft of it (not you): CON 17 or Stunned.
    if (isMagicItem(item, "hammer-of-thunderbolts") && attuned(item) && targets.length && (/hurl/i.test(workflow.activity.name ?? "") || workflow.attackMode === "thrown")) {
      const center = targets[0];
      const me = tokenOf(workflow.token);
      for (const t of (center.parent?.tokens ?? []).filter((x) => x.actor && x !== me && (x === center || edgeDistance(center, x, center.parent) <= 30))) {
        if (await save(t.actor, "con", 17, "Hammer of Thunderbolts")) continue;
        await addEffect(t.actor, statusEffect("stunned", "Stunned (Hammer of Thunderbolts)", item.uuid, { duration: { rounds: 2 }, flags: { dae: { specialDuration: ["turnEndSource"] } } }));
      }
    }
    // Hammer of Thunderbolts, Giant's Bane: with an attuned Belt of Giant Strength or Gauntlets of Ogre Power, a 20 vs a Giant - CON 17 or die.
    if (isMagicItem(item, "hammer-of-thunderbolts") && attuned(item) && natural20(workflow) && (magicItem(actor, "belt-of-giant-strength") || magicItem(actor, "gauntlets-of-ogre-power") || actor.items.some((i) => /belt of .*giant strength/i.test(i.name) && attuned(i) && i.system.equipped))) {
      for (const t of targets.filter((x) => hasType(x.actor, "giant"))) {
        if (!(await save(t.actor, "con", 17, "Giant's Bane"))) { await gmUpdateActor(t.actor, { "system.attributes.hp.value": 0 }); killMessage(t.actor, "Giant's Bane"); }
      }
    }
    // Staff of Withering: after a hit, offer to spend a charge (its Damage & Save activity).
    if (isMagicItem(item, "staff-of-withering") && attuned(item) && targets.length && usesLeft(item) > 0) {
      const act = findActivity(item, /save|wither/i, "save");
      if (act && await askOwner(actor, `Staff of Withering: ${actor.name}`, `<p>Hit! Spend a charge (${usesLeft(item)} left): +2d10 Necrotic and a DC 15 CON save or Disadvantage on STR and CON checks and saves for 1 hour?</p>`)) await runActivity(act, targets[0]);
    }
    // Staff of Thunder and Lightning: after a melee hit, offer the once-per-dawn properties.
    if (isMagicItem(item, "staff-of-thunder-and-lightning") && attuned(item) && targets.length && isMelee(workflow)) {
      const opts = [["lightning", findActivity(item, /^lightning$/i), "Lightning (+2d6 Lightning)"], ["thunder", findActivity(item, /^thunder$/i), "Thunder (CON 17 or Stunned)"],
        ["both", findActivity(item, /thunder\s*(&|and)\s*lightning/i), "Thunder and Lightning (Bonus Action)"]].filter(([, a]) => a && activityUsesLeft(a) > 0);
      if (opts.length) {
        const pick = await askChoice(actor, `Staff of Thunder and Lightning: ${actor.name}`, `<p>Hit! Use one of the staff's once-per-dawn properties on ${targets[0].name}?</p>`,
          [...opts.map(([k, , label]) => ({ action: k, label })), { action: "none", label: "No", default: true }]);
        const chosen = opts.find(([k]) => k === pick);
        if (chosen) await runActivity(chosen[1], targets[0]);
      }
    }
    // Tentacle Rod: the third tentacle hit on the same creature this turn - its Constrict save.
    if (isMagicItem(item, "tentacle-rod") && attuned(item) && /tentacle/i.test(workflow.activity.name ?? "") && targets.length) {
      const key = `${actor.uuid}|${targets[0].uuid}|${turnKey()}`;
      const n = (tentacleHits.get(key) ?? 0) + 1;
      tentacleHits.set(key, n);
      if (n === 3) { const act = findActivity(item, /constrict|restrain/i, "save"); if (act) await runActivity(act, targets[0]); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 item hit rules failed`, err); }
});

// ------------------------------------------------------------------ Oathbow: swear an enemy when you attack with it and have none
const oathAsked = new Set(); // attacker|target this session (don't nag after a "no")
Hooks.on("midi-qol.preAttackRoll", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !isMagicItem(item, "oathbow") || !attuned(item) || swornEnemyOf(actor)) return;
    const target = tokenOf(Array.from(workflow.targets ?? [])[0]);
    if (!target?.actor || target.actor === actor || oathAsked.has(`${actor.uuid}|${target.uuid}`)) return;
    oathAsked.add(`${actor.uuid}|${target.uuid}`);
    if (!(await askOwner(actor, `Oathbow: ${actor.name}`, `<p>Speak the command words and make ${target.name} your sworn enemy (until it dies or 7 days pass)? Advantage and +3d6 Piercing against it with the bow; Disadvantage with other weapons while it lives.</p>`))) return;
    await addEffect(target.actor, { name: `Sworn Enemy (${actor.name})`, img: item.img, origin: item.uuid, transfer: false, duration: { seconds: 7 * 86400 },
      description: `<p>Sworn enemy of ${actor.name}'s Oathbow.</p>` });
  } catch (err) { console.warn(`${MODULE_ID} | Oathbow oath failed`, err); }
});

// ------------------------------------------------------------------ Attack rolls: Oathbow Advantage / Disadvantage
Hooks.on("midi-qol.preAttackRollConfig", (workflow) => {
  try {
    const sworn = swornEnemyOf(workflow?.actor);
    const item = workflow?.item ?? workflow?.activity?.item;
    if (!sworn || item?.type !== "weapon") return;
    const target = tokenOf(Array.from(workflow.targets ?? [])[0]);
    const tracker = workflow.attackRollModifierTracker;
    if (isMagicItem(item, "oathbow")) { if (target?.uuid === sworn.token.uuid && isRanged(workflow)) tracker?.advantage?.add?.("oathbow", "Oathbow: sworn enemy"); }
    else tracker?.disadvantage?.add?.("oathbow", "Oathbow: your sworn enemy lives");
  } catch (err) { console.warn(`${MODULE_ID} | Oathbow failed`, err); }
});

// ------------------------------------------------------------------ Before hits are checked: Arrow-Catching Shield, Quarterstaff of the Acrobat
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    if (!workflow?.attackRoll || workflow.targets?.size !== 1 || workflow.isCritical) return;
    const tDoc = tokenOf(Array.from(workflow.targets)[0]);
    const def = tDoc?.actor;
    if (!def) return;
    const roll = workflow.attackRoll;
    const ac = Number(def.system.attributes.ac.value ?? 10);
    const adjust = async (d) => { roll._total = Number(roll.total) + d; await workflow.setAttackRoll?.(roll); };
    // Arrow-Catching Shield: +2 AC against ranged attack rolls.
    if (isRanged(workflow) && magicItem(def, "arrow-catching-shield")) {
      if (roll.total >= ac && roll.total < ac + 2) say(def, `<strong>Arrow-Catching Shield:</strong> +2 AC against the ranged attack - it misses ${def.name}.`);
      await adjust(-2);
    }
    // Quarterstaff of the Acrobat (Quarterstaff form): Reaction +5 AC against a hit, once per Short or Long Rest.
    const staff = magicItem(def, "quarterstaff-of-the-acrobat");
    if (staff && usesLeft(staff) > 0 && canReact(def) && roll.total >= ac && roll.total < ac + 5 && workflow.actor !== def
      && await askOwner(def, `Quarterstaff of the Acrobat: ${def.name}`, `<p>${workflow.actor?.name ?? "An attack"} hits ${def.name} (${roll.total} vs AC ${ac}). Use your Reaction to twirl the staff for +5 AC (once per rest)?</p>`)) {
      if (staff.system.uses?.max) await spendUse(staff);
      await useReaction(def);
      say(def, `<strong>Attack Deflection:</strong> ${def.name} gains +5 AC - the attack misses.`);
      await adjust(-5);
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 defence rules failed`, err); }
});

// ------------------------------------------------------------------ Ring of Spell Turning: a saved spell of level 7 or lower has no effect
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || workflow?.item?.type !== "spell" || !magicItem(actor, "ring-of-spell-turning")) return;
    const level = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? workflow.item.system.level ?? 0);
    const saved = Array.from(workflow.saves ?? []).some((t) => tokenOf(t) === tokenOf(token));
    if (level > 7 || !saved || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
    reduceDamage(ditem, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
    say(actor, `<strong>Ring of Spell Turning:</strong> the spell has no effect on ${actor.name}.`);
  } catch (err) { console.warn(`${MODULE_ID} | Ring of Spell Turning failed`, err); }
});

// ------------------------------------------------------------------ Sword of Answering: Reaction attack at a creature that damages you
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const attackerTok = tokenOf(workflow?.token);
    if (!attackerTok?.actor) return;
    for (const d of workflow.damageList ?? []) {
      if (!((d.hpDamage ?? 0) + (d.tempDamage ?? 0) > 0)) continue;
      const tu = d.targetUuid ?? d.tokenUuid;
      const found = tu ? fromUuidSync(tu) : null;
      const defTok = found instanceof Actor ? found.getActiveTokens?.()[0]?.document : (found?.document ?? found);
      const def = defTok?.actor;
      if (!def || def === attackerTok.actor) continue;
      const sword = magicItem(def, "sword-of-answering");
      if (!sword || !sword.isOwner || !canReact(def)) continue; // the client running this workflow must be able to use the sword
      const reach = sword.system.properties?.has?.("rch") ? 10 : 5;
      if (edgeDistance(defTok, attackerTok, defTok.parent) > reach) continue;
      if (!(await askOwner(def, `Sword of Answering: ${def.name}`, `<p>${attackerTok.name} damaged ${def.name}. Use your Reaction to strike back with Advantage (ignoring its Resistance and Immunity)?</p>`))) continue;
      const act = sword.system.activities.find((a) => a.type === "attack");
      if (!act) continue;
      const types = Object.keys(CONFIG.DND5E.damageTypes);
      const [fx] = await def.createEmbeddedDocuments("ActiveEffect", [{ name: "Sword of Answering", img: sword.img, transfer: false,
        system: { changes: [chg("flags.midi-qol.advantage.attack.all", "1"), ...types.flatMap((t) => [chg("system.traits.idr.value", t, "add"), chg("system.traits.idi.value", t, "add")])] } }]);
      await useReaction(def);
      await runActivity(act, attackerTok);
      await fx?.delete().catch(() => {});
    }
  } catch (err) { console.warn(`${MODULE_ID} | Sword of Answering failed`, err); }
});

// ------------------------------------------------------------------ Periapt of Wound Closure: Hit Point Dice heal double
Hooks.on("dnd5e.rollHitDieV2", (rolls, { subject, updates }) => {
  try {
    if (!magicItem(subject, "periapt-of-wound-closure")) return;
    const hp = subject.system.attributes.hp;
    const now = Number(updates?.actor?.["system.attributes.hp.value"] ?? hp.value);
    const gained = now - hp.value;
    if (gained <= 0) return;
    updates.actor["system.attributes.hp.value"] = Math.min(Math.max(0, hp.effectiveMax ?? hp.max), hp.value + gained * 2);
  } catch (err) { console.warn(`${MODULE_ID} | Periapt of Wound Closure failed`, err); }
});

// ------------------------------------------------------------------ Passive effects
const SPELL_SAVE_ADV = chg("flags.midi-qol.advantage.save.all", 'workflow?.item?.type === "spell"');
PASSIVES.push(
  { key: "spellguard", active: (a) => !!magicItem(a, "spellguard-shield"),
    effect: { name: "Spellguard Shield", img: "icons/equipment/shield/heater-crystal-blue.webp",
      changes: [chg("flags.midi-qol.magicResistance.all", "1"), chg("flags.midi-qol.grants.disadvantage.attack.msak", "1"), chg("flags.midi-qol.grants.disadvantage.attack.rsak", "1")] } },
  { key: "archmagi", active: (a) => !!magicItem(a, "robe-of-the-archmagi"),
    effect: { name: "Robe of the Archmagi: Magic Resistance", img: "icons/equipment/chest/robe-layered-red.webp", changes: [chg("flags.midi-qol.magicResistance.all", "1")] } },
  { key: "spell-turning", active: (a) => !!magicItem(a, "ring-of-spell-turning"),
    effect: { name: "Ring of Spell Turning", img: "icons/equipment/finger/ring-band-engraved-scrolls-gold.webp", changes: [SPELL_SAVE_ADV] } },
  { key: "magi", active: (a) => !!magicItem(a, "staff-of-the-magi"),
    effect: { name: "Staff of the Magi: Spell Absorption", img: "icons/weapons/staves/staff-ornate-purple.webp", changes: [SPELL_SAVE_ADV] } },
  { key: "wound-closure", active: (a) => !!magicItem(a, "periapt-of-wound-closure"),
    effect: { name: "Periapt of Wound Closure", img: "icons/equipment/neck/amulet-round-gold-red.webp", changes: [chg("system.attributes.death.roll.min", "10", "upgrade")] } },
  { key: "vorpal", active: (a) => !!magicItem(a, "vorpal-sword"),
    effect: { name: "Vorpal Sword", img: "icons/weapons/swords/greatsword-crossguard-silver.webp", changes: [chg("system.traits.idr.value", "slashing", "add")] } }
);
ITEM_TOGGLES.push(
  // Arrow-Catching Shield: its +2 is only against ranged attacks (handled when hits are checked), never always-on.
  { ident: "arrow-catching-shield", keys: ["system.attributes.ac.bonus"], off: () => true },
  // Robe of the Archmagi: base AC 15 + DEX only while not wearing armor.
  { ident: "robe-of-the-archmagi", keys: ["system.attributes.ac.calc", "system.attributes.ac.formula"], off: wearsArmor }
);

// ------------------------------------------------------------------ Stop midi chaining these items' extra activity onto every attack
// midi runs an attack's sole "other activity" after every attack when none is chosen. On these compendium items that
// meant a save-or-die (Giant's Bane), a lost charge (Life Stealing, Withering, Striking) or a Restraint arrow on every
// hit. The module offers them at the right moment instead, so their attacks get otherActivityId "none".
const NO_CHAIN = ["hammer-of-thunderbolts", "nine-lives-stealer", "staff-of-withering", "staff-of-striking", "energy-bow", "oathbow", "staff-of-thunder-and-lightning",
  "mace-of-terror", "ring-of-the-ram", "staff-of-swarming-insects", "staff-of-the-woodlands"];
async function unchain(item) {
  if (!isGM() || !(item?.parent instanceof Actor) || !NO_CHAIN.some((id) => isMagicItem(item, id))) return;
  const upd = {};
  for (const a of item.system.activities?.contents ?? []) if (a.type === "attack" && !a.otherActivityId) upd[`system.activities.${a.id}.otherActivityId`] = "none";
  if (Object.keys(upd).length) await item.update(upd).catch((err) => console.warn(`${MODULE_ID} | unchain failed`, err));
}
Hooks.on("createItem", (item) => unchain(item));
// A compendium enchantment (e.g. "Nine Lives Stealer" put on a longsword) adds its activities through an effect.
Hooks.on("createActiveEffect", (effect) => { if (effect.parent instanceof Item) setTimeout(() => unchain(effect.parent), 300); });
Hooks.once("ready", () => { if (isGM()) for (const a of game.actors) for (const i of a.items) unchain(i); });

// ------------------------------------------------------------------ Ammunition of Slaying: DC 17 CON, 6d10 Force (half on a success)
// The creature type comes from the ammunition's name ("Arrow of Dragon Slaying", "Ammunition of Slaying (Undead)");
// if the name doesn't say, the archer is asked whether the creature hit is the right type.
const SLAY_TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "humanoid", "fey", "fiend", "giant", "monstrosity", "ooze", "plant", "undead"];
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const ammo = workflow?.ammunition ?? workflow?.ammo;
    if (!ammo || !(isMagicItem(ammo, "ammunition-of-slaying") || /slaying/i.test(ammo.name ?? ""))) return;
    const t = hits(workflow)[0];
    if (!t) return;
    const named = SLAY_TYPES.find((ty) => new RegExp(`\\b${ty.replace(/y$/, "(y|ie)")}s?(?![a-z])`, "i").test(ammo.name));
    const ok = named ? hasType(t.actor, named)
      : await askOwner(workflow.actor, `Ammunition of Slaying: ${workflow.actor.name}`, `<p>The ${ammo.name} hits ${t.name}. Is it the creature type this ammunition slays?</p>`);
    if (!ok) return;
    const saved = await save(t.actor, "con", 17, "Ammunition of Slaying");
    const roll = await new CONFIG.Dice.DamageRoll("6d10", {}, { type: "force", types: ["force"] }).evaluate();
    const dmg = saved ? Math.floor(roll.total / 2) : roll.total;
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: workflow.actor }), flavor: `Ammunition of Slaying (Force${saved ? ", half" : ""})` });
    await MidiQOL.applyTokenDamage([{ value: dmg, type: "force" }], dmg, new Set([t.object ?? t]), null, new Set(), {});
  } catch (err) { console.warn(`${MODULE_ID} | Ammunition of Slaying failed`, err); }
});

// ------------------------------------------------------------------ Passive items the compendium left empty
PASSIVES.push(
  // Eyes of the Eagle: Advantage on Wisdom (Perception) checks that rely on sight.
  { key: "eagle-eyes", active: (a) => !!magicItem(a, "eyes-of-the-eagle"),
    effect: { name: "Eyes of the Eagle", img: "icons/equipment/head/goggles-leather-blue.webp", changes: [chg("flags.midi-qol.advantage.skill.prc", "1")] } },
  // Slippers of Spider Climbing: a Climb Speed equal to your Speed.
  { key: "spider-slippers", active: (a) => !!magicItem(a, "slippers-of-spider-climbing"),
    effect: (a) => ({ name: "Slippers of Spider Climbing", img: "icons/equipment/feet/shoes-leather-simple-brown.webp",
      changes: [chg("system.attributes.movement.climb", String(Number(a.system.attributes.movement?.walk ?? 30) || 30), "upgrade")] }) },
  // Necklace of Adaptation: Advantage on saves against harmful gases and vapors (cloud spells, breath of poison gas).
  { key: "adaptation", active: (a) => !!magicItem(a, "necklace-of-adaptation"),
    effect: { name: "Necklace of Adaptation", img: "icons/equipment/neck/pendant-faceted-blue.webp",
      changes: [chg("flags.midi-qol.advantage.save.all", '/cloud|fog|gas|vapou?r|spores|poison breath/i.test(workflow?.item?.name ?? "")')] } }
);
PASSIVES.push(
  { key: "elven-boots", active: (a) => !!magicItem(a, "boots-of-elvenkind"),
    effect: { name: "Boots of Elvenkind", img: "icons/equipment/feet/boots-leather-green.webp", changes: [chg("flags.midi-qol.advantage.skill.ste", "1")] } },
  { key: "elven-cloak", active: (a) => !!magicItem(a, "cloak-of-elvenkind"),
    effect: { name: "Cloak of Elvenkind", img: "icons/equipment/back/cloak-hooded-green-gold.webp", changes: [chg("flags.midi-qol.advantage.skill.ste", "1")] } },
  // Gloves of Swimming and Climbing: the compendium's "@attributes.movement.walk" isn't evaluated for speeds.
  { key: "swim-climb-gloves", active: (a) => !!magicItem(a, "gloves-of-swimming-and-climbing"),
    effect: (a) => { const w = String(Number(a.system.attributes.movement?.walk ?? 30) || 30);
      return { name: "Gloves of Swimming and Climbing", img: "icons/equipment/hand/glove-ringed-cloth-brown.webp",
        changes: [chg("system.attributes.movement.climb", w, "upgrade"), chg("system.attributes.movement.swim", w, "upgrade")] }; } },
  // Ring of Free Action: magic can't make you Paralyzed or Restrained.
  { key: "free-action", active: (a) => !!magicItem(a, "ring-of-free-action"),
    effect: { name: "Ring of Free Action", img: "icons/equipment/finger/ring-band-engraved-scrolls-gold.webp",
      changes: [chg("system.traits.ci.value", "paralyzed", "add"), chg("system.traits.ci.value", "restrained", "add")] } }
);
// Belt of Dwarvenkind: the compendium ships its benefits effect switched off.
ITEM_TOGGLES.push({ ident: "belt-of-dwarvenkind", keys: ["system.abilities.con.value", "system.attributes.senses.darkvision"], off: () => false });

// ------------------------------------------------------------------ Elixir of Health: end Blinded, Deafened, Paralyzed and Poisoned
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    if (!isMagicItem(workflow?.item, "elixir-of-health")) return;
    const targets = Array.from(workflow.targets ?? []).map(tokenOf).map((t) => t?.actor).filter(Boolean);
    for (const a of targets.length ? targets : [workflow.actor]) {
      const ids = a.effects.filter((e) => ["blinded", "deafened", "paralyzed", "poisoned"].some((s) => e.statuses.has(s))).map((e) => e.id);
      if (ids.length) await MidiQOL.socket().executeAsGM("removeEffects", { actorUuid: a.uuid, effects: ids }).catch(() => {});
      if (ids.length) say(a, `<strong>Elixir of Health:</strong> ${a.name} is cured.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Elixir of Health failed`, err); }
});

// ------------------------------------------------------------------ Oil: a creature covered in oil takes 5 extra Fire damage (once)
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem }) => {
  try {
    const actor = token?.actor;
    const oil = actor?.effects?.find((e) => e.flags?.[MODULE_ID]?.oiled && !e.disabled);
    if (!oil || !(ditem.damageDetail ?? []).some((d) => d.type === "fire" && (d.value ?? 0) > 0)) return;
    const fire = ditem.damageDetail.find((d) => d.type === "fire");
    fire.value += 5;
    ditem.totalDamage = (ditem.totalDamage ?? 0) + 5;
    const extra = Math.min(5, Math.max(0, ditem.newHP ?? 0));
    ditem.hpDamage = (ditem.hpDamage ?? 0) + extra;
    ditem.newHP = (ditem.newHP ?? 0) - extra;
    await MidiQOL.socket().executeAsGM("removeEffects", { actorUuid: actor.uuid, effects: [oil.id] }).catch(() => {});
    say(actor, `<strong>Oil:</strong> ${actor.name} burns for 5 extra Fire damage.`);
  } catch (err) { console.warn(`${MODULE_ID} | Oil failed`, err); }
});

// ------------------------------------------------------------------ Sword of Life Stealing / Sword of Sharpness (2024)
// midi-qol's sample swords are the 2014 items with their own macros: those are left alone.
const hasMidiMacro = (item) => !!(item.flags?.["midi-qol"]?.onUseMacroName || item.flags?.dae?.macro?.command);
ON_HIT.push(
  { ident: "sword-of-life-stealing", label: "Sword of Life Stealing", builtIn: hasMidiMacro, bonus: async (wf) => (natural20(wf)
      && hits(wf).some((t) => !hasType(t.actor, "construct") && !hasType(t.actor, "undead")) ? [{ formula: "15", type: "necrotic", crit: false }] : null) },
  { ident: "sword-of-sharpness", label: "Sword of Sharpness", builtIn: hasMidiMacro, bonus: async (wf) => (natural20(wf) ? [{ formula: "14", type: "slashing", crit: false }] : null) }
);
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const item = workflow?.item, actor = workflow?.actor;
    if (!item || !actor || !natural20(workflow) || hasMidiMacro(item)) return;
    const targets = hits(workflow);
    if (isMagicItem(item, "sword-of-life-stealing") && attuned(item) && targets.some((t) => !hasType(t.actor, "construct") && !hasType(t.actor, "undead"))) {
      if (Number(actor.system.attributes.hp.temp ?? 0) < 15) { await gmUpdateActor(actor, { "system.attributes.hp.temp": 15 }); say(actor, `<strong>Sword of Life Stealing:</strong> ${actor.name} gains 15 Temporary Hit Points.`); }
    }
    if (isMagicItem(item, "sword-of-sharpness") && attuned(item)) for (const t of targets) {
      const lvl = Number(t.actor.system.attributes?.exhaustion ?? 0);
      if (lvl < 6) { await gmUpdateActor(t.actor, { "system.attributes.exhaustion": lvl + 1 }); say(t.actor, `<strong>Sword of Sharpness:</strong> ${t.name} gains 1 Exhaustion level.`); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Life Stealing / Sharpness failed`, err); }
});

// ------------------------------------------------------------------ Cloak of Displacement
// Attacks against you have Disadvantage; after you take damage the illusion fails until the start of your next turn;
// it doesn't work while your Speed is 0.
const displacementOff = (a) => a.effects.some((e) => e.flags?.[MODULE_ID]?.displacementOff && !e.disabled);
Hooks.on("midi-qol.preAttackRollConfig", (workflow) => {
  try {
    const def = tokenOf(Array.from(workflow?.targets ?? [])[0])?.actor;
    if (!def || def === workflow.actor || !magicItem(def, "cloak-of-displacement") || displacementOff(def)) return;
    if (Number(def.system.attributes.movement?.walk ?? 0) <= 0 || isIncapacitated(def)) return;
    workflow.attackRollModifierTracker?.disadvantage?.add?.("displacement", "Cloak of Displacement");
  } catch (err) { console.warn(`${MODULE_ID} | Cloak of Displacement failed`, err); }
});
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem }) => {
  try {
    const def = token?.actor;
    if (!def || !magicItem(def, "cloak-of-displacement") || displacementOff(def) || (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) <= 0) return;
    await addEffect(def, { name: "Displacement Suppressed", img: "icons/equipment/back/cape-layered-blue.webp", transfer: false, duration: { rounds: 1 },
      flags: { [MODULE_ID]: { displacementOff: true }, dae: { specialDuration: ["turnStart"] } } });
  } catch (err) { console.warn(`${MODULE_ID} | Cloak of Displacement suppression failed`, err); }
});
