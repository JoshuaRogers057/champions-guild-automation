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
});

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
  for (const scene of new Set(tokens.map((t) => t.parent))) {
    const ids = tokens.filter((t) => t.parent === scene).map((t) => t.id);
    try { await scene.deleteEmbeddedDocuments("Token", ids); }
    catch (err) { console.warn(`${MODULE_ID} | couldn't remove summons for ${effect.name}`, err); }
  }
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
const turnKey = () => (game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : `t${Math.floor(Date.now() / 6000)}`);
function reduceDamage(ditem, amount, types) {
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
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem }) => {
  const actor = token?.actor;
  if (!actor || !ditem || (ditem.totalDamage ?? 0) <= 0) return;
  try {
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

// After an update, tell the GM once that there are new fixes to apply.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const mod = game.modules.get(MODULE_ID);
  const last = game.settings.get(MODULE_ID, "lastSeenVersion");
  if (last === mod.version) return;
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
