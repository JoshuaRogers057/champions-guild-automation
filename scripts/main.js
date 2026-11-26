// Champions Guild Automation - plugs our fixes into Coven's Automation Toolkit (CAT).
//
// How it works:
//  - Every Item in this module's compendiums carries flags.cat.automation.version and a system.identifier
//    (e.g. "eldritch-blast"). registerAutomationModule() tells CAT to index those compendiums as an
//    automation source named after this module.
//  - Each DM puts "Champions Guild Automation" first in CAT's Automation Sources list, so where we have a
//    fix it wins, and CAT / midi-qol / dnd5e fill in everything else.
//  - CAT's Mass Apply / Update then copies our activities, effects and flags onto matching actor items,
//    keeping the actor's own name, description, prepared state and uses.
//  - Macros written in CAT's own function-macro format live in scripts/fn-macros/ and are registered
//    here too. Changing one of those only needs a module update, no Mass Apply.

import { ownMacros, overrideMacros } from "./fn-macros/index.js";

export const MODULE_ID = "champions-guild-automation";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "lastSeenVersion", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  // Saving throws on the spell's own card (one row per creature: roll, pass/fail) instead of a separate chat card per
  // save. That's dnd5e's "Summary Chat Cards" with midi-qol's saves section; dnd5e keeps it per player (client), so
  // this world setting applies it on every client.
  game.settings.register(MODULE_ID, "saveCards", {
    name: "Saving throw cards",
    hint: "Condensed: saving throws are listed on the spell or ability card that forced them (roll, pass or fail), like "
      + "midi-qol used to. Separate: every save gets its own chat card. Player's choice: leave dnd5e's \"Summary Chat "
      + "Cards\" setting to each player.",
    scope: "world",
    config: true,
    type: String,
    choices: { condensed: "Condensed (on the spell's card)", separate: "Separate cards", player: "Each player's choice" },
    default: "condensed",
    onChange: () => applySaveCards()
  });
});
async function applySaveCards() {
  const mode = game.settings.get(MODULE_ID, "saveCards");
  if (mode === "player" || !game.settings.settings.has("dnd5e.chatCardSummary")) return;
  const want = mode === "condensed";
  if (game.settings.get("dnd5e", "chatCardSummary") !== want) await game.settings.set("dnd5e", "chatCardSummary", want);
  // midi-qol's own saves section is the summary that matches the old look.
  if (want && game.user.isGM) {
    const cfg = foundry.utils.duplicate(game.settings.get("midi-qol", "ConfigSettings") ?? {});
    if (cfg.saveSummaryStyle && cfg.saveSummaryStyle !== "midi") { cfg.saveSummaryStyle = "midi"; await game.settings.set("midi-qol", "ConfigSettings", cfg); }
  }
}
Hooks.once("ready", () => { applySaveCards().catch((err) => console.warn(`${MODULE_ID} | couldn't apply the saving throw card setting`, err)); });

Hooks.once("catReady", async () => {
  const api = globalThis.cat?.api;
  const mod = game.modules.get(MODULE_ID);
  if (!api) {
    console.error(`${mod.title} | CAT's API is missing - is Coven's Automation Toolkit enabled?`);
    return;
  }
  try {
    api.registerSourceName(MODULE_ID, mod.title);
    if (ownMacros.length) api.registerFnMacros(ownMacros.map((m) => ({ ...m, source: MODULE_ID })));
    // Overrides replace an existing CAT / midi-qol macro: each keeps the original source, identifier and rules.
    if (overrideMacros.length) api.registerFnMacros(overrideMacros, true);
    await api.registerAutomationModule(MODULE_ID);
    console.log(`${mod.title} ${mod.version} | registered with CAT`);
    await rankFirstOnce(mod);
  } catch (err) {
    console.error(`${mod.title} | CAT registration failed`, err);
    ui.notifications?.error(`${mod.title}: could not register with CAT - see the console (F12).`);
  }
});

// CAT ranks a source that isn't in its "Automation Sources" setting LAST, so midi-qol, CPR etc. would beat our fixes.
// The first time a GM loads the world with this module, add it at the top. Once the entry exists we never touch it
// again, so a DM who reorders or disables it keeps their choice.
async function rankFirstOnce(mod) {
  if (!game.user.isGM) return;
  const sources = foundry.utils.deepClone(game.settings.get("cat", "automationSources") ?? {});
  if (sources[MODULE_ID]) return;
  const priorities = Object.values(sources).map((s) => Number(s?.priority)).filter(Number.isFinite);
  sources[MODULE_ID] = { enabled: true, pack: false, priority: priorities.length ? Math.min(...priorities) - 1 : 0 };
  await game.settings.set("cat", "automationSources", sources);
  console.log(`${mod.title} | added to the top of CAT's Automation Sources`);
}

// Summons end with the concentration that sustains them. dnd5e leaves the summoned tokens on the map when
// concentration ends (Spiritual Weapon, Bigby's Hand, Flaming Sphere, Summon ...), so the active GM removes every
// token whose actor was summoned by that spell item. When the same spell is cast again, dnd5e places the new summon
// first and only then ends the old concentration, so summons from the last few seconds are left alone.
export function summonedBy(effect) {
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return [];
  const itemId = effect.flags?.dnd5e?.item?.id;
  const origins = new Set([effect.origin, itemId ? `${actor.uuid}.Item.${itemId}` : null].filter(Boolean));
  if (!origins.size) return [];
  const cutoff = Date.now() - 4000;
  const found = [];
  for (const scene of game.scenes) {
    for (const t of scene.tokens) {
      if (!origins.has(t.actor?.flags?.dnd5e?.summon?.origin)) continue;
      if ((summonTimes.get(t.uuid) ?? 0) >= cutoff) continue;
      found.push(t);
    }
  }
  return found;
}
// Embedded tokens carry no creation time, so remember when each summoned token appeared.
const summonTimes = new Map();
Hooks.on("createToken", (token) => { if (token.actor?.flags?.dnd5e?.summon?.origin) summonTimes.set(token.uuid, Date.now()); });
Hooks.on("deleteToken", (token) => summonTimes.delete(token.uuid));
Hooks.on("deleteActiveEffect", async (effect) => {
  if (!game.users.activeGM?.isSelf || !effect.statuses?.has("concentrating")) return;
  const tokens = summonedBy(effect);
  for (const t of tokens) await lastGasp(t);
  for (const scene of new Set(tokens.map((t) => t.parent))) {
    const ids = tokens.filter((t) => t.parent === scene).map((t) => t.id);
    try { await scene.deleteEmbeddedDocuments("Token", ids); }
    catch (err) { console.warn(`${MODULE_ID} | couldn't remove summons for ${effect.name}`, err); }
  }
});

// Summoned spirits that disappear at 0 Hit Points (the Summon spells say so). A summon with a "death-throes" ability
// (the Demon Fiendish Spirit) uses it on every creature within 10 ft first, also when the spell ends.
const VANISH_AT_ZERO = new Set(["summon-beast", "summon-fey", "summon-undead", "summon-aberration", "summon-construct", "summon-elemental",
  "summon-celestial", "summon-fiend", "summon-dragon"]);
async function lastGasp(tokenDoc) {
  const throes = tokenDoc.actor?.items.find((i) => i.system.identifier === "death-throes")?.system.activities.contents[0];
  if (!throes || tokenDoc.getFlag(MODULE_ID, "throes")) return;
  await tokenDoc.setFlag(MODULE_ID, "throes", true).catch(() => {});
  const caught = tokenDoc.parent.tokens.filter((t) => t.id !== tokenDoc.id && t.actor && !t.hidden && edgeDistance(tokenDoc, t, tokenDoc.parent) <= 10);
  if (!caught.length) return;
  try {
    await MidiQOL.completeActivityUse(throes, { midiOptions: { targetUuids: caught.map((t) => t.uuid), workflowOptions: { targetConfirmation: "none" } },
      consume: { resources: false }, create: { measuredTemplate: false } }, { configure: false }, {});
  } catch (err) { console.warn(`${MODULE_ID} | Death Throes failed`, err); }
}
Hooks.on("updateActor", async (actor, changes) => {
  if (!game.users.activeGM?.isSelf) return;
  const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if (hp === undefined || hp > 0) return;
  const origin = actor.flags?.dnd5e?.summon?.origin;
  if (!origin || !VANISH_AT_ZERO.has(fromUuidSync(origin)?.system?.identifier)) return;
  const tokenDoc = actor.token ?? actor.getActiveTokens?.()[0]?.document;
  if (!tokenDoc) return;
  await lastGasp(tokenDoc);
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>${tokenDoc.name}</strong> drops to 0 Hit Points and disappears.</p>` });
  await tokenDoc.delete().catch(() => {});
});

// Damage rules that dnd5e and midi-qol can't express with plain effect changes. A spell's effect sets one of these
// flags on the creature it protects; midi-qol calls this hook (on the client running the attack or spell) before the
// damage is applied, and the damage entry can still be changed:
//   flags.champions-guild-automation.resistance = "<damage type>"  Resistance cantrip: 1d4 less damage of that type,
//                                                                   once per turn
//   flags.champions-guild-automation.deathWard = true              Death Ward: drop to 1 HP instead of 0, once
//   flags.champions-guild-automation.wardingBond = true            Warding Bond: the caster (the effect's origin)
//                                                                   takes the same damage
const resistanceUsed = new Map(); // actor uuid -> combat turn key
export const turnKey = () => (game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : `t${Math.floor(Date.now() / 6000)}`);
export function reduceDamage(ditem, amount, types) {
  let left = amount;
  for (const d of ditem.damageDetail ?? []) {
    if (left <= 0) break;
    if (types && !types.includes(d.type)) continue;
    if (d.type === "temphp" || d.type === "healing" || (d.value ?? 0) <= 0) continue;
    const cut = Math.min(left, d.value);
    d.value -= cut;
    left -= cut;
  }
  const done = amount - left;
  if (!done) return 0;
  ditem.totalDamage = Math.max(0, (ditem.totalDamage ?? 0) - done);
  // Take the reduction from HP damage first, then from temp HP damage.
  const fromHp = Math.min(done, Math.max(0, ditem.hpDamage ?? 0));
  ditem.hpDamage = (ditem.hpDamage ?? 0) - fromHp;
  ditem.newHP = (ditem.newHP ?? 0) + fromHp;
  const fromTemp = done - fromHp;
  if (fromTemp > 0) {
    ditem.tempDamage = Math.max(0, (ditem.tempDamage ?? 0) - fromTemp);
    ditem.newTempHP = (ditem.newTempHP ?? 0) + fromTemp;
  }
  return done;
}
const effectsWith = (actor, flag) => Array.from(actor?.effects ?? []).filter((e) => !e.disabled && !e.isSuppressed
  && (e.system?.changes ?? e.changes ?? []).some((c) => c.key === `flags.${MODULE_ID}.${flag}`));
export const hasFeat = (actor, identifier) => !!actor?.items?.some((i) => i.system?.identifier === identifier);
const wearingHeavyArmor = (actor) => actor.items.some((i) => i.type === "equipment" && i.system.equipped && i.system.type?.value === "heavy");
// Boon of the Night Spirit: Resistance to everything but Psychic and Radiant while in Dim Light or Darkness.
function inBrightLight(tokenDoc) {
  const t = tokenDoc?.object;
  if (!t || tokenDoc.parent !== canvas.scene) return true; // can't tell off-canvas: no bonus
  if (canvas.environment?.globalLightSource?.active) return true;
  const c = t.center;
  for (const s of canvas.effects?.lightSources ?? []) {
    if (!s.active || s.isDarkness || s.constructor?.name === "GlobalLightSource") continue;
    const bright = Number(s.data?.bright ?? 0);
    if (bright > 0 && Math.hypot(c.x - s.x, c.y - s.y) <= bright && (s.shape?.contains?.(c.x, c.y) ?? true)) return true;
  }
  return false;
}
const fortitudeUsed = new Map(); // actor uuid -> turn key
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  const actor = token?.actor;
  if (!actor || !ditem) return;
  // Boon of Fortitude: once per turn, healing restores an extra CON modifier.
  try {
    if ((ditem.hpDamage ?? 0) < 0 && hasFeat(actor, "boon-of-fortitude") && fortitudeUsed.get(actor.uuid) !== turnKey()) {
      const con = Math.max(0, Number(actor.system.abilities.con?.mod ?? 0));
      const max = Number(actor.system.attributes.hp.max ?? 0);
      const gain = Math.min(con, Math.max(0, max - Number(ditem.newHP ?? 0)));
      if (gain > 0) {
        const heal = (ditem.damageDetail ?? []).find((d) => d.type === "healing");
        if (heal) heal.value += (heal.value < 0 ? -gain : gain); // midi stores healing as a negative value
        ditem.newHP += gain; ditem.hpDamage -= gain; ditem.totalDamage -= gain;
        fortitudeUsed.set(actor.uuid, turnKey());
        ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Boon of Fortitude:</strong> ${actor.name} regains ${gain} extra Hit Points.</p>` });
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Boon of Fortitude failed`, err); }
  if ((ditem.totalDamage ?? 0) <= 0) return;
  try {
    // Boon of the Night Spirit: halve damage (not Psychic/Radiant) outside Bright Light, unless already resistant.
    if (hasFeat(actor, "boon-of-the-night-spirit") && !inBrightLight(token.document ?? token)) {
      const tr = actor.system.traits ?? {};
      const resisted = (type) => tr.dr?.value?.has?.(type) || tr.di?.value?.has?.(type) || tr.dr?.all || tr.di?.all;
      let cut = 0;
      for (const d of ditem.damageDetail ?? []) {
        if (["psychic", "radiant", "healing", "temphp"].includes(d.type) || (d.value ?? 0) <= 0 || resisted(d.type)) continue;
        cut += reduceDamage(ditem, d.value - Math.floor(d.value / 2), [d.type]);
      }
      if (cut) ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Shadowy Form:</strong> ${actor.name} resists ${cut} damage in the dark.</p>` });
    }
    // Heavy Armor Master: while wearing Heavy armor, an attack that hits you deals PB less Bludgeoning/Piercing/Slashing.
    const tokenDoc = token.document ?? token;
    const wasHit = !!workflow?.activity?.attack && Array.from(workflow.hitTargets ?? []).some((t) => (t.document ?? t) === tokenDoc);
    if (wasHit && hasFeat(actor, "heavy-armor-master") && wearingHeavyArmor(actor)) {
      const cut = reduceDamage(ditem, Number(actor.system.attributes.prof ?? 0), ["bludgeoning", "piercing", "slashing"]);
      if (cut) ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Heavy Armor Master:</strong> ${actor.name} takes ${cut} less damage.</p>` });
    }
    // Interception (fighting style): an ally within 5 ft may use its Reaction to cut the damage.
    if (wasHit && (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) > 0) await interception(token, ditem, workflow);
    // Mage Slayer: a concentrating creature damaged by someone with the feat has Disadvantage on that Concentration save.
    if (hasFeat(workflow?.actor, "mage-slayer") && workflow.actor !== actor && actor.statuses?.has("concentrating")
      && (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0) > 0) {
      await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: actor.uuid, effects: [{
        name: "Mage Slayer: Disadvantage on Concentration", img: "icons/magic/control/debuff-energy-hold-teal-blue.webp", transfer: false,
        duration: { seconds: 6 },
        system: { changes: [{ key: "flags.midi-qol.disadvantage.concentration", value: "1", type: "override", priority: 50, phase: "initial" }] },
        flags: { dae: { specialDuration: ["isSave"], stackable: "noneName" } }
      }] }).catch((err) => console.warn(`${MODULE_ID} | Mage Slayer failed`, err));
    }
    // Resistance (cantrip)
    const types = foundry.utils.getProperty(actor, `flags.${MODULE_ID}.resistance`);
    if (types && resistanceUsed.get(actor.uuid) !== turnKey()) {
      const list = String(types).split(/[,;|\s]+/).filter(Boolean);
      if ((ditem.damageDetail ?? []).some((d) => list.includes(d.type) && d.value > 0)) {
        const roll = await new Roll("1d4").evaluate();
        const cut = reduceDamage(ditem, roll.total, list);
        if (cut) {
          resistanceUsed.set(actor.uuid, turnKey());
          roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Resistance: ${actor.name} takes ${cut} less ${list.join("/")} damage` });
        }
      }
    }
    // Death Ward
    if (foundry.utils.getProperty(actor, `flags.${MODULE_ID}.deathWard`) && (ditem.oldHP ?? 0) > 0 && (ditem.newHP ?? 1) <= 0) {
      // midi applies the per-type damage values, so trim those until the creature keeps exactly 1 HP.
      const dealt = (ditem.damageDetail ?? []).reduce((s, d) => s + (["temphp", "healing"].includes(d.type) ? 0 : Math.max(0, d.value ?? 0)), 0);
      const allowed = Math.max(0, (ditem.oldHP ?? 0) - 1 + (ditem.oldTempHP ?? 0));
      if (dealt > allowed) reduceDamage(ditem, dealt - allowed);
      ditem.newHP = 1;
      ditem.hpDamage = (ditem.oldHP ?? 1) - 1;
      const wards = effectsWith(actor, "deathWard");
      ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Death Ward:</strong> ${actor.name} drops to 1 Hit Point instead of 0, and the spell ends.</p>` });
      for (const e of wards) MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: e.uuid }).catch(() => {});
    }
    // Boon of Recovery - Last Stand: once per Long Rest, drop to 1 HP instead of 0 and regain half your HP maximum.
    const stand = (ditem.oldHP ?? 0) > 0 && (ditem.newHP ?? 1) <= 0
      ? actor.items.find((i) => i.system?.identifier === "boon-of-recovery")?.system.activities.find((a) => a.midiProperties?.identifier === "last-stand") : null;
    if (stand && Number(stand.uses?.value ?? 0) > 0) {
      const dealt = (ditem.damageDetail ?? []).reduce((s, d) => s + (["temphp", "healing"].includes(d.type) ? 0 : Math.max(0, d.value ?? 0)), 0);
      const allowed = Math.max(0, (ditem.oldHP ?? 0) - 1 + (ditem.oldTempHP ?? 0));
      if (dealt > allowed) reduceDamage(ditem, dealt - allowed);
      ditem.newHP = 1;
      ditem.hpDamage = (ditem.oldHP ?? 1) - 1;
      const half = Math.floor(Number(actor.system.attributes.hp.max ?? 0) / 2);
      try { await stand.update({ "uses.spent": Number(stand.uses.spent ?? 0) + 1 }); } catch (err) { console.warn(`${MODULE_ID} | Last Stand use not recorded`, err); }
      ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Last Stand:</strong> ${actor.name} drops to 1 Hit Point instead of 0 and regains ${half} Hit Points.</p>` });
      setTimeout(() => MidiQOL.applyTokenDamage([{ value: half, type: "healing" }], half, new Set([token]), null, new Set(), {})
        .catch((err) => console.warn(`${MODULE_ID} | Last Stand healing failed`, err)), 600);
    }
    // Warding Bond: the caster takes the same amount (after the target's own resistances and the spell's).
    if (foundry.utils.getProperty(actor, `flags.${MODULE_ID}.wardingBond`)) {
      const taken = Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
      const bond = effectsWith(actor, "wardingBond")[0];
      const casterActor = bond?.origin ? (await fromUuid(bond.origin))?.actor ?? null : null;
      const casterToken = casterActor?.getActiveTokens?.()[0];
      if (taken > 0 && casterToken && casterActor !== actor) {
        setTimeout(() => {
          ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: casterActor }), content: `<p><strong>Warding Bond:</strong> ${casterActor.name} takes ${taken} damage shared from ${actor.name}.</p>` });
          MidiQOL.applyTokenDamage([{ value: taken, type: "none" }], taken, new Set([casterToken]), null, new Set(), {})
            .catch((err) => console.warn(`${MODULE_ID} | Warding Bond damage failed`, err));
        }, 250);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | damage rules failed`, err); }
});

// Spike Growth: a creature takes 2d4 Piercing for every 5 ft it moves into or within the area. midi-qol region rules
// only fire on entering, leaving or turn start/end, so the active GM counts the grid steps a moving token ends inside a
// Spike Growth region (midi-qol's regionActivity behavior names the source spell) and applies the damage.
const SPIKE_SPELLS = new Set(["spike-growth"]);
Hooks.on("moveToken", async (tokenDoc, movement) => {
  if (!game.users.activeGM?.isSelf || !movement?.passed?.waypoints?.length) return;
  const scene = tokenDoc.parent;
  const zones = [];
  for (const region of scene?.regions ?? []) {
    for (const b of region.behaviors) {
      if (b.disabled) continue;
      // midi-qol's own behavior names the spell; rules that only apply an effect become dnd5e's applyActiveEffect
      // behavior, which names the spell's effect instead.
      let spell = null;
      if (b.type === "midi-qol.regionActivity") spell = fromUuidSync(b.system?.sourceItemUuid ?? "");
      else if (b.type === "dnd5e.applyActiveEffect") spell = fromUuidSync(Array.from(b.system?.effects ?? [])[0] ?? "")?.parent;
      if (spell && SPIKE_SPELLS.has(spell.system?.identifier)) zones.push({ region, spell, level: b.system.castLevel });
    }
  }
  if (!zones.length) return;
  const size = scene.grid.size;
  const half = { x: (tokenDoc.width * size) / 2, y: (tokenDoc.height * size) / 2 };
  const points = [movement.origin, ...movement.passed.waypoints].filter(Boolean);
  for (const { region, spell } of zones) {
    let steps = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dist = scene.grid.measurePath([a, b]).distance;
      const n = Math.max(1, Math.round(dist / scene.grid.distance));
      for (let k = 1; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n + half.x, y: a.y + ((b.y - a.y) * k) / n + half.y, elevation: b.elevation ?? 0 };
        if (region.testPoint(p)) steps++;
      }
    }
    if (!steps || !tokenDoc.object) continue;
    try {
      const roll = await new Roll(`${2 * steps}d4`).evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: spell.actor }),
        flavor: `${spell.name}: ${tokenDoc.name} moves ${steps * scene.grid.distance} ft through the spikes (Piercing)` });
      await MidiQOL.applyTokenDamage([{ value: roll.total, type: "piercing", properties: ["mgc"] }], roll.total, new Set([tokenDoc.object]), spell, new Set(), {});
    } catch (err) { console.warn(`${MODULE_ID} | Spike Growth damage failed`, err); }
  }
});

// Effects an area applies while a creature stands in it (Spirit Guardians' half speed, Hunger of Hadar's blindness ...)
// come from dnd5e's applyActiveEffect region behavior, which removes them when the token leaves. It misses leaving an
// area attached to a moving token, and the area being deleted when the spell ends, so the active GM sweeps: an effect
// whose origin is a region behavior is removed once that region is gone or no longer contains the creature's token.
let sweepTimer = null;
function scheduleRegionSweep(scene) {
  if (!game.users.activeGM?.isSelf || !scene) return;
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => sweepRegionEffects(scene), 600);
}
async function sweepRegionEffects(scene) {
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor) continue;
    const stale = actor.effects.filter((e) => {
      if (!e.origin?.includes(".RegionBehavior.")) return false;
      if (!e.origin.startsWith(scene.uuid)) return false;
      const behavior = fromUuidSync(e.origin);
      if (!behavior?.parent) return true; // the area is gone
      return !behavior.parent.tokens?.has?.(token);
    }).map((e) => e.id);
    if (!stale.length) continue;
    try { await actor.deleteEmbeddedDocuments("ActiveEffect", stale); }
    catch (err) { console.warn(`${MODULE_ID} | couldn't remove area effects from ${token.name}`, err); }
  }
}
Hooks.on("moveToken", (tokenDoc) => scheduleRegionSweep(tokenDoc.parent));
Hooks.on("deleteRegion", (region) => scheduleRegionSweep(region.parent));
Hooks.on("updateRegion", (region) => scheduleRegionSweep(region.parent));

// Summons that hurt creatures near them. dnd5e places the summoned token (its actor's flags.dnd5e.summon names the spell
// and slot level); the active GM watches turns and movement and runs the spell's hidden save activity (midi identifier
// "<spell identifier>-aura", or "-aura-<element>" for Conjure Elemental) on each creature that qualifies, once per turn.
//   turnStart / turnEnd: the creature starts / ends its turn within range of the summon
//   enter: the creature moves to within range;  summonMove: the summon moves to within range of the creature
//   ownTurnStart: the summon starts its own turn (every creature in range)
//   casterTurnStart: the caster starts their turn (up to maxTargets creatures in range, nearest first)
// An entry can instead name an ability of the summoned creature (actorItem = the item's identifier), limited to one form
// (form = text in the summon's name), e.g. the Putrid Undead Spirit's Festering Aura.
const SUMMON_AURAS = {
  "flaming-sphere": { range: 5, triggers: ["turnEnd", "summonMove"], enemiesOnly: false },
  "conjure-animals": { range: 10, triggers: ["enter", "turnEnd", "summonMove"], enemiesOnly: true },
  "guardian-of-faith": { range: 10, triggers: ["enter", "turnStart"], enemiesOnly: true, damageCap: 60 },
  "conjure-elemental": { range: 5, triggers: ["enter", "turnStart"], enemiesOnly: true, oneRestrained: true },
  "summon-undead": { form: "putrid", actorItem: "festering-aura", range: 5, triggers: ["turnStart"], excludeCaster: true },
  "summon-construct": { form: "stone", actorItem: "stony-lethargy", range: 10, triggers: ["turnStart"], enemiesOnly: true },
  "summon-aberration": { form: "mind flayer", actorItem: "whispering-aura", range: 5, triggers: ["ownTurnStart"], excludeCaster: true, needsActive: true },
  "faithful-hound": { actorItem: "bite", range: 5, triggers: ["casterTurnStart"], enemiesOnly: true, maxTargets: 1 }
};
const auraUsed = new Set();
export function edgeDistance(a, b, scene) {
  // Distance between two token footprints in feet (grid squares, diagonals count as 5 ft), from top-left positions.
  const g = scene.grid.size, d = scene.grid.distance;
  const ca = { x: a.x + (a.width * g) / 2, y: a.y + (a.height * g) / 2 }, cb = { x: b.x + (b.width * g) / 2, y: b.y + (b.height * g) / 2 };
  const dx = Math.max(0, Math.abs(ca.x - cb.x) - ((a.width + b.width) * g) / 2);
  const dy = Math.max(0, Math.abs(ca.y - cb.y) - ((a.height + b.height) * g) / 2);
  return Math.round(Math.max(dx, dy) / g) * d + d; // adjacent squares are 5 ft apart
}
function auraSummons(scene) {
  const out = [];
  for (const t of scene?.tokens ?? []) {
    const summon = t.actor?.flags?.dnd5e?.summon;
    if (!summon?.origin) continue;
    const spell = fromUuidSync(summon.origin);
    for (const cfg of [SUMMON_AURAS[spell?.system?.identifier] ?? []].flat()) {
      if (cfg.form && !`${t.name} ${t.actor?.name}`.toLowerCase().includes(cfg.form)) continue;
      out.push({ token: t, spell, cfg, level: Number(summon.level) || spell.system.level });
    }
  }
  return out;
}
async function triggerAura(aura, creature, why) {
  const { token: summonToken, spell, cfg, level } = aura;
  if (!creature?.actor || creature.id === summonToken.id || creature.hidden) return;
  if (creature.actor.flags?.dnd5e?.summon?.origin === spell.uuid) return; // its own summons
  if ((creature.actor.system.attributes?.hp?.value ?? 0) <= 0) return;
  const casterToken = spell.actor?.getActiveTokens?.()[0]?.document;
  if (creature.id === casterToken?.id && (cfg.enemiesOnly || cfg.excludeCaster)) return;
  if (cfg.needsActive && summonToken.actor?.statuses?.has("incapacitated")) return;
  if (cfg.enemiesOnly && casterToken && creature.disposition === casterToken.disposition) return;
  const key = `${summonToken.id}|${cfg.actorItem ?? ""}|${creature.id}|${turnKey()}`;
  if (auraUsed.has(key)) return;
  let ident = `${spell.system.identifier}-aura`;
  if (spell.system.identifier === "conjure-elemental") {
    const element = ["air", "earth", "fire", "water"].find((e) => summonToken.name.toLowerCase().includes(e) || summonToken.actor?.name?.toLowerCase().includes(e)) ?? "air";
    ident += `-${element}`;
  }
  const activity = cfg.actorItem
    ? summonToken.actor?.items.find((i) => i.system.identifier === cfg.actorItem)?.system.activities.contents[0]
    : spell.system.activities.find((a) => a.midiProperties?.identifier === ident);
  if (!activity) return;
  if (cfg.oneRestrained) {
    // Conjure Elemental: only while the spirit has no creature Restrained.
    const held = canvas.scene?.tokens.some((t) => t.actor?.effects.some((e) => e.statuses?.has("restrained") && String(e.origin ?? "").startsWith(spell.actor.uuid) && e.name.startsWith(spell.name)));
    if (held) return;
  }
  auraUsed.add(key);
  try {
    const usage = { midiOptions: { targetUuids: [creature.uuid], workflowOptions: { targetConfirmation: "none" } },
      consume: { spellSlot: false, resources: false }, concentration: { begin: false, end: null }, create: { measuredTemplate: false } };
    if (!cfg.actorItem) usage.spell = { slot: `spell${level}` };
    const wf = await MidiQOL.completeActivityUse(activity, usage, { configure: false }, {});
    if (cfg.damageCap) {
      const dealt = (wf?.damageList ?? []).reduce((s, d) => s + Math.max(0, (d.hpDamage ?? 0) + (d.tempDamage ?? 0)), 0);
      const total = (summonToken.getFlag(MODULE_ID, "dealt") ?? 0) + dealt;
      if (total >= cfg.damageCap) {
        ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: spell.actor }), content: `<p><strong>${spell.name}</strong> has dealt ${total} damage and vanishes.</p>` });
        await summonToken.delete();
      } else await summonToken.setFlag(MODULE_ID, "dealt", total);
    }
  } catch (err) { console.warn(`${MODULE_ID} | ${spell.name} (${why}) failed`, err); }
}
Hooks.on("updateCombat", async (combat, changed) => {
  if (!game.users.activeGM?.isSelf || !("turn" in changed || "round" in changed)) return;
  const scene = combat.scene ?? canvas.scene;
  const auras = auraSummons(scene);
  if (!auras.length) return;
  const prev = combat.previous?.tokenId ? scene.tokens.get(combat.previous.tokenId) : null;
  const curr = combat.combatant?.token;
  for (const aura of auras) {
    if (prev && aura.cfg.triggers.includes("turnEnd") && edgeDistance(aura.token, prev, scene) <= aura.cfg.range) {
      // The end of the previous turn still counts as that turn for once-per-turn purposes.
      await triggerAura(aura, prev, "turn end");
    }
  }
  for (const aura of auras) {
    if (curr && aura.cfg.triggers.includes("turnStart") && edgeDistance(aura.token, curr, scene) <= aura.cfg.range) await triggerAura(aura, curr, "turn start");
    if (curr && aura.cfg.triggers.includes("casterTurnStart") && curr.actorId === aura.spell.actor?.id) {
      const near = scene.tokens.filter((o) => o.id !== aura.token.id && o.actor && edgeDistance(aura.token, o, scene) <= aura.cfg.range
        && o.disposition !== curr.disposition && (o.actor.system.attributes?.hp?.value ?? 0) > 0)
        .sort((a, b) => edgeDistance(aura.token, a, scene) - edgeDistance(aura.token, b, scene));
      for (const o of near.slice(0, aura.cfg.maxTargets ?? near.length)) await triggerAura(aura, o, "caster's turn start");
    }
    if (curr?.id === aura.token.id && aura.cfg.triggers.includes("ownTurnStart")) {
      for (const other of scene.tokens) {
        if (other.id !== aura.token.id && edgeDistance(aura.token, other, scene) <= aura.cfg.range) await triggerAura(aura, other, "its turn start");
      }
    }
  }
});
Hooks.on("moveToken", async (tokenDoc, movement) => {
  if (!game.users.activeGM?.isSelf || !movement?.origin) return;
  const scene = tokenDoc.parent;
  const auras = auraSummons(scene);
  if (!auras.length) return;
  const before = { x: movement.origin.x, y: movement.origin.y, width: tokenDoc.width, height: tokenDoc.height };
  const after = { x: movement.destination?.x ?? tokenDoc.x, y: movement.destination?.y ?? tokenDoc.y, width: tokenDoc.width, height: tokenDoc.height };
  for (const aura of auras) {
    if (aura.token.id === tokenDoc.id) {
      if (!aura.cfg.triggers.includes("summonMove")) continue;
      for (const other of scene.tokens) {
        if (other.id === tokenDoc.id) continue;
        if (edgeDistance(before, other, scene) > aura.cfg.range && edgeDistance(after, other, scene) <= aura.cfg.range) await triggerAura(aura, other, "summon moved");
      }
    } else if (aura.cfg.triggers.includes("enter")) {
      if (edgeDistance(aura.token, before, scene) > aura.cfg.range && edgeDistance(aura.token, after, scene) <= aura.cfg.range) await triggerAura(aura, tokenDoc, "entered");
    }
  }
});

// Effects a concentration spell puts on creatures end with that concentration. dnd5e links the ones the casting itself
// applies, but not those applied later by the spell's areas, repeat saves or summons (Black Tentacles' Restrained from
// entering the area, Conjure Elemental's Restrained ...). The active GM links those to the caster's concentration.
function spellOfOrigin(origin) {
  if (!origin?.includes(".Item.")) return null;
  let doc = null;
  try { doc = fromUuidSync(origin); } catch (err) { return null; }
  if (doc instanceof Item) return doc;
  if (doc?.item instanceof Item) return doc.item;
  if (doc?.parent instanceof Item) return doc.parent;
  return null;
}
Hooks.on("createActiveEffect", async (effect) => {
  if (!game.users.activeGM?.isSelf) return;
  if (!(effect.parent instanceof Actor) || effect.transfer || effect.statuses?.has("concentrating")) return;
  if (effect.flags?.dnd5e?.dependentOn) return;
  const spell = spellOfOrigin(String(effect.origin ?? ""));
  const props = spell?.system?.properties;
  if (spell?.type !== "spell" || !(props?.has?.("concentration") ?? props?.includes?.("concentration"))) return;
  const conc = Array.from(spell.actor?.effects ?? []).find((e) => e.statuses?.has("concentrating") && e.flags?.dnd5e?.item?.id === spell.id);
  if (!conc || conc === effect) return;
  try { await MidiQOL.addDependent(conc, effect); }
  catch (err) { console.warn(`${MODULE_ID} | couldn't tie ${effect.name} to ${spell.name}'s concentration`, err); }
});

// dnd5e imports a summoned creature from our compendium into the world once and reuses that copy for every later cast,
// so a spirit fixed in a module update would keep its old statistics. After an update, delete the auto-imported copies
// that aren't on any map; the next cast imports the new version.
async function refreshSummonCopies() {
  const prefix = `Compendium.${MODULE_ID}.cga-summons.`;
  const onMap = new Set(game.scenes.contents.flatMap((s) => s.tokens.map((t) => t.actorId)));
  const stale = game.actors.filter((a) => a.getFlag("dnd5e", "isAutoImported") && String(a._stats?.compendiumSource ?? "").startsWith(prefix) && !onMap.has(a.id));
  if (!stale.length) return;
  try {
    await Actor.implementation.deleteDocuments(stale.map((a) => a.id));
    console.log(`${MODULE_ID} | removed ${stale.length} outdated summoned-creature copies`);
  } catch (err) { console.warn(`${MODULE_ID} | couldn't remove outdated summon copies`, err); }
}

// Holy Aura: when a Fiend or Undead hits a creature protected by the aura with a melee attack, it makes the spell's
// CON save or is Blinded. The protection comes from the aura's region, so find the spell through the region behavior.
Hooks.on("midi-qol.RollComplete", async (wf) => {
  try {
    if (!["mwak", "msak"].includes(wf?.activity?.actionType) || !wf.hitTargets?.size) return;
    if (!["fiend", "undead"].includes(wf.actor?.system?.details?.type?.value)) return;
    for (const target of wf.hitTargets) {
      const prot = Array.from(target.actor?.effects ?? []).find((e) => e.name === "Holy Protection");
      if (!prot) continue;
      const behavior = prot.origin?.includes(".RegionBehavior.") ? fromUuidSync(prot.origin) : null;
      const spell = behavior ? fromUuidSync(Array.from(behavior.system?.effects ?? [])[0] ?? "")?.parent : spellOfOrigin(String(prot.origin ?? ""));
      const save = spell?.system?.activities?.find((a) => a.midiProperties?.identifier === "holyAuraBlind");
      if (!save || !wf.token) return;
      await MidiQOL.completeActivityUse(save, { midiOptions: { targetUuids: [wf.token.document.uuid], workflowOptions: { targetConfirmation: "none" } },
        consume: { spellSlot: false, resources: false }, concentration: { begin: false, end: null }, create: { measuredTemplate: false } }, { configure: false }, {});
      return; // once per attack
    }
  } catch (err) { console.warn(`${MODULE_ID} | Holy Aura failed`, err); }
});

// Alert (2024): right after Initiative is rolled, the creature with Alert may swap Initiative with a willing ally in the
// same combat (neither Incapacitated). Once every combatant on its side has rolled, the owner (a player if one is
// online, otherwise the GM) gets a prompt; "Keep my Initiative" is the default. The swap itself runs on the GM's client.
// The feat's "Initiative Swap" activity opens the same prompt by hand.
let cgaSocket = null;
Hooks.once("socketlib.ready", () => {
  cgaSocket = socketlib.registerModule(MODULE_ID);
  cgaSocket.register("swapInitiative", swapInitiativeAsGM);
  cgaSocket.register("askYesNo", askYesNoHere);
  cgaSocket.register("askChoice", askChoiceHere);
  cgaSocket.register("createTokens", (sceneId, data) => game.scenes.get(sceneId)?.createEmbeddedDocuments("Token", data).then((docs) => docs.map((d) => d.id)));
  cgaSocket.register("updateTokens", (sceneId, updates, options = {}) => game.scenes.get(sceneId)?.updateEmbeddedDocuments("Token", updates, options).then(() => true));
  cgaSocket.register("rollSave", rollSaveHere);
});
// A saving throw for a creature the current user may not own (item riders): rolls on the GM's client, returns the total.
async function rollSaveHere(actorUuid, ability, dc) {
  const a = fromUuidSync(actorUuid);
  if (!a) return null;
  const r = await a.rollSavingThrow({ ability, target: dc }, { configure: false }, {}).catch(() => null);
  const roll = Array.isArray(r) ? r[0] : r;
  return roll ? Number(roll.total) : null;
}
export async function gmRollSave(actor, ability, dc) {
  const total = actor.isOwner || !cgaSocket ? await rollSaveHere(actor.uuid, ability, dc) : await cgaSocket.executeAsGM("rollSave", actor.uuid, ability, dc);
  return total === null ? null : total >= dc;
}
async function askYesNoHere(title, html, seconds = 30) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(!!v); } };
    const dlg = foundry.applications.api.DialogV2.confirm({ window: { title }, content: `${html}<p><em>(${seconds} seconds to decide)</em></p>`, rejectClose: false })
      .then(finish, () => finish(false));
    setTimeout(() => { finish(false); for (const app of foundry.applications.instances.values()) if (app.options?.window?.title === title) app.close(); }, seconds * 1000);
  });
}
// Ask the player who controls `actor` (or the GM when no owner is online). Resolves false on no answer.
export async function askOwner(actor, title, html) {
  const user = responsibleUser(actor);
  if (!user) return false;
  if (user.isSelf) return askYesNoHere(title, html);
  try { return !!(await cgaSocket?.executeAsUser("askYesNo", user.id, title, html)); } catch (err) { return false; }
}
// A choice for the owner of `actor`: buttons = [{ action, label, default? }]. Resolves the picked action, or null.
async function askChoiceHere(title, html, buttons, seconds = 30) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v ?? null); } };
    foundry.applications.api.DialogV2.wait({ window: { title }, content: `${html}<p><em>(${seconds} seconds to decide)</em></p>`,
      buttons: buttons.map((b) => ({ ...b, callback: (event, button) => (b.form ? new foundry.applications.ux.FormDataExtended(button.form).object : b.action) })), rejectClose: false })
      .then(finish, () => finish(null));
    setTimeout(() => { finish(null); for (const app of foundry.applications.instances.values()) if (app.options?.window?.title === title) app.close(); }, seconds * 1000);
  });
}
export async function askChoice(actor, title, html, buttons, seconds = 30) {
  const user = responsibleUser(actor);
  if (!user) return null;
  if (user.isSelf) return askChoiceHere(title, html, buttons, seconds);
  try { return (await cgaSocket?.executeAsUser("askChoice", user.id, title, html, buttons, seconds)) ?? null; } catch (err) { return null; }
}

// Fighting styles that react to attacks on someone else (the attacker's client runs these):
//  - Protection: when a creature attacks a target within 5 ft of you and you hold a Shield, Reaction: Disadvantage on
//    that attack and on attacks against the target until the start of your next turn.
//  - Interception: when a creature hits a target within 5 ft of you and you hold a Shield or a weapon, Reaction: reduce
//    the damage by 1d10 + your Proficiency Bonus.
export const holdsShield = (a) => a.items.some((i) => i.type === "equipment" && i.system.equipped && i.system.type?.value === "shield");
const holdsWeapon = (a) => a.items.some((i) => i.type === "weapon" && i.system.equipped && ["simpleM", "simpleR", "martialM", "martialR"].includes(i.system.type?.value)
  && i.system.identifier !== "unarmed-strike");
function guardians(targetDoc, attacker, identifier, canUse) {
  const scene = targetDoc?.parent;
  if (!scene) return [];
  return scene.tokens.filter((t) => t !== targetDoc && t.actor && t.actor !== attacker && !t.hidden && hasFeat(t.actor, identifier)
    && t.disposition === targetDoc.disposition && !isIncapacitated(t.actor) && !MidiQOL.hasUsedReaction?.(t.actor)
    && (t.actor.system.attributes.hp.value ?? 0) > 0 && edgeDistance(t, targetDoc, scene) <= 5 && canUse(t.actor));
}
Hooks.on("midi-qol.preAttackRoll", async (workflow) => {
  try {
    if (!workflow?.activity?.attack || workflow.targets?.size !== 1) return;
    const target = Array.from(workflow.targets)[0];
    const targetDoc = target.document ?? target;
    for (const g of guardians(targetDoc, workflow.actor, "protection", holdsShield)) {
      const ok = await askOwner(g.actor, `Protection: ${g.name}`,
        `<p><strong>${workflow.actor?.name}</strong> is attacking <strong>${targetDoc.name}</strong> next to you. Use your Reaction to interpose your Shield (Disadvantage on this attack and on attacks against ${targetDoc.name} until the start of your next turn)?</p>`);
      if (!ok) continue;
      const feat = g.actor.items.find((i) => i.system?.identifier === "protection");
      await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: targetDoc.actor.uuid, effects: [{
        name: `Protection (${g.name})`, img: feat?.img ?? "icons/equipment/shield/heater-steel-worn.webp", transfer: false, origin: feat?.uuid,
        system: { changes: [{ key: "flags.midi-qol.grants.disadvantage.attack.all", value: "1", type: "override", priority: 50, phase: "initial" }] },
        flags: { dae: { specialDuration: ["turnStartSource"], stackable: "noneName" } } }] });
      await MidiQOL.setReactionUsed?.(g.actor);
      ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: g.actor }), content: `<p><strong>Protection:</strong> ${g.name} interposes a Shield to protect ${targetDoc.name}.</p>` });
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Protection failed`, err); }
});
async function interception(token, ditem, workflow) {
  const tokenDoc = token.document ?? token;
  for (const g of guardians(tokenDoc, workflow.actor, "interception", (a) => holdsShield(a) || holdsWeapon(a))) {
    const ok = await askOwner(g.actor, `Interception: ${g.name}`,
      `<p><strong>${tokenDoc.name}</strong> is hit for ${ditem.hpDamage + (ditem.tempDamage ?? 0)} damage next to you. Use your Reaction to reduce it by 1d10 + your Proficiency Bonus?</p>`);
    if (!ok) continue;
    const roll = await new Roll(`1d10 + ${Number(g.actor.system.attributes.prof ?? 0)}`).evaluate();
    const cut = reduceDamage(ditem, roll.total);
    await MidiQOL.setReactionUsed?.(g.actor);
    roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: g.actor }), flavor: `Interception: ${g.name} reduces the damage to ${tokenDoc.name} by ${cut}` });
    return;
  }
}
async function swapInitiativeAsGM(combatId, aId, bId) {
  const combat = game.combats.get(combatId);
  const a = combat?.combatants.get(aId); const b = combat?.combatants.get(bId);
  if (!a || !b) return false;
  const currentId = combat.started ? combat.combatant?.id : null;
  await combat.updateEmbeddedDocuments("Combatant", [{ _id: a.id, initiative: b.initiative }, { _id: b.id, initiative: a.initiative }], { cgaAlertSwap: true });
  if (currentId) {
    const idx = combat.turns.findIndex((c) => c.id === currentId);
    if (idx >= 0 && idx !== combat.turn) await combat.update({ turn: idx });
  }
  return true;
}
export const isIncapacitated = (actor) => !!actor?.statuses?.has("incapacitated") || ["paralyzed", "petrified", "stunned", "unconscious"].some((s) => actor?.statuses?.has(s));
const sideOf = (c) => (c.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE ? -1 : c.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY ? 1 : 0);
export async function alertSwap(combatant, { auto = false } = {}) {
  const combat = combatant?.parent;
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const warn = (m) => { if (!auto) ui.notifications.warn(`Alert: ${m}`); };
  if (!combat) return warn("there is no active combat.");
  if (combatant.initiative === null || combatant.initiative === undefined) return warn(`${combatant.name} hasn't rolled Initiative yet.`);
  if (isIncapacitated(combatant.actor)) return warn(`${combatant.name} is Incapacitated and can't swap.`);
  const allies = combat.combatants.filter((c) => c.id !== combatant.id && !c.defeated && sideOf(c) === sideOf(combatant)
    && c.initiative !== null && c.initiative !== undefined && !isIncapacitated(c.actor) && c.initiative !== combatant.initiative)
    .sort((a, b) => b.initiative - a.initiative);
  if (!allies.length) return warn("no ally to swap with.");
  const buttons = allies.map((c) => ({ action: c.id, label: `${c.name} (${c.initiative})` }));
  buttons.push({ action: "keep", label: "Keep my Initiative", default: true });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Alert: Initiative Swap - ${combatant.name}` },
    content: `<p><strong>${esc(combatant.name)}</strong> rolled <strong>${combatant.initiative}</strong>. Swap Initiative with a willing ally?</p>`,
    buttons, rejectClose: false
  }).catch(() => null);
  if (!choice || choice === "keep") return;
  const other = combat.combatants.get(choice);
  if (!other) return;
  const [mine, theirs] = [combatant.initiative, other.initiative];
  const done = game.user.isGM ? await swapInitiativeAsGM(combat.id, combatant.id, other.id)
    : await cgaSocket?.executeAsGM("swapInitiative", combat.id, combatant.id, other.id).catch(() => false);
  if (!done) return ui.notifications.warn("Alert: the swap needs a GM online.");
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: combatant.actor }),
    content: `<p><strong>Alert:</strong> ${esc(combatant.name)} swaps Initiative with ${esc(other.name)}: ${esc(combatant.name)} is now on <strong>${theirs}</strong>, ${esc(other.name)} on <strong>${mine}</strong>.</p>` });
}
const alertAsked = new Set();
export function responsibleUser(actor) {
  return game.users.find((u) => u.active && !u.isGM && actor?.testUserPermission(u, "OWNER")) ?? game.users.activeGM;
}
Hooks.on("updateCombatant", (combatant, changes, options) => {
  if (!("initiative" in changes) || options?.cgaAlertSwap) return;
  const combat = combatant.parent;
  for (const c of combat.combatants) {
    const key = `${combat.id}.${c.id}`;
    if (alertAsked.has(key) || c.initiative === null || c.initiative === undefined || !hasFeat(c.actor, "alert")) continue;
    if (responsibleUser(c.actor)?.id !== game.user.id) continue;
    // Wait until everyone on its side has rolled, so the prompt can offer every ally.
    if (combat.combatants.some((o) => sideOf(o) === sideOf(c) && (o.initiative === null || o.initiative === undefined))) continue;
    alertAsked.add(key);
    setTimeout(() => alertSwap(c, { auto: true }), 500);
  }
});
Hooks.on("deleteCombat", (combat) => { for (const k of [...alertAsked]) if (k.startsWith(`${combat.id}.`)) alertAsked.delete(k); });
Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = { alertSwap, alertSwapFor: (actor) => alertSwap(game.combat?.combatants.find((c) => c.actor === actor || c.actorId === actor?.id)), askChoice, createTokens };
});

// Medium Armor Master: in Medium armor with DEX 16+, AC gets +1 (DEX adds 3 instead of 2). The feat's AC effect is
// switched on and off by the active GM whenever armor, the feat or Dexterity changes.
async function syncMediumArmorMaster(actor) {
  if (!game.users.activeGM?.isSelf || !actor?.items) return;
  const feat = actor.items.find((i) => i.system?.identifier === "medium-armor-master");
  const eff = feat?.effects.find((e) => e.flags?.world?.cgaMediumArmor);
  if (!eff) return;
  const medium = actor.items.some((i) => i.type === "equipment" && i.system.equipped && i.system.type?.value === "medium");
  const want = medium && Number(actor.system.abilities?.dex?.value ?? 0) >= 16;
  if (eff.disabled === want) await eff.update({ disabled: !want }).catch(() => {});
}
for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, (item) => { if (item.parent instanceof Actor) syncMediumArmorMaster(item.parent); });
Hooks.on("updateActor", (actor, changes) => { if (foundry.utils.hasProperty(changes, "system.abilities.dex")) syncMediumArmorMaster(actor); });

// Boon of Spell Recall - Free Casting: casting with a level 1-4 slot rolls 1d4; on a match the slot isn't expended.
// dnd5e's consumption hook knows which slot is being spent, so the slot update is simply dropped.
Hooks.on("dnd5e.activityConsumption", (activity, usageConfig, messageConfig, updates) => {
  try {
    const actor = activity?.actor;
    const slot = usageConfig?.spell?.slot;
    if (!slot || activity.item?.type !== "spell" || !hasFeat(actor, "boon-of-spell-recall")) return;
    const level = Number(actor.system.spells?.[slot]?.level ?? 0);
    const key = `system.spells.${slot}.value`;
    const upd = updates?.actor ?? {};
    const flat = key in upd;
    if (level < 1 || level > 4 || (!flat && foundry.utils.getProperty(upd, key) === undefined)) return;
    // The hook is synchronous, so draw the d4 directly (dice rolls are asynchronous).
    const d4 = Math.min(4, Math.max(1, Math.ceil(CONFIG.Dice.randomUniform() * 4)));
    const saved = d4 === level;
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Boon of Spell Recall:</strong> Free Casting with a level ${level} slot - 1d4 rolls <strong>${d4}</strong>${saved ? ": the slot isn't expended." : "."}</p>` });
    if (!saved) return;
    if (flat) delete upd[key]; else foundry.utils.setProperty(upd, key, actor.system.spells[slot].value);
  } catch (err) { console.warn(`${MODULE_ID} | Spell Recall failed`, err); }
});

// Lucky (2024): before a creature with Lucky rolls a saving throw that doesn't already have Advantage, its owner is
// asked whether to spend a Luck Point for Advantage (the choice comes before any d20 is rolled). Wraps
// Actor#rollSavingThrow, so it covers saves midi-qol requests, Concentration saves and saves rolled from the sheet.
const truthy = (v) => v !== undefined && v !== null && v !== false && v !== 0 && v !== "0" && v !== "" && v !== "false";
function saveHasAdvantage(actor, config, message) {
  const abl = config?.ability;
  if (config?.advantage || config?.midiOptions?.advantage || config?.rolls?.some?.((r) => r?.options?.advantage)) return true;
  const mf = actor.flags?.["midi-qol"] ?? {};
  const adv = mf.advantage ?? {};
  const isConc = !!(config?.isConcentration || config?.midiOptions?.isConcentrationCheck
    || message?.data?.flags?.["midi-qol"]?.isConcentrationCheck || config?.workflow?.item?.flags?.["midi-qol"]?.isConcentrationCheck);
  const flags = [adv.all, adv.ability?.all, adv.ability?.save?.all, adv.ability?.save?.[abl], adv.save?.all, adv.save?.[abl], isConc ? adv.concentration : undefined];
  if (flags.some(truthy)) return true;
  const magic = config?.isMagicSave || config?.midiOptions?.isMagicSave || config?.workflow?.item?.type === "spell";
  if (magic && (truthy(mf.magicResistance?.all) || truthy(mf.magicResistance?.[abl]))) return true;
  if (Number(actor.system?.abilities?.[abl]?.save?.roll?.mode ?? 0) > 0 || Number(actor.system?.rolls?.ability?.save?.mode ?? 0) > 0) return true;
  return false;
}
async function luckyBeforeSave(actor, config, message) {
  if (!actor || config?.cgaLucky !== undefined) return config;
  const lucky = actor.items?.find((i) => i.system?.identifier === "lucky");
  const left = Number(lucky?.system?.uses?.value ?? 0);
  if (!lucky || left <= 0 || saveHasAdvantage(actor, config, message)) return config;
  const label = CONFIG.DND5E.abilities[config.ability]?.label ?? "saving";
  const ok = await askOwner(actor, `Lucky: ${actor.name}`,
    `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> is about to make a <strong>${label} saving throw</strong>. Spend a Luck Point for Advantage? (${left} left)</p>`);
  config = { ...config, cgaLucky: !!ok };
  if (!ok) return config;
  try { await lucky.update({ "system.uses.spent": Number(lucky.system.uses.spent ?? 0) + 1 }); }
  catch (err) { await MidiQOL.socket().executeAsGM("updateItems", { actorUuid: actor.uuid, updates: [{ _id: lucky.id, "system.uses.spent": Number(lucky.system.uses.spent ?? 0) + 1 }] }).catch(() => {}); }
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>Lucky:</strong> ${foundry.utils.escapeHTML(actor.name)} spends a Luck Point for Advantage on the ${label} saving throw.</p>` });
  config.advantage = true;
  config.midiOptions = { ...(config.midiOptions ?? {}), advantage: true };
  return config;
}
Hooks.once("setup", () => {
  if (!globalThis.libWrapper) return console.warn(`${MODULE_ID} | libWrapper missing: Lucky's saving-throw prompt is off`);
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollSavingThrow", async function (wrapped, config = {}, dialog = {}, message = {}) {
    try { config = await luckyBeforeSave(this, config, message); } catch (err) { console.warn(`${MODULE_ID} | Lucky prompt failed`, err); }
    return wrapped(config, dialog, message);
  }, "WRAPPER");
});

// After an update, tell the GM once that there are new fixes to apply.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const mod = game.modules.get(MODULE_ID);
  const last = game.settings.get(MODULE_ID, "lastSeenVersion");
  if (last === mod.version) return;
  await refreshSummonCopies();
  const firstRun = !last;
  const content = firstRun
    ? `<h3>${mod.title} ${mod.version}</h3>
       <p>Installed and placed at the top of CAT's <b>Automation Sources</b> list, so its fixes win over other sources.
       (You can change that in CAT's settings; this module won't move it again.)</p>
       <p>Next: on each player character, open the CAT shield in the sheet's title bar and click
       <b>Mass Apply / Update</b>.</p>`
    : `<h3>${mod.title} updated: ${last} &rarr; ${mod.version}</h3>
       <p>New or changed fixes are available. On each character, open the CAT shield in the sheet's title bar and click
       <b>Mass Apply / Update</b> to pick them up. See the module's CHANGELOG for the list.</p>`;
  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    speaker: { alias: mod.title }
  });
  await game.settings.set(MODULE_ID, "lastSeenVersion", mod.version);
});
// Create tokens on a scene through the GM (players usually can't create tokens), for features like Invoke Duplicity.
export async function createTokens(scene, data) {
  if (game.user.isGM) return (await scene.createEmbeddedDocuments("Token", data)).map((d) => d.id);
  return cgaSocket?.executeAsGM("createTokens", scene.id, data);
}
// Update tokens the current user may not own (swap places, teleports): runs on the GM's client.
export async function gmUpdateTokens(scene, updates, options = {}) {
  if (game.user.isGM) return scene.updateEmbeddedDocuments("Token", updates, options);
  return cgaSocket?.executeAsGM("updateTokens", scene.id, updates, options);
}
