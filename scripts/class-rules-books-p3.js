// Champions Guild Automation - priority-3 class and subclass features from Forge of the Artificer, Ravenloft, Heroes
// of Faerûn and Arcana Unleashed (module rules keyed on the feature identifier). Some P3 features extend P1/P2 rules
// directly (Ingenious Movement, Mystical Connection, Eventide's Splendor, Improved Defender, Fortified Position's second
// cannon, Aura of Malevolence, Death's Friend, Potent Stone).
//  Artificer: Magic Item Tinker, Spell-Storing Item, Soul of Artifice. Alchemist: Chemical Mastery. Armorer: Perfected
//  Armor. Artillerist: Fortified Position (Half Cover). Cartographer: Superior Atlas. Reanimator: Refined Reanimation.
//  Grave: Divine Reaper. Knowledge / restore activities. Arcane Archer: Indomitable Teleport, Masterful Shots.
//  Banneret: Shared Resilience. Noble Genies: Elemental Rebuke, Noble Scion. Hollow Warden: Ancient Might. Winter
//  Walker: Frozen Haunt. Phantom: Ghost Walk restore, Draw of Death. Scion: Dread Incarnate. Shadow Sorcery: Shadow
//  Walk, Umbral Form. Spellfire: Crown of Spellfire. Undead Patron: Superior Dread. Vestige Patron: Vestige Recovery,
//  Semblance of Life. Bladesinger: Song of Victory. Conjurer: Splintered Summons. Enchanter: Instinctive Charm.
//  Necromancer: Harvest Undead, Death's Master. Transmuter: Master Transmuter.
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, reduceDamage, gmUpdateTokens, createTokens } from "./main.js";
import { canReact, useReaction, say, tokenOf, isGM, chg, creatureType } from "./item-rules.js";
import { feat, spend } from "./background-feats.js";
import { blinkNextMove } from "./background-feats-p2.js";
import { addEffect, updateActor, usedThisTurn, markTurn, hpOf, isBloodied, hitDieClasses, spendHitDie } from "./feat-rules-books.js";
import { classLevel } from "./class-rules.js";
import { runAct, bonusRoll, heal, tempHP, removeEffects, removeStatus, statusEffect, spItem, summonOrigin, summonerOf, hits, targetsOf, sceneTokens, tokensOf,
  hostile, mod, usesOf, alive, isAttack, rangedAttack, hidden, artificerSpell, onceKey, rollTypes, retotal, cap } from "./class-rules-books.js";

const later = (fn, ms = 1000) => setTimeout(() => Promise.resolve(fn()).catch((err) => console.warn(`${MODULE_ID} | follow-up failed`, err)), ms);
const pick1 = (actor, title, html, toks, none = "No") => askChoice(actor, title, html, [...toks.map((t, i) => ({ action: t.id, label: t.name, default: i === 0 })), { action: "none", label: none }]).then((id) => toks.find((t) => t.id === id) ?? null);
const freeSlots = (a, min = 1) => Object.entries(a.system.spells ?? {}).filter(([k, s]) => /^spell\d$|^pact$/.test(k) && Number(s.value) > 0 && Number(s.level ?? k.slice(5)) >= min)
  .map(([k, s]) => ({ key: k, level: Number(s.level ?? k.slice(5)), value: Number(s.value) }));
const damageTotal = (ditem) => (ditem.damageDetail ?? []).filter((x) => !["temphp", "healing"].includes(x.type) && (x.value ?? 0) > 0).reduce((s, x) => s + x.value, 0) || Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
const wasHit = (workflow, tDoc) => isAttack(workflow) && hits(workflow).some((t) => t.uuid === tDoc?.uuid);
const companionsOf = (owner, ident, scene) => Array.from(scene?.tokens ?? []).filter((t) => t.actor && summonOrigin(t.actor)?.system?.identifier === ident && summonerOf(t.actor) === owner);
const undeadOf = (owner, scene) => Array.from(scene?.tokens ?? []).filter((t) => t.actor && summonerOf(t.actor) === owner && /undead/.test(creatureType(t.actor)) && alive(t.actor));
const formOn = (a) => a?.effects?.some((e) => e.flags?.world?.cgaFormOfDread && !e.disabled);
const wrathOn = (a) => a?.effects?.some((e) => e.flags?.world?.cgaWrathWild && !e.disabled);
const fxOn = (a, flag) => a?.effects?.find((e) => e.flags?.world?.[flag] && !e.disabled);
const indomitable = (a) => a?.items?.find((i) => (i.system?.identifier === "indomitable" || /^indomitable$/i.test(i.name)) && i.system?.uses?.max);
// "Drop to 0 HP but not killed outright": returns {oldHP, oldTemp, total} or null
function dropping(actor, ditem) {
  const oldHP = Number(ditem.oldHP ?? hpOf(actor).value ?? 0), oldTemp = Number(ditem.oldTempHP ?? hpOf(actor).temp ?? 0), total = damageTotal(ditem);
  if (oldHP <= 0 || (ditem.newHP ?? 1) > 0 || total - oldTemp - oldHP >= Number(hpOf(actor).max ?? 0)) return null;
  return { oldHP, oldTemp, total };
}
// Cancel this damage and set the HP afterwards.
function stayUp(actor, ditem, d, hp) {
  reduceDamage(ditem, d.total);
  ditem.hpDamage = 0; ditem.newHP = d.oldHP; ditem.tempDamage = d.oldTemp; ditem.newTempHP = 0;
  setTimeout(() => updateActor(actor, { "system.attributes.hp.value": hp }), 700);
}
async function pullToward(t, to, feet) {
  const scene = t.parent, gs = scene.grid.size, per = gs / scene.grid.distance;
  const tc = { x: t.x + (t.width * gs) / 2, y: t.y + (t.height * gs) / 2 }, oc = { x: to.x + (to.width * gs) / 2, y: to.y + (to.height * gs) / 2 };
  const dist = Math.hypot(oc.x - tc.x, oc.y - tc.y), move = Math.min(feet * per, Math.max(0, edgeDistance(t, to, scene) - 5) * per);
  if (move <= 0 || !dist) return;
  await gmUpdateTokens(scene, [{ _id: t.id, x: Math.round((t.x + ((oc.x - tc.x) / dist) * move) / gs) * gs, y: Math.round((t.y + ((oc.y - tc.y) / dist) * move) / gs) * gs }], { animate: false, teleport: true });
}
async function consumeStone(actor) {
  const keep = freeSlots(actor, 7);
  if (keep.length && await askOwner(actor, `Master Transmuter: ${actor.name}`, "<p>Expend a level 7+ spell slot to keep the Transmuter's Stone?</p>")) {
    const s = keep[0]; await actor.update({ [`system.spells.${s.key}.value`]: s.value - 1 }); return say(actor, "<strong>Master Transmuter:</strong> the stone survives (a level 7+ slot was spent).");
  }
  for (const a of [...game.actors.contents, ...game.scenes.contents.flatMap((s) => s.tokens.contents.map((t) => t.actor).filter((x) => x?.isToken))]) {
    const old = a?.items?.filter((i) => i.flags?.world?.cgaStone === actor.uuid).map((i) => i.id) ?? [];
    if (old.length && a.isOwner) await a.deleteEmbeddedDocuments("Item", old).catch(() => {});
  }
  say(actor, "<strong>Master Transmuter:</strong> the Transmuter's Stone crumbles to dust.");
}

// ------------------------------------------------------------------ Workflow done
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, act = workflow?.activity, item = workflow?.item;
    if (!actor || !act) return;
    const id = act.midiProperties?.identifier ?? "";
    const me = tokenOf(workflow.token) ?? tokensOf(actor)[0];
    const tgt = hits(workflow)[0] ?? targetsOf(workflow)[0];

    // ---- restore activities (spend a slot, the feature's use comes back)
    if (/-restore$/.test(id) && id === `${item?.system?.identifier}-restore`) { await item.update({ "system.uses.spent": 0 }); return say(actor, `<strong>${item.name}</strong> is ready again.`); }
    if (id === "ghost-restore") {
      const tk = feat(actor, "tokens-of-the-departed");
      if (!tk || usesOf(tk) < 1) return say(actor, "<strong>Ghost Walk:</strong> no soul trinket to destroy.");
      await spend(tk); await item.update({ "system.uses.spent": 0 });
      return say(actor, "<strong>Ghost Walk:</strong> a soul trinket crumbles - Ghost Walk is ready again.");
    }
    if (id === "tinker-charge") return tinkerCharge(actor);
    if (id === "tinker-drain") return tinkerDrain(actor);
    if (id === "spell-storing") return spellStoring(actor);
    if (id === "infiltrator-flight") return addEffect(actor, { name: "Infiltrator Flight", img: "icons/magic/air/wind-tornado-wall-blue.webp", transfer: false,
      system: { changes: [chg("system.attributes.movement.fly", String(2 * Number(actor.system.attributes.movement.walk || 30)), "upgrade")] }, flags: { dae: { stackable: "noneName", specialDuration: ["turnEnd"] } } });
    if (id === "shadow-walk") return blinkNextMove(actor, "Shadow Walk", 120);
    if (id === "bolster-undead") {
      const L = classLevel(actor, "wizard"), ts = undeadOf(actor, me?.parent).filter((t) => !me || edgeDistance(me, t, t.parent) <= 60);
      for (const t of ts) await tempHP(t.actor, L);
      return say(actor, `<strong>Bolster Undead:</strong> ${ts.length} Undead gain ${L} Temporary Hit Points.`);
    }
    if (id === "panacea" && tgt) {
      await heal(tgt.actor, Math.floor(Number(hpOf(tgt.actor).max) / 2));
      for (const s of ["poisoned", "petrified"]) if (tgt.actor.statuses.has(s)) await removeStatus(tgt.actor, s);
      say(actor, `<strong>Panacea:</strong> ${tgt.name} regains ${Math.floor(Number(hpOf(tgt.actor).max) / 2)} HP (curses and contagions by hand).`);
      return consumeStone(actor);
    }
    const via = item?.getFlag?.("dnd5e", "cachedFor");
    if (via && fromUuidSync(via, { relative: actor })?.midiProperties?.identifier === "master-raise") await consumeStone(actor);
    if (hidden(workflow)) return;

    // ---- items used
    const ident = item?.system?.identifier ?? "";
    if ((ident === "indomitable" || /^indomitable$/i.test(item?.name ?? "")) && feat(actor, "indomitable-teleport")
      && await askOwner(actor, `Indomitable Teleport: ${actor.name}`, "<p>If you succeeded on the save, teleport up to 60 ft?</p>")) await blinkNextMove(actor, "Indomitable Teleport", 60);
    if (ident === "innate-sorcery" || /^innate sorcery$/i.test(item?.name ?? "")) await innateForms(actor);
    // Infiltrator glimmer (Perfected Armor)
    if (id === "lightning-launcher" && feat(actor, "perfected-armor"))
      for (const t of hits(workflow)) await addEffect(t.actor, { name: `Glimmering (Disadvantage on attacks against ${actor.name})`, img: "icons/magic/lightning/bolt-strike-blue.webp", transfer: false,
        origin: feat(actor, "perfected-armor").uuid, duration: { value: null, units: "rounds", expiry: "sourceStart" }, system: { changes: [chg("flags.midi-qol.disadvantage.attack.all", `targetActorUuid === "${actor.uuid}"`)] } });

    // ---- spells
    if (item?.type === "spell") {
      // Frozen Haunt (Winter Walker 15): Hunter's Mark form
      const fh = feat(actor, "frozen-haunt");
      if (fh && /hunter'?s mark/i.test(item.name) && !/move/i.test(act.name ?? "") && usesOf(fh) > 0 && me
        && await askOwner(actor, `Frozen Haunt: ${actor.name}`, "<p>Adopt the ghostly, snowy form while Hunter's Mark lasts? (once per Long Rest)</p>")) {
        await spend(fh);
        await addEffect(actor, { name: "Frozen Haunt", img: fh.img, origin: item.uuid, transfer: false, duration: { seconds: 3600 }, flags: { world: { cgaFrozenHaunt: true } },
          system: { changes: [chg("system.traits.di.value", "cold", "add"), ...["grappled", "prone", "restrained"].map((s) => chg("system.traits.ci.value", s, "add"))] } });
        await frozenPulse(actor, me);
      }
      // Song of Victory (Bladesinger 14): a Bonus Action weapon attack after an action spell
      if (feat(actor, "song-of-victory") && act.activation?.type === "action" && !MidiQOL.hasUsedBonusAction?.(actor) && me) {
        const w = actor.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.activities?.some((a) => a.type === "attack"));
        const foes = sceneTokens(me).filter((o) => o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(me, o, me.parent) <= (w?.system.range?.reach ?? 5));
        const t = w && foes.length ? await pick1(actor, `Song of Victory: ${actor.name}`, `<p>Use your Bonus Action to attack with ${w.name}?</p>`, foes) : null;
        if (t) { await MidiQOL.setBonusActionUsed?.(actor); later(() => MidiQOL.completeActivityUse(w.system.activities.find((a) => a.type === "attack"), { midiOptions: { targetUuids: [t.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 800); }
      }
      // Instinctive Charm comes back after an Enchantment spell cast with a slot
      const ic = feat(actor, "instinctive-charm");
      if (ic && item.system.school === "enc" && Number(item.system.level) >= 1 && !item.getFlag?.("dnd5e", "cachedFor") && Number(ic.system.uses.spent) > 0) { await ic.update({ "system.uses.spent": 0 }); say(actor, "<strong>Instinctive Charm</strong> is ready again."); }
    }

    // ---- attacks: Masterful Shots (missed), Refined Reanimation / Harvest Undead / Keeper of Souls (damage)
    if (isAttack(workflow) && me) {
      for (const t of targetsOf(workflow).filter((x) => !hits(workflow).includes(x))) {
        const ta = t.actor;
        if (!feat(ta, "masterful-shots") || !canReact(ta)) continue;
        const w = ta.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.properties?.has?.("amm"));
        if (!w || !(await askOwner(ta, `Masterful Shots: ${t.name}`, `<p>${me.name} misses you. Use your Reaction to move up to half your Speed (no Opportunity Attacks, by hand) and shoot back?</p>`))) continue;
        await useReaction(ta);
        later(() => MidiQOL.completeActivityUse(w.system.activities.find((a) => a.type === "attack"), { midiOptions: { targetUuids: [me.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 800);
      }
    }
    await afterDamage(workflow);
  } catch (err) { console.warn(`${MODULE_ID} | P3 book class RollComplete rules failed`, err); }
});

async function afterDamage(workflow) {
  for (const d of workflow.damageList ?? []) {
    if (!(Number(d.hpDamage ?? 0) + Number(d.tempDamage ?? 0) > 0)) continue;
    const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "");
    const tDoc = found instanceof Actor ? tokensOf(found)[0] : tokenOf(found);
    const victim = tDoc?.actor;
    if (!victim) continue;
    const oldHP = Number(d.oldHP ?? 0), newHP = Number(d.newHP ?? hpOf(victim).value), max = Number(hpOf(victim).max ?? 0);
    // Keeper of Souls: an enemy dies within 60 ft
    if (oldHP > 0 && newHP <= 0) for (const c of sceneTokens(tDoc)) {
      const dr = c.actor && feat(c.actor, "divine-reaper");
      if (!dr || usesOf(dr) < 1 || isIncapacitated(c.actor) || !hostile(c, tDoc) || edgeDistance(c, tDoc, c.parent) > 60) continue;
      const hurt = sceneTokens(c).filter((o) => o.actor && alive(o.actor) && o.disposition === c.disposition && Number(hpOf(o.actor).value) < Number(hpOf(o.actor).max) && edgeDistance(c, o, c.parent) <= 60);
      if (!hurt.length) continue;
      const t = await pick1(c.actor, `Keeper of Souls: ${c.name}`, `<p>${tDoc.name} dies. Heal someone for ${2 * classLevel(c.actor, "cleric")} HP?</p>`, hurt);
      if (!t) continue;
      await spend(dr); await heal(t.actor, 2 * classLevel(c.actor, "cleric"));
      say(c.actor, `<strong>Keeper of Souls:</strong> ${t.name} regains ${2 * classLevel(c.actor, "cleric")} HP.`);
    }
    // Harvest Undead: you become Bloodied
    if (feat(victim, "harvest-undead") && newHP > 0 && oldHP > max / 2 && newHP <= max / 2 && canReact(victim)) {
      const und = undeadOf(victim, tDoc.parent);
      const u = und.length ? await pick1(victim, `Harvest Undead: ${victim.name}`, `<p>You're Bloodied. Use your Reaction to drop one of your Undead to 0 HP and regain ${classLevel(victim, "wizard")} HP?</p>`, und) : null;
      if (u) { await useReaction(victim); await updateActor(u.actor, { "system.attributes.hp.value": 0 }); await heal(victim, classLevel(victim, "wizard")); say(victim, `<strong>Harvest Undead:</strong> ${u.name} falls; ${victim.name} regains ${classLevel(victim, "wizard")} HP.`); }
    }
    // Life Transfer (Refined Reanimation): you or your companion takes damage
    const maker = feat(victim, "refined-reanimation") ? victim : (summonOrigin(victim)?.system?.identifier === "reanimated-companion" ? summonerOf(victim) : null);
    if (maker && feat(maker, "refined-reanimation") && canReact(maker)) {
      const comp = companionsOf(maker, "reanimated-companion", tDoc.parent).find((c) => alive(c.actor));
      if (comp && Number(hpOf(maker).value) < Number(hpOf(maker).max) && await askOwner(maker, `Life Transfer: ${maker.name}`, `<p>Use your Reaction to absorb your companion (${hpOf(comp.actor).value} HP)? It dies with its Death Burst.</p>`)) {
        const amt = Number(hpOf(comp.actor).value);
        await useReaction(maker); await heal(maker, amt); await updateActor(comp.actor, { "system.attributes.hp.value": 0 });
        say(maker, `<strong>Life Transfer:</strong> ${maker.name} regains ${amt} HP.`);
      }
    }
  }
}

// ------------------------------------------------------------------ Damage rolls: Alchemical Eruption, Perfected Armor dice, Ominous Strikes, Murderous Intent
Hooks.on("dnd5e.preRollDamageV2", (config) => {
  const act = config?.subject, id = act?.midiProperties?.identifier;
  if (!["force-demolisher", "thunder-pulse", "lightning-launcher"].includes(id) || !feat(act.actor, "perfected-armor") || !config.rolls?.[0]?.parts?.length) return;
  const swap = { "force-demolisher": [/^\s*1d10/, "2d6"], "thunder-pulse": [/^\s*1d8/, "1d10"], "lightning-launcher": [/^\s*1d6/, "2d6"] }[id];
  config.rolls[0].parts[0] = String(config.rolls[0].parts[0]).replace(swap[0], swap[1]);
});
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !workflow.damageRolls?.length || hidden(workflow)) return;
    const types = workflow.damageRolls.flatMap(rollTypes), first = types.find((t) => !["temphp", "healing"].includes(t));
    if (feat(actor, "chemical-mastery") && artificerSpell(item, actor) && types.some((t) => ["acid", "fire", "poison"].includes(t)) && !usedThisTurn("alchemical-eruption", actor)) {
      markTurn("alchemical-eruption", actor); await bonusRoll(workflow, "2d8", "force", "Alchemical Eruption");
    }
    if (feat(actor, "ancient-might") && isAttack(workflow) && hits(workflow).some((t) => t.actor.statuses.has("frightened")) && first)
      await bonusRoll(workflow, String(Math.max(1, mod(actor, "wis"))), first, "Ominous Strikes");
    // Murderous Intent (Dread Incarnate): Sneak Attack dice of 1-2 count as 3
    if (feat(actor, "dread-incarnate")) {
      let changed = false;
      const fix = (r) => { if (!/sneak attack/i.test(r.options?.flavor ?? "")) return; for (const d of r.dice ?? []) for (const x of d.results ?? []) if (x.result < 3) { x.result = 3; changed = true; } retotal(r); };
      (workflow.bonusDamageRolls ?? []).forEach(fix);
      if (changed) await workflow.setBonusDamageRolls(workflow.bonusDamageRolls);
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 book class damage rules failed`, err); }
});

// ------------------------------------------------------------------ Damage taken
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor, tDoc = tokenOf(token);
    if (!actor || !ditem) return;
    let total = damageTotal(ditem);
    if (total <= 0) return;
    const atk = tokenOf(workflow?.token);
    // Elemental Rebuke: halve an attack's damage and retaliate
    const er = feat(actor, "elemental-rebuke");
    if (er && usesOf(er) > 0 && wasHit(workflow, tDoc) && canReact(actor) && atk && atk.actor !== actor) {
      const p = await askChoice(actor, `Elemental Rebuke: ${actor.name}`, `<p>${atk.name} hits you for ${total}. Use your Reaction to halve it and retaliate (2d10 + CHA, DEX save)?</p>`,
        [...["fire", "cold", "lightning", "thunder", "acid"].map((t, i) => ({ action: t, label: cap(t), default: i === 0 })), { action: "none", label: "No" }]);
      if (p && p !== "none") {
        await spend(er); await useReaction(actor);
        total -= reduceDamage(ditem, total - Math.floor(total / 2));
        later(() => runAct(er, `rebuke-${p}`, [atk]), 1200);
      }
    }
    // Burning Life Force (Crown of Spellfire): spend Hit Dice to cut a hit's damage, once per turn
    if (fxOn(actor, "cgaCrown") && wasHit(workflow, tDoc) && !usedThisTurn("burning-life", actor)) {
      const classes = hitDieClasses(actor), have = classes.reduce((s, c) => s + Number(c.system.hd.value ?? 0), 0), cap2 = Math.min(have, Math.max(1, mod(actor, "cha")));
      if (cap2 > 0) {
        const p = await askChoice(actor, `Burning Life Force: ${actor.name}`, `<p>You're hit for ${total}. Spend Hit Point Dice to reduce the damage?</p>`,
          [...Array.from({ length: cap2 }, (_, i) => ({ action: String(i + 1), label: `${i + 1} ${i ? "dice" : "die"}`, default: i === 0 })), { action: "none", label: "No" }]);
        const n = Number(p);
        if (n > 0) {
          markTurn("burning-life", actor);
          let sum = 0;
          for (let i = 0; i < n; i++) { const c = hitDieClasses(actor)[0]; if (!c) break; const r = await new Roll(`1${c.system.hd.denomination}`).evaluate(); sum += r.total; await spendHitDie(c); }
          total -= reduceDamage(ditem, sum);
          say(actor, `<strong>Burning Life Force:</strong> ${n} Hit Point ${n > 1 ? "Dice" : "Die"} reduce the damage by ${sum}.`);
        }
      }
    }
    // Dropping to 0 HP: Cheat Death, Safe Haven, Persistent Wrath, Vestige Recovery
    const d = dropping(actor, ditem);
    if (!d) return;
    if (feat(actor, "soul-of-artifice")) {
      const p = await askChoice(actor, `Cheat Death: ${actor.name}`, "<p>You drop to 0 HP. Disintegrate how many Uncommon or Rare replicated items (HP = 20 each)? Remove them by hand.</p>",
        [...[1, 2, 3, 4, 5, 6].map((n) => ({ action: String(n), label: String(n), default: n === 1 })), { action: "none", label: "None" }]);
      if (Number(p) > 0) { stayUp(actor, ditem, d, 20 * Number(p)); return say(actor, `<strong>Cheat Death:</strong> ${actor.name} has ${20 * Number(p)} HP.`); }
    }
    const map = actor.effects.find((e) => /Atlas/.test(e.name) && feat(fromUuidSync(e.origin ?? "")?.actor, "superior-atlas"));
    if (map && await askOwner(actor, `Safe Haven: ${actor.name}`, "<p>You'd drop to 0 HP. Destroy your map to stay up and teleport next to a map holder?</p>")) {
      const carto = fromUuidSync(map.origin)?.actor, hp = 2 * classLevel(carto, "artificer");
      await removeEffects(actor, [map.id]); stayUp(actor, ditem, d, hp);
      await blinkNextMove(actor, "Safe Haven (to within 5 ft of the cartographer or a map holder)", 1000);
      return say(actor, `<strong>Safe Haven:</strong> ${actor.name} stays up with ${hp} HP.`);
    }
    const am = feat(actor, "ancient-might");
    if (am && usesOf(am) > 0 && wrathOn(actor) && await askOwner(actor, `Persistent Wrath: ${actor.name}`, `<p>You drop to 0 HP while transformed. Surge to ${2 * classLevel(actor, "ranger")} HP? (once per Long Rest)</p>`)) {
      await spend(am); stayUp(actor, ditem, d, 2 * classLevel(actor, "ranger"));
      return say(actor, `<strong>Persistent Wrath:</strong> ${actor.name} surges with ${2 * classLevel(actor, "ranger")} HP.`);
    }
    if (summonOrigin(actor)?.system?.identifier === "vestige-companion") {
      const owner = summonerOf(actor), vr = owner && feat(owner, "vestige-recovery");
      const pact = owner?.system?.spells?.pact;
      if (vr && usesOf(vr) > 0 && canReact(owner) && Number(pact?.value) > 0
        && await askOwner(owner, `Vestige Recovery: ${owner.name}`, "<p>Your vestige would drop to 0 HP. Use your Reaction and a Pact Magic slot to restore it to full HP?</p>")) {
        await spend(vr); await useReaction(owner); await owner.update({ "system.spells.pact.value": Number(pact.value) - 1 });
        stayUp(actor, ditem, d, Number(hpOf(actor).max));
        await blinkNextMove(actor, "Vestige Recovery", 30);
        say(owner, `<strong>Vestige Recovery:</strong> ${tDoc.name} returns to full HP.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 book class damage-taken rules failed`, err); }
});

// ------------------------------------------------------------------ Saves: Shared Resilience, Minor Wish
Hooks.on("midi-qol.preSavesComplete", async (workflow) => {
  try {
    const dc = Number(workflow?.activity?.save?.dc?.value ?? workflow?.saveDC ?? 0);
    if (!dc) return;
    for (const t of Array.from(workflow.failedSaves ?? [])) {
      const tDoc = tokenOf(t), roll = workflow.targetSaveDetails?.[tDoc?.uuid]?.saveRoll;
      if (!roll || !tDoc) continue;
      let ok = false;
      for (const b of sceneTokens(tDoc)) {
        const a = b.actor;
        if (!a || !canReact(a) || b.disposition !== tDoc.disposition) continue;
        // Shared Resilience: spend Indomitable, the ally rerolls with + Fighter level
        const ind = indomitable(a);
        if (!ok && b !== tDoc && feat(a, "shared-resilience") && ind && usesOf(ind) > 0 && edgeDistance(b, tDoc, b.parent) <= 60
          && await askOwner(a, `Shared Resilience: ${a.name}`, `<p>${tDoc.name} fails a DC ${dc} save (${roll.total}). Use your Reaction and Indomitable to let it reroll with +${classLevel(a, "fighter")}?</p>`)) {
          await spend(ind); await useReaction(a);
          const die = roll.dice?.find((x) => x.faces === 20)?.total ?? 10;
          const r = await new Roll("1d20").evaluate();
          roll._total = r.total + (Number(roll.total) - die) + classLevel(a, "fighter");
          await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: a }), flavor: `Shared Resilience: ${tDoc.name}'s reroll totals ${roll._total} (DC ${dc})` });
          ok = roll._total >= dc;
        }
        // Minor Wish (Noble Scion): the failure becomes a success
        const range = classLevel(a, "paladin") >= 18 ? 30 : 10;
        if (!ok && fxOn(a, "cgaNobleScion") && canReact(a) && (b === tDoc || edgeDistance(b, tDoc, b.parent) <= range)
          && await askOwner(a, `Minor Wish: ${a.name}`, `<p>${tDoc.name} fails a DC ${dc} save. Use your Reaction to make it succeed?</p>`)) {
          await useReaction(a); roll._total = Math.max(Number(roll.total), dc); ok = true;
          say(a, `<strong>Minor Wish:</strong> ${tDoc.name} succeeds.`);
        }
        if (ok) break;
      }
      if (ok) { workflow.failedSaves.delete(t); workflow.saves?.add?.(t); }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 book class save rules failed`, err); }
});

// ------------------------------------------------------------------ Attack rolls: Minor Wish (a miss becomes a hit), Instinctive Charm (a hit becomes a miss)
const wished = new WeakSet(), charmed = new WeakSet();
Hooks.on("midi-qol.preCheckHits", async (workflow) => {
  try {
    const atk = tokenOf(workflow?.token), tDoc = targetsOf(workflow)[0], roll = workflow?.attackRoll;
    if (!atk || !tDoc || !roll || wished.has(workflow)) return;
    const ac = Number(tDoc.actor.system.attributes.ac?.value ?? 10);
    if (Number(roll.total) >= ac) return;
    for (const b of sceneTokens(atk)) {
      const a = b.actor, range = classLevel(a, "paladin") >= 18 ? 30 : 10;
      if (!a || !fxOn(a, "cgaNobleScion") || !canReact(a) || b.disposition !== atk.disposition || (b !== atk && edgeDistance(b, atk, b.parent) > range)) continue;
      wished.add(workflow);
      if (!(await askOwner(a, `Minor Wish: ${a.name}`, `<p>${atk.name}'s attack (${roll.total}) misses ${tDoc.name} (AC ${ac}). Use your Reaction to make it hit?</p>`))) return;
      await useReaction(a);
      roll._total = ac; await workflow.setAttackRoll?.(roll);
      return say(a, `<strong>Minor Wish:</strong> the attack hits.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | Minor Wish (attack) failed`, err); }
});
Hooks.on("midi-qol.hitsChecked", async (workflow) => {
  try {
    if (!isAttack(workflow) || charmed.has(workflow)) return;
    const atk = tokenOf(workflow.token);
    for (const t of hits(workflow)) {
      const ic = feat(t.actor, "instinctive-charm");
      if (!ic || usesOf(ic) < 1 || !canReact(t.actor) || !atk || edgeDistance(atk, t, t.parent) > 30) continue;
      charmed.add(workflow);
      if (!(await askOwner(t.actor, `Instinctive Charm: ${t.name}`, `<p>${atk.name} hits you. Use your Reaction - WIS save or the attack misses (redirect it by hand)?</p>`))) continue;
      await spend(ic); await useReaction(t.actor);
      const w = await runAct(ic, "instinctive-charm", [atk]);
      if (w && Array.from(w.failedSaves ?? []).some((x) => tokenOf(x)?.uuid === atk.uuid)) {
        for (const h of Array.from(workflow.hitTargets)) if (tokenOf(h)?.uuid === t.uuid) workflow.hitTargets.delete(h);
        say(t.actor, `<strong>Instinctive Charm:</strong> ${atk.name}'s attack misses ${t.name}.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | Instinctive Charm failed`, err); }
});

// ------------------------------------------------------------------ Turns: Guardian pull, Frozen Haunt pulse, Draw of Death
Hooks.on("updateCombat", async (combat, changes) => {
  try {
    if (!isGM() || !("turn" in changes || "round" in changes)) return;
    // Frozen Haunt: start of your turn
    const cur = combat.combatant;
    if (cur?.actor && fxOn(cur.actor, "cgaFrozenHaunt") && onceKey(`frozen:${cur.actor.uuid}`)) await frozenPulse(cur.actor, cur.token);
    // Perfected Armor (Guardian): a creature ended its turn within 30 ft
    const prevId = combat.previous?.combatantId, prev = prevId ? combat.combatants.get(prevId) : null, ended = prev?.token;
    if (!ended?.actor || !alive(ended.actor)) return;
    for (const g of sceneTokens(ended)) {
      const a = g.actor, pa = a && feat(a, "perfected-armor"), am = a && feat(a, "armor-model");
      if (!pa || !am || am.getFlag("world", "cgaModel") !== "guardian" || usesOf(pa) < 1 || !canReact(a) || !hostile(g, ended) || edgeDistance(g, ended, g.parent) > 30) continue;
      if ((ended.actor.system.traits?.size ?? "med") === "grg") continue;
      if (!(await askOwner(a, `Guardian Pull: ${a.name}`, `<p>${ended.name} ends its turn within 30 ft. Use your Reaction to pull it (STR save) and attack if it lands next to you?</p>`))) continue;
      await spend(pa); await useReaction(a);
      const w = await runAct(pa, "perfected-pull", [ended]);
      if (w && Array.from(w.failedSaves ?? []).some((x) => tokenOf(x)?.uuid === ended.uuid)) {
        await pullToward(ended, g, 25);
        const pulse = am.system.activities.find((x) => x.midiProperties?.identifier === "thunder-pulse");
        if (pulse && edgeDistance(g, ended, g.parent) <= 5) later(() => MidiQOL.completeActivityUse(pulse, { midiOptions: { targetUuids: [ended.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 600);
      }
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 turn rules failed`, err); }
});
async function frozenPulse(actor, me) {
  const fh = feat(actor, "frozen-haunt");
  const ts = me ? sceneTokens(me).filter((o) => o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(me, o, me.parent) <= 15) : [];
  if (fh && ts.length) await runAct(fh, "frozen-haunt-damage", ts);
}
Hooks.on("updateCombatant", async (combatant, changes) => {
  try {
    if (!isGM() || !("initiative" in changes) || changes.initiative === null) return;
    const a = combatant.actor, tk = a && feat(a, "tokens-of-the-departed");
    if (tk && feat(a, "deaths-friend") && usesOf(tk) < 1) { await tk.update({ "system.uses.spent": Math.max(0, Number(tk.system.uses.spent) - 1) }); say(a, "<strong>Draw of Death:</strong> a soul trinket appears."); }
  } catch (err) { console.warn(`${MODULE_ID} | Draw of Death failed`, err); }
});

// ------------------------------------------------------------------ Rests: Magical Guidance, Cutthroat
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner) return;
    const long = config?.type === "long" || result?.longRest;
    if (long) return;
    const fg = feat(actor, "flash-of-genius");
    if (feat(actor, "soul-of-artifice") && fg && actor.items.some((i) => i.system?.attuned) && Number(fg.system.uses.spent) > 0) { await fg.update({ "system.uses.spent": 0 }); say(actor, "<strong>Magical Guidance:</strong> all Flash of Genius uses restored."); }
    const bt = feat(actor, "bloodthirst");
    if (feat(actor, "dread-incarnate") && bt && Number(bt.system.uses.spent) > 0) { await bt.update({ "system.uses.spent": Number(bt.system.uses.spent) - 1 }); say(actor, "<strong>Cutthroat:</strong> one Bloodthirst use restored."); }
  } catch (err) { console.warn(`${MODULE_ID} | P3 rest rules failed`, err); }
});

// ------------------------------------------------------------------ Effects: Giant Stature (Huge), Superior Dread
Hooks.on("createActiveEffect", async (effect) => {
  try {
    const a = effect.parent;
    if (!isGM() || !(a instanceof Actor)) return;
    if (effect.name === "Giant Stature" && feat(a, "perfected-armor")) {
      const p = await askChoice(a, `Giant Stature: ${a.name}`, "<p>Grow to which size? (+10 ft reach by hand; Advantage on STR checks and saves)</p>", [{ action: "lg", label: "Large", default: true }, { action: "huge", label: "Huge" }]);
      const changes = [chg("system.traits.size", p === "huge" ? "huge" : "lg"), chg("flags.midi-qol.advantage.check.str", "1"), chg("flags.midi-qol.advantage.save.str", "1")];
      await effect.update({ "system.changes": changes }).catch(() => {});
      if (p === "huge") for (const t of tokensOf(a)) await gmUpdateTokens(t.parent, [{ _id: t.id, width: 3, height: 3, ...(t.getFlag("world", "cgaGiantPrev") ? {} : { "flags.world.cgaGiantPrev": t.width < 2 ? t.width : 1 }) }]);
    }
    if (effect.flags?.world?.cgaFormOfDread && feat(a, "superior-dread"))
      await addEffect(a, { name: "Superior Dread", img: "icons/magic/death/skull-horned-worn-fire-blue.webp", transfer: false, flags: { world: { cgaSupDread: true } },
        system: { changes: [...["bludgeoning", "piercing", "slashing"].map((t) => chg("system.traits.dr.value", t, "add")), chg("system.attributes.movement.fly", String(Number(a.system.attributes.movement.walk) || 30), "upgrade"), chg("system.attributes.movement.hover", "true")] } });
  } catch (err) { console.warn(`${MODULE_ID} | P3 effect rules failed`, err); }
});
Hooks.on("deleteActiveEffect", async (effect) => {
  const a = effect.parent;
  if (!isGM() || !(a instanceof Actor) || !effect.flags?.world?.cgaFormOfDread) return;
  const fx = a.effects.filter((e) => e.flags?.world?.cgaSupDread);
  if (fx.length) await removeEffects(a, fx.map((e) => e.id));
});

// ------------------------------------------------------------------ Innate Sorcery: Umbral Form, Crown of Spellfire
async function innateForms(actor) {
  const forms = [
    { ident: "umbral-form", sp: 6, label: "Umbral Form", text: "Resistance to all damage except Force and Radiant", flag: "cgaUmbral",
      changes: ["acid", "bludgeoning", "cold", "fire", "lightning", "necrotic", "piercing", "poison", "psychic", "slashing", "thunder"].map((t) => chg("system.traits.dr.value", t, "add")) },
    { ident: "crown-of-spellfire", sp: 5, label: "Crown of Spellfire", text: "Fly 60 ft, Burning Life Force and Spell Avoidance", flag: "cgaCrown",
      changes: [chg("system.attributes.movement.fly", "60", "upgrade"), chg("system.attributes.movement.hover", "true"), chg("flags.midi-qol.superSaver.all", `workflow?.item?.type === "spell"`)] }];
  for (const f of forms) {
    const it = feat(actor, f.ident);
    if (!it) continue;
    const sp = spItem(actor), free = usesOf(it) > 0, canPay = sp && usesOf(sp) >= f.sp;
    if (!free && !canPay) continue;
    if (!(await askOwner(actor, `${f.label}: ${actor.name}`, `<p>Adopt ${f.label} while Innate Sorcery lasts (${f.text})? ${free ? "(once per Long Rest)" : `(spends ${f.sp} Sorcery Points)`}</p>`))) continue;
    if (free) await spend(it); else await sp.update({ "system.uses.spent": Number(sp.system.uses.spent ?? 0) + f.sp });
    await addEffect(actor, { name: f.label, img: it.img, transfer: false, duration: { seconds: 60 }, flags: { world: { [f.flag]: true } }, system: { changes: f.changes } });
  }
}

// ------------------------------------------------------------------ Summons: Semblance of Life, Splintered Summons, Extinguish Undead
Hooks.on("dnd5e.postSummon", async (activity, profile, tokens) => {
  try {
    const caster = activity?.actor, item = activity?.item;
    const docs = (tokens ?? []).map(tokenOf).filter((t) => t?.actor);
    if (!caster || !item || !docs.length) return;
    // Semblance of Life: the spirit takes the vestige's place, HP and temp HP
    if (item.system?.identifier === "semblance-of-life") {
      const v = companionsOf(caster, "vestige-companion", docs[0].parent)[0], s = docs[0];
      const spiritHP = Number(hpOf(s.actor).max);
      const lvl = Math.min(9, Math.floor(classLevel(caster, "warlock") / 2));
      const upd = { "system.attributes.hp.temp": spiritHP, "flags.dnd5e.summon.level": lvl };
      if (v) { upd["system.attributes.hp.max"] = Number(hpOf(v.actor).max); upd["system.attributes.hp.value"] = Number(hpOf(v.actor).value); }
      await updateActor(s.actor, upd);
      if (v) { await gmUpdateTokens(s.parent, [{ _id: s.id, x: v.x, y: v.y }], { animate: false, teleport: true }); await v.delete().catch(() => {}); }
      say(caster, `<strong>Semblance of Life:</strong> the vestige becomes ${s.name} (${spiritHP} temp HP) for 1 hour - summon the vestige again afterwards.`);
    }
    // Splintered Summons: two spirits with halved HP
    const sp = feat(caster, "splintered-summons");
    if (sp && usesOf(sp) > 0 && item.type === "spell" && item.system.school === "con" && /^summon /i.test(item.name) && Number(item.system.level) >= 1
      && await askOwner(caster, `Splintered Summons: ${caster.name}`, `<p>Split ${docs[0].name} into two creatures with half the HP each? (once per Long Rest)</p>`)) {
      await spend(sp);
      for (const t of docs) {
        const hp = hpOf(t.actor), half = { "system.attributes.hp.max": Math.max(1, Math.floor(Number(hp.max) / 2)), "system.attributes.hp.value": Math.max(1, Math.floor(Number(hp.value) / 2)) };
        await updateActor(t.actor, half);
        const data = t.toObject(); delete data._id;
        data.x = t.x + t.parent.grid.size * t.width;
        await createTokens(t.parent, [data]);
      }
      say(caster, "<strong>Splintered Summons:</strong> two spirits answer the call.");
    }
  } catch (err) { console.warn(`${MODULE_ID} | P3 summon rules failed`, err); }
});
const exploded = new Set();
Hooks.on("updateActor", async (actor, changes) => {
  try {
    if (!isGM() || !foundry.utils.hasProperty(changes, "system.attributes.hp.value") || Number(changes.system.attributes.hp.value) > 0) return;
    const owner = summonerOf(actor), dm = owner && feat(owner, "deaths-master");
    if (!dm || !/undead/.test(creatureType(actor))) return;
    const t = tokensOf(actor)[0];
    if (!t || exploded.has(t.uuid)) return;
    exploded.add(t.uuid);
    if (!(await askOwner(owner, `Extinguish Undead: ${owner.name}`, `<p>${t.name} drops to 0 HP. Make it explode with necrotic energy?</p>`))) return;
    const hd = Number(actor.system.attributes.hd?.max ?? actor.system.attributes.hd?.value ?? 2) || 2;
    const around = sceneTokens(t).filter((o) => o !== t && o.actor && alive(o.actor) && edgeDistance(o, t, o.parent) <= 10);
    if (around.length) await runAct(dm, "extinguish-undead", around, { formula: `${Math.max(1, Math.ceil(hd / 2))}d6` });
  } catch (err) { console.warn(`${MODULE_ID} | Extinguish Undead failed`, err); }
});

// ------------------------------------------------------------------ Magic Item Tinker, Spell-Storing Item
async function tinkerCharge(actor) {
  const items = actor.items.filter((i) => !["feat", "spell", "class", "subclass", "background", "race"].includes(i.type) && i.system.uses?.max && Number(i.system.uses.spent) > 0);
  const slots = freeSlots(actor);
  if (!items.length || !slots.length) return say(actor, "<strong>Charge Magic Item:</strong> no item with spent charges, or no spell slot.");
  const ip = await askChoice(actor, `Charge Magic Item: ${actor.name}`, "<p>Recharge which item?</p>", items.map((i, n) => ({ action: i.id, label: `${i.name} (${i.system.uses.value}/${i.system.uses.max})`, default: n === 0 })));
  const it = items.find((i) => i.id === ip);
  const sp = it ? await askChoice(actor, "Charge Magic Item", "<p>Expend which spell slot? (charges = slot level)</p>", slots.map((s, n) => ({ action: s.key, label: `Level ${s.level}`, default: n === 0 }))) : null;
  const s = slots.find((x) => x.key === sp);
  if (!it || !s) return;
  await actor.update({ [`system.spells.${s.key}.value`]: s.value - 1 });
  await it.update({ "system.uses.spent": Math.max(0, Number(it.system.uses.spent) - s.level) });
  say(actor, `<strong>Charge Magic Item:</strong> ${it.name} regains ${s.level} charges.`);
}
async function tinkerDrain(actor) {
  const items = actor.items.filter((i) => !["feat", "spell", "class", "subclass", "background", "race"].includes(i.type) && (i.system.properties?.has?.("mgc") || i.system.rarity));
  if (!items.length) return say(actor, "<strong>Drain Magic Item:</strong> no magic item to drain.");
  const ip = await askChoice(actor, `Drain Magic Item: ${actor.name}`, "<p>Which replicated item vanishes?</p>", items.map((i, n) => ({ action: i.id, label: `${i.name} (${i.system.rarity || "common"})`, default: n === 0 })));
  const it = items.find((i) => i.id === ip);
  if (!it) return;
  const lvl = ["uncommon", "rare"].includes(it.system.rarity) ? 2 : 1;
  await it.delete();
  await actor.update({ [`system.spells.spell${lvl}.value`]: Number(actor.system.spells[`spell${lvl}`]?.value ?? 0) + 1 });
  say(actor, `<strong>Drain Magic Item:</strong> ${it.name} vanishes into a level ${lvl} spell slot (gone after a Long Rest).`);
}
async function spellStoring(actor) {
  const spells = actor.items.filter((i) => i.type === "spell" && Number(i.system.level) >= 1 && Number(i.system.level) <= 3 && artificerSpell(i, actor)
    && i.system.activities?.some((a) => a.activation?.type === "action"));
  if (!spells.length) return say(actor, "<strong>Spell-Storing Item:</strong> no level 1-3 Artificer action spell on your sheet.");
  const p = await askChoice(actor, `Spell-Storing Item: ${actor.name}`, "<p>Store which spell?</p>", spells.map((s, n) => ({ action: s.id, label: `${s.name} (level ${s.system.level})`, default: n === 0 })));
  const sp = spells.find((s) => s.id === p);
  if (!sp) return;
  const old = actor.items.filter((i) => i.flags?.world?.cgaStored === actor.uuid).map((i) => i.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  const uses = 2 * Math.max(1, mod(actor, "int")), aid = foundry.utils.randomID();
  await actor.createEmbeddedDocuments("Item", [{ name: `Spell-Storing Item (${sp.name})`, type: "consumable", img: sp.img,
    system: { type: { value: "trinket", subtype: "" }, quantity: 1, uses: { max: String(uses), spent: 0, autoDestroy: false, recovery: [] },
      description: { value: `<p>${actor.name} stored ${sp.name} in this object. While holding it, a creature can take a Magic action to cast the spell (${actor.name}'s spellcasting ability), once per turn. ${uses} uses.</p>` },
      activities: { [aid]: { _id: aid, type: "cast", name: `Cast ${sp.name}`, activation: { type: "action", value: 1, condition: "" },
        consumption: { targets: [{ type: "itemUses", value: "1", target: "", scaling: {} }], scaling: { allowed: false }, spellSlot: false },
        spell: { uuid: sp._stats?.compendiumSource || sp.uuid, properties: [], spellbook: false, ability: actor.system.attributes.spellcasting || "int", challenge: { override: true, attack: Number(actor.system.attributes.spell?.attack ?? 0), save: Number(actor.system.attributes.spell?.dc ?? 10) } } } } },
    flags: { world: { cgaStored: actor.uuid } } }]);
  say(actor, `<strong>Spell-Storing Item:</strong> ${sp.name} is stored (${uses} uses). Hand the item to whoever holds the object.`);
}

// ------------------------------------------------------------------ Fortified Position: Half Cover near your cannons
let auraTimer = null;
function scheduleCover() { if (!isGM()) return; clearTimeout(auraTimer); auraTimer = setTimeout(() => sweepCover(canvas.scene).catch((err) => console.warn(`${MODULE_ID} | Fortified Position aura failed`, err)), 450); }
async function sweepCover(scene) {
  if (!scene) return;
  const toks = scene.tokens.contents.filter((t) => t.actor);
  const cannons = toks.filter((t) => summonOrigin(t.actor)?.system?.identifier === "eldritch-cannon" && alive(t.actor) && feat(summonerOf(t.actor), "fortified-position"));
  for (const t of toks) {
    const covered = cannons.some((c) => { const own = tokensOf(summonerOf(c.actor)).find((x) => x.parent === scene); return own && t.disposition === own.disposition && t !== c && edgeDistance(t, c, scene) <= 10; });
    const have = t.actor.effects.filter((e) => e.flags?.world?.cgaShimmer);
    if (!covered && have.length) await removeEffects(t.actor, have.map((e) => e.id));
    if (covered && !have.length) await addEffect(t.actor, { name: "Shimmering Field (Half Cover)", img: "icons/magic/defensive/shield-barrier-glowing-blue.webp", transfer: false, flags: { world: { cgaShimmer: true } },
      system: { changes: [chg("system.attributes.ac.bonus", "+2", "add"), chg("system.abilities.dex.bonuses.save", "+2", "add")] } });
  }
}
for (const h of ["moveToken", "createToken", "deleteToken"]) Hooks.on(h, () => scheduleCover());
Hooks.on("updateToken", (doc, changes) => { if ("x" in changes || "y" in changes) scheduleCover(); });
Hooks.on("canvasReady", () => scheduleCover());
