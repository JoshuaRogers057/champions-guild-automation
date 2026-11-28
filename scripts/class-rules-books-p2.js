// Champions Guild Automation - priority-2 class and subclass features from Forge of the Artificer, Ravenloft, Heroes
// of Faerûn and Arcana Unleashed (module rules keyed on the feature identifier).
//  Artificer: Refreshed Genius. Artillerist: Explosive Cannon (Firepower, Detonate). Battle Smith: Arcane Jolt.
//  Cartographer: Guided Precision. Reanimator: Strange / Macabre Modifications, Improved Reanimation. College of
//  Spirits: Empowered Channeling. College of the Moon: Blessing of Moonlight. Arcana Domain: Dispelling Recovery.
//  Grave Domain: Sentinel at Death's Door. Arcane Archer: Curving Shot, Ever-Ready Shot. Banneret: Rallying Surge.
//  Mystic Arts: Mystic Focus, Focused Strike. Noble Genies: Aura of Elemental Shielding. Hollow Warden: Hungering
//  Might, Rot and Violence. Winter Walker: Fortifying Soul, Chilling Retribution. Phantom: Tokens of the Departed.
//  Shadow Sorcery: Beasts of Ill Omen. Spellfire Sorcery: Absorb Spells. Undead Patron: Grave Touched, Necrotic Husk.
//  Vestige Patron: Vestige Power. Bladesinger: Song of Defense. Conjurer: Distant Transposition, Durable Summons,
//  Focused Conjuration. Enchanter: Enchanting Conversationalist, Split Enchantment. Necromancer: Grave Power, Undead
//  Thralls. Transmuter: Transmuter's Stone, Wondrous Alteration, Empowered Transmutation.
import { MODULE_ID, askOwner, askChoice, edgeDistance, isIncapacitated, reduceDamage, turnKey } from "./main.js";
import { canReact, useReaction, say, tokenOf, isGM, chg, creatureType } from "./item-rules.js";
import { feat, spend, saveStatuses } from "./background-feats.js";
import { addEffect, updateActor, usedThisTurn, markTurn, hpOf, isBloodied } from "./feat-rules-books.js";
import { classLevel } from "./class-rules.js";
import { runAct, bonusRoll, heal, tempHP, removeEffects, statusEffect, spItem, summonOrigin, summonerOf, hits, targetsOf, sceneTokens, tokensOf,
  hostile, myTurn, mod, usesOf, alive, isAttack, rangedAttack, hidden, artificerSpell, onceKey, rollTypes, cap } from "./class-rules-books.js";

const slotLevel = (wf) => Number(wf?.castData?.castLevel ?? wf?.spellLevel ?? wf?.item?.system?.level ?? 0);
const slotCast = (wf) => wf?.item?.type === "spell" && Number(wf.item.system.level ?? 0) >= 1 && slotLevel(wf) >= 1 && wf.activity?.consumption?.spellSlot !== false && !wf.item.getFlag?.("dnd5e", "cachedFor");
const damageTypesOf = (wf) => (wf?.damageRolls ?? []).flatMap(rollTypes);
const pick1 = (actor, title, html, toks, none = "No") => askChoice(actor, title, html, [...toks.map((t, i) => ({ action: t.id, label: t.name, default: i === 0 })), { action: "none", label: none }]).then((id) => toks.find((t) => t.id === id) ?? null);
const later = (fn, ms = 1200) => setTimeout(() => fn().catch?.((err) => console.warn(`${MODULE_ID} | follow-up failed`, err)), ms);
const freeSlots = (a) => Object.entries(a.system.spells ?? {}).filter(([k, s]) => /^spell\d$|^pact$/.test(k) && Number(s.value) > 0 && Number(s.level ?? k.slice(5)) >= 1)
  .map(([k, s]) => ({ key: k, level: Number(s.level ?? k.slice(5)), value: Number(s.value) }));
const focusItem = (a) => a?.items?.find((i) => (i.system?.identifier === "monks-focus" || /^(monk'?s focus|focus points)$/i.test(i.name)) && i.system?.uses?.max);
const companionsOf = (owner, ident, scene) => Array.from(scene?.tokens ?? []).filter((t) => t.actor && summonOrigin(t.actor)?.system?.identifier === ident && summonerOf(t.actor) === owner);
const formOn = (a) => a?.effects?.some((e) => e.flags?.world?.cgaFormOfDread && !e.disabled);
const songOn = (a) => a?.effects?.some((e) => e.flags?.world?.cgaBladesong && !e.disabled);
const wrathOn = (a) => a?.effects?.some((e) => e.flags?.world?.cgaWrathWild && !e.disabled);
const damageTotal = (ditem) => ((ditem.calculatedDamages ?? ditem.damageDetail) ?? []).filter((x) => !["temphp", "healing"].includes(x.type) && (x.value ?? 0) > 0).reduce((s, x) => s + x.value, 0) || Math.max(0, (ditem.hpDamage ?? 0) + (ditem.tempDamage ?? 0));
const CARTO_SPELLS = /^(faerie fire|guiding bolt|healing word|locate object|mind spike|call lightning|clairvoyance|banishment|locate creature|scrying|teleportation circle)$/i;
const CONDITION_SPELLS = /^(lesser restoration|greater restoration|remove curse|heal|power word heal|protection from poison|dispel evil and good|mass heal)$/i;

// ------------------------------------------------------------------ Rests: Refreshed Genius, Mystic Focus, Tokens of the Departed, Vestige Power
Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  try {
    if (!actor.isOwner) return;
    const long = config?.type === "long" || result?.longRest;
    // Refreshed Genius (Advanced Artifice): a Short Rest restores one Flash of Genius use
    const fg = feat(actor, "flash-of-genius");
    if (!long && feat(actor, "advanced-artifice") && fg && Number(fg.system.uses.spent) > 0) { await fg.update({ "system.uses.spent": Number(fg.system.uses.spent) - 1 }); say(actor, "<strong>Refreshed Genius:</strong> one Flash of Genius use restored."); }
    // Mystic Focus: Focus Points -> a spell slot after a Short Rest
    if (!long && feat(actor, "mystic-focus")) await focusToSlot(actor);
    // Tokens of the Departed: a Long Rest brings you back up to two soul trinkets
    const tok = feat(actor, "tokens-of-the-departed");
    if (long && tok && usesOf(tok) < 2) await tok.update({ "system.uses.spent": Math.max(0, Number(tok.system.uses.max) - 2) });
    // Vestige Power: the vestige's Divine Power comes back on any rest
    if (feat(actor, "vestige-power")) await refreshDivinePower(actor);
  } catch (err) { console.warn(`${MODULE_ID} | P2 book class rest rules failed`, err); }
});
async function refreshDivinePower(actor) {
  for (const t of companionsOf(actor, "vestige-companion", canvas.scene)) for (const i of t.actor.items.filter((x) => /^Divine Power/.test(x.name) && Number(x.system.uses?.spent) > 0))
    await i.update({ "system.uses.spent": 0 }).catch(() => {});
}
const FOCUS_COST = [[1, 2, 6], [2, 3, 7], [3, 5, 13], [4, 6, 19]];
async function focusToSlot(actor) {
  const fp = focusItem(actor);
  if (!fp) return;
  const L = classLevel(actor, "monk"), have = usesOf(fp);
  const opts = FOCUS_COST.filter(([lvl, cost, min]) => L >= min && have >= cost && Number(actor.system.spells?.[`spell${lvl}`]?.value ?? 0) < Number(actor.system.spells?.[`spell${lvl}`]?.max ?? 0));
  if (!opts.length) return;
  const p = await askChoice(actor, `Mystic Focus: ${actor.name}`, `<p>Turn Focus Points into one expended spell slot? (${have} FP)</p>`,
    [...opts.map(([lvl, cost], i) => ({ action: String(lvl), label: `Level ${lvl} slot (${cost} FP)`, default: i === 0 })), { action: "none", label: "No" }]);
  const o = opts.find(([lvl]) => String(lvl) === p);
  if (!o) return;
  await fp.update({ "system.uses.spent": Number(fp.system.uses.spent ?? 0) + o[1] });
  await actor.update({ [`system.spells.spell${o[0]}.value`]: Number(actor.system.spells[`spell${o[0]}`].value) + 1 });
  say(actor, `<strong>Mystic Focus:</strong> ${o[1]} Focus Points become a level ${o[0]} spell slot.`);
}

// ------------------------------------------------------------------ Workflow done
const curved = new WeakSet();
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, act = workflow?.activity, item = workflow?.item;
    if (!actor || !act) return;
    const id = act.midiProperties?.identifier ?? "";
    const me = tokenOf(workflow.token) ?? tokensOf(actor)[0];
    const tgt = hits(workflow)[0] ?? targetsOf(workflow)[0];

    // ---- activities
    if (/^genie-shield-/.test(id)) { await item.setFlag("world", "cgaShieldType", id.slice(13)); scheduleAuras(); return say(actor, `<strong>Aura of Elemental Shielding:</strong> ${cap(id.slice(13))} Resistance.`); }
    if (id === "mystic-focus-convert") return slotToFocus(actor);
    if (id === "distant-restore") { const bt = feat(actor, "benign-transposition"); if (bt && Number(bt.system.uses.spent) > 0) await bt.update({ "system.uses.spent": Number(bt.system.uses.spent) - 1 }); return say(actor, "<strong>Distant Transposition:</strong> one Benign Transposition use restored."); }
    if (id === "cgacd-dispelling-restore") { const dr = feat(actor, "dispelling-recovery"); if (dr) await dr.update({ "system.uses.spent": 0 }); return say(actor, "<strong>Dispelling Recovery</strong> is ready again."); }
    if (/^enchanting-/.test(id)) { const grp = actor.effects.filter((e) => e.flags?.world?.cgaChoice === "enchanting-conversationalist"); return removeEffects(actor, grp.slice(0, -1).map((e) => e.id)); }
    if (id === "arm-split" || id === "arm-empower") {
      if (usesOf(item) < 1) return say(actor, `<strong>${item.name}:</strong> no uses left.`);
      await item.setFlag("world", "cgaArmed", true);
      return say(actor, `<strong>${item.name}:</strong> your next eligible spell cast with a slot is raised by one level.`);
    }
    if (id === "transmuter-stone") return transmuterStone(actor, item, tgt ?? me);
    if (id === "unnerving-aura" && feat(actor, "rot-and-violence")) {
      for (const t of Array.from(workflow.failedSaves ?? []).map(tokenOf).filter((x) => x?.actor))
        await addEffect(t.actor, { name: "Menacing Aura (no healing or Reactions)", img: "icons/magic/nature/root-vine-entangle-foot-green.webp", origin: feat(actor, "rot-and-violence").uuid, transfer: false,
          duration: { value: null, units: "rounds", expiry: "sourceStart" }, system: { changes: [chg("flags.midi-qol.actions.reaction", "true"), chg("flags.midi-qol.actions.reactionsUsed", "1")] }, flags: { world: { cgaNoHeal: true } } });
      return;
    }
    if (hidden(workflow)) return;

    // ---- items used
    const ident = item?.system?.identifier ?? "";
    if (ident === "action-surge" || /^action surge$/i.test(item?.name ?? "")) await rallyingSurge(actor, me);
    if ((ident === "uncanny-metabolism" || /^uncanny metabolism$/i.test(item?.name ?? "")) && feat(actor, "mystic-focus")) later(() => focusToSlot(actor), 800);
    if ((ident === "magical-cunning" || /^magical cunning$/i.test(item?.name ?? "")) && feat(actor, "vestige-power")) await refreshDivinePower(actor);
    if ((ident === "arcane-recovery" || /^arcane recovery$/i.test(item?.name ?? "")) && feat(actor, "grave-power")) {
      const ex = Number(actor.system.attributes.exhaustion ?? 0);
      if (ex > 0) { await actor.update({ "system.attributes.exhaustion": ex - 1 }); say(actor, "<strong>Grave Resilience:</strong> one Exhaustion level removed."); }
    }
    if ((ident === "stunning-strike" || /^stunning strike$/i.test(item?.name ?? "")) && feat(actor, "focused-strike"))
      for (const t of targetsOf(workflow)) await addEffect(t.actor, { name: `Focused Strike (Disadvantage on saves vs ${actor.name}'s spells)`, img: "icons/skills/melee/unarmed-punch-fist-yellow-red.webp",
        origin: feat(actor, "focused-strike").uuid, transfer: false, duration: { value: null, units: "rounds", expiry: "sourceStart" },
        system: { changes: [chg("flags.midi-qol.disadvantage.save.all", `workflow?.actor?.uuid === "${actor.uuid}" && workflow?.item?.type === "spell"`)] } });

    // ---- spells
    if (item?.type === "spell") {
      // Spiritual Manifestation: Half Cover option for Spirit Guardians (1/SR)
      const ec = feat(actor, "empowered-channeling");
      if (ec && /spirit guardians/i.test(item.name) && usesOf(ec) > 0 && me
        && await askOwner(actor, `Spiritual Manifestation: ${actor.name}`, "<p>Let the spirits guard against worldly threats - you and allies within 15 ft get Half Cover (+2 AC and DEX saves) while the spell lasts? (once per Short Rest)</p>")) {
        await spend(ec);
        for (const t of sceneTokens(me).filter((o) => o.actor && o.disposition === me.disposition && (o === me || edgeDistance(me, o, me.parent) <= 15)))
          await addEffect(t.actor, { name: "Spiritual Manifestation (Half Cover)", img: "icons/magic/holy/angel-winged-humanoid-blue.webp", origin: item.uuid, transfer: false, duration: { seconds: 600 },
            system: { changes: [chg("system.attributes.ac.bonus", "+2", "add"), chg("system.abilities.dex.bonuses.save", "+2", "add")] } });
      }
      // Blessing of Moonlight
      const bm = feat(actor, "blessing-of-moonlight");
      const blessed = actor.effects.find((e) => e.flags?.world?.cgaMoonBless && !e.disabled);
      if (bm && /moonbeam/i.test(item.name) && !blessed && usesOf(bm) > 0
        && await askOwner(actor, `Blessing of Moonlight: ${actor.name}`, "<p>Glow with moonlight while this Moonbeam lasts - each failed save against it heals another creature 2d4? (once per Long Rest)</p>")) {
        await spend(bm);
        await addEffect(actor, { name: "Blessing of Moonlight", img: "icons/magic/nature/moon-crescent.webp", origin: item.uuid, transfer: false, duration: { seconds: 60 }, flags: { world: { cgaMoonBless: true } } });
      }
      if (/moonbeam/i.test(item.name) && (blessed || actor.effects.some((e) => e.flags?.world?.cgaMoonBless)) && workflow.failedSaves?.size && me) {
        for (const _ of Array.from(workflow.failedSaves)) {
          const hurt = sceneTokens(me).filter((o) => o.actor && alive(o.actor) && o.disposition === me.disposition && Number(hpOf(o.actor).value) < Number(hpOf(o.actor).max) && edgeDistance(me, o, me.parent) <= 60);
          if (!hurt.length) break;
          const t = await pick1(actor, `Blessing of Moonlight: ${actor.name}`, "<p>A creature failed its save - who regains 2d4 HP?</p>", hurt);
          if (!t) break;
          const r = await new Roll("2d4").evaluate(); await heal(t.actor, r.total);
          await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Blessing of Moonlight: ${t.name} regains ${r.total} HP` });
        }
      }
      // Dispelling Recovery: a free Dispel Magic after a slot spell that heals or ends a condition
      const dr = feat(actor, "dispelling-recovery");
      if (dr && usesOf(dr) > 0 && slotCast(workflow) && (damageTypesOf(workflow).includes("healing") || CONDITION_SPELLS.test(item.name))
        && await askOwner(actor, `Dispelling Recovery: ${actor.name}`, "<p>Cast Dispel Magic now without a slot? (Target the creature, object or effect first.)</p>")) {
        const cast = dr.system.activities.find((a) => a.midiProperties?.identifier === "dispelling-cast");
        if (cast) later(() => MidiQOL.completeActivityUse(cast, { midiOptions: { workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 900);
      }
      // Absorb Spells: a failed save against your Counterspell restores 1d4 Sorcery Points
      const sp = spItem(actor);
      if (feat(actor, "absorb-spells") && /counterspell/i.test(item.name) && workflow.failedSaves?.size && sp) {
        const r = await new Roll("1d4").evaluate();
        await sp.update({ "system.uses.spent": Math.max(0, Number(sp.system.uses.spent ?? 0) - r.total) });
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Absorb Spells: ${actor.name} regains ${r.total} Sorcery Points` });
      }
      // Wondrous Alteration: extras while Alter Self lasts (removed with its Concentration)
      if (/alter self/i.test(item.name) && feat(actor, "wondrous-alteration"))
        await addEffect(actor, { name: "Wondrous Alteration", img: "icons/magic/control/silhouette-grow-shrink-blue.webp", origin: item.uuid, transfer: false, duration: { seconds: 3600 },
          system: { changes: [chg("flags.midi-qol.advantage.skill.dec", "1"), chg("flags.midi-qol.advantage.concentration", "1")] } });
    }

    // ---- attacks
    if (isAttack(workflow)) {
      // Curving Shot: a missed Ammunition attack ricochets (Bonus Action)
      if (feat(actor, "curving-shot") && rangedAttack(workflow) && item?.system?.properties?.has?.("amm") && !hits(workflow).length && targetsOf(workflow).length === 1 && !curved.has(workflow)
        && !MidiQOL.hasUsedBonusAction?.(actor) && me) {
        curved.add(workflow);
        const first = targetsOf(workflow)[0];
        const others = sceneTokens(first).filter((o) => o !== first && o !== me && o.actor && alive(o.actor) && hostile(o, me) && edgeDistance(o, first, o.parent) <= 60);
        const t = others.length ? await pick1(actor, `Curving Shot: ${actor.name}`, "<p>The shot misses. Use your Bonus Action to ricochet it at another creature within 60 ft of the target?</p>", others) : null;
        if (t) {
          await MidiQOL.setBonusActionUsed?.(actor);
          later(async () => { const w = await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [t.uuid], workflowOptions: { targetConfirmation: "none" } }, consume: { resources: false } }, { configure: false }, {}); if (w) curved.add(w); }, 600);
        }
      }
      // Hungering Might: once per turn, a hit while transformed and Bloodied heals 1d10 + WIS
      if (hits(workflow).length && feat(actor, "hungering-might") && wrathOn(actor) && isBloodied(actor) && !usedThisTurn("hungering-might", actor)) {
        markTurn("hungering-might", actor);
        const r = await new Roll(`1d10 + ${Math.max(1, mod(actor, "wis"))}`).evaluate(); await heal(actor, r.total);
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Hungering Might: ${actor.name} regains ${r.total} HP` });
      }
      // Bloated companion: Dreadful Swipe pushes a Large or smaller target 10 ft
      if (hits(workflow).length && actor.getFlag("world", "cgaMods")?.includes?.("bloated") && /dreadful swipe/i.test(item?.name ?? "") && me) {
        const t = hits(workflow)[0];
        if (["tiny", "sm", "med", "lg"].includes(t.actor.system.traits?.size ?? "med") && t.object) await MidiQOL.moveTokenAwayFromPoint(t.object, 10, me.object?.center ?? me.center, { animate: false }).catch(() => {});
      }
      // Moist companion / Chilling Retribution: reactions to being hit
      for (const t of hits(workflow)) {
        const ta = t.actor;
        if (ta.getFlag("world", "cgaMods")?.includes?.("moist") && me && edgeDistance(me, t, t.parent) <= 10) {
          const maker = summonerOf(ta), dmg = Math.max(0, mod(maker, "int"));
          if (dmg) { await MidiQOL.applyTokenDamage([{ value: dmg, type: "acid" }], dmg, new Set([me.object ?? me]), null, new Set(), {}); say(ta, `<strong>Moist:</strong> ${me.name} takes ${dmg} Acid damage.`); }
        }
        const cr = feat(ta, "chilling-retribution");
        if (cr && usesOf(cr) > 0 && canReact(ta) && me && alive(actor)
          && await askOwner(ta, `Chilling Retribution: ${t.name}`, `<p>${me.name} hits you. Use your Reaction - WIS save or Stunned until the end of your next turn? (${usesOf(cr)} left)</p>`)) {
          await spend(cr); await useReaction(ta);
          later(() => runAct(cr, "chilling-retribution", [me]), 600);
        }
      }
    }

    // ---- deaths: Tokens of the Departed
    for (const d of workflow.damageList ?? []) {
      if (!(Number(d.oldHP ?? 1) > 0 && Number(d.newHP ?? 1) <= 0)) continue;
      const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "");
      const victim = found instanceof Actor ? tokensOf(found)[0] : tokenOf(found);
      if (!victim) continue;
      for (const p of sceneTokens(victim)) {
        const tk = p.actor && feat(p.actor, "tokens-of-the-departed");
        if (!tk || p === victim || !canReact(p.actor) || usesOf(tk) >= Number(tk.system.uses.max) || edgeDistance(p, victim, p.parent) > 30) continue;
        if (!(await askOwner(p.actor, `Tokens of the Departed: ${p.name}`, `<p>${victim.name} dies nearby. Use your Reaction to gain a soul trinket?</p>`))) continue;
        await useReaction(p.actor);
        await tk.update({ "system.uses.spent": Math.max(0, Number(tk.system.uses.spent) - 1) });
        say(p.actor, `<strong>Tokens of the Departed:</strong> ${p.name} claims a soul trinket.`);
      }
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 book class RollComplete rules failed`, err); }
});

// ------------------------------------------------------------------ Damage rolls
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    const actor = workflow?.actor, item = workflow?.item;
    if (!actor || !workflow.damageRolls?.length || hidden(workflow)) return;
    const types = damageTypesOf(workflow), healing = types.includes("healing"), first = types.find((t) => t !== "temphp") ?? types[0];
    const me = tokenOf(workflow.token);
    // Firepower (Explosive Cannon): +1d8 to the cannon's damage and Protector's temp HP
    if (summonOrigin(actor)?.system?.identifier === "eldritch-cannon" && classLevel(summonerOf(actor), "artificer") >= 9 && feat(summonerOf(actor), "explosive-cannon"))
      await bonusRoll(workflow, "1d8", types[0], "Firepower");
    // Arcane Jolt: once per turn after a magic weapon hit (you) or a Steel Defender hit
    if (isAttack(workflow) && hits(workflow).length) {
      const owner = feat(actor, "arcane-jolt") && item?.system?.properties?.has?.("mgc") ? actor : (summonOrigin(actor)?.system?.identifier === "steel-defender" ? summonerOf(actor) : null);
      const aj = owner && feat(owner, "arcane-jolt");
      if (aj && usesOf(aj) > 0 && !usedThisTurn("arcane-jolt", owner)) {
        const n = classLevel(owner, "artificer") >= 15 ? 4 : 2, t = hits(workflow)[0];
        const p = await askChoice(owner, `Arcane Jolt: ${owner.name}`, `<p>Channel an Arcane Jolt through the hit on ${t.name}? (${usesOf(aj)} left)</p>`,
          [{ action: "harm", label: `Destructive (+${n}d6 Force)`, default: true }, { action: "heal", label: `Restorative (heal ${n}d6)` }, { action: "none", label: "No" }]);
        if (p === "harm" || p === "heal") {
          markTurn("arcane-jolt", owner); await spend(aj);
          if (p === "harm") await bonusRoll(workflow, `${n}d6`, "force", "Arcane Jolt");
          else {
            const ownTok = tokensOf(owner)[0];
            const hurt = sceneTokens(t).filter((o) => o.actor && alive(o.actor) && ownTok && o.disposition === ownTok.disposition && edgeDistance(o, t, o.parent) <= 30);
            const h = hurt.length ? await pick1(owner, "Arcane Jolt", "<p>Who regains the healing (within 30 ft of the target)?</p>", hurt) : null;
            if (h) later(() => runAct(aj, "arcane-jolt-heal", [h], { formula: `${n}d6` }), 1500);
          }
        }
      }
    }
    // Guided Precision: once per turn, + INT to a Cartographer spell or an attack against a Faerie Fire target
    if (feat(actor, "guided-precision") && !healing && !usedThisTurn("guided-precision", actor)) {
      const fairy = isAttack(workflow) && hits(workflow).some((t) => t.actor.effects.some((e) => /outlined|faerie fire/i.test(e.name)));
      if ((item?.type === "spell" && CARTO_SPELLS.test(item.name)) || fairy) { markTurn("guided-precision", actor); await bonusRoll(workflow, String(Math.max(1, mod(actor, "int"))), first, "Guided Precision"); }
    }
    // Arcane Conduit (Reanimated Companion): + INT to an Evocation/Necromancy Artificer spell while the companion is within 120 ft
    if (artificerSpell(item, actor) && ["evo", "nec"].includes(item.system.school) && !healing && me && !usedThisTurn("arcane-conduit", actor)
      && companionsOf(actor, "reanimated-companion", me.parent).some((c) => c.actor.getFlag("world", "cgaMods")?.includes?.("arcane-conduit") && edgeDistance(me, c, me.parent) <= 120)) {
      markTurn("arcane-conduit", actor); await bonusRoll(workflow, String(Math.max(1, mod(actor, "int"))), first, "Arcane Conduit");
    }
    // Power from Beyond (Empowered Channeling): +1d6 once per turn to a Bard slot spell's damage or healing
    if (feat(actor, "empowered-channeling") && slotCast(workflow) && (item.system.sourceClass === "bard" || (!item.system.sourceClass && classLevel(actor, "bard") > 0)) && !usedThisTurn("power-from-beyond", actor)) {
      markTurn("power-from-beyond", actor); await bonusRoll(workflow, "1d6", first, "Power from Beyond");
    }
    // Arcane Necrosis (Grave Touched): once per turn a damaging spell's damage can become Necrotic
    if (feat(actor, "grave-touched") && item?.type === "spell" && !healing && !types.includes("necrotic") && !usedThisTurn("arcane-necrosis", actor)
      && await askOwner(actor, `Arcane Necrosis: ${actor.name}`, `<p>Change ${item.name}'s damage to Necrotic?</p>`)) {
      markTurn("arcane-necrosis", actor);
      for (const r of workflow.damageRolls) { if (rollTypes(r).includes("temphp")) continue; r.options.type = "necrotic"; r.options.types = ["necrotic"]; }
      await workflow.setDamageRolls(workflow.damageRolls);
    }
    // Dreaded Necrosis (Grave Touched): once per turn in Form of Dread, a Necrotic hit rolls one extra die
    if (feat(actor, "grave-touched") && formOn(actor) && isAttack(workflow) && hits(workflow).length && types.includes("necrotic") && !usedThisTurn("dreaded-necrosis", actor)) {
      const r = workflow.damageRolls.find((x) => rollTypes(x).includes("necrotic"));
      const faces = r?.dice?.[0]?.faces;
      if (faces) { markTurn("dreaded-necrosis", actor); await bonusRoll(workflow, `1d${faces}`, "necrotic", "Dreaded Necrosis"); }
    }
    // Withering Strike (Undead Thralls): your Undead within 60 ft deal + INT Necrotic on a hit
    const maker = summonerOf(actor);
    if (maker && feat(maker, "undead-thralls") && /undead/.test(creatureType(actor)) && isAttack(workflow) && hits(workflow).length) {
      const mt = tokensOf(maker)[0];
      if (!mt || !me || edgeDistance(mt, me, me.parent) <= 60) await bonusRoll(workflow, String(Math.max(1, mod(maker, "int"))), "necrotic", "Withering Strike");
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 book class damage rules failed`, err); }
});

// ------------------------------------------------------------------ Damage taken: Sentinel at Death's Door, Song of Defense, Unholy Resuscitation, no healing
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { ditem, workflow }) => {
  try {
    const actor = token?.actor, tDoc = tokenOf(token);
    if (!actor || !ditem) return;
    // Menacing Aura: no healing
    if (actor.effects.some((e) => e.flags?.world?.cgaNoHeal && !e.disabled) && (ditem.hpDamage ?? 0) < 0) {
      for (const d of (ditem.calculatedDamages ?? ditem.damageDetail) ?? []) if (d.type === "healing") d.value = 0;
      ditem.hpDamage = 0; ditem.newHP = ditem.oldHP ?? hpOf(actor).value; ditem.totalDamage = 0;
      return say(actor, `<strong>Menacing Aura:</strong> ${actor.name} can't regain Hit Points.`);
    }
    let total = damageTotal(ditem);
    if (total <= 0) return;
    const wasHit = isAttack(workflow) && hits(workflow).some((t) => t.uuid === tDoc?.uuid);
    // Sentinel at Death's Door: halve an attack's damage to you or a Bloodied creature within 60 ft
    if (wasHit) {
      const oldHP = Number(ditem.oldHP ?? hpOf(actor).value), max = Number(hpOf(actor).max ?? 0);
      for (const c of sceneTokens(tDoc)) {
        const s = c.actor && feat(c.actor, "sentinel-at-deaths-door");
        if (!s || usesOf(s) < 1 || !canReact(c.actor)) continue;
        if (c !== tDoc && (c.disposition !== tDoc.disposition || !(oldHP <= max / 2) || edgeDistance(c, tDoc, c.parent) > 60)) continue;
        if (!(await askOwner(c.actor, `Sentinel at Death's Door: ${c.name}`, `<p>${tDoc.name} is hit for ${total} damage. Use your Reaction to halve it? (${usesOf(s)} left)</p>`))) continue;
        await spend(s); await useReaction(c.actor);
        const cut = reduceDamage(ditem, total - Math.floor(total / 2));
        total -= cut;
        say(c.actor, `<strong>Sentinel at Death's Door:</strong> ${tDoc.name} takes ${cut} less damage${workflow?.isCritical ? " (cancel any critical-hit effects by hand)" : ""}.`);
        break;
      }
    }
    // Song of Defense: spend a slot to reduce the damage by 5 x its level
    if (total > 0 && feat(actor, "song-of-defense") && songOn(actor) && canReact(actor)) {
      const slots = freeSlots(actor);
      if (slots.length) {
        const p = await askChoice(actor, `Song of Defense: ${actor.name}`, `<p>You take ${total} damage. Use your Reaction and a spell slot to reduce it by 5 x the slot's level?</p>`,
          [...slots.map((s, i) => ({ action: s.key, label: `Level ${s.level} (-${5 * s.level})`, default: i === 0 })), { action: "none", label: "No" }]);
        const s = slots.find((x) => x.key === p);
        if (s) {
          await useReaction(actor);
          await actor.update({ [`system.spells.${s.key}.value`]: s.value - 1 });
          const cut = reduceDamage(ditem, 5 * s.level); total -= cut;
          say(actor, `<strong>Song of Defense:</strong> ${actor.name} takes ${cut} less damage.`);
        }
      }
    }
    // Unholy Resuscitation (Necrotic Husk): at 0 HP, a Necrotic burst and HP = 2 x Warlock level (1/SR)
    const nh = feat(actor, "necrotic-husk");
    const oldHP = Number(ditem.oldHP ?? hpOf(actor).value ?? 0), oldTemp = Number(ditem.oldTempHP ?? hpOf(actor).temp ?? 0);
    if (nh && usesOf(nh) > 0 && oldHP > 0 && (ditem.newHP ?? 1) <= 0 && total - oldTemp - oldHP < Number(hpOf(actor).max ?? 0)
      && await askOwner(actor, `Unholy Resuscitation: ${actor.name}`, `<p>${actor.name} drops to 0 HP. Erupt with deathly energy and stay up with ${2 * classLevel(actor, "warlock")} HP (+1 Exhaustion)?</p>`)) {
      await spend(nh);
      const keep = 2 * classLevel(actor, "warlock");
      reduceDamage(ditem, total);
      ditem.hpDamage = 0; ditem.newHP = oldHP; ditem.tempDamage = oldTemp; ditem.newTempHP = 0;
      setTimeout(async () => {
        await updateActor(actor, { "system.attributes.hp.value": keep, "system.attributes.exhaustion": Math.min(6, Number(actor.system.attributes.exhaustion ?? 0) + 1) });
        const foes = sceneTokens(tDoc).filter((o) => o.actor && alive(o.actor) && hostile(o, tDoc) && edgeDistance(o, tDoc, o.parent) <= 30);
        if (foes.length) await runAct(nh, "unholy-resuscitation", foes);
      }, 800);
      say(actor, `<strong>Unholy Resuscitation:</strong> ${actor.name} rises with ${keep} HP.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 book class damage-taken rules failed`, err); }
});

// ------------------------------------------------------------------ Explosive Cannon: Detonate when the cannon takes damage
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  try {
    for (const d of workflow?.damageList ?? []) {
      if (!(Number(d.hpDamage ?? 0) + Number(d.tempDamage ?? 0) > 0)) continue;
      const found = fromUuidSync(d.targetUuid ?? d.tokenUuid ?? "");
      const can = found instanceof Actor ? tokensOf(found)[0] : tokenOf(found);
      if (!can?.actor || summonOrigin(can.actor)?.system?.identifier !== "eldritch-cannon") continue;
      const maker = summonerOf(can.actor), mt = maker && tokensOf(maker)[0];
      if (!maker || !feat(maker, "explosive-cannon") || !mt || !canReact(maker) || edgeDistance(mt, can, can.parent) > 60) continue;
      if (!(await askOwner(maker, `Detonate: ${maker.name}`, "<p>Your cannon takes damage. Use your Reaction to detonate it (20-ft DEX save, 3d10 Force)?</p>"))) continue;
      await useReaction(maker);
      const det = can.actor.items.find((i) => i.system?.identifier === "detonate" || /^detonate$/i.test(i.name));
      const around = sceneTokens(can).filter((o) => o !== can && o.actor && alive(o.actor) && edgeDistance(o, can, can.parent) <= 20);
      if (det && around.length) await runAct(det, "cannon-detonate", around);
      if (can.isOwner) await can.delete().catch(() => {}); else await updateActor(can.actor, { "system.attributes.hp.value": 0 });
    }
  } catch (err) { console.warn(`${MODULE_ID} | Detonate failed`, err); }
});

// ------------------------------------------------------------------ Saves: Fortifying Soul (fear Advantage), Beasts of Ill Omen (Disadvantage near the beast)
Hooks.on("midi-qol.preCheckSaves", async (workflow) => {
  try {
    const statuses = saveStatuses(workflow);
    const caster = workflow?.actor, me = tokenOf(workflow?.token);
    const beasts = feat(caster, "beasts-of-ill-omen") && workflow.item?.type === "spell" && me
      ? sceneTokens(me).filter((t) => t.actor && /summon beast/i.test(summonOrigin(t.actor)?.name ?? "") && summonerOf(t.actor) === caster) : [];
    for (const t of targetsOf(workflow)) {
      const a = t.actor;
      const fearSave = statuses.has("frightened") || a.effects.some((e) => e.statuses.has("frightened") && (e.origin ?? "").startsWith(workflow.item?.uuid ?? "~"));
      if (fearSave && a.effects.some((e) => e.flags?.world?.cgaFearAdv && !e.disabled))
        await addEffect(a, { name: "Fortifying Soul (Advantage)", img: "icons/magic/water/snowflake-ice-blue.webp", transfer: false, system: { changes: [chg("flags.midi-qol.advantage.save.all", "1")] }, flags: { dae: { specialDuration: ["isSave"] } } });
      if (beasts.some((b) => hostile(t, me) && edgeDistance(b, t, t.parent) <= 5))
        await addEffect(a, { name: "Beasts of Ill Omen (Disadvantage)", img: "icons/creatures/mammals/wolf-howl-moon-black.webp", transfer: false, system: { changes: [chg("flags.midi-qol.disadvantage.save.all", "1")] }, flags: { dae: { specialDuration: ["isSave"] } } });
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 book class save rules failed`, err); }
});

// ------------------------------------------------------------------ Concentration: Guided Precision (Faerie Fire), Focused Conjuration
Hooks.on("dnd5e.preRollConcentrationV2", (config) => {
  try {
    const actor = config?.subject;
    if (!actor) return;
    const items = Array.from(actor.concentration?.items ?? []);
    const ff = feat(actor, "guided-precision") && items.some((i) => /faerie fire/i.test(i?.name ?? ""));
    const con = feat(actor, "focused-conjuration") && items.length && items.every((i) => i?.system?.school === "con");
    if (!ff && !con) return;
    config.rolls ??= [];
    if (!config.rolls.length) config.rolls.push({ parts: [], data: {} });
    config.rolls[0].parts ??= [];
    config.rolls[0].parts.push("99");
  } catch (err) { console.warn(`${MODULE_ID} | P2 Concentration rules failed`, err); }
});

// ------------------------------------------------------------------ Split Enchantment / Empowered Transmutation: raise the next eligible slot spell by one level
Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig, messageConfig) => {
  try {
    const item = activity?.item, actor = activity?.actor;
    if (item?.type !== "spell" || Number(item.system.level) < 1 || !usageConfig?.spell?.slot) return;
    const rules = [["split-enchantment", "enc", () => true], ["empowered-transmutation", "trs", () => !item.system.activities.some((a) => ["attack", "save"].includes(a.type))]];
    for (const [ident, school, ok] of rules) {
      const f = feat(actor, ident);
      if (!f?.getFlag("world", "cgaArmed") || item.system.school !== school || !ok() || usesOf(f) < 1) continue;
      usageConfig.scaling = Number(usageConfig.scaling || 0) + 1;
      item.updateSource({ "flags.dnd5e.scaling": usageConfig.scaling });
      item.prepareFinalAttributes?.();
      foundry.utils.setProperty(messageConfig, "data.system.scaling", usageConfig.scaling);
      f.update({ "system.uses.spent": Number(f.system.uses.spent ?? 0) + 1, "flags.world.-=cgaArmed": null });
      say(actor, `<strong>${f.name}:</strong> ${item.name} is cast one level higher.`);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | spell level raise failed`, err); }
});

// ------------------------------------------------------------------ Summons: Reanimated Companion modifications, Durable Summons, Undead Fortitude
const MODS = { "arcane-conduit": "Arcane Conduit", ferocity: "Ferocity", bloated: "Bloated", gaunt: "Gaunt", moist: "Moist" };
Hooks.on("dnd5e.postSummon", async (activity, profile, tokens) => {
  try {
    const caster = activity?.actor, item = activity?.item;
    if (!caster || !item) return;
    const docs = (tokens ?? []).map(tokenOf).filter((t) => t?.actor);
    // Reanimated Companion
    if (item.system?.identifier === "reanimated-companion") {
      const L = classLevel(caster, "artificer");
      const n = feat(caster, "strange-modifications") ? (L >= 15 ? 3 : L >= 9 && feat(caster, "macabre-modifications") ? 2 : 1) : 0;
      const pool = ["arcane-conduit", "ferocity", ...(feat(caster, "macabre-modifications") ? ["bloated", "gaunt", "moist"] : [])];
      const chosen = [];
      for (let i = 0; i < n; i++) {
        const left = pool.filter((k) => !chosen.includes(k));
        const p = await askChoice(caster, `Strange Modifications: ${caster.name}`, `<p>Choose modification ${i + 1} of ${n} for your companion.</p>`, left.map((k, j) => ({ action: k, label: MODS[k], default: j === 0 })));
        chosen.push(left.includes(p) ? p : left[0]);
      }
      for (const t of docs) await applyMods(t, chosen, L >= 9 && feat(caster, "improved-reanimation"));
      if (chosen.length) say(caster, `<strong>Strange Modifications:</strong> ${chosen.map((k) => MODS[k]).join(", ")}.`);
    }
    // Durable Summons: slot-cast Conjuration summons get temp HP and Resistance
    if (feat(caster, "durable-summons") && item.type === "spell" && item.system.school === "con" && Number(item.system.level) >= 1) {
      const temp = 2 * classLevel(caster, "wizard");
      for (const t of docs) {
        await tempHP(t.actor, temp);
        await addEffect(t.actor, { name: "Durable Summons (Resistance)", img: "icons/magic/defensive/shield-barrier-glowing-blue.webp", transfer: false, flags: { world: { cgaDurable: true } },
          system: { changes: ["acid", "bludgeoning", "cold", "fire", "lightning", "piercing", "poison", "slashing", "thunder"].map((d) => chg("system.traits.dr.value", d, "add")) } });
      }
      if (docs.length) say(caster, `<strong>Durable Summons:</strong> ${temp} temp HP and Resistance for the summoned creature(s).`);
    }
    // Undead Fortitude (Undead Thralls): + INT + half Wizard level HP for Undead from a Necromancy spell
    if (feat(caster, "undead-thralls") && item.type === "spell" && item.system.school === "nec") {
      const b = Math.max(0, mod(caster, "int")) + Math.floor(classLevel(caster, "wizard") / 2);
      for (const t of docs.filter((x) => /undead/.test(creatureType(x.actor)))) {
        const hp = hpOf(t.actor);
        await updateActor(t.actor, { "system.attributes.hp.max": Number(hp.max) + b, "system.attributes.hp.value": Number(hp.value) + b });
      }
      if (b && docs.length) say(caster, `<strong>Undead Fortitude:</strong> +${b} HP for your Undead.`);
    }
  } catch (err) { console.warn(`${MODULE_ID} | P2 summon rules failed`, err); }
});
async function applyMods(t, mods, improved) {
  const a = t.actor;
  await a.setFlag("world", "cgaMods", mods);
  if (mods.includes("ferocity")) {
    const sw = a.items.find((i) => /dreadful swipe/i.test(i.name)), act = sw?.system.activities.contents[0];
    if (act) await act.update({ "damage.parts": act.damage.parts.map((p) => ({ ...p.toObject?.() ?? p, denomination: 6 })) });
  }
  if (mods.includes("bloated")) { await a.update({ "system.traits.size": "lg" }); await t.update({ width: 2, height: 2 }).catch(() => {}); }
  if (mods.includes("gaunt")) await a.update({ "system.attributes.movement.walk": 45, "system.attributes.movement.climb": 45 });
  if (mods.includes("moist")) await a.update({ "system.attributes.movement.swim": Number(a.system.attributes.movement.walk) || 30 });
  if (improved) await addEffect(a, { name: "Improved Reanimation (Necrotic ignores Resistance)", img: "icons/magic/death/skull-energy-light-purple.webp", transfer: false, system: { changes: [({ key: "damage", value: "necrotic", type: "dnd5e.damage.ignore.resistance", priority: 100, phase: "initial" })] } });
}
Hooks.on("updateActor", async (actor, changes) => {
  if (!isGM() || !foundry.utils.hasProperty(changes, "system.attributes.hp.temp") || Number(changes.system.attributes.hp.temp) > 0) return;
  const fx = actor.effects.filter((e) => e.flags?.world?.cgaDurable);
  if (fx.length) await removeEffects(actor, fx.map((e) => e.id));
});

// ------------------------------------------------------------------ Turn starts: Gaunt companion aura
Hooks.on("updateCombat", async (combat, changes) => {
  try {
    if (!isGM() || !("turn" in changes || "round" in changes)) return;
    const c = combat.combatant, t = c?.token;
    if (!t?.actor || !onceKey(`gaunt:${t.uuid}`)) return;
    for (const g of sceneTokens(t)) {
      if (g === t || !g.actor?.getFlag("world", "cgaMods")?.includes?.("gaunt") || !alive(g.actor) || !hostile(g, t) || edgeDistance(g, t, t.parent) > 10) continue;
      const aura = g.actor.items.find((i) => /gaunt/i.test(i.name));
      if (aura) await runAct(aura, "gaunt-aura", [t]);
      break;
    }
  } catch (err) { console.warn(`${MODULE_ID} | Gaunt aura failed`, err); }
});

// ------------------------------------------------------------------ Ever-Ready Shot: an Arcane Shot use back when you roll Initiative
Hooks.on("updateCombatant", async (combatant, changes) => {
  try {
    if (!isGM() || !("initiative" in changes) || changes.initiative === null) return;
    const a = combatant.actor, as = a && feat(a, "arcane-shot");
    if (!as || !feat(a, "ever-ready-shot") || Number(as.system.uses.spent) < 1) return;
    await as.update({ "system.uses.spent": Number(as.system.uses.spent) - 1 });
    say(a, "<strong>Ever-Ready Shot:</strong> one Arcane Shot use restored.");
  } catch (err) { console.warn(`${MODULE_ID} | Ever-Ready Shot failed`, err); }
});

// ------------------------------------------------------------------ Mystic Focus: slot -> Focus Points
async function slotToFocus(actor) {
  const fp = focusItem(actor), slots = freeSlots(actor).filter((s) => /^spell/.test(s.key));
  if (!fp) return say(actor, "<strong>Mystic Focus:</strong> no Focus Points on the sheet.");
  if (!slots.length) return say(actor, "<strong>Mystic Focus:</strong> no spell slots left.");
  const p = await askChoice(actor, `Mystic Focus: ${actor.name}`, `<p>Expend which spell slot to regain Focus Points? (${usesOf(fp)}/${fp.system.uses.max} FP)</p>`,
    [...slots.map((s, i) => ({ action: s.key, label: `Level ${s.level} (+${s.level} FP)`, default: i === 0 })), { action: "none", label: "No" }]);
  const s = slots.find((x) => x.key === p);
  if (!s) return;
  await actor.update({ [`system.spells.${s.key}.value`]: s.value - 1 });
  await fp.update({ "system.uses.spent": Math.max(0, Number(fp.system.uses.spent ?? 0) - s.level) });
  say(actor, `<strong>Mystic Focus:</strong> a level ${s.level} slot becomes ${s.level} Focus Points.`);
}

// ------------------------------------------------------------------ Rallying Surge: allies react after Action Surge
async function rallyingSurge(actor, me) {
  if (!feat(actor, "rallying-surge") || !me) return;
  const range = feat(actor, "inspiring-commander") ? 60 : 30;
  const allies = sceneTokens(me).filter((o) => o !== me && o.actor && alive(o.actor) && o.disposition === me.disposition && canReact(o.actor) && edgeDistance(me, o, me.parent) <= range)
    .slice(0, Math.max(1, mod(actor, "cha")));
  for (const o of allies) {
    const p = await askChoice(o.actor, `Rallying Surge: ${o.name}`, `<p>${actor.name} rallies you. Use your Reaction?</p>`,
      [{ action: "attack", label: "Make one attack", default: true }, { action: "move", label: "Move half Speed (no Opportunity Attacks)" }, { action: "none", label: "No" }]);
    if (p !== "attack" && p !== "move") continue;
    await useReaction(o.actor);
    say(o.actor, `<strong>Rallying Surge:</strong> ${o.name} ${p === "attack" ? "makes one attack with a weapon or an Unarmed Strike now" : "moves up to half its Speed without provoking Opportunity Attacks"}.`);
  }
}

// ------------------------------------------------------------------ Transmuter's Stone
async function transmuterStone(actor, feature, bearerTok) {
  const bearer = bearerTok?.actor ?? actor;
  // Potent Stone (Transmuter 10): two benefits, plus Mighty Build and Tremorsense
  const potent = !!feat(actor, "potent-stone");
  const changes = [], labels = [], picked = [], resisted = [];
  for (let i = 0; i < (potent ? 2 : 1); i++) {
    const opts = [["darkvision", "Darkvision 60 ft"], ["resistance", "Resistance"], ["speed", "+10 ft Speed"], ...(potent ? [["mighty", "Mighty Build"], ["tremor", "Tremorsense 30 ft"]] : [])]
      .filter(([k]) => k === "resistance" || !picked.includes(k));
    const p = await askChoice(actor, `Transmuter's Stone: ${actor.name}`, `<p>Choose ${potent ? `benefit ${i + 1} of 2` : "the stone's benefit"} for ${bearer.name}.</p>`, opts.map(([k, l], j) => ({ action: k, label: l, default: j === 0 })));
    const k = opts.some(([x]) => x === p) ? p : opts[0][0];
    picked.push(k);
    if (k === "resistance") {
      const types = ["acid", "cold", "fire", "lightning", "poison", "thunder"].filter((x) => !resisted.includes(x));
      const t = await askChoice(actor, "Transmuter's Stone", "<p>Which damage type?</p>", types.map((x, j) => ({ action: x, label: cap(x), default: j === 0 })));
      const type = types.includes(t) ? t : types[0];
      resisted.push(type); changes.push(chg("system.traits.dr.value", type, "add")); labels.push(`${cap(type)} Resistance`);
    } else if (k === "speed") { changes.push(chg("system.attributes.movement.walk", "10", "add")); labels.push("+10 ft Speed"); }
    else if (k === "mighty") { changes.push(chg("flags.midi-qol.advantage.save.str", "1")); labels.push("Mighty Build"); }
    else if (k === "tremor") { changes.push(chg("system.attributes.senses.ranges.tremorsense", "30", "upgrade")); labels.push("Tremorsense"); }
    else {
      const dv = Number(bearer.system.attributes.senses?.ranges?.darkvision ?? 0);
      changes.push(chg("system.attributes.senses.ranges.darkvision", String(dv ? dv + 60 : 60), "upgrade")); labels.push("Darkvision");
    }
  }
  const label = labels.join(", "), change = changes;
  for (const a of [...game.actors.contents, ...game.scenes.contents.flatMap((s) => s.tokens.contents.map((t) => t.actor).filter((x) => x?.isToken))]) {
    const old = a?.items?.filter((i) => i.flags?.world?.cgaStone === actor.uuid).map((i) => i.id) ?? [];
    if (old.length && a.isOwner) await a.deleteEmbeddedDocuments("Item", old).catch(() => {});
  }
  const holder = bearer.isOwner ? bearer : actor;
  await holder.createEmbeddedDocuments("Item", [{ name: `Transmuter's Stone (${label})`, type: "loot", img: "icons/commodities/gems/gem-rough-cushion-green.webp",
    system: { description: { value: `<p>Made by ${actor.name}'s Transmuter's Stone: the bearer has proficiency in Constitution saving throws and ${label}.</p>` }, quantity: 1 },
    effects: [{ name: `Transmuter's Stone (${label})`, img: "icons/commodities/gems/gem-rough-cushion-green.webp", transfer: true, system: { changes: [chg("system.abilities.con.proficient", "1", "upgrade"), ...change] } }],
    flags: { world: { cgaStone: actor.uuid } } }]);
  say(actor, `<strong>Transmuter's Stone:</strong> ${label} + CON save proficiency${holder === bearer ? ` for ${bearer.name}` : ` (in ${actor.name}'s inventory - hand it to ${bearer.name})`}.`);
}

// ------------------------------------------------------------------ Tokens of the Departed: Life Essence while you have a trinket
async function lifeEssence(item) {
  if (!item?.parent || !item.isOwner) return;
  const fx = item.effects.find((e) => /^Life Essence/.test(e.name));
  const off = usesOf(item) < 1;
  if (fx && fx.disabled !== off) await fx.update({ disabled: off }).catch(() => {});
}
Hooks.on("updateItem", (item, changes, options, userId) => { if (userId === game.user.id && item.system?.identifier === "tokens-of-the-departed") lifeEssence(item); });
Hooks.on("createItem", (item, options, userId) => { if (userId === game.user.id && item.system?.identifier === "tokens-of-the-departed") lifeEssence(item); });

// ------------------------------------------------------------------ Necrotic Husk: Necrotic Immunity in Form of Dread
Hooks.on("createActiveEffect", async (effect) => {
  try {
    const a = effect.parent;
    if (!isGM() || !(a instanceof Actor) || !effect.flags?.world?.cgaFormOfDread || !feat(a, "necrotic-husk")) return;
    await addEffect(a, { name: "Necrotic Husk (Necrotic Immunity)", img: "icons/magic/death/skull-energy-light-purple.webp", transfer: false, flags: { world: { cgaHuskImm: true } }, system: { changes: [chg("system.traits.di.value", "necrotic", "add")] } });
  } catch (err) { console.warn(`${MODULE_ID} | Necrotic Husk failed`, err); }
});
Hooks.on("deleteActiveEffect", async (effect) => {
  try {
    const a = effect.parent;
    if (!isGM() || !(a instanceof Actor) || !effect.flags?.world?.cgaFormOfDread) return;
    const fx = a.effects.filter((e) => e.flags?.world?.cgaHuskImm);
    if (fx.length) await removeEffects(a, fx.map((e) => e.id));
  } catch (err) { console.warn(`${MODULE_ID} | Necrotic Husk cleanup failed`, err); }
});

// ------------------------------------------------------------------ Auras: Aura of Elemental Shielding, Vestige Power (shared Resistance)
let auraTimer = null;
function scheduleAuras() { if (!isGM()) return; clearTimeout(auraTimer); auraTimer = setTimeout(() => sweepAuras(canvas.scene).catch((err) => console.warn(`${MODULE_ID} | P2 auras failed`, err)), 400); }
const VESTIGE_TYPE = { celestial: "radiant", fiend: "fire", undead: "necrotic" };
async function sweepAuras(scene) {
  if (!scene) return;
  const want = new Map(); // actor -> [{key, name, changes}]
  const add = (a, e) => { if (!want.has(a)) want.set(a, []); want.get(a).push(e); };
  const toks = scene.tokens.contents.filter((t) => t.actor);
  for (const p of toks) {
    const a = p.actor;
    const ae = feat(a, "aura-of-elemental-shielding");
    if (ae && alive(a) && !isIncapacitated(a)) {
      const type = ae.getFlag("world", "cgaShieldType") ?? "fire", range = classLevel(a, "paladin") >= 18 ? 30 : 10;
      for (const o of toks) if (o.disposition === p.disposition && (o === p || edgeDistance(p, o, scene) <= range))
        add(o.actor, { key: `genie:${p.id}`, name: `Aura of Elemental Shielding (${cap(type)})`, img: "icons/magic/defensive/shield-barrier-flaming-diamond-orange.webp", changes: [chg("system.traits.dr.value", type, "add")] });
    }
    if (feat(a, "vestige-power")) {
      for (const v of companionsOf(a, "vestige-companion", scene)) {
        const type = VESTIGE_TYPE[v.actor.system.details?.type?.value];
        if (type && alive(v.actor) && edgeDistance(p, v, scene) <= 30) add(a, { key: `vestige:${v.id}`, name: `Vestige Power (${cap(type)} Resistance)`, img: "icons/magic/symbols/runes-carved-stone-purple.webp", changes: [chg("system.traits.dr.value", type, "add")] });
      }
    }
  }
  for (const t of toks) {
    const a = t.actor, have = a.effects.filter((e) => e.flags?.world?.cgaBookAura), need = want.get(a) ?? [];
    const drop = have.filter((e) => !need.some((n) => n.key === e.flags.world.cgaBookAura && n.name === e.name)).map((e) => e.id);
    if (drop.length) await removeEffects(a, drop);
    for (const n of need) if (!have.some((e) => e.flags.world.cgaBookAura === n.key && e.name === n.name))
      await addEffect(a, { name: n.name, img: n.img, transfer: false, flags: { world: { cgaBookAura: n.key } }, system: { changes: n.changes } });
  }
}
for (const h of ["moveToken", "createToken", "deleteToken"]) Hooks.on(h, () => scheduleAuras());
Hooks.on("updateToken", (doc, changes) => { if ("x" in changes || "y" in changes || "disposition" in changes) scheduleAuras(); });
Hooks.on("createItem", (item) => { if (["aura-of-elemental-shielding", "vestige-power"].includes(item.system?.identifier)) scheduleAuras(); });
Hooks.on("deleteItem", (item) => { if (["aura-of-elemental-shielding", "vestige-power"].includes(item.system?.identifier)) scheduleAuras(); });
Hooks.on("canvasReady", () => scheduleAuras());
