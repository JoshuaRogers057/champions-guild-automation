// Champions Guild Automation - class and subclass features (2024 Player's Handbook). One macro shared by every class
// feature item; it does the part for the feature it runs from (macroItem.system.identifier). Passive features call it
// from a transfer effect (flags.midi-qol.onUseMacroName "ItemMacro,<pass>"); activities call it through the item's
// onUseMacroName. Numbers that dnd5e keeps in class scale values (Rage Damage, Martial Arts die, ...) are worked out
// from class levels here, so characters imported without those scale values still work.
// Module rules in scripts/class-rules.js cover the auras, damage-reduction Reactions, Precision Attack, Cutting Words,
// Dark One's Blessing, Portent's Long Rest roll, Rage upkeep and the Martial Arts Finesse property.
const pass = args[0]?.macroPass;
const feat = macroItem;
const id = feat?.system?.identifier;
if (!feat || !id || !actor) return;
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);
const say = (html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p><strong>${esc(feat.name)}:</strong> ${html}</p>` });
const wf = workflow;
const activity = wf?.activity;
const usedItem = wf?.item;
const isWeapon = usedItem?.type === "weapon";
const actionType = activity?.actionType;
const me = token ?? MidiQOL.tokenForActor?.(actor);
const lvl = (cls) => Number(actor.classes?.[cls]?.system?.levels ?? 0);
const mod = (a) => Number(actor.system.abilities?.[a]?.mod ?? 0);
const prof = Number(actor.system.attributes.prof ?? 0);
const item = (identifier) => actor.items.find((i) => i.system?.identifier === identifier);
const has = (identifier) => !!item(identifier);
const left = (it) => Number(it?.system?.uses?.value ?? 0);
const spend = async (it, n = 1) => it && it.update({ "system.uses.spent": Number(it.system.uses.spent ?? 0) + n });
const isUnarmed = (it) => it?.system?.identifier === "unarmed-strike" || /unarmed strike/i.test(it?.name ?? "");
const monkWeapon = (it) => isUnarmed(it) || (it?.type === "weapon" && (it.system.type?.value === "simpleM" || (it.system.type?.value === "martialM" && it.system.properties?.has("lgt"))));
const attackAbility = () => activity?.ability ?? usedItem?.system?.abilityMod ?? "";
function hitTokens() {
  let hits = asTokens(wf?.hitTargets);
  let checkHits = "all";
  try { checkHits = game.settings.get("midi-qol", "ConfigSettings")?.autoCheckHit ?? "all"; } catch (err) { /* default */ }
  if (!hits.length && checkHits === "none" && wf?.attackRoll && !wf.isFumble) {
    const total = Number(wf.attackRoll.total ?? 0);
    hits = asTokens(wf.targets).filter((t) => t.actor && (wf.isCritical || total >= Number(t.actor.system?.attributes?.ac?.value ?? 10)));
  }
  return hits;
}
const combat = game.combat?.started ? game.combat : null;
const turnKey = combat ? `${combat.id}:${combat.round}:${combat.turn}` : `t${Math.floor(Date.now() / 6000)}`;
const isMyTurn = () => !combat || combat.combatant?.actorId === actor.id || combat.combatant?.actor === actor;
const usedThisTurn = (tag = id) => actor.getFlag("world", `cgaClassTurn.${tag}`) === turnKey;
const markUsed = async (tag = id) => actor.setFlag("world", `cgaClassTurn.${tag}`, turnKey).catch(() => {});
function firstCall(tag) {
  if (!wf) return true;
  wf.cgaClassCalls ??= new Set();
  const key = `${id}|${tag}`;
  if (wf.cgaClassCalls.has(key)) return false;
  wf.cgaClassCalls.add(key);
  return true;
}
const confirm = (title, html) => foundry.applications.api.DialogV2.confirm({ window: { title: `${feat.name}: ${title}` }, content: html, rejectClose: false });
const choose = (title, html, buttons) => foundry.applications.api.DialogV2.wait({ window: { title: `${feat.name}: ${title}` }, content: html, buttons, rejectClose: false }).catch(() => null);
const later = (fn, ms = 400) => setTimeout(() => fn().catch((err) => console.warn(`${feat.name} |`, err)), ms);
const DieTerm = foundry.dice?.terms?.Die ?? Die;
async function effectOn(t, name, changes, { special = [], statuses = [], seconds = null } = {}) {
  const data = { name: `${feat.name}: ${name}`, img: feat.img, transfer: false, origin: feat.uuid, statuses,
    duration: seconds ? { seconds } : { value: null, units: "seconds" },
    system: { changes: changes.map(([key, value, type = "override"]) => ({ key, value, type, priority: 50, phase: "initial" })) },
    flags: { dae: { specialDuration: special, stackable: "noneName" } } };
  if ((t.actor ?? t) === actor) return actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return MidiQOL.socket().executeAsGM("createEffects", { actorUuid: (t.actor ?? t).uuid, effects: [data] });
}
async function runSave(activityIdent, t, owner = feat) {
  const act = owner.system.activities.find((a) => a.midiProperties?.identifier === activityIdent);
  if (!act) return false;
  const w = await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } },
    consume: { resources: false, spellSlot: false }, create: { measuredTemplate: false } }, { configure: false }, {});
  return !!w && Array.from(w.failedSaves ?? []).some((x) => (x.document ?? x) === t.document);
}
async function pushAway(t, feet) { if (me && t) await MidiQOL.moveTokenAwayFromPoint(t, feet, me.center, { animate: false, autoRotate: false }); }
const sizeRank = (a) => Number(CONFIG.DND5E.actorSizes?.[a?.system?.traits?.size]?.numerical ?? 2);
const largeOrSmaller = (t) => sizeRank(t.actor) <= Number(CONFIG.DND5E.actorSizes?.lg?.numerical ?? 3);
const rageOn = () => actor.effects.some((e) => e.flags?.world?.cgaRage && !e.disabled);
const rageDamage = () => { const l = lvl("barbarian"); return l >= 16 ? 4 : l >= 9 ? 3 : 2; };
const supDie = () => { const l = lvl("fighter"); return l >= 18 ? 12 : l >= 10 ? 10 : 8; };
const maDie = () => { const l = lvl("monk"); return l >= 17 ? 12 : l >= 11 ? 10 : l >= 5 ? 8 : 6; };
const psiDie = () => { const l = Math.max(lvl("fighter"), lvl("rogue")); return l >= 17 ? 12 : l >= 11 ? 10 : l >= 5 ? 8 : 6; };
const bardDie = (a = actor) => { const l = Number(a.classes?.bard?.system?.levels ?? 0); return l >= 15 ? 12 : l >= 10 ? 10 : l >= 5 ? 8 : 6; };
const pickType = async (types, title) => types.length === 1 ? types[0]
  : (await choose(title, "<p>Which damage type?</p>", types.map((t, i) => ({ action: t, label: CONFIG.DND5E.damageTypes[t]?.label ?? t, default: i === 0 })))) ?? types[0];

switch (id) {
  // ======================================================================= Barbarian
  case "rage": {
    if (pass === "postActiveEffects" && activity?.item?.id === feat.id) {
      // Entering (or extending) Rage: mark the Rage effect, end Concentration.
      const rage = actor.effects.find((e) => e.flags?.world?.cgaRage);
      if (rage && !rage.getFlag("world", "cgaRageStart")) await rage.setFlag("world", "cgaRageStart", turnKey);
      await actor.setFlag("world", "cgaRageKept", turnKey);
      const conc = actor.effects.filter((e) => e.statuses?.has("concentrating"));
      if (conc.length) { await actor.deleteEmbeddedDocuments("ActiveEffect", conc.map((e) => e.id)).catch(() => {}); say("ends Concentration (no Concentration while raging)."); }
      return;
    }
    if (pass === "DamageBonus") {
      // Rage Damage on attacks using Strength (weapon or Unarmed Strike).
      if (!rageOn() || !activity?.attack || attackAbility() !== "str" || !(isWeapon || isUnarmed(usedItem)) || !hitTokens().length || !firstCall(pass)) return;
      return { damageRoll: `${rageDamage()}`, damageType: wf.defaultDamageType, flavor: "Rage" };
    }
    if (pass === "postActiveEffects" && rageOn() && isMyTurn()) {
      // Extending Rage: an attack roll against an enemy, or forcing an enemy to make a saving throw.
      const others = asTokens(wf?.targets).filter((t) => t.actor && t.actor !== actor && t.document.disposition !== me?.document?.disposition);
      if (others.length && (activity?.attack || activity?.save)) await actor.setFlag("world", "cgaRageKept", turnKey);
    }
    return;
  }
  case "reckless-attack": {
    if (pass !== "preAttackRoll" || !combat || !isMyTurn() || attackAbility() !== "str" || usedThisTurn() || !firstCall(pass)) return;
    await markUsed();
    if (!(await confirm("Attack recklessly?", "<p>Advantage on your Strength attack rolls until the start of your next turn, but attack rolls against you have Advantage too.</p>"))) return;
    await effectOn(actor, "Reckless", [["flags.midi-qol.advantage.attack.str", "1"], ["flags.midi-qol.grants.advantage.attack.all", "1"]], { special: ["turnStart"] });
    // midi has already worked out this attack's Advantage, so add it to this roll too.
    if (wf.attackRollModifierTracker?.advantage?.add) wf.attackRollModifierTracker.advantage.add("reckless", "Reckless Attack");
    else wf.advantage = true;
    return;
  }
  case "frenzy": {
    if (pass !== "DamageBonus" || !rageOn() || !activity?.attack || attackAbility() !== "str" || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    if (!actor.effects.some((e) => /Reckless/.test(e.name) && !e.disabled)) return;
    await markUsed();
    return { damageRoll: `${rageDamage()}d6`, damageType: wf.defaultDamageType, flavor: "Frenzy" };
  }
  case "divine-fury": {
    if (pass !== "DamageBonus" || !rageOn() || !activity?.attack || !(isWeapon || isUnarmed(usedItem)) || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    await markUsed();
    const type = await pickType(["radiant", "necrotic"], "Divine Fury");
    return { damageRoll: `1d6 + ${Math.floor(lvl("barbarian") / 2)}`, damageType: type, flavor: "Divine Fury" };
  }

  // ======================================================================= Bard
  case "bardic-inspiration": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const die = `1d${bardDie()}`;
    for (const t of asTokens(wf.targets).filter((x) => x.actor && x.actor !== actor)) {
      const old = t.actor.effects.filter((e) => e.flags?.world?.cgaBardic);
      if (old.length) await MidiQOL.socket().executeAsGM("deleteEffectsByUuid", { effectsToDelete: old.map((e) => e.uuid) }).catch(() => {});
      const data = { name: `Bardic Inspiration (${die})`, img: feat.img, transfer: false, origin: feat.uuid, duration: { seconds: 3600 },
        system: { changes: [
          ["flags.midi-qol.optional.cgaBardic.label", `Bardic Inspiration: add ${die}`],
          ["flags.midi-qol.optional.cgaBardic.attack.fail.all", die],
          ["flags.midi-qol.optional.cgaBardic.save.fail.all", die],
          ["flags.midi-qol.optional.cgaBardic.check.all", die],
          ["flags.midi-qol.optional.cgaBardic.skill.all", die],
          ["flags.midi-qol.optional.cgaBardic.count", "1"]].map(([key, value]) => ({ key, value, type: "override", priority: 20, phase: "initial" })) },
        flags: { world: { cgaBardic: true, die }, dae: { stackable: "noneName" } } };
      await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: t.actor.uuid, effects: [data] });
      say(`${esc(t.name)} gains a Bardic Inspiration die (${die}) for the next hour.`);
    }
    return;
  }

  // ======================================================================= Cleric / Druid strikes
  case "blessed-strikes-divine-strike":
  case "elemental-fury-primal-strike": {
    if (pass !== "DamageBonus" || !activity?.attack || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    const primal = id === "elemental-fury-primal-strike";
    const beastAttack = primal && !!actor.flags?.dnd5e?.isPolymorphed;
    if (!(isWeapon || beastAttack)) return;
    const n = (primal ? lvl("druid") >= 15 : lvl("cleric") >= 14) ? 2 : 1;
    await markUsed();
    const type = await pickType(primal ? ["cold", "fire", "lightning", "thunder"] : ["radiant", "necrotic"], primal ? "Primal Strike" : "Divine Strike");
    return { damageRoll: `${n}d8`, damageType: type, flavor: primal ? "Primal Strike" : "Divine Strike" };
  }
  case "blessed-strikes-potent-spellcasting":
  case "elemental-fury-potent-spellcasting": {
    if (pass !== "DamageBonus" || usedItem?.type !== "spell" || Number(usedItem.system.level) !== 0 || !firstCall(pass)) return;
    const cls = id.startsWith("blessed") ? "cleric" : "druid";
    const src = usedItem.system.sourceClass;
    if (src && src !== cls) return;
    if (!(wf.damageRolls ?? []).some((r) => !["healing", "temphp"].includes(r.options?.type))) return;
    return { damageRoll: `${mod("wis")}`, damageType: wf.defaultDamageType, flavor: "Potent Spellcasting" };
  }
  case "disciple-of-life": {
    if (pass !== "postDamageRoll" || usedItem?.type !== "spell" || !firstCall(pass)) return;
    const slot = Number(wf.castData?.castLevel ?? usedItem.system.level ?? 0);
    const rolls = wf.damageRolls ?? [];
    if (slot < 1 || !rolls.some((r) => r.options?.type === "healing")) return;
    rolls.push(await new CONFIG.Dice.DamageRoll(`${2 + slot}`, {}, { type: "healing", types: ["healing"] }).evaluate());
    await wf.setDamageRolls(rolls);
    return;
  }
  case "war-priest": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const weapons = actor.items.filter((i) => i.type === "weapon" && (i.system.equipped || isUnarmed(i)) && i.system.activities.some((a) => a.type === "attack"));
    if (!weapons.length) return say("no weapon to attack with.");
    const pick = weapons.length === 1 ? weapons[0].id : await choose("Bonus Action attack", "<p>Attack with:</p>", weapons.map((w, i) => ({ action: w.id, label: w.name, default: i === 0 })));
    const w = actor.items.get(pick);
    if (!w) return;
    later(() => w.system.activities.find((a) => a.type === "attack").use(), 300);
    return;
  }

  // ======================================================================= Fighter: Battle Master
  case "combat-superiority": {
    // Damage maneuvers: after a hit, offer the maneuvers you know (one per attack), add the Superiority Die to damage,
    // then apply the maneuver's effect (saves use DC 8 + STR or DEX + PB).
    const MANEUVERS = {
      "distracting-strike": { label: "Distracting Strike", note: "next attack against it by someone else has Advantage" },
      "goading-attack": { label: "Goading Attack", save: "wis", note: "WIS save or Disadvantage on attacks against others" },
      "menacing-attack": { label: "Menacing Attack", save: "wis", note: "WIS save or Frightened" },
      "pushing-attack": { label: "Pushing Attack", save: "str", note: "STR save or pushed 15 ft", large: true },
      "trip-attack": { label: "Trip Attack", save: "str", note: "STR save or Prone", large: true },
      "disarming-attack": { label: "Disarming Attack", save: "str", note: "STR save or drops an object" }
    };
    const known = Object.entries(MANEUVERS).filter(([k]) => has(`maneuver-${k}`) || has(k));
    if (pass === "DamageBonus") {
      if (!activity?.attack || !known.length || left(feat) <= 0 || !firstCall(pass)) return;
      const t = hitTokens().find((x) => x.actor && x !== me);
      if (!t) return;
      const die = supDie();
      const opts = known.filter(([, m]) => !m.large || largeOrSmaller(t));
      if (!opts.length) return;
      const buttons = opts.map(([k, m]) => ({ action: k, label: m.label }));
      buttons.push({ action: "none", label: "No maneuver", default: true });
      const pick = await choose("Maneuver", `<p>You hit <strong>${esc(t.name)}</strong>. Spend a Superiority Die (d${die}, ${left(feat)} left)?</p><ul>${opts.map(([, m]) => `<li><strong>${m.label}</strong>: ${m.note}</li>`).join("")}</ul>`, buttons);
      if (!pick || pick === "none") return;
      await spend(feat);
      wf.cgaManeuver = { key: pick, target: t.document.uuid };
      return { damageRoll: `1d${die}`, damageType: wf.defaultDamageType, flavor: MANEUVERS[pick].label };
    }
    if (pass === "postActiveEffects" && wf?.cgaManeuver && firstCall("maneuver-effect")) {
      const { key, target } = wf.cgaManeuver;
      const t = canvas.tokens.placeables.find((p) => p.document.uuid === target);
      if (!t?.actor) return;
      const m = MANEUVERS[key];
      later(async () => {
        if (m.save && !(await runSave(`maneuver-save-${m.save}`, t))) return say(`${esc(t.name)} resists the ${m.label}.`);
        if (key === "distracting-strike") await effectOn(t, "Distracted", [["flags.midi-qol.grants.advantage.attack.all", `workflow?.actor?.uuid !== "${actor.uuid}"`]], { special: ["isAttacked", "turnStartSource"] });
        else if (key === "goading-attack") await effectOn(t, "Goaded", [["flags.midi-qol.disadvantage.attack.all", `targetActorUuid !== "${actor.uuid}"`]], { special: ["turnEndSource"] });
        else if (key === "menacing-attack") await effectOn(t, "Frightened", [], { statuses: ["frightened"], special: ["turnEndSource"] });
        else if (key === "pushing-attack") await pushAway(t, 15);
        else if (key === "trip-attack") await MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: t.actor.uuid, statusId: "prone", options: { active: true } });
        else if (key === "disarming-attack") say(`${esc(t.name)} drops one object of your choice that it's holding (it lands in its space).`);
      }, 300);
    }
    return;
  }
  case "maneuver-riposte":
  case "riposte": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const t = asTokens(wf.targets)[0];
    const w = actor.items.find((i) => i.type === "weapon" && (i.system.equipped || isUnarmed(i)) && i.system.activities.some((a) => a.type === "attack" && a.actionType === "mwak"));
    if (!t || !w) return say("no melee weapon or target for the Riposte.");
    const die = supDie();
    await effectOn(actor, `Riposte (+1d${die})`, [["system.bonuses.mwak.damage", `+1d${die}`, "add"]], { special: ["1Attack"], seconds: 6 });
    later(() => MidiQOL.completeActivityUse(w.system.activities.find((a) => a.type === "attack"),
      { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 300);
    return;
  }

  // ======================================================================= Fighter: Psi Warrior
  case "psionic-power": {
    // Psionic Strike: once per turn after a weapon hit on a target within 30 ft.
    if (pass !== "DamageBonus" || lvl("fighter") < 3 || !isWeapon || !activity?.attack || left(feat) <= 0 || usedThisTurn("psionic-strike") || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me && (!me || MidiQOL.computeDistance?.(me, x) <= 30));
    if (!t) return;
    const die = psiDie();
    if (!(await confirm("Psionic Strike", `<p>Spend a Psionic Energy Die (${left(feat)} left) to deal 1d${die} + ${mod("int")} Force to <strong>${esc(t.name)}</strong>?</p>`))) return;
    await spend(feat); await markUsed("psionic-strike");
    return { damageRoll: `1d${die} + ${mod("int")}`, damageType: "force", flavor: "Psionic Strike" };
  }

  // ======================================================================= Monk
  case "martial-arts": {
    // Martial Arts die on Unarmed Strikes and Monk weapons while unarmored and without a Shield.
    if (pass !== "postDamageRoll" || !activity?.attack || !monkWeapon(usedItem) || !firstCall(pass)) return;
    if (actor.system.attributes.ac?.equippedArmor || actor.system.attributes.ac?.equippedShield) return;
    const rolls = wf.damageRolls ?? [];
    if (!rolls.length) return;
    const faces = maDie();
    const dice = rolls[0].terms.filter((t) => t instanceof DieTerm);
    const current = Math.max(0, ...dice.map((t) => t.faces));
    if (current >= faces && !isUnarmed(usedItem)) return;
    if (isUnarmed(usedItem) && current >= faces) return;
    const abil = Math.max(mod("str"), mod("dex"));
    const opts = foundry.utils.deepClone(rolls[0].options ?? {});
    opts.configured = false; opts.isCritical = !!wf.isCritical;
    const formula = isUnarmed(usedItem) ? `1d${faces} + ${abil}` : rolls[0].formula.replace(/^(\d*)d\d+/, `$1d${faces}`);
    rolls[0] = await new CONFIG.Dice.DamageRoll(formula, actor.getRollData(), opts).evaluate();
    await wf.setDamageRolls(rolls);
    return;
  }
  case "monks-focus": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id || !/flurry/i.test(activity.name ?? "")) return;
    const unarmed = actor.items.find(isUnarmed);
    const t = asTokens(wf.targets)[0] ?? asTokens(game.user.targets)[0];
    if (!unarmed || !t) return say("target a creature and make sure you have an Unarmed Strike item.");
    const strikes = lvl("monk") >= 10 ? 3 : 2;
    await actor.setFlag("world", "cgaFlurry", Date.now());
    later(async () => {
      const act = unarmed.system.activities.find((a) => a.type === "attack");
      for (let i = 0; i < strikes; i++) {
        if ((t.actor?.system?.attributes?.hp?.value ?? 0) <= 0) break;
        await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {});
      }
    }, 300);
    return;
  }
  case "stunning-strike": {
    if (pass !== "postActiveEffects" || !activity?.attack || !monkWeapon(usedItem) || usedThisTurn() || !firstCall(pass)) return;
    const focus = item("monks-focus");
    const t = hitTokens().find((x) => x.actor && x !== me && (x.actor.system.attributes.hp.value ?? 0) > 0);
    if (!t || left(focus) <= 0) return;
    // Several hits can land before the first prompt is answered: only one prompt at a time per turn.
    globalThis.cgaStunAsking ??= {};
    if (globalThis.cgaStunAsking[actor.id] === turnKey) return;
    globalThis.cgaStunAsking[actor.id] = turnKey;
    later(async () => {
      try {
        if (!(await confirm("Stunning Strike", `<p>Spend 1 Focus Point (${left(focus)} left)? <strong>${esc(t.name)}</strong> makes a CON save or is Stunned until the start of your next turn; on a success its Speed is halved and the next attack against it has Advantage.</p>`))) return;
        await spend(focus); await markUsed();
        if (await runSave("stunning-strike-save", t)) return; // Stunned comes from the save activity's effect
        await effectOn(t, "Slowed", [["system.attributes.movement.multiplier", "0.5"]], { special: ["turnStartSource"] });
        await effectOn(t, "Off Balance", [["flags.midi-qol.grants.advantage.attack.all", "1"]], { special: ["isAttacked", "turnStartSource"] });
      } finally { if (!usedThisTurn()) delete globalThis.cgaStunAsking[actor.id]; }
    });
    return;
  }
  case "hand-of-harm": {
    if (pass === "postActiveEffects" && wf?.cgaHarmPoison && firstCall("harm-poison")) {
      // Physician's Touch (Mercy 6): the target is also Poisoned until the end of your next turn.
      const t = hitTokens().find((x) => x.actor && x !== me);
      if (t) await effectOn(t, "Poisoned", [], { statuses: ["poisoned"], special: ["turnEndSource"] });
      return;
    }
    if (pass !== "DamageBonus" || !activity?.attack || !isUnarmed(usedItem) || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    const focus = item("monks-focus");
    const flurryUses = item("flurry-of-healing-and-harm");
    const free = !!flurryUses && left(flurryUses) > 0 && Date.now() - Number(actor.getFlag("world", "cgaFlurry") ?? 0) < 20000;
    if (!free && left(focus) <= 0) return;
    if (!(await confirm("Hand of Harm", `<p>${free ? "Use a free Flurry of Healing and Harm use" : `Spend 1 Focus Point (${left(focus)} left)`} for 1d${maDie()} + ${mod("wis")} extra Necrotic damage?</p>`))) return;
    await (free ? spend(flurryUses) : spend(focus)); await markUsed();
    if (lvl("monk") >= 6) wf.cgaHarmPoison = true;
    return { damageRoll: `1d${maDie()} + ${mod("wis")}`, damageType: "necrotic", flavor: "Hand of Harm" };
  }
  case "hand-of-healing": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const focus = item("monks-focus");
    const t = asTokens(wf.targets)[0] ?? me;
    if (left(focus) <= 0) return say("no Focus Points left.");
    await spend(focus);
    const roll = await new Roll(`1d${maDie()} + ${mod("wis")}`).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${feat.name}: ${esc(t.name)} regains Hit Points` });
    await MidiQOL.applyTokenDamage([{ value: roll.total, type: "healing" }], roll.total, new Set([t]), feat, new Set(), {});
    return;
  }
  case "open-hand-technique": {
    if (pass !== "postActiveEffects" || !activity?.attack || !isUnarmed(usedItem) || !firstCall(pass)) return;
    if (Date.now() - Number(actor.getFlag("world", "cgaFlurry") ?? 0) > 20000) return; // only Flurry of Blows strikes
    const t = hitTokens().find((x) => x.actor && x !== me && (x.actor.system.attributes.hp.value ?? 0) > 0);
    if (!t) return;
    later(async () => {
      const pick = await choose("Open Hand Technique", `<p>Your Flurry of Blows hits <strong>${esc(t.name)}</strong>:</p>`,
        [{ action: "addle", label: "Addle (no Opportunity Attacks)" }, { action: "push", label: "Push (STR save, 15 ft)" }, { action: "topple", label: "Topple (DEX save, Prone)", default: true }, { action: "none", label: "None" }]);
      if (pick === "addle") await effectOn(t, "Addled", [["flags.midi-qol.actions.reactionsUsed", "1", "override"], ["flags.midi-qol.actions.reaction", "true", "override"]], { special: ["turnStart"] });
      else if (pick === "push") { if (await runSave("open-hand-push", t)) await pushAway(t, 15); }
      else if (pick === "topple") { if (await runSave("open-hand-topple", t)) await MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: t.actor.uuid, statusId: "prone", options: { active: true } }); }
    });
    return;
  }

  // ======================================================================= Ranger
  case "dreadful-strikes": {
    if (pass !== "DamageBonus" || !isWeapon || !activity?.attack || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me);
    if (!t || usedThisTurn(`dreadful-${t.document.id}`)) return;
    await markUsed(`dreadful-${t.document.id}`);
    return { damageRoll: lvl("ranger") >= 11 ? "1d6" : "1d4", damageType: "psychic", flavor: "Dreadful Strikes" };
  }
  case "dread-ambusher": {
    if (pass !== "DamageBonus" || !isWeapon || !activity?.attack || left(feat) <= 0 || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    const dice = lvl("ranger") >= 11 ? "2d8" : "2d6";
    if (!(await confirm("Dreadful Strike", `<p>Deal an extra ${dice} Psychic damage (${left(feat)} uses left)?</p>`))) return;
    await spend(feat); await markUsed();
    return { damageRoll: dice, damageType: "psychic", flavor: "Dreadful Strike" };
  }
  case "hunters-prey": {
    if (pass === "postActiveEffects" && activity?.item?.id === feat.id) {
      const pick = await choose("Hunter's Prey", "<p>Which option do you use (change it after a Short or Long Rest)?</p>",
        [{ action: "colossus", label: "Colossus Slayer", default: true }, { action: "horde", label: "Horde Breaker" }]);
      if (pick) { await feat.setFlag("world", "cgaPrey", pick); say(pick === "colossus" ? "Colossus Slayer: +1d8 once per turn against a wounded creature." : "Horde Breaker: one extra attack against a different creature within 5 ft of the target, once per turn (make it yourself)."); }
      return;
    }
    if (pass !== "DamageBonus" || (feat.getFlag("world", "cgaPrey") ?? "colossus") !== "colossus" || !isWeapon || !activity?.attack || usedThisTurn() || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && (x.actor.system.attributes.hp.value ?? 0) < (x.actor.system.attributes.hp.max ?? 0));
    if (!t) return;
    await markUsed();
    return { damageRoll: "1d8", damageType: wf.defaultDamageType, flavor: "Colossus Slayer" };
  }

  // ======================================================================= Rogue
  case "sneak-attack": {
    if (pass === "DamageBonus") {
      if (!activity?.attack || usedThisTurn() || !firstCall(pass)) return;
      const blade = usedItem?.system?.identifier === "psychic-blades";
      if (!blade && !(isWeapon && (usedItem.system.properties?.has("fin") || actionType === "rwak"))) return;
      const t = hitTokens().find((x) => x.actor && x !== me);
      if (!t) return;
      const roll = wf.attackRoll;
      const adv = !!roll?.hasAdvantage, dis = !!roll?.hasDisadvantage;
      const ally = !dis && (t.document.parent?.tokens ?? []).some((o) => o.actor && o !== t.document && o !== me?.document && o.disposition === me?.document?.disposition
        && !o.actor.statuses?.has("incapacitated") && (o.actor.system.attributes.hp.value ?? 0) > 0 && MidiQOL.computeDistance?.(o.object, t) <= 5);
      if (!(adv && !dis) && !ally) return;
      let n = Math.ceil(lvl("rogue") / 2);
      if (n < 1) return;
      await markUsed();
      // Cunning Strike (Rogue 5): trade Sneak Attack dice for an effect
      const cunning = item("cunning-strike");
      if (cunning && lvl("rogue") >= 5) {
        const opts = [["trip", "Trip (1d6): DEX save or Prone", 1, largeOrSmaller(t)], ["withdraw", "Withdraw (1d6): move half Speed, no Opportunity Attacks", 1, true],
          ["poison", "Poison (1d6): CON save or Poisoned 1 minute", 1, actor.items.some((i) => /poisoner'?s kit/i.test(i.name))]];
        if (lvl("rogue") >= 14) opts.push(["daze", "Daze (2d6): CON save or only one of move/action/Bonus Action", 2, true], ["obscure", "Obscure (3d6): DEX save or Blinded", 3, true], ["knockout", "Knock Out (6d6): CON save or Unconscious", 6, true]);
        const usable = opts.filter(([, , cost, ok]) => ok && cost <= n);
        if (usable.length) {
          const pick = await choose("Cunning Strike", `<p>Sneak Attack: ${n}d6. Give up dice for a Cunning Strike?</p>`,
            [...usable.map(([k, label]) => ({ action: k, label })), { action: "none", label: `No - full ${n}d6`, default: true }]);
          const o = usable.find(([k]) => k === pick);
          if (o) { n -= o[2]; wf.cgaCunning = { key: o[0], target: t.document.uuid }; }
        }
      }
      // Assassinate (Assassin 3): extra damage equal to Rogue level in the first round
      const extra = has("assassinate") && combat?.round === 1 ? ` + ${lvl("rogue")}` : "";
      if (n <= 0 && !extra) return;
      return { damageRoll: `${Math.max(0, n)}d6${extra}`, damageType: wf.defaultDamageType, flavor: "Sneak Attack" };
    }
    if (pass === "postActiveEffects" && wf?.cgaCunning && firstCall("cunning")) {
      const { key, target } = wf.cgaCunning;
      const t = canvas.tokens.placeables.find((p) => p.document.uuid === target);
      const cunning = item("cunning-strike");
      if (!t?.actor || !cunning) return;
      later(async () => {
        if (key === "withdraw") return say("Withdraw: move up to half your Speed without provoking Opportunity Attacks.");
        if (await runSave(`cunning-${key}`, t, cunning)) say(`${esc(t.name)} fails the Cunning Strike save.`);
      });
    }
    return;
  }
  case "assassinate": {
    // Advantage against creatures that haven't taken a turn yet, in the first round of combat.
    if (pass !== "preAttackRoll" || !combat || combat.round !== 1 || !firstCall(pass)) return;
    const t = asTokens(wf?.targets)[0];
    const c = t && combat.combatants.find((x) => x.tokenId === t.document.id);
    if (!c) return;
    const order = combat.turns.map((x) => x.id);
    if (order.indexOf(c.id) <= combat.turn) return; // already acted
    wf.attackRollModifierTracker?.advantage?.add?.("assassinate", "Assassinate");
    if (!wf.attackRollModifierTracker) wf.advantage = true;
    return;
  }

  // ======================================================================= Warlock / Wizard
  case "steps-of-the-fey": {
    // Only the Misty Step activity (the hidden Taunting/Dreadful saves come back through here too).
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id || activity.type !== "utility") return;
    const options = [{ action: "plain", label: "Just teleport" }, { action: "refresh", label: "Refreshing Step (1d10 temp HP)", default: true }, { action: "taunt", label: "Taunting Step (WIS save)" }];
    if (lvl("warlock") >= 6) options.push({ action: "vanish", label: "Disappearing Step (Invisible)" }, { action: "dread", label: "Dreadful Step (WIS save, 2d10 psychic)" });
    const pick = await choose("Misty Step", "<p>You teleport up to 30 feet (move your token). Add an effect?</p>", options);
    const near = (me?.document?.parent?.tokens ?? []).filter((o) => o.actor && o !== me?.document && o.disposition !== me?.document?.disposition && MidiQOL.computeDistance?.(me, o.object) <= 5).map((o) => o.object);
    if (pick === "refresh") {
      const r = await new Roll("1d10").evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Refreshing Step: Temporary Hit Points" });
      if (Number(actor.system.attributes.hp.temp ?? 0) < r.total) await actor.update({ "system.attributes.hp.temp": r.total });
    } else if (pick === "taunt") {
      for (const t of near) if (await runSave("fey-taunt", t)) await effectOn(t, "Taunted", [["flags.midi-qol.disadvantage.attack.all", `targetActorUuid !== "${actor.uuid}"`]], { special: ["turnStartSource"] });
    } else if (pick === "vanish") {
      await effectOn(actor, "Disappearing Step", [], { statuses: ["invisible"], special: ["turnStart", "1Attack", "1Spell", "DamageDealt"] });
    } else if (pick === "dread") {
      for (const t of near) await runSave("fey-dread", t);
    }
    return;
  }
  case "portent": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const dice = feat.getFlag("world", "cgaPortent") ?? [];
    if (!dice.length) return say("no foretelling rolls left (they're rolled when you finish a Long Rest).");
    const t = asTokens(wf.targets)[0] ?? asTokens(game.user.targets)[0] ?? me;
    const pick = await choose("Portent", `<p>Replace the next d20 Test made by <strong>${esc(t.name)}</strong> (target a creature first; no target = you):</p>`,
      [...dice.map((d, i) => ({ action: String(i), label: String(d), default: i === 0 })), { action: "none", label: "Cancel" }]);
    if (pick === null || pick === "none") return;
    const v = dice[Number(pick)];
    const rest = dice.filter((_, i) => i !== Number(pick));
    await feat.setFlag("world", "cgaPortent", rest);
    const keys = ["attack.all", "ability.save.all", "ability.check.all", "skill.all"];
    await effectOn(t, `Portent (${v})`, keys.flatMap((k) => [[`flags.midi-qol.min.${k}`, `${v}`, "upgrade"], [`flags.midi-qol.max.${k}`, `${v}`, "downgrade"]]),
      { special: ["1Attack", "isSave", "isCheck", "isSkill"], seconds: 3600 });
    say(`${esc(t.name)}'s next d20 Test will be a ${v}. (${rest.length} foretelling ${rest.length === 1 ? "roll" : "rolls"} left: ${rest.join(", ") || "none"})`);
    return;
  }
}
