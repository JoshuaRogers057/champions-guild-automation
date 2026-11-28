// Champions Guild Automation - priority-1 class and subclass features from Eberron: Forge of the Artificer, Ravenloft:
// The Horrors Within, Forgotten Realms: Heroes of Faerûn and Arcana Unleashed. Module rules keyed on the feature's
// identifier (or slugged name), so they work as soon as the module updates.
//  Artificer: Flash of Genius. Alchemist: Experimental Elixir, Alchemical Savant. Armorer: Armor Model riders.
//  Artillerist: Eldritch Cannon (one at a time, Force Ballista push), Arcane Firearm. Battle Smith: Battle Ready (INT
//  weapons), Steel Defender (Deflect Attack). Cartographer: Adventurer's Atlas, Portal Jump. Reanimator: Jolt to Life,
//  Reanimated Companion (Death Burst, Lightning Absorption). College of Spirits: Spirits from Beyond. College of the
//  Moon: Moon's Inspiration. Arcana Domain: Modify Magic. Grave Domain: Circle of Mortality, Path to the Grave. Arcane
//  Archer: Arcane Shot. Banneret: Group Recovery. Noble Genies: Elemental Smite, Genie's Splendor. Hollow Warden: Wrath
//  of the Wild. Winter Walker: Polar Strikes, Hunter's Rime. Phantom: Wails from the Grave. Scion of the Three:
//  Bloodthirst, Dread Allegiance. Shadow Sorcery: Strength of the Grave. Spellfire Sorcery: Spellfire Burst. Undead
//  Patron: Frightful Avatar. Vestige Patron: Divine Power. Bladesinger: Bladesong. Enchanter: Hypnotic Presence.
//  Necromancer: Undead Vitality.
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, turnKey, reduceDamage, gmUpdateTokens } from "./main.js";
import { canReact, useReaction, say, tokenOf, isGM, chg, creatureType } from "./item-rules.js";
import { feat, spend } from "./background-feats.js";
import { blinkNextMove } from "./background-feats-p2.js";
import { addEffect, updateActor, usedThisTurn, markTurn, hpOf, isBloodied } from "./feat-rules-books.js";
import { classLevel, bardicDie } from "./class-rules.js";

const asGM = (fn, data) => MidiQOL.socket().executeAsGM(fn, data).catch((err) => console.warn(`${MODULE_ID} | ${fn} failed`, err));
const mod = (a, abl) => Number(a?.system?.abilities?.[abl]?.mod ?? 0);
const usesOf = (item) => Number(item?.system?.uses?.value ?? 0);
const alive = (a) => Number(hpOf(a).value ?? 0) > 0;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const tokensOf = (actor) => actor?.getActiveTokens?.(false, true) ?? [];
const sceneTokens = (doc) => Array.from(doc?.parent?.tokens ?? canvas.scene?.tokens ?? []);
const hostile = (a, b) => a && b && a.disposition !== b.disposition && a.disposition !== 0 && b.disposition !== 0;
const myTurn = (actor) => !game.combat?.started || game.combat.combatant?.actor === actor || game.combat.combatant?.actorId === actor?.id;
const hits = (wf) => Array.from(wf?.hitTargets ?? []).map(tokenOf).filter((t) => t?.actor);
const targetsOf = (wf) => Array.from(wf?.targets ?? []).map(tokenOf).filter((t) => t?.actor);
const isAttack = (wf) => wf?.activity?.type === "attack";
const isWeaponAttack = (wf) => isAttack(wf) && (wf.item?.type === "weapon" || wf.activity?.attack?.type?.classification === "weapon");
const rangedAttack = (wf) => isAttack(wf) && wf.activity?.attack?.type?.value === "ranged";
const meleeAttack = (wf) => isAttack(wf) && wf.activity?.attack?.type?.value === "melee";
const hidden = (wf) => !!wf?.activity?.midiProperties?.automationOnly;
const summonOrigin = (a) => { const o = a?.flags?.dnd5e?.summon?.origin; return o ? fromUuidSync(o) : null; };
const summonerOf = (a) => { const it = summonOrigin(a); return it?.actor ?? it?.parent ?? null; };
async function heal(actor, amount) {
  const hp = hpOf(actor);
  await updateActor(actor, { "system.attributes.hp.value": Math.min(Number(hp.effectiveMax ?? hp.max), Number(hp.value) + Math.max(0, amount)) });
}
async function tempHP(actor, amount) { if (Number(hpOf(actor).temp ?? 0) < amount) await updateActor(actor, { "system.attributes.hp.temp": amount }); }
async function removeEffects(actor, ids) {
  if (!ids.length) return;
  if (actor.isOwner) await actor.deleteEmbeddedDocuments("ActiveEffect", ids).catch(() => {});
  else await asGM("removeEffects", { actorUuid: actor.uuid, effects: ids });
}
async function removeStatus(actor, status) { await removeEffects(actor, actor.effects.filter((e) => e.statuses.has(status)).map((e) => e.id)); }
async function statusEffect(id, extra = {}) {
  const s = CONFIG.statusEffects.find((x) => x.id === id);
  return { name: game.i18n.localize(s?.name ?? cap(id)), img: s?.img ?? "icons/svg/aura.svg", statuses: [id], transfer: false, ...extra };
}
const turnOnce = new Map();
const onceKey = (k) => { if (turnOnce.get(k) === turnKey()) return false; turnOnce.set(k, turnKey()); return true; };
// Bonus damage on the current workflow.
async function bonusRoll(workflow, formula, type, flavor) {
  const roll = await new CONFIG.Dice.DamageRoll(String(formula), workflow.actor?.getRollData?.() ?? {}, { type, types: [type], flavor }).evaluate();
  await workflow.setBonusDamageRolls([...(workflow.bonusDamageRolls ?? []), roll]);
  return roll;
}
const rollTypes = (r) => [r.options?.type, ...(r.options?.types ?? [])].filter(Boolean);
function retotal(roll) { try { roll._total = roll._evaluateTotal(); } catch (err) { roll._total = roll.terms.reduce((s, t) => s + (Number(t.total) || 0), 0); } }

// ------------------------------------------------------------------ Running an item's hidden activity with a formula chosen at run time
const pendingFormula = new Map(); // activity uuid -> formula
Hooks.on("dnd5e.preRollDamageV2", (config) => {
  const act = config?.subject;
  const f = act?.uuid && pendingFormula.get(act.uuid);
  if (f && config.rolls?.[0]) { config.rolls[0].parts = [f]; pendingFormula.delete(act.uuid); return; }
  // Piercing / Seeking Shot: your ranged weapon's damage + 2 Arcane Shot dice
  const id = act?.midiProperties?.identifier;
  if (/^cgashot-/.test(id ?? "") && config.rolls?.[0]) config.rolls[0].parts = [shotWeaponFormula(act.actor, 2)];
});
async function runAct(item, identifier, targets, { formula } = {}) {
  const act = item?.system?.activities?.find((a) => a.midiProperties?.identifier === identifier);
  if (!act) return null;
  if (formula) pendingFormula.set(act.uuid, String(formula));
  try {
    return await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: targets.map((t) => tokenOf(t).uuid), workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {});
  } catch (err) { console.warn(`${MODULE_ID} | ${identifier} failed`, err); return null; }
  finally { pendingFormula.delete(act.uuid); }
}

// ------------------------------------------------------------------ Resources other features spend (Channel Divinity, Favored Enemy, Arcane Shot, Bardic Inspiration)
const CD_IDS = ["channel-divinity", "channel-divinity-cleric", "channel-divinity-paladin"];
const cdItem = (a) => a?.items?.find((i) => (CD_IDS.includes(i.system?.identifier) || /^channel divinity/i.test(i.name)) && i.system?.uses?.max);
const biItem = (a) => a?.items?.find((i) => (i.system?.identifier === "bardic-inspiration" || /^bardic inspiration$/i.test(i.name)) && i.system?.uses?.max);
const feItem = (a) => a?.items?.find((i) => (i.system?.identifier === "favored-enemy" || /^favou?red enemy/i.test(i.name)) && i.system?.uses?.max);
const RESOURCE_ACTS = {
  "cgacd-path-to-the-grave": { find: cdItem, label: "Channel Divinity" },
  "wrath-of-the-wild": { find: feItem, label: "Favored Enemy" },
  "cgashot-piercing-shot": { find: (a) => feat(a, "arcane-shot"), label: "Arcane Shot" },
  "cgashot-seeking-shot": { find: (a) => feat(a, "arcane-shot"), label: "Arcane Shot" },
  "spirits-controlled": { find: biItem, label: "Bardic Inspiration" },
  "sp3-beast": { find: (a) => spItem(a), label: "Sorcery Points", cost: 3 },
  "sp3-beast-nc": { find: (a) => spItem(a), label: "Sorcery Points", cost: 3 }
};
const spItem = (a) => a?.items?.find((i) => (["font-of-magic", "sorcery-points"].includes(i.system?.identifier) || /^(font of magic|sorcery points)$/i.test(i.name)) && i.system?.uses?.max);
Hooks.on("dnd5e.preUseActivity", (activity) => {
  let id = activity?.midiProperties?.identifier ?? "";
  // a spell cast from a feature's cast activity: the hook fires on the spell's own activity
  const via = activity?.item?.getFlag?.("dnd5e", "cachedFor");
  if (via && !RESOURCE_ACTS[id] && !/^cgacd-/.test(id)) id = fromUuidSync(via, { relative: activity.actor })?.midiProperties?.identifier ?? id;
  const r = RESOURCE_ACTS[id] ?? (/^cgacd-/.test(id) ? { find: cdItem, label: "Channel Divinity" } : null);
  if (!r) return;
  const item = r.find(activity.actor), cost = r.cost ?? 1;
  if (!item || usesOf(item) < cost) { ui.notifications.warn(`${activity.item?.name}: not enough ${r.label} (needs ${cost}).`); return false; }
  if (cost === 1) spend(item);
  else item.update({ "system.uses.spent": Number(item.system.uses.spent ?? 0) + cost });
});

// ------------------------------------------------------------------ Genie's Splendor: an unarmored AC option (10 + DEX + CHA, Shield allowed)
Hooks.once("init", () => {
  CONFIG.DND5E.armorClasses.genieSplendor = { label: "Genie's Splendor", formula: "10 + @abilities.dex.mod + @abilities.cha.mod", armored: false };
});

// ------------------------------------------------------------------ Flash of Genius: Reaction bonus to a failed check or save within 30 ft
async function flashOfGenius(tDoc, total, dc, what) {
  for (const h of sceneTokens(tDoc)) {
    const a = h.actor, it = a && feat(a, "flash-of-genius");
    if (!it || usesOf(it) < 1 || !canReact(a)) continue;
    if (h !== tDoc && (h.disposition !== tDoc.disposition || edgeDistance(h, tDoc, h.parent) > 30)) continue;
    const bonus = Math.max(1, mod(a, "int"));
    if (total + bonus < dc) continue;
    if (!(await askOwner(a, `Flash of Genius: ${a.name}`, `<p>${tDoc.name} fails a DC ${dc} ${what} (${total}). Use your Reaction to add +${bonus}?</p>`))) continue;
    await spend(it); await useReaction(a);
    say(a, `<strong>Flash of Genius:</strong> ${tDoc.name}'s ${what} is now ${total + bonus} (DC ${dc}) - ${total + bonus >= dc ? "a success" : "still a failure"}.`);
    // Ingenious Movement (Cartographer 9): a 30-ft teleport for you or the creature
    if (feat(a, "ingenious-movement")) {
      const who = await askChoice(a, `Ingenious Movement: ${a.name}`, "<p>Teleport someone up to 30 ft as part of the Reaction?</p>",
        [{ action: "me", label: h.name, default: true }, ...(h !== tDoc ? [{ action: "them", label: tDoc.name }] : []), { action: "none", label: "No" }]);
      if (who === "me") await blinkNextMove(a, "Ingenious Movement", 30); else if (who === "them") await blinkNextMove(tDoc.actor, "Ingenious Movement", 30);
    }
    return bonus;
  }
  return 0;
}
const flashSeen = new WeakSet();
for (const h of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"]) Hooks.on(h, async (rolls, data) => {
  try {
    const roll = rolls?.[0], actor = data?.subject;
    if (!roll || !actor || flashSeen.has(roll) || /save/i.test(roll.options?.rollType ?? "")) return;
    flashSeen.add(roll);
    const dc = Number(roll.options?.target);
    const tDoc = tokensOf(actor)[0];
    if (!dc || !tDoc || roll.total >= dc) return;
    await flashOfGenius(tDoc, Number(roll.total), dc, "check");
  } catch (err) { console.warn(`${MODULE_ID} | Flash of Genius (check) failed`, err); }
});

// ------------------------------------------------------------------ Saves: Flash of Genius, Tenacious Spell (Modify Magic)
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    const dc = Number(workflow?.activity?.save?.dc?.value ?? workflow?.saveDC ?? 0);
    if (!dc) return;
    for (const t of Array.from(workflow.failedSaves ?? [])) {
      const tDoc = tokenOf(t), roll = workflow.targetSaveDetails?.[tDoc?.uuid]?.saveRoll;
      if (!roll) continue;
      const add = await flashOfGenius(tDoc, Number(roll.total), dc, "save");
      if (!add) continue;
      roll._total = Number(roll.total) + add;
      if (roll._total >= dc) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); }
    }
    // Tenacious Spell: a creature that succeeds on a save against your spell subtracts 1d6 (Channel Divinity)
    const caster = workflow.actor, mm = feat(caster, "modify-magic"), cd = cdItem(caster);
    if (mm && cd && usesOf(cd) > 0 && workflow.item?.type === "spell" && !workflow.cgaModify) {
      for (const t of Array.from(workflow.saves ?? [])) {
        const tDoc = tokenOf(t), roll = workflow.targetSaveDetails?.[tDoc?.uuid]?.saveRoll;
        if (!roll || Number(roll.total) - 6 >= dc || !hostile(tDoc, tokenOf(workflow.token))) continue;
        if (!(await askOwner(caster, `Tenacious Spell: ${caster.name}`, `<p>${tDoc.name} saves against ${workflow.item.name} (${roll.total} vs DC ${dc}). Spend Channel Divinity to subtract 1d6 from it?</p>`))) break;
        workflow.cgaModify = true;
        await spend(cd);
        const d = await new Roll("1d6").evaluate();
        roll._total = Number(roll.total) - d.total;
        await d.toMessage({ speaker: ChatMessage.getSpeaker({ actor: caster }), flavor: `Tenacious Spell: ${tDoc.name}'s save drops to ${roll._total} (DC ${dc})` });
        if (roll._total < dc) { workflow.saves.delete(t); workflow.failedSaves?.add?.(t); }
        break;
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | book class save rules failed`, err); }
});

// ------------------------------------------------------------------ Experimental Elixir
const ELIXIRS = {
  healing: { label: "Healing", img: "icons/consumables/potions/bottle-round-corked-red.webp" },
  swiftness: { label: "Swiftness", img: "icons/consumables/potions/bottle-round-corked-yellow.webp" },
  resilience: { label: "Resilience", img: "icons/consumables/potions/bottle-round-corked-blue.webp" },
  boldness: { label: "Boldness", img: "icons/consumables/potions/bottle-round-corked-orante-red.webp" },
  flight: { label: "Flight", img: "icons/consumables/potions/bottle-round-corked-pink.webp" }
};
const ELIXIR_ROLL = ["healing", "swiftness", "resilience", "boldness", "flight"];
function elixirData(kind, art) {
  const L = classLevel(art, "artificer"), tier = L >= 15 ? 2 : L >= 9 ? 1 : 0, int = mod(art, "int");
  const e = ELIXIRS[kind], actId = foundry.utils.randomID(), fxId = foundry.utils.randomID();
  const base = { _id: actId, type: kind === "healing" ? "heal" : "utility", name: "Drink or Administer", activation: { type: "bonus", value: 1, condition: "" },
    consumption: { targets: [{ type: "itemUses", value: "1", target: "", scaling: {} }], scaling: { allowed: false }, spellSlot: false },
    range: { units: "ft", value: "5" }, target: { affects: { count: "1", type: "creature" }, template: {} } };
  let effect = null, text;
  if (kind === "healing") {
    base.healing = { custom: { enabled: true, formula: `${2 + tier}d8 + ${int}` }, types: ["healing"] };
    text = `The drinker regains ${2 + tier}d8 + ${int} Hit Points.`;
  } else {
    const spec = {
      swiftness: [[chg("system.attributes.movement.walk", String(10 + 5 * tier), "add")], 3600, `Speed +${10 + 5 * tier} ft for 1 hour.`],
      resilience: [[chg("system.attributes.ac.bonus", "+1", "add")], [600, 3600, 28800][tier], `+1 AC for ${["10 minutes", "1 hour", "8 hours"][tier]}.`],
      boldness: [["mwak", "rwak", "msak", "rsak"].map((k) => chg(`system.bonuses.${k}.attack`, "+1d4", "add")).concat([chg("system.bonuses.abilities.save", "+1d4", "add")]), [60, 600, 3600][tier], `+1d4 to attack rolls and saving throws for ${["1 minute", "10 minutes", "1 hour"][tier]}.`],
      flight: [[chg("system.attributes.movement.fly", String(10 * (tier + 1)), "upgrade")], 600, `Fly Speed ${10 * (tier + 1)} ft for 10 minutes.`]
    }[kind];
    effect = { _id: fxId, name: `Experimental Elixir: ${e.label}`, img: e.img, transfer: false, system: { changes: spec[0] }, duration: { seconds: spec[1] }, flags: { dae: { stackable: "noneName" } } };
    base.effects = [{ _id: fxId }];
    text = spec[2];
  }
  return { name: `Experimental Elixir (${e.label})`, type: "consumable", img: e.img, effects: effect ? [effect] : [],
    system: { type: { value: "potion", subtype: "" }, quantity: 1, uses: { max: "1", spent: 0, autoDestroy: true, recovery: [] }, properties: ["mgc"],
      description: { value: `<p>Made by ${art.name}'s Experimental Elixir. Bonus Action: drink it or give it to a creature within 5 ft. ${text} It vanishes when ${art.name} finishes a Long Rest.</p>` },
      activities: { [actId]: base } },
    flags: { world: { cgaElixir: art.uuid } } };
}
async function pickElixir(actor) {
  const k = await askChoice(actor, `Experimental Elixir: ${actor.name}`, "<p>Choose the elixir's effect.</p>", ELIXIR_ROLL.map((x, i) => ({ action: x, label: ELIXIRS[x].label, default: i === 0 })));
  return ELIXIRS[k] ? k : "healing";
}
async function brewElixirs(actor) {
  const L = classLevel(actor, "artificer"), n = 2 + (L >= 5) + (L >= 9) + (L >= 15);
  const old = actor.items.filter((i) => i.flags?.world?.cgaElixir === actor.uuid).map((i) => i.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old).catch(() => {});
  const kinds = [];
  for (let i = 0; i < n; i++) { const r = (await new Roll("1d6").evaluate()).total; kinds.push(r === 6 ? await pickElixir(actor) : ELIXIR_ROLL[r - 1]); }
  await actor.createEmbeddedDocuments("Item", kinds.map((k) => elixirData(k, actor)));
  say(actor, `<strong>Experimental Elixir:</strong> ${actor.name} brews ${kinds.map((k) => ELIXIRS[k].label).join(", ")}.`);
}

// ------------------------------------------------------------------ Workflow done: activities, follow-ups and after-hit rules
const shotPending = new WeakMap();
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, act = workflow?.activity, item = workflow?.item;
    if (!actor || !act) return;
    const id = act.midiProperties?.identifier ?? "";
    const me = tokenOf(workflow.token) ?? tokensOf(actor)[0];
    const tgt = hits(workflow)[0] ?? targetsOf(workflow)[0];

    // ---- feature activities
    if (id === "elixir-brew") return brewElixirs(actor);
    if (id === "elixir-create") { const k = await pickElixir(actor); await actor.createEmbeddedDocuments("Item", [elixirData(k, actor)]); return say(actor, `<strong>Experimental Elixir:</strong> ${actor.name} makes an elixir of ${ELIXIRS[k].label}.`); }
    if (/^model-/.test(id)) {
      const model = id.slice(6);
      await item.setFlag("world", "cgaModel", model);
      const inf = item.effects.find((e) => /^Infiltrator/.test(e.name));
      if (inf && inf.disabled !== (model !== "infiltrator")) await inf.update({ disabled: model !== "infiltrator" });
      return say(actor, `<strong>Armor Model:</strong> ${actor.name}'s Arcane Armor is now the ${cap(model)} model.`);
    }
    if (id === "adventurers-atlas") return atlasCleanup(item, targetsOf(workflow).map((t) => t.actor));
    if (id === "portal-jump") {
      const atlas = feat(actor, "adventurers-atlas");
      const holder = atlas && me && sceneTokens(me).some((o) => o !== me && o.actor?.effects?.some((e) => (e.origin ?? "").startsWith(atlas.uuid)) && edgeDistance(me, o, me.parent) <= 30);
      return blinkNextMove(actor, "Portal Jump", holder ? 35 : 10);
    }
    if (id === "spirits-controlled") return controlledChanneling(actor, item);
    if (id === "spirits-unleash") return unleashSpirit(actor, item, tgt);
    if (id === "cgacd-path-to-the-grave") return;
    if (id === "wrath-of-the-wild") return unnervingAura(actor, me);
    if (id === "form-of-dread") return removeStatus(actor, "frightened");
    if (id === "marid-surge") { for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf)) if (me && t?.object) await MidiQOL.moveTokenAwayFromPoint(t.object, 15, me.object?.center ?? me.center, { animate: false, autoRotate: false }).catch(() => {}); return; }
    if (/^dread-(bane|bhaal|myrkul)$/.test(id)) {
      const keep = id.slice(6);
      return removeEffects(actor, actor.effects.filter((e) => e.flags?.world?.cgaAllegiance && e.flags.world.cgaAllegiance !== keep).map((e) => e.id));
    }
    if (id === "healing-touch" && tgt) { for (const s of ["blinded", "deafened", "poisoned"]) if (tgt.actor.statuses.has(s)) { await removeStatus(tgt.actor, s); break; } return; }
    if (id === "fiendish-swap") return fiendishSwap(actor, me);
    if (id === "cursed-invocation" && tgt) return cursedInvocation(actor, tgt);
    if (id === "force-ballista" && hits(workflow).length && me) { const t = hits(workflow)[0]; if (t.object) await MidiQOL.moveTokenAwayFromPoint(t.object, 5, me.object?.center ?? me.center, { animate: false, autoRotate: false }).catch(() => {}); return; }
    if (id === "force-demolisher" && hits(workflow).length && me) return demolisher(actor, me, hits(workflow)[0]);
    if (id === "thunder-pulse" && hits(workflow).length) {
      const t = hits(workflow)[0];
      return addEffect(t.actor, { name: `Thunder Pulse (Disadvantage on attacks not against ${actor.name})`, img: "icons/magic/sonic/explosion-shock-wave-teal.webp", origin: item.uuid, transfer: false,
        duration: { value: null, units: "rounds", expiry: "sourceStart" }, system: { changes: [chg("flags.midi-qol.disadvantage.attack.all", `targetActorUuid !== "${actor.uuid}"`)] } });
    }
    if (hidden(workflow)) return;

    // ---- Arcane Shot follow-up (save / burst) on the hit target
    const shot = shotPending.get(workflow);
    if (shot && shot.target?.actor && alive(shot.target.actor)) {
      if (shot.key === "bursting-shot") {
        const around = sceneTokens(shot.target).filter((o) => o.actor && alive(o.actor) && (o === shot.target || edgeDistance(o, shot.target, o.parent) <= 10));
        await runAct(shot.option, "bursting-shot-damage", around, { formula: `2d${shot.die}` });
      } else await runAct(shot.option, `${shot.key}-save`, [shot.target]);
    }

    // ---- Bardic Inspiration given: Spirits from Beyond, Inspired Eclipse
    if (item?.system?.identifier === "bardic-inspiration" || /^bardic inspiration$/i.test(item?.name ?? "")) {
      const sp = feat(actor, "spirits-from-beyond");
      if (sp && await askOwner(actor, `Spirits from Beyond: ${actor.name}`, `<p>Call forth a random spirit (roll your d${bardicDie(actor)} Bardic Inspiration die)?</p>`)) {
        const r = await new Roll(`1d${bardicDie(actor)}`).evaluate();
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Spirits from Beyond: ${SPIRITS[r.total - 1]}` });
        let n = r.total;
        // Mystical Connection (College of Spirits 14): roll twice and choose; doubles let you pick any spirit
        if (feat(actor, "mystical-connection")) {
          const r2 = await new Roll(`1d${bardicDie(actor)}`).evaluate();
          await r2.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Mystical Connection: ${SPIRITS[r2.total - 1]}` });
          const opts = r2.total === r.total ? SPIRITS.map((_, i) => i + 1) : [r.total, r2.total];
          const p = await askChoice(actor, `Mystical Connection: ${actor.name}`, `<p>${r2.total === r.total ? "Doubles - choose any spirit." : "Choose one of the two spirits."}</p>`, opts.map((k, i) => ({ action: String(k), label: `${k}. ${SPIRITS[k - 1]}`, default: i === 0 })));
          if (opts.includes(Number(p))) n = Number(p);
        }
        await channel(sp, n);
      }
      const moon = feat(actor, "moons-inspiration");
      if (moon && await askOwner(actor, `Inspired Eclipse: ${actor.name}`, "<p>Turn Invisible (until the start of your next turn, or until you attack, deal damage or cast a spell) and teleport up to 30 ft?</p>")) {
        await addEffect(actor, await statusEffect("invisible", { name: "Inspired Eclipse (Invisible)", origin: moon.uuid, duration: { value: null, units: "rounds", expiry: "sourceStart" },
          flags: { dae: { stackable: "noneName", specialDuration: ["1Attack", "1Spell"] } } }));
        await blinkNextMove(actor, "Inspired Eclipse", 30);
        const rec = targetsOf(workflow)[0];
        if (feat(actor, "eventides-splendor") && rec && rec.actor !== actor && await askOwner(rec.actor, `Shadow of the New Moon: ${rec.name}`, "<p>Turn Invisible until the start of your next turn and use your Reaction to teleport up to 30 ft?</p>")) {
          if (canReact(rec.actor)) await useReaction(rec.actor);
          await addEffect(rec.actor, await statusEffect("invisible", { name: "Shadow of the New Moon (Invisible)", flags: { dae: { stackable: "noneName", specialDuration: ["turnStart"] } } }));
          await blinkNextMove(rec.actor, "Shadow of the New Moon", 30);
        }
      }
    }

    // ---- Second Wind: Group Recovery
    if ((item?.system?.identifier === "second-wind" || /^second wind$/i.test(item?.name ?? "")) && me) await groupRecovery(actor, me);

    // ---- spells
    if (item?.type === "spell") {
      // Jolt to Life
      const rss = feat(actor, "reanimators-skill-set");
      if (rss && /spare the dying/i.test(item.name) && tgt && usesOf(rss) > 0
        && await askOwner(actor, `Jolt to Life: ${actor.name}`, `<p>Jolt ${tgt.name} back to life (${classLevel(actor, "artificer")} HP and a 10-ft Lightning burst)? ${usesOf(rss)} use(s) left.</p>`)) {
        await spend(rss);
        await heal(tgt.actor, classLevel(actor, "artificer"));
        const burst = sceneTokens(tgt).filter((o) => o.actor && o !== tgt && alive(o.actor) && hostile(o, me) && edgeDistance(o, tgt, o.parent) <= 10);
        if (burst.length) await runAct(rss, "jolt-to-life-save", burst);
        say(actor, `<strong>Jolt to Life:</strong> ${tgt.name} regains ${classLevel(actor, "artificer")} HP.`);
      }
      // Hunter's Rime
      if (/hunter'?s mark/i.test(item.name) && !/move/i.test(act.name ?? "") && feat(actor, "hunters-rime")) {
        const r = await new Roll(`1d10 + ${classLevel(actor, "ranger")}`).evaluate();
        await tempHP(actor, r.total);
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Hunter's Rime: ${r.total} Temporary Hit Points` });
      }
      // Elemental Smite
      if (/divine smite/i.test(item.name) && feat(actor, "elemental-smite") && tgt) await elementalSmite(actor, me, tgt, feat(actor, "elemental-smite"));
      // Fortifying Spell (Modify Magic)
      const mm = feat(actor, "modify-magic"), cd = cdItem(actor);
      if (mm && cd && usesOf(cd) > 0 && !workflow.cgaModify && me) {
        const friends = targetsOf(workflow).filter((t) => t.disposition === me.disposition);
        if (friends.length) {
          const pick = await askChoice(actor, `Fortifying Spell: ${actor.name}`, `<p>Spend Channel Divinity to give one target of ${item.name} 2d8 + ${classLevel(actor, "cleric")} Temporary Hit Points?</p>`,
            [...friends.map((t, i) => ({ action: t.id, label: t.name, default: i === 0 })), { action: "none", label: "No" }]);
          const t = friends.find((x) => x.id === pick);
          if (t) {
            workflow.cgaModify = true;
            await spend(cd);
            const r = await new Roll(`2d8 + ${classLevel(actor, "cleric")}`).evaluate();
            await tempHP(t.actor, r.total);
            await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Fortifying Spell: ${t.name} gains ${r.total} Temporary Hit Points` });
          }
        }
      }
      // Undead Vitality (Necromancy Spellbook)
      const ns = feat(actor, "necromancy-spellbook");
      const slot = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? item.system.level ?? 0);
      if (ns && item.system.school === "nec" && slot >= 1 && Number(item.system.level) >= 1 && me) {
        const undead = sceneTokens(me).filter((o) => o.actor && /undead/i.test(creatureType(o.actor)) && alive(o.actor)
          && Number(hpOf(o.actor).value) < Number(hpOf(o.actor).max) && edgeDistance(me, o, me.parent) <= 60);
        if (undead.length) {
          const amt = slot + classLevel(actor, "wizard");
          const pick = await askChoice(actor, `Undead Vitality: ${actor.name}`, `<p>Heal an Undead within 60 ft by ${amt}?</p>`,
            [...undead.map((t, i) => ({ action: t.id, label: t.name, default: i === 0 })), { action: "none", label: "No" }]);
          const t = undead.find((x) => x.id === pick);
          if (t) { await heal(t.actor, amt); say(actor, `<strong>Undead Vitality:</strong> ${t.name} regains ${amt} HP.`); }
        }
      }
    }

    // ---- after a hit on your turn: Wails from the Grave
    if (workflow.cgaSneak && feat(actor, "wails-from-the-grave") && myTurn(actor)) await wails(actor, workflow);
    // ---- Frightful Avatar (once per turn on a hit while in Form of Dread)
    const fa = feat(actor, "form-of-dread");
    if (fa && isAttack(workflow) && hits(workflow).length && actor.effects.some((e) => e.flags?.world?.cgaFormOfDread && !e.disabled) && !usedThisTurn("frightful-avatar", actor)) {
      const t = hits(workflow)[0];
      if (alive(t.actor) && await askOwner(actor, `Frightful Avatar: ${actor.name}`, `<p>Force ${t.name} to make a WIS save or be Frightened until the end of your next turn?</p>`)) {
        markTurn("frightful-avatar", actor);
        await runAct(fa, "frightful-avatar", [t]);
      }
    }
    // ---- creatures damaged: Bloodthirst, Prowling Retribution
    await afterDamage(workflow, me);
  } catch (err) { console.warn(`${MODULE_ID} | book class RollComplete rules failed`, err); }
});

// ------------------------------------------------------------------ Damage rolls: Alchemical Savant, Arcane Firearm, Lightning Launcher, Pull of Death,
// Polar Strikes, maximized healing (Circle of Mortality), Lunar Vitality, Path to the Grave, Arcane Shot
const artificerSpell = (item, actor) => item?.type === "spell" && (item.system.sourceClass === "artificer" || (!item.system.sourceClass && classLevel(actor, "artificer") > 0));
const shotDie = (a) => { const l = classLevel(a, "fighter"); return l >= 18 ? 12 : l >= 15 ? 10 : l >= 10 ? 8 : 6; };
const SHOTS = {
  "banishing-shot": { n: 1, type: "psychic" }, "beguiling-shot": { n: 2, type: "psychic" }, "bursting-shot": { n: 0 },
  "enfeebling-shot": { n: 2, type: "necrotic" }, "grasping-shot": { n: 1, type: "slashing" }, "shadow-shot": { n: 1, type: "psychic" }
};
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item, act = workflow?.activity;
    if (!actor || !workflow.damageRolls?.length || hidden(workflow)) return;
    const types = workflow.damageRolls.flatMap(rollTypes);
    const healing = types.includes("healing");
    const me = tokenOf(workflow.token);
    // Artificer spells
    if (artificerSpell(item, actor)) {
      if (feat(actor, "alchemical-savant") && !workflow.cgaSavant) {
        const t = types.find((x) => ["acid", "fire", "poison", "healing"].includes(x));
        if (t) { workflow.cgaSavant = true; await bonusRoll(workflow, String(Math.max(1, mod(actor, "int"))), t, "Alchemical Savant"); }
      }
      if (feat(actor, "arcane-firearm") && !workflow.cgaFirearm && !healing && types.length) {
        workflow.cgaFirearm = true;
        await bonusRoll(workflow, "1d8", types.find((x) => x !== "temphp") ?? types[0], "Arcane Firearm");
      }
    }
    // Lightning Launcher: +1d6 Lightning once per turn
    if (act?.midiProperties?.identifier === "lightning-launcher" && hits(workflow).length && !usedThisTurn("lightning-launcher", actor)) {
      markTurn("lightning-launcher", actor);
      await bonusRoll(workflow, "1d6", "lightning", "Lightning Launcher");
    }
    // Pull of Death: +1d4 Necrotic (1d6 at 11) once per turn against a single creature that's missing HP
    if (feat(actor, "circle-of-mortality") && !healing && (item?.type === "spell" || (isAttack(workflow) && hits(workflow).length)) && !usedThisTurn("pull-of-death", actor)) {
      const ts = isAttack(workflow) ? hits(workflow) : targetsOf(workflow);
      if (ts.length === 1 && Number(hpOf(ts[0].actor).value) < Number(hpOf(ts[0].actor).max)) {
        markTurn("pull-of-death", actor);
        await bonusRoll(workflow, classLevel(actor, "cleric") >= 11 ? "1d6" : "1d4", "necrotic", "Pull of Death");
      }
    }
    // Circle of Mortality: healing dice are maximized on a creature at 0 HP (spells and Channel Divinity)
    if (healing && feat(actor, "circle-of-mortality") && (item?.type === "spell" || cdItem(actor)?.id === item?.id || /channel divinity/i.test(item?.name ?? ""))) {
      const ts = targetsOf(workflow);
      if (ts.length === 1 && Number(hpOf(ts[0].actor).value) <= 0) {
        for (const r of workflow.damageRolls) { for (const d of r.dice ?? []) for (const res of d.results ?? []) res.result = d.faces; retotal(r); }
        await workflow.setDamageRolls(workflow.damageRolls);
        say(actor, `<strong>Circle of Mortality:</strong> the healing dice are maximized for ${ts[0].name}.`);
      }
    }
    // Polar Strikes: +1d4 Cold (1d6 at 11) on a weapon hit; each creature only once per turn
    if (feat(actor, "frigid-explorer") && isWeaponAttack(workflow) && hits(workflow).length && onceKey(`polar:${hits(workflow)[0].uuid}`))
      await bonusRoll(workflow, classLevel(actor, "ranger") >= 11 ? "1d6" : "1d4", "cold", "Polar Strikes");
    // Lunar Vitality: once per turn, spend a Bardic Inspiration die to add it to a spell's healing
    const moon = feat(actor, "moons-inspiration"), bi = biItem(actor);
    const fullMoon = !!feat(actor, "eventides-splendor");
    let lunar = null;
    if (moon && healing && item?.type === "spell" && ((bi && usesOf(bi) > 0) || fullMoon) && !usedThisTurn("lunar-vitality", actor)) {
      const opts = [...(bi && usesOf(bi) > 0 ? [{ action: "bi", label: `Bardic Inspiration (1d${bardicDie(actor)})`, default: !fullMoon }] : []), ...(fullMoon ? [{ action: "d6", label: "Full Moon (1d6, free)", default: true }] : []), { action: "none", label: "No" }];
      lunar = await askChoice(actor, `Lunar Vitality: ${actor.name}`, `<p>Add to ${item.name}'s healing (+10 ft Speed for the creature)?</p>`, opts);
    }
    if (lunar === "bi" || lunar === "d6") {
      markTurn("lunar-vitality", actor);
      if (lunar === "bi") await spend(bi);
      await bonusRoll(workflow, lunar === "bi" ? `1d${bardicDie(actor)}` : "1d6", "healing", "Lunar Vitality");
      for (const t of targetsOf(workflow)) await addEffect(t.actor, { name: "Lunar Vitality (+10 ft Speed)", img: "icons/magic/nature/moon-crescent.webp", origin: moon.uuid, transfer: false,
        system: { changes: [chg("system.attributes.movement.walk", "10", "add")] }, flags: { dae: { stackable: "noneName", specialDuration: ["turnEnd"] } } });
    }
    // Path to the Grave: a hit on the cursed creature can end the curse for + Cleric level damage
    if (isAttack(workflow) && hits(workflow).length) {
      const t = hits(workflow)[0];
      const curse = t.actor.effects.find((e) => e.flags?.world?.cgaGraveCurse && !e.disabled);
      const cleric = curse ? fromUuidSync(curse.origin ?? "")?.actor : null;
      const clericTok = cleric && tokensOf(cleric)[0];
      if (cleric && clericTok && me && (workflow.actor === cleric || me.disposition === clericTok.disposition)) {
        const L = classLevel(cleric, "cleric");
        const pick = await askChoice(cleric, `Path to the Grave: ${cleric.name}`, `<p>${me.name} hits the cursed ${t.name}. End the curse to deal ${L} extra damage?</p>`,
          [{ action: "necrotic", label: "Necrotic", default: true }, { action: "radiant", label: "Radiant" }, { action: "none", label: "No" }]);
        if (pick === "necrotic" || pick === "radiant") { await removeEffects(t.actor, [curse.id]); await bonusRoll(workflow, String(L), pick, "Path to the Grave"); }
      }
    }
    // Arcane Shot: once per turn after an Ammunition hit
    const as = feat(actor, "arcane-shot");
    if (as && usesOf(as) > 0 && rangedAttack(workflow) && workflow.item?.system?.properties?.has?.("amm") && hits(workflow).length === 1 && !usedThisTurn("arcane-shot", actor)) {
      const known = Object.keys(SHOTS).map((k) => feat(actor, k)).filter(Boolean);
      if (known.length) {
        const die = shotDie(actor);
        const pick = await askChoice(actor, `Arcane Shot: ${actor.name}`, `<p>Apply an Arcane Shot option (d${die}, ${usesOf(as)} use(s) left)?</p>`,
          [...known.map((o, i) => ({ action: o.system.identifier, label: o.name.replace(/^Arcane Shot: /, ""), default: i === 0 })), { action: "none", label: "No" }]);
        const option = known.find((o) => o.system.identifier === pick);
        if (option) {
          markTurn("arcane-shot", actor);
          await spend(as);
          const key = Object.keys(SHOTS).find((k) => option.system.identifier === k || feat(actor, k) === option);
          const s = SHOTS[key];
          if (s.n) await bonusRoll(workflow, `${s.n}d${die}`, s.type, option.name);
          shotPending.set(workflow, { option, key, die, target: hits(workflow)[0] });
        }
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | book class damage rules failed`, err); }
});
// Piercing / Seeking Shot damage: the actor's equipped Ammunition weapon + n Arcane Shot dice.
function shotWeaponFormula(actor, n) {
  const w = actor?.items?.find((i) => i.type === "weapon" && i.system.equipped && i.system.properties?.has?.("amm")) ?? actor?.items?.find((i) => i.type === "weapon" && i.system.properties?.has?.("amm"));
  const die = shotDie(actor);
  if (!w) return `${n}d${die}`;
  const b = w.system.damage?.base ?? {};
  const abl = w.system.ability || (w.system.properties.has("fin") ? (mod(actor, "dex") >= mod(actor, "str") ? "dex" : "str") : "dex");
  const magic = Number(w.system.magicalBonus ?? 0);
  return `${b.number ?? 1}d${b.denomination ?? 6} + ${mod(actor, abl) + magic} + ${n}d${die}`;
}

// ------------------------------------------------------------------ Damage taken: Strength of the Grave, Enfeebling Shot, Lightning Absorption
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor;
    if (!actor || !ditem) return;
    // Enfeebling Shot: an Enfeebled attacker's hits deal one Arcane Shot die less
    const enf = workflow?.actor?.effects?.find((e) => e.flags?.world?.cgaEnfeebled && !e.disabled);
    if (enf && isAttack(workflow) && (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) > 0 && hits(workflow).some((t) => t.uuid === tokenOf(token)?.uuid)) {
      const archer = fromUuidSync(enf.origin ?? "")?.actor;
      const r = await new Roll(`1d${shotDie(archer)}`).evaluate();
      const cut = reduceDamage(ditem, r.total);
      if (cut) say(workflow.actor, `<strong>Enfeebling Shot:</strong> ${workflow.actor.name}'s hit deals ${cut} less damage.`);
    }
    // Lightning Absorption: the Reanimated Companion is healed by Lightning damage
    if (summonOrigin(actor)?.system?.identifier === "reanimated-companion") {
      const lightning = [...(workflow?.damageRolls ?? []), ...(workflow?.bonusDamageRolls ?? [])].filter((r) => rollTypes(r).includes("lightning")).reduce((s, r) => s + Number(r.total ?? 0), 0);
      if (lightning > 0) setTimeout(async () => { await heal(actor, lightning); say(actor, `<strong>Lightning Absorption:</strong> ${actor.name} regains ${lightning} HP.`); }, 600);
    }
    // Strength of the Grave: a CHA save (DC 5 + damage) to stay up instead of dropping to 0 HP (1/LR)
    const ps = feat(actor, "power-of-shadow");
    const oldHP = Number(ditem.oldHP ?? hpOf(actor).value ?? 0);
    if (ps && usesOf(ps) > 0 && oldHP > 0 && (ditem.newHP ?? 1) <= 0) {
      const total = ((ditem.calculatedDamages ?? ditem.damageDetail) ?? []).filter((x) => !["temphp", "healing"].includes(x.type) && (x.value ?? 0) > 0).reduce((s, x) => s + x.value, 0) || (ditem.hpDamage ?? 0);
      const oldTemp = Number(ditem.oldTempHP ?? hpOf(actor).temp ?? 0);
      if (total - oldTemp - oldHP >= Number(hpOf(actor).max ?? 0)) return; // killed outright
      const save = await actor.rollSavingThrow({ ability: "cha", target: 5 + total }, {}, { create: true }).catch(() => null);
      const r = Array.isArray(save) ? save[0] : save;
      if (r && Number(r.total) >= 5 + total) {
        await spend(ps);
        const keep = mod(actor, "cha") + classLevel(actor, "sorcerer");
        if (keep < oldHP) {
          reduceDamage(ditem, Math.max(0, total - (oldTemp + oldHP - keep)));
          ditem.hpDamage = oldHP - keep; ditem.newHP = keep; ditem.tempDamage = oldTemp; ditem.newTempHP = 0;
        } else {
          // the new HP are higher than before the hit: cancel the damage, then set the HP
          reduceDamage(ditem, total);
          ditem.hpDamage = 0; ditem.newHP = oldHP; ditem.tempDamage = oldTemp; ditem.newTempHP = 0;
          setTimeout(() => updateActor(actor, { "system.attributes.hp.value": keep }), 600);
        }
        say(actor, `<strong>Strength of the Grave:</strong> ${actor.name} stays standing with ${keep} HP.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | book class damage-taken rules failed`, err); }
});

// ------------------------------------------------------------------ Attacks: Deflect Attack (Steel Defender)
Hooks.on("midi-qol.preAttackRollConfig", async (workflow) => {
  try {
    const tr = workflow?.attackRollModifierTracker, atk = tokenOf(workflow?.token), tDoc = targetsOf(workflow)[0];
    if (!tr || !atk || !tDoc || tr.disadvantage?.isActive?.()) return;
    for (const d of sceneTokens(atk)) {
      if (d === tDoc || d === atk || !d.actor || summonOrigin(d.actor)?.system?.identifier !== "steel-defender") continue;
      if (!hostile(d, atk) || !canReact(d.actor) || edgeDistance(d, atk, d.parent) > 5) continue;
      if (!(await askOwner(d.actor, `Deflect Attack: ${d.name}`, `<p>${atk.name} attacks ${tDoc.name}. Use the defender's Reaction to give the attack Disadvantage?</p>`))) continue;
      await useReaction(d.actor);
      tr.disadvantage?.add?.("deflect-attack", "Deflect Attack");
      const maker = summonerOf(d.actor);
      if (maker && feat(maker, "improved-defender")) {
        const r = await new Roll(`1d4 + ${Math.max(0, mod(maker, "int"))}`).evaluate();
        await MidiQOL.applyTokenDamage([{ value: r.total, type: "force" }], r.total, new Set([atk.object ?? atk]), null, new Set(), {});
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: d.actor }), flavor: `Improved Deflection: ${atk.name} takes ${r.total} Force damage` });
      }
      say(d.actor, `<strong>Deflect Attack:</strong> ${d.name} hampers ${atk.name}'s attack.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Deflect Attack failed`, err); }
});

// ------------------------------------------------------------------ Armor Model helpers
async function demolisher(actor, me, t) {
  const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
  if (SIZES.indexOf(t.actor.system.traits?.size ?? "med") >= SIZES.indexOf(actor.system.traits?.size ?? "med")) return;
  const pick = await askChoice(actor, `Force Demolisher: ${actor.name}`, `<p>Push ${t.name} up to 10 ft away, or pull it up to 10 ft toward you?</p>`,
    [{ action: "push", label: "Push 10 ft", default: true }, { action: "pull", label: "Pull 10 ft" }, { action: "none", label: "No" }]);
  if (pick === "push" && t.object) await MidiQOL.moveTokenAwayFromPoint(t.object, 10, me.object?.center ?? me.center, { animate: false, autoRotate: false }).catch(() => {});
  if (pick === "pull") await pullToward(t, me, 10);
}
async function pullToward(t, to, feet) {
  const scene = t.parent, gs = scene.grid.size, per = gs / scene.grid.distance;
  const tc = { x: t.x + (t.width * gs) / 2, y: t.y + (t.height * gs) / 2 }, oc = { x: to.x + (to.width * gs) / 2, y: to.y + (to.height * gs) / 2 };
  const dist = Math.hypot(oc.x - tc.x, oc.y - tc.y);
  const gap = Math.max(0, edgeDistance(t, to, scene) - 5) * per;
  const move = Math.min(feet * per, gap);
  if (move <= 0 || !dist) return;
  const x = Math.round((t.x + ((oc.x - tc.x) / dist) * move) / gs) * gs, y = Math.round((t.y + ((oc.y - tc.y) / dist) * move) / gs) * gs;
  await gmUpdateTokens(scene, [{ _id: t.id, x, y }], { animate: false, teleport: true });
}
// Giant Stature: the token grows with the Large size and shrinks back afterwards
Hooks.on("createActiveEffect", async (effect) => {
  try {
    if (!isGM() || !(effect.parent instanceof Actor) || effect.name !== "Giant Stature") return;
    for (const t of tokensOf(effect.parent)) if (t.width < 2) await gmUpdateTokens(t.parent, [{ _id: t.id, width: 2, height: 2, "flags.world.cgaGiantPrev": t.width }]);
  } catch (err) { console.warn(`${MODULE_ID} | Giant Stature failed`, err); }
});
Hooks.on("deleteActiveEffect", async (effect) => {
  try {
    if (!isGM() || !(effect.parent instanceof Actor)) return;
    if (effect.name === "Giant Stature") for (const t of tokensOf(effect.parent)) { const p = t.getFlag("world", "cgaGiantPrev"); if (p) await gmUpdateTokens(t.parent, [{ _id: t.id, width: p, height: p, "flags.world.-=cgaGiantPrev": null }]); }
    // Spirits from Beyond, Shade: when the invisibility ends, nearby creatures make a CON save
    const shade = effect.flags?.world?.cgaShade;
    if (shade) {
      const bard = fromUuidSync(shade.bard), sp = bard && feat(bard, "spirits-from-beyond"), tDoc = tokensOf(effect.parent)[0];
      if (sp && tDoc) {
        const around = sceneTokens(tDoc).filter((o) => o.actor && o !== tDoc && alive(o.actor) && edgeDistance(o, tDoc, o.parent) <= 5);
        if (around.length) await runAct(sp, "spirit-shade", around, { formula: `2d${shade.die}` });
      }
    }
    if (effect.flags?.world?.cgaBladesong) scheduleIntWeapons(effect.parent);
  } catch (err) { console.warn(`${MODULE_ID} | book class effect cleanup failed`, err); }
});

// ------------------------------------------------------------------ Companions: one at a time; Death Burst
const ONE_AT_A_TIME = ["eldritch-cannon", "steel-defender", "reanimated-companion", "vestige-companion"];
Hooks.on("createToken", async (tokenDoc) => {
  try {
    if (!isGM()) return;
    const origin = tokenDoc.actor?.flags?.dnd5e?.summon?.origin;
    if (!origin || !ONE_AT_A_TIME.includes(fromUuidSync(origin)?.system?.identifier)) return;
    for (const scene of game.scenes.contents) {
      let old = scene.tokens.filter((t) => t.id !== tokenDoc.id && t.actor?.flags?.dnd5e?.summon?.origin === origin);
      // Fortified Position (Artillerist 15): two cannons at once - only the oldest goes when a third appears
      const maker = fromUuidSync(origin)?.actor;
      if (fromUuidSync(origin)?.system?.identifier === "eldritch-cannon" && feat(maker, "fortified-position")) old = old.slice(0, Math.max(0, old.length - 1));
      if (old.length) await scene.deleteEmbeddedDocuments("Token", old.map((t) => t.id)).catch(() => {});
    }
  } catch (err) { console.warn(`${MODULE_ID} | companion replacement failed`, err); }
});
const burstDone = new Set();
Hooks.on("updateActor", async (actor, changes) => {
  try {
    if (!isGM() || !foundry.utils.hasProperty(changes, "system.attributes.hp.value")) return;
    // Death Burst (Reanimated Companion)
    if (Number(changes.system.attributes.hp.value) <= 0 && summonOrigin(actor)?.system?.identifier === "reanimated-companion") {
      const tDoc = tokensOf(actor)[0];
      if (!tDoc || burstDone.has(tDoc.uuid)) return;
      burstDone.add(tDoc.uuid);
      const burst = actor.items.find((i) => i.system?.identifier === "death-burst");
      const around = sceneTokens(tDoc).filter((o) => o.actor && o !== tDoc && alive(o.actor) && edgeDistance(o, tDoc, o.parent) <= 10);
      // Improved Reanimation (Reanimator 9): 4d4; Bloated: + the creator's INT modifier
      const maker = summonerOf(actor), lvl = classLevel(maker, "artificer");
      const bloated = actor.getFlag("world", "cgaMods")?.includes?.("bloated");
      const formula = lvl >= 9 || bloated ? `${lvl >= 9 ? 4 : 2}d4${bloated ? ` + ${Math.max(0, mod(maker, "int"))}` : ""}` : undefined;
      if (burst && around.length) await runAct(burst, "death-burst", around, { formula });
    }
    // Wayfarer spirit: the Speed bonus ends with the temp HP
  } catch (err) { console.warn(`${MODULE_ID} | Death Burst failed`, err); }
});
Hooks.on("updateActor", async (actor, changes) => {
  if (!isGM() || !foundry.utils.hasProperty(changes, "system.attributes.hp.temp") || Number(changes.system.attributes.hp.temp) > 0) return;
  const fx = actor.effects.filter((e) => e.flags?.world?.cgaWayfarer);
  if (fx.length) await removeEffects(actor, fx.map((e) => e.id));
});

// ------------------------------------------------------------------ Vestige Divine Power
async function fiendishSwap(vestige, me) {
  const owner = summonerOf(vestige), ownTok = owner && tokensOf(owner)[0];
  if (!ownTok || !me) return;
  if (edgeDistance(me, ownTok, me.parent) > 60) return say(vestige, "<strong>Fiendish Swap:</strong> you and the vestige must be within 60 ft of each other.");
  await gmUpdateTokens(me.parent, [{ _id: me.id, x: ownTok.x, y: ownTok.y }, { _id: ownTok.id, x: me.x, y: me.y }], { animate: false, teleport: true });
  say(vestige, `<strong>Fiendish Swap:</strong> ${me.name} and ${ownTok.name} swap places.`);
}
async function cursedInvocation(vestige, t) {
  const owner = summonerOf(vestige);
  const cond = owner ? `targetActorUuid === "${owner.uuid}" || targetActorUuid === "${vestige.uuid}"` : `targetActorUuid === "${vestige.uuid}"`;
  await addEffect(t.actor, { name: `Cursed Invocation (Disadvantage vs ${owner?.name ?? "the warlock"} and the vestige)`, img: "icons/magic/unholy/hand-claw-fog-green.webp", transfer: false,
    duration: { seconds: 60 }, system: { changes: [chg("flags.midi-qol.disadvantage.attack.all", cond)] } });
}

// ------------------------------------------------------------------ Adventurer's Atlas: reusing it removes the old maps
async function atlasCleanup(item, kept) {
  for (const scene of game.scenes.contents) for (const t of scene.tokens) {
    const a = t.actor;
    if (!a) continue;
    const maps = a.effects.filter((e) => (e.origin ?? "").startsWith(item.uuid) && /Atlas/.test(e.name));
    if (!maps.length) continue;
    const drop = kept.includes(a) ? maps.slice(0, -1) : maps;
    if (drop.length) await removeEffects(a, drop.map((e) => e.id));
  }
}

// ------------------------------------------------------------------ Spirits from Beyond
const SPIRITS = ["Beloved", "Sharpshooter", "Avenger", "Renegade", "Fortune Teller", "Wayfarer", "Trickster", "Shade", "Arsonist", "Coward", "Brute", "Priest"];
async function channel(sp, n) {
  const list = [...(sp.getFlag("world", "cgaSpirits") ?? []), n];
  await sp.setFlag("world", "cgaSpirits", list);
  say(sp.actor, `<strong>Spirits from Beyond:</strong> ${sp.actor.name} channels the ${SPIRITS[n - 1]} (channeled: ${list.map((x) => SPIRITS[x - 1]).join(", ")}).`);
}
async function controlledChanneling(actor, item) {
  const die = bardicDie(actor);
  const pick = await askChoice(actor, `Controlled Channeling: ${actor.name}`, `<p>Choose a spirit (up to ${die}).</p>`, SPIRITS.slice(0, die).map((s, i) => ({ action: String(i + 1), label: `${i + 1}. ${s}`, default: i === 0 })));
  const n = Number(pick);
  if (n >= 1 && n <= die) await channel(item, n);
}
async function unleashSpirit(actor, item, tgt) {
  const list = item.getFlag("world", "cgaSpirits") ?? [];
  if (!list.length) return say(actor, "<strong>Unleash Spirit:</strong> no spirit is channeled.");
  if (!tgt) return say(actor, "<strong>Unleash Spirit:</strong> target a creature within 30 ft first.");
  const pick = list.length === 1 ? String(list[0]) : await askChoice(actor, `Unleash Spirit: ${actor.name}`, `<p>Which spirit do you unleash on ${tgt.name}?</p>`,
    [...new Set(list)].map((n, i) => ({ action: String(n), label: SPIRITS[n - 1], default: i === 0 })));
  const n = Number(pick);
  if (!list.includes(n)) return;
  const rest = [...list]; rest.splice(rest.indexOf(n), 1);
  await item.setFlag("world", "cgaSpirits", rest);
  const d = bardicDie(actor), cha = mod(actor, "cha"), me = tokensOf(actor)[0];
  const enemiesNear = (center, r, incl) => sceneTokens(center).filter((o) => o.actor && alive(o.actor) && hostile(o, me) && (incl ? true : o !== center) && edgeDistance(o, center, o.parent) <= r);
  say(actor, `<strong>Unleash Spirit:</strong> the ${SPIRITS[n - 1]} descends on ${tgt.name}.`);
  switch (n) {
    case 1: return runAct(item, "spirit-beloved", [tgt], { formula: `1d${d} + ${cha}` });
    case 2: return runAct(item, "spirit-sharpshooter", [tgt], { formula: `1d${d} + ${cha}` });
    case 3: return addEffect(tgt.actor, { name: "Avenger spirit (melee attackers take Force damage)", img: item.img, origin: item.uuid, transfer: false,
      duration: { value: null, units: "rounds", expiry: "sourceEnd" }, flags: { world: { cgaAvenger: { die: d, bard: actor.uuid } } } });
    case 4: { if (canReact(tgt.actor)) await useReaction(tgt.actor); return blinkNextMove(tgt.actor, "Renegade spirit", 30); }
    case 5: return addEffect(tgt.actor, { name: "Fortune Teller spirit (Advantage on D20 Tests)", img: item.img, origin: item.uuid, transfer: false,
      duration: { value: null, units: "rounds", expiry: "sourceStart" }, system: { changes: [chg("flags.midi-qol.advantage.all", "1")] } });
    case 6: {
      const r = await new Roll(`1d${d} + ${classLevel(actor, "bard")}`).evaluate();
      await tempHP(tgt.actor, r.total);
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Wayfarer spirit: ${tgt.name} gains ${r.total} Temporary Hit Points and +10 ft Speed while they last` });
      return addEffect(tgt.actor, { name: "Wayfarer spirit (+10 ft Speed)", img: item.img, transfer: false, system: { changes: [chg("system.attributes.movement.walk", "10", "add")] }, flags: { world: { cgaWayfarer: true } } });
    }
    case 7: return runAct(item, "spirit-trickster", [tgt], { formula: `2d${d}` });
    case 8: return addEffect(tgt.actor, await statusEffect("invisible", { name: "Shade spirit (Invisible)", origin: item.uuid,
      flags: { dae: { stackable: "noneName", specialDuration: ["turnEnd", "1Attack", "1Spell"] }, world: { cgaShade: { die: d, bard: actor.uuid } } } }));
    case 9: return runAct(item, "spirit-arsonist", [tgt], { formula: `4d${d}` });
    case 10: return runAct(item, "spirit-coward", [tgt, ...enemiesNear(tgt, 30, false).filter((o) => o !== tgt)]);
    case 11: { const ts = enemiesNear(tgt, 30, false); return ts.length ? runAct(item, "spirit-brute", ts, { formula: `3d${d}` }) : say(actor, "<strong>Brute spirit:</strong> no enemies within 30 ft of the target."); }
    case 12: {
      await runAct(item, "spirit-priest", [tgt], { formula: `2d${d}` });
      const conds = ["blinded", "charmed", "deafened", "paralyzed", "poisoned", "stunned"].filter((s) => tgt.actor.statuses.has(s));
      if (!conds.length) return;
      const c = conds.length === 1 ? conds[0] : await askChoice(actor, `Priest spirit: ${actor.name}`, `<p>End which condition on ${tgt.name}?</p>`, conds.map((s, i) => ({ action: s, label: cap(s), default: i === 0 })));
      if (conds.includes(c)) { await removeStatus(tgt.actor, c); say(actor, `<strong>Priest spirit:</strong> ${tgt.name} is no longer ${c}.`); }
    }
  }
}
// Avenger spirit: a creature that hits the target with a melee attack takes Force damage
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    if (!meleeAttack(workflow) || !hits(workflow).length || !workflow.token) return;
    for (const t of hits(workflow)) {
      const av = t.actor.effects.find((e) => e.flags?.world?.cgaAvenger && !e.disabled);
      if (!av) continue;
      const r = await new Roll(`1d${av.flags.world.cgaAvenger.die}`).evaluate();
      await MidiQOL.applyTokenDamage([{ value: r.total, type: "force" }], r.total, new Set([workflow.token.object ?? workflow.token]), null, new Set(), {});
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: t.actor }), flavor: `Avenger spirit: ${workflow.token.name} takes ${r.total} Force damage` });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Avenger spirit failed`, err); }
});
Hooks.on("dnd5e.restCompleted", async (actor) => {
  try {
    if (!actor.isOwner) return;
    const sp = feat(actor, "spirits-from-beyond");
    if (sp?.getFlag("world", "cgaSpirits")?.length) await sp.unsetFlag("world", "cgaSpirits");
  } catch (err) { console.warn(`${MODULE_ID} | spirit rest cleanup failed`, err); }
});

// ------------------------------------------------------------------ Group Recovery (Banneret)
async function groupRecovery(actor, me) {
  const gr = feat(actor, "group-recovery");
  if (!gr || usesOf(gr) < 1) return;
  const allies = sceneTokens(me).filter((o) => o !== me && o.actor && alive(o.actor) && o.disposition === me.disposition && Number(hpOf(o.actor).value) < Number(hpOf(o.actor).max) && edgeDistance(me, o, me.parent) <= (feat(actor, "inspiring-commander") ? 60 : 30))
    .sort((a, b) => (Number(hpOf(b.actor).max) - Number(hpOf(b.actor).value)) - (Number(hpOf(a.actor).max) - Number(hpOf(a.actor).value))).slice(0, Math.max(1, mod(actor, "cha")));
  if (!allies.length) return;
  if (!(await askOwner(actor, `Group Recovery: ${actor.name}`, `<p>Heal ${allies.map((a) => a.name).join(", ")} for 1d4 + ${classLevel(actor, "fighter")} each (once per Short Rest)?</p>`))) return;
  await spend(gr);
  for (const a of allies) {
    const r = await new Roll(`1d4 + ${classLevel(actor, "fighter")}`).evaluate();
    await heal(a.actor, r.total);
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Group Recovery: ${a.name} regains ${r.total} HP` });
    // Team Tactics (Banneret 7): Advantage on D20 Tests until the start of your next turn
    if (feat(actor, "team-tactics")) await addEffect(a.actor, { name: "Team Tactics (Advantage on D20 Tests)", img: "icons/skills/social/diplomacy-handshake-yellow.webp", origin: gr.uuid, transfer: false,
      duration: { value: null, units: "rounds", expiry: "sourceStart" }, system: { changes: [chg("flags.midi-qol.advantage.all", "1")] } });
  }
}

// ------------------------------------------------------------------ Elemental Smite (Noble Genies)
async function elementalSmite(actor, me, tgt, es) {
  const cd = cdItem(actor);
  if (!cd || usesOf(cd) < 1) return;
  const pick = await askChoice(actor, `Elemental Smite: ${actor.name}`, `<p>Spend Channel Divinity for an Elemental Smite on ${tgt.name}?</p>`,
    [{ action: "dao", label: "Dao's Crush", default: true }, { action: "djinni", label: "Djinni's Escape" }, { action: "efreeti", label: "Efreeti's Fury" }, { action: "marid", label: "Marid's Surge" }, { action: "none", label: "No" }]);
  if (!["dao", "djinni", "efreeti", "marid"].includes(pick)) return;
  await spend(cd);
  if (pick === "dao") return addEffect(tgt.actor, { name: "Dao's Crush (Grappled and Restrained)", img: "icons/magic/earth/barrier-stone-brown-green.webp", statuses: ["grappled", "restrained"], transfer: false });
  if (pick === "djinni") {
    await addEffect(actor, { name: "Djinni's Escape", img: "icons/magic/air/air-burst-spiral-blue-gray.webp", origin: es.uuid, transfer: false, duration: { value: null, units: "rounds", expiry: "sourceEnd" },
      system: { changes: [...["bludgeoning", "piercing", "slashing"].map((t) => chg("system.traits.dr.value", t, "add")), ...["grappled", "prone", "restrained"].map((s) => chg("system.traits.ci.value", s, "add"))] } });
    return blinkNextMove(actor, "Djinni's Escape", 30);
  }
  if (pick === "efreeti") {
    const others = sceneTokens(me).filter((o) => o !== tgt && o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(me, o, me.parent) <= 30);
    let second = null;
    if (others.length) {
      const p = await askChoice(actor, "Efreeti's Fury", "<p>The fire jumps to which creature within 30 ft?</p>", [...others.map((o, i) => ({ action: o.id, label: o.name, default: i === 0 })), { action: "none", label: "None" }]);
      second = others.find((o) => o.id === p);
    }
    return runAct(es, "efreeti-fury", [tgt, second].filter(Boolean), { formula: "2d4" });
  }
  const near = sceneTokens(me).filter((o) => o !== tgt && o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(me, o, me.parent) <= 10);
  return runAct(es, "marid-surge", [tgt, ...near]);
}

// ------------------------------------------------------------------ Wrath of the Wild: Unnerving Aura, Prowling Retribution
async function unnervingAura(actor, me) {
  const ww = feat(actor, "wrath-of-the-wild");
  if (!ww || !me) return;
  const ts = sceneTokens(me).filter((o) => o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(me, o, me.parent) <= 10);
  if (ts.length) await runAct(ww, "unnerving-aura", ts);
}
Hooks.on("updateCombat", async (combat, changes) => {
  try {
    if (!isGM() || !("turn" in changes || "round" in changes)) return;
    const c = combat.combatant, actor = c?.actor;
    if (!actor || !actor.effects.some((e) => e.flags?.world?.cgaWrathWild && !e.disabled)) return;
    if (!onceKey(`unnerving:${actor.uuid}`)) return;
    await unnervingAura(actor, c.token);
  } catch (err) { console.warn(`${MODULE_ID} | Unnerving Aura failed`, err); }
});
const meleeWeaponAttack = (a) => {
  const w = a.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.activities?.some((x) => x.type === "attack" && x.attack?.type?.value === "melee"));
  return w?.system.activities.find((x) => x.type === "attack" && x.attack?.type?.value === "melee") ?? null;
};
async function afterDamage(workflow, atk) {
  if (!atk?.actor) return;
  const damaged = (workflow.damageList ?? []).filter((d) => Number(d.hpDamage ?? 0) + Number(d.tempDamage ?? 0) > 0 || Number(d.totalDamage ?? 0) > 0);
  for (const d of damaged) {
    const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "");
    const tDoc = found instanceof Actor ? tokensOf(found)[0] : tokenOf(found);
    const victim = tDoc?.actor;
    if (!victim) continue;
    // Bloodthirst: an enemy becomes Bloodied but isn't killed
    const max = Number(hpOf(victim).max ?? 0), oldHP = Number(d.oldHP ?? max), newHP = Number(d.newHP ?? hpOf(victim).value);
    if (newHP > 0 && oldHP > max / 2 && newHP <= max / 2) {
      for (const s of sceneTokens(tDoc)) {
        const bt = s.actor && feat(s.actor, "bloodthirst");
        if (!bt || usesOf(bt) < 1 || !canReact(s.actor) || !hostile(s, tDoc) || edgeDistance(s, tDoc, s.parent) > 30) continue;
        if (!(await askOwner(s.actor, `Bloodthirst: ${s.name}`, `<p>${tDoc.name} is Bloodied. Use your Reaction to teleport next to it and make a melee attack? (${usesOf(bt)} use(s) left)</p>`))) continue;
        await spend(bt); await useReaction(s.actor);
        await teleportNextTo(s, tDoc);
        if (feat(s.actor, "aura-of-malevolence")) await malevolence(s, tDoc);
        const a = meleeWeaponAttack(s.actor);
        if (a) setTimeout(() => MidiQOL.completeActivityUse(a, { midiOptions: { targetUuids: [tDoc.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}).catch(() => {}), 800);
        break;
      }
    }
    // Prowling Retribution: a creature within 5 ft of a transformed Hollow Warden damages the warden or an ally
    for (const w of sceneTokens(atk)) {
      if (!w.actor || !feat(w.actor, "wrath-of-the-wild") || !w.actor.effects.some((e) => e.flags?.world?.cgaWrathWild && !e.disabled)) continue;
      if (w === atk || !hostile(w, atk) || w.disposition !== tDoc.disposition || !canReact(w.actor) || edgeDistance(w, atk, w.parent) > 5) continue;
      const a = meleeWeaponAttack(w.actor);
      if (!a || !(await askOwner(w.actor, `Prowling Retribution: ${w.name}`, `<p>${atk.name} damaged ${tDoc.name}. Use your Reaction for an Opportunity Attack against it?</p>`))) continue;
      await useReaction(w.actor);
      setTimeout(() => MidiQOL.completeActivityUse(a, { midiOptions: { targetUuids: [atk.uuid], workflowOptions: { targetConfirmation: "none", isAoO: true } } }, { configure: false }, {}).catch(() => {}), 800);
      break;
    }
  }
}
async function teleportNextTo(mover, target) {
  const scene = target.parent, gs = scene.grid.size;
  const occupied = (x, y) => scene.tokens.some((o) => o !== mover && x < o.x + o.width * gs && x + mover.width * gs > o.x && y < o.y + o.height * gs && y + mover.height * gs > o.y);
  const spots = [];
  for (let dx = -mover.width; dx <= target.width; dx++) for (let dy = -mover.height; dy <= target.height; dy++) {
    const x = target.x + dx * gs, y = target.y + dy * gs;
    if (dx > -mover.width && dx < target.width && dy > -mover.height && dy < target.height) continue;
    if (!occupied(x, y)) spots.push({ x, y, d: Math.hypot(x - mover.x, y - mover.y) });
  }
  spots.sort((a, b) => a.d - b.d);
  if (spots[0]) await gmUpdateTokens(scene, [{ _id: mover.id, x: spots[0].x, y: spots[0].y }], { animate: false, teleport: true });
}

// ------------------------------------------------------------------ Wails from the Grave (Phantom)
async function wails(actor, workflow) {
  const wf = feat(actor, "wails-from-the-grave");
  // Death's Knell (Tokens of the Departed): destroy a soul trinket instead of spending a use
  const tokens = feat(actor, "tokens-of-the-departed");
  const knell = wf && usesOf(wf) < 1 && tokens && usesOf(tokens) > 0;
  if (!wf || (usesOf(wf) < 1 && !knell)) return;
  const first = fromUuidSync(workflow.cgaSneak);
  const me = tokenOf(workflow.token);
  if (!first) return;
  const others = sceneTokens(first).filter((o) => o !== first && o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(o, first, o.parent) <= 30);
  if (!others.length) return;
  const n = Math.ceil(Math.ceil(classLevel(actor, "rogue") / 2) / 2);
  const pick = await askChoice(actor, `Wails from the Grave: ${actor.name}`, `<p>Deal ${n}d6 Necrotic to a second creature within 30 ft of ${first.name}? (${knell ? "destroys a soul trinket" : usesOf(wf) + " use(s) left"})</p>`,
    [...others.map((o, i) => ({ action: o.id, label: o.name, default: i === 0 })), { action: "none", label: "No" }]);
  const t = others.find((o) => o.id === pick);
  if (!t) return;
  await spend(knell ? tokens : wf);
  await runAct(wf, "wails-damage", feat(actor, "deaths-friend") ? [t, first] : [t], { formula: `${n}d6` });
}

// ------------------------------------------------------------------ Spellfire Burst: after spending Sorcery Points on your turn
const SP_IDS = ["font-of-magic", "sorcery-points"];
Hooks.on("updateItem", async (item, changes, options, userId) => {
  try {
    if (userId !== game.user.id || !foundry.utils.hasProperty(changes, "system.uses.spent")) return;
    const actor = item.parent;
    if (!(actor instanceof Actor) || !(SP_IDS.includes(item.system.identifier) || /^(font of magic|sorcery points)$/i.test(item.name))) return;
    const before = options?.cgaSpentBefore;
    const sf = feat(actor, "spellfire-burst");
    if (!sf || !myTurn(actor) || usedThisTurn("spellfire-burst", actor)) return;
    if (before !== undefined && Number(changes.system.uses.spent) <= before) return;
    const me = tokensOf(actor)[0];
    if (!me) return;
    const L = classLevel(actor, "sorcerer"), cha = mod(actor, "cha");
    const pick = await askChoice(actor, `Spellfire Burst: ${actor.name}`, "<p>You spent Sorcery Points - unleash a Spellfire Burst?</p>",
      [{ action: "bolster", label: `Bolstering Flames (1d4 + ${cha}${L >= 14 ? ` + ${L}` : ""} temp HP)`, default: true }, { action: "fire", label: `Radiant Fire: Fire (1d${L >= 14 ? 8 : 4})` },
        { action: "radiant", label: `Radiant Fire: Radiant (1d${L >= 14 ? 8 : 4})` }, { action: "none", label: "No" }]);
    if (!["bolster", "fire", "radiant"].includes(pick)) return;
    const near = sceneTokens(me).filter((o) => o.actor && alive(o.actor) && edgeDistance(me, o, me.parent) <= 30 && (pick === "bolster" ? o.disposition === me.disposition : hostile(o, me)));
    if (!near.length) return;
    const who = near.length === 1 ? near[0].id : await askChoice(actor, "Spellfire Burst", "<p>Which creature?</p>", near.map((o, i) => ({ action: o.id, label: o.name, default: i === 0 })));
    const t = near.find((o) => o.id === who);
    if (!t) return;
    markTurn("spellfire-burst", actor);
    if (pick === "bolster") await runAct(sf, "spellfire-bolster", [t], { formula: `1d4 + ${cha}${L >= 14 ? ` + ${L}` : ""}` });
    else await runAct(sf, `spellfire-${pick}`, [t], { formula: `1d${L >= 14 ? 8 : 4}` });
  } catch (err) { console.warn(`${MODULE_ID} | Spellfire Burst failed`, err); }
});
Hooks.on("preUpdateItem", (item, changes, options) => { if (foundry.utils.hasProperty(changes, "system.uses.spent")) options.cgaSpentBefore = Number(item.system.uses?.spent ?? 0); });

// ------------------------------------------------------------------ Battle Ready and Bladesong: Intelligence for weapon attacks
const intBusy = new Set(), intTimers = new Map();
function scheduleIntWeapons(actor) {
  if (!actor || !isGM()) return;
  clearTimeout(intTimers.get(actor.uuid));
  intTimers.set(actor.uuid, setTimeout(() => ensureIntWeapons(actor), 300));
}
const bladesongOn = (a) => a.effects.some((e) => e.flags?.world?.cgaBladesong && !e.disabled);
async function ensureIntWeapons(actor) {
  if (!actor?.items || intBusy.has(actor.uuid)) return;
  const br = feat(actor, "battle-ready"), song = feat(actor, "bladesong") && bladesongOn(actor);
  intBusy.add(actor.uuid);
  try {
    const int = mod(actor, "int");
    for (const w of actor.items.filter((i) => i.type === "weapon")) {
      const usual = w.system.properties?.has("fin") ? Math.max(mod(actor, "str"), mod(actor, "dex")) : (w.system.attackType === "ranged" || /R$/.test(w.system.type?.value ?? "")) ? mod(actor, "dex") : mod(actor, "str");
      const want = int > usual && ((br && w.system.properties?.has("mgc")) || (song && w.system.proficient !== 0 && w.system.prof?.multiplier !== 0));
      const mine = w.effects.filter((e) => e.flags?.[MODULE_ID]?.intWeapon);
      if (!want && mine.length) await w.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id)).catch(() => {});
      if (want && !mine.length) await w.createEmbeddedDocuments("ActiveEffect", [{ name: br && w.system.properties?.has("mgc") ? "Battle Ready (Intelligence)" : "Bladesong (Intelligence)", type: "enchantment",
        img: "icons/magic/symbols/runes-star-pentagon-blue.webp", transfer: true, origin: (br ?? feat(actor, "bladesong")).uuid,
        system: { changes: [{ key: "activities[attack].attack.ability", value: "int", type: "override", priority: 20, phase: "initial" }] }, flags: { [MODULE_ID]: { intWeapon: true } } }]).catch((err) => console.warn(`${MODULE_ID} | INT weapon enchantment failed`, err));
    }
  } finally { intBusy.delete(actor.uuid); }
}
Hooks.on("createItem", (item) => { if (item.parent instanceof Actor && (item.type === "weapon" || ["battle-ready", "bladesong"].includes(item.system?.identifier))) scheduleIntWeapons(item.parent); });
Hooks.on("updateItem", (item, changes) => { if (item.parent instanceof Actor && item.type === "weapon" && foundry.utils.hasProperty(changes, "system.properties")) scheduleIntWeapons(item.parent); });
Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes, "system.abilities")) scheduleIntWeapons(actor); });
Hooks.on("createActiveEffect", (effect) => { if (effect.parent instanceof Actor && effect.flags?.world?.cgaBladesong) scheduleIntWeapons(effect.parent); });
Hooks.once("ready", () => { if (isGM()) for (const a of game.actors) if (a.type === "character" && (feat(a, "battle-ready") || feat(a, "bladesong"))) scheduleIntWeapons(a); });

// ------------------------------------------------------------------ Bladesong ends early; Arcane Recovery restores a use
const songFx = (a) => a.effects.filter((e) => e.flags?.world?.cgaBladesong && !e.disabled);
async function endBladesong(actor, why) { const fx = songFx(actor); if (!fx.length) return; await removeEffects(actor, fx.map((e) => e.id)); say(actor, `<strong>Bladesong</strong> ends (${why}).`); }
Hooks.on("updateItem", async (item, changes) => {
  try {
    const actor = item.parent;
    if (!isGM() || !(actor instanceof Actor) || !songFx(actor).length || item.type !== "equipment" || !foundry.utils.getProperty(changes, "system.equipped")) return;
    if (["light", "medium", "heavy", "shield"].includes(item.system.type?.value)) await endBladesong(actor, `${item.name} donned`);
  } catch (err) { console.warn(`${MODULE_ID} | Bladesong armor check failed`, err); }
});
Hooks.on("createItem", async (item) => {
  try {
    const actor = item.parent;
    if (!isGM() || !(actor instanceof Actor) || !songFx(actor).length || item.type !== "equipment" || !item.system.equipped) return;
    if (["light", "medium", "heavy", "shield"].includes(item.system.type?.value)) await endBladesong(actor, `${item.name} donned`);
  } catch (err) { console.warn(`${MODULE_ID} | Bladesong armor check failed`, err); }
});
Hooks.on("midi-qol.AttackRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor;
    if (!actor || !songFx(actor).length || workflow.item?.type !== "weapon") return;
    const twoHanded = workflow.item.system.properties?.has("two") || workflow.attackMode === "twoHanded";
    if (twoHanded) await endBladesong(actor, "a two-handed attack");
  } catch (err) { console.warn(`${MODULE_ID} | Bladesong two-hand check failed`, err); }
});
Hooks.on("createActiveEffect", async (effect) => {
  try {
    const actor = effect.parent;
    if (!isGM() || !(actor instanceof Actor) || !songFx(actor).length || !effect.statuses?.size) return;
    if (["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"].some((s) => effect.statuses.has(s))) await endBladesong(actor, "Incapacitated");
  } catch (err) { console.warn(`${MODULE_ID} | Bladesong incapacitated check failed`, err); }
});
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !(item?.system?.identifier === "arcane-recovery" || /^arcane recovery$/i.test(item?.name ?? ""))) return;
    const bs = feat(actor, "bladesong");
    if (bs && Number(bs.system.uses?.spent ?? 0) > 0) { await bs.update({ "system.uses.spent": Number(bs.system.uses.spent) - 1 }); say(actor, "<strong>Bladesong:</strong> Arcane Recovery restores one use."); }
  } catch (err) { console.warn(`${MODULE_ID} | Bladesong recovery failed`, err); }
});

// ------------------------------------------------------------------ Hypnotic Presence: ends beyond 10 ft
Hooks.on("updateToken", async (doc, changes) => {
  try {
    if (!isGM() || !("x" in changes || "y" in changes)) return;
    const scene = doc.parent;
    for (const t of scene.tokens) {
      const fx = t.actor?.effects?.filter((e) => e.flags?.world?.cgaHypnotic) ?? [];
      for (const e of fx) {
        const src = fromUuidSync(e.origin ?? "")?.actor, srcTok = src && tokensOf(src).find((x) => x.parent === scene);
        if (srcTok && (doc === t || doc === srcTok) && edgeDistance(t, srcTok, scene) > 10) { await removeEffects(t.actor, [e.id]); say(src, `<strong>Hypnotic Presence</strong> on ${t.name} ends (more than 10 ft away).`); }
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Hypnotic Presence range check failed`, err); }
});

// Shared with class-rules-books-p2.js
export { runAct, bonusRoll, heal, tempHP, removeEffects, removeStatus, statusEffect, cdItem, biItem, spItem, summonOrigin, summonerOf, hits, targetsOf, sceneTokens, tokensOf,
  hostile, myTurn, mod, usesOf, alive, isAttack, isWeaponAttack, rangedAttack, meleeAttack, hidden, shotDie, artificerSpell, onceKey, rollTypes, retotal, cap, asGM };

// ------------------------------------------------------------------ Aura of Malevolence (Scion of the Three 13): damage ignoring Resistance
async function malevolence(s, near) {
  const type = s.actor.effects.find((e) => e.flags?.world?.cgaAllegiance)?.system?.changes?.find((c) => c.key === "system.traits.dr.value")?.value ?? "necrotic";
  const dmg = Math.max(1, mod(s.actor, "int"));
  await new Promise((r) => setTimeout(r, 400));
  const me = tokensOf(s.actor)[0] ?? s;
  for (const o of sceneTokens(me).filter((x) => x.actor && x !== me && alive(x.actor) && hostile(x, me) && edgeDistance(x, me, me.parent) <= 10)) {
    const hp = hpOf(o.actor), temp = Number(hp.temp ?? 0), fromTemp = Math.min(temp, dmg);
    await updateActor(o.actor, { "system.attributes.hp.temp": temp - fromTemp, "system.attributes.hp.value": Math.max(0, Number(hp.value) - (dmg - fromTemp)) });
    say(s.actor, `<strong>Aura of Malevolence:</strong> ${o.name} takes ${dmg} ${type} damage (ignores Resistance).`);
  }
}
