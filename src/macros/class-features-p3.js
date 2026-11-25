// Champions Guild Automation - priority-3 class and subclass features (2024 Player's Handbook). One macro shared by the
// P3 feature items (macroItem.system.identifier picks the part). Same helpers as class-features.js. Module rules for
// P3 live in scripts/class-rules-p3.js (initiative refills, reactions, auras, Relentless Hunter, ...).
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
async function effectOn(t, name, changes, { special = [], statuses = [], seconds = null, flags = {} } = {}) {
  const data = { name: `${feat.name}: ${name}`, img: feat.img, transfer: false, origin: feat.uuid, statuses,
    duration: seconds ? { seconds } : { value: null, units: "seconds" },
    system: { changes: changes.map(([key, value, type = "override"]) => ({ key, value, type, priority: 50, phase: "initial" })) },
    flags: { dae: { specialDuration: special, stackable: "noneName" }, ...flags } };
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
const CD_IDS = ["channel-divinity-cleric", "channel-divinity-paladin", "channel-divinity"];
const cdItem = () => CD_IDS.map(item).find((i) => left(i) > 0) ?? CD_IDS.map(item).find(Boolean);
const nearTokens = (ft, filter = () => true) => (me?.document?.parent?.tokens ?? []).filter((o) => o.actor && (o === me.document || MidiQOL.computeDistance?.(me, o.object) <= ft) && filter(o)).map((o) => o.object);
const allies = (ft) => nearTokens(ft, (o) => o.disposition === me.document.disposition);
const enemies = (ft) => nearTokens(ft, (o) => o !== me.document && o.disposition !== me.document.disposition && (o.actor.system.attributes.hp.value ?? 0) > 0);
const gmUpdate = (a, updates) => (a === actor ? actor.update(updates) : MidiQOL.socket().executeAsGM("updateActor", { actorUuid: a.uuid, updates }));
const giveTemp = async (t, n) => { if (t?.actor && Number(t.actor.system.attributes.hp.temp ?? 0) < n) await gmUpdate(t.actor, { "system.attributes.hp.temp": n }); };
const ownActivity = () => activity?.item?.id === feat.id;
const ident = activity?.midiProperties?.identifier ?? "";
const walk = () => Number(actor.system.attributes.movement.walk) || 30;
const tokenAt = (uuid) => canvas.tokens.placeables.find((p) => p.document.uuid === uuid);
const toggle = (t, statusId, active = true) => MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: t.actor.uuid, statusId, options: { active } });
const pickToken = async (title, html, list) => {
  if (!list.length) return null;
  const id = list.length === 1 ? list[0].document.id : await choose(title, html, list.map((o, i) => ({ action: o.document.id, label: o.name, default: i === 0 })));
  return list.find((o) => o.document.id === id) ?? null;
};
const SPOINTS = () => item("font-of-magic") ?? item("sorcery-points");
const dc = (abl) => 8 + mod(abl) + prof;
async function permanentChoice(flag, name, changes) {
  const old = actor.effects.filter((e) => e.flags?.world?.[flag]);
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
  const [e] = await effectOn(actor, name, changes, { flags: { world: { [flag]: true } } });
  return e;
}
async function lightUp(bright, dim, flag) {
  if (!me?.document) return;
  if (!me.document.getFlag("world", "cgaLightPrev")) await me.document.setFlag("world", "cgaLightPrev", { bright: me.document.light.bright, dim: me.document.light.dim });
  await me.document.update({ "light.bright": bright, "light.dim": dim });
}

// Activities that spend Channel Divinity (cd-*) or a Superiority Die (sup-*): checked and spent before they run.
if (pass === "preItemRoll" && ownActivity()) {
  if (ident.startsWith("cd-")) {
    const cd = cdItem();
    if (left(cd) <= 0) { ui.notifications.warn(`${feat.name}: no Channel Divinity uses left.`); return false; }
    await spend(cd);
  } else if (ident.startsWith("sup-")) {
    const sup = item("combat-superiority");
    if (left(sup) <= 0) { ui.notifications.warn(`${feat.name}: no Superiority Dice left.`); return false; }
    await spend(sup);
  }
  return;
}

switch (id) {
  // ======================================================================= Barbarian
  case "aspect-of-the-wilds": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const pick = await choose("Aspect of the Wilds", "<p>Which aspect (change it after a Long Rest)?</p>", [
      { action: "owl", label: "Owl (Darkvision 60 ft, or +60 ft)", default: true }, { action: "panther", label: "Panther (Climb Speed equal to your Speed)" }, { action: "salmon", label: "Salmon (Swim Speed equal to your Speed)" }]);
    if (!pick) return;
    const changes = pick === "owl" ? [["system.attributes.senses.ranges.darkvision", "60", "add"]] : [[`system.attributes.movement.${pick === "panther" ? "climb" : "swim"}`, String(walk()), "upgrade"]];
    await permanentChoice("cgaAspect", pick[0].toUpperCase() + pick.slice(1), changes);
    say(`the ${pick} aspect is with you until you change it.`);
    return;
  }
  case "power-of-the-wilds": {
    // Ram: melee hits knock a Large or smaller target Prone while raging with the Ram power.
    if (pass !== "postActiveEffects" || actionType !== "mwak" || !firstCall(pass)) return;
    const rage = actor.effects.find((e) => e.flags?.world?.cgaRage && !e.disabled);
    if (rage?.getFlag("world", "cgaPower") !== "ram") return;
    for (const t of hitTokens().filter((x) => x.actor && x !== me && largeOrSmaller(x))) await toggle(t, "prone");
    return;
  }

  case "rage-of-the-gods": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const old = actor.effects.filter((e) => e.flags?.world?.cgaRageOfGods);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
    await effectOn(actor, "Divine Warrior Form", [["system.attributes.movement.fly", String(walk()), "upgrade"], ["system.attributes.movement.hover", "true", "override"],
      ["system.traits.dr.value", "necrotic", "add"], ["system.traits.dr.value", "psychic", "add"], ["system.traits.dr.value", "radiant", "add"]], { seconds: 60, flags: { world: { cgaRageOfGods: true } } });
    say("for 1 minute you fly and resist Necrotic, Psychic and Radiant damage; when an ally within 30 ft drops to 0 you're offered Revivification (Reaction and a Rage use).");
    return;
  }

  // ======================================================================= Cleric
  case "improved-blessed-strikes": {
    // Potent Spellcasting: after a cantrip deals damage, a creature within 60 ft gains 2x WIS temp HP.
    if (pass !== "postActiveEffects" || usedItem?.type !== "spell" || Number(usedItem.system.level) !== 0 || !has("blessed-strikes-potent-spellcasting") || !firstCall(pass)) return;
    if (!(wf.damageRolls ?? []).some((r) => !["healing", "temphp"].includes(r.options?.type)) || !hitTokens().length && !asTokens(wf.failedSaves).length && !asTokens(wf.saves).length) return;
    const near = allies(60);
    later(async () => {
      const t = await pickToken("Improved Blessed Strikes", `<p>Give ${2 * mod("wis")} Temporary Hit Points to:</p>`, near);
      if (t) await giveTemp(t, 2 * mod("wis"));
    });
    return;
  }
  case "supreme-healing": {
    // Healing dice from your spells and Channel Divinity roll their maximum.
    if (pass !== "postDamageRoll" || !(usedItem?.type === "spell" || /channel divinity/i.test(usedItem?.name ?? "")) || !firstCall(pass)) return;
    const rolls = wf.damageRolls ?? [];
    let changed = false;
    for (let i = 0; i < rolls.length; i++) {
      if (rolls[i].options?.type !== "healing" || !rolls[i].dice?.length) continue;
      const opts = foundry.utils.deepClone(rolls[i].options ?? {});
      opts.configured = false;
      rolls[i] = await new CONFIG.Dice.DamageRoll(rolls[i].formula, rolls[i].data ?? {}, opts).evaluate({ maximize: true });
      changed = true;
    }
    if (changed) await wf.setDamageRolls(rolls);
    return;
  }
  case "corona-of-light": {
    if (pass === "postActiveEffects" && ownActivity()) { await lightUp(60, 90); say("sunlight shines from you in a 60-ft emanation (enemies in it have Disadvantage on saves against your Fire and Radiant effects) for 1 minute."); }
    return;
  }
  case "tricksters-transposition": {
    if (pass !== "postActiveEffects" || !ownActivity() || !me) return;
    const dupe = me.document.parent.tokens.find((t) => t.flags?.world?.cgaDuplicate === actor.uuid);
    if (!dupe) return say("you have no illusory duplicate to swap with.");
    const a = { x: me.document.x, y: me.document.y }, b = { x: dupe.x, y: dupe.y };
    await me.document.update(b, { animate: false, teleport: true });
    // The duplicate is a copy of your token, so you own it and can move it.
    await dupe.update(a, { animate: false, teleport: true }).catch(() => MidiQOL.socket().executeAsGM("moveToken", { tokenUuid: dupe.uuid, newCenter: { x: a.x + dupe.parent.grid.size * dupe.width / 2, y: a.y + dupe.parent.grid.size * dupe.height / 2 }, animate: false }));
    return;
  }

  // ======================================================================= Druid
  case "lunar-form": {
    if (pass !== "DamageBonus" || !actor.flags?.dnd5e?.isPolymorphed || !activity?.attack || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    await markUsed();
    return { damageRoll: "2d10", damageType: "radiant", flavor: "Lunar Form" };
  }

  // ======================================================================= Fighter
  case "studied-attacks": {
    if (pass !== "postActiveEffects" || !activity?.attack || !firstCall(pass)) return;
    const hits = new Set(hitTokens());
    const missed = asTokens(wf.targets).filter((t) => t.actor && t !== me && !hits.has(t));
    for (const t of missed) await effectOn(actor, `Studied: ${t.name}`, [["flags.midi-qol.advantage.attack.all", `targetActorUuid === "${t.actor.uuid}"`]], { special: ["1Attack"], seconds: 12 });
    return;
  }
  case "maneuver-bait-and-switch": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const t = asTokens(wf.targets).find((x) => x.actor && x !== me);
    if (!t) return say("target the willing creature within 5 ft first.");
    const r = await new Roll(`1d${supDie()}`).evaluate();
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Bait and Switch: AC bonus" });
    const who = await choose("Bait and Switch", `<p>Swap places with ${esc(t.name)} (move the tokens). Who gains +${r.total} AC until the start of your next turn?</p>`, [{ action: "me", label: "You", default: true }, { action: "them", label: t.name }]);
    await effectOn(who === "them" ? t : actor, `Bait and Switch (+${r.total} AC)`, [["system.attributes.ac.bonus", `+${r.total}`, "add"]], { special: ["turnStartSource"], seconds: 12 });
    return;
  }
  case "guarded-mind": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const ended = ["charmed", "frightened"].filter((s) => actor.statuses.has(s));
    for (const s of ended) await actor.toggleStatusEffect(s, { active: false }).catch(() => {});
    const fx = actor.effects.filter((e) => e.statuses?.has("charmed") || e.statuses?.has("frightened"));
    if (fx.length) await actor.deleteEmbeddedDocuments("ActiveEffect", fx.map((e) => e.id)).catch(() => {});
    say(ended.length || fx.length ? "the Charmed and Frightened conditions end on you." : "you aren't Charmed or Frightened.");
    return;
  }

  // ======================================================================= Monk
  case "stride-of-the-elements": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    await effectOn(actor, "Stride of the Elements", [["system.attributes.movement.fly", String(walk()), "upgrade"], ["system.attributes.movement.swim", String(walk()), "upgrade"]], { seconds: 600 });
    return;
  }
  case "elemental-epitome": {
    const TYPES = ["acid", "cold", "fire", "lightning", "thunder"];
    if (pass === "postActiveEffects" && ownActivity()) {
      const pick = await pickType(TYPES, "Elemental Epitome");
      await feat.setFlag("world", "cgaEpitome", pick);
      await permanentChoice("cgaEpitomeFx", `Resistance (${pick})`, [["system.traits.dr.value", pick, "add"]]);
      say(`Resistance to ${pick} damage; once per turn your Unarmed Strike hit adds a Martial Arts die of ${pick} damage.`);
      return;
    }
    if (pass !== "DamageBonus" || !isUnarmed(usedItem) || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
    await markUsed();
    const type = feat.getFlag("world", "cgaEpitome") ?? "force";
    return { damageRoll: `1d${maDie()}`, damageType: type, flavor: "Empowered Strikes (Elemental Epitome)" };
  }

  // ======================================================================= Paladin
  case "restoring-touch": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const t = asTokens(wf.targets)[0] ?? me;
    const conds = ["blinded", "charmed", "deafened", "frightened", "paralyzed", "stunned"].filter((s) => t.actor?.statuses?.has(s));
    if (!conds.length) return say(`${esc(t.name)} has none of the conditions Restoring Touch can end.`);
    const s = conds.length === 1 ? conds[0] : await choose("Restoring Touch", `<p>End which condition on ${esc(t.name)}?</p>`, conds.map((c, i) => ({ action: c, label: c, default: i === 0 })));
    if (s) { await toggle(t, s, false); say(`${esc(t.name)} is no longer ${s}.`); }
    return;
  }
  case "smite-of-protection": {
    if (pass !== "postActiveEffects" || !(usedItem?.system?.identifier === "divine-smite" || /divine smite/i.test(usedItem?.name ?? "")) || !firstCall(pass)) return;
    const range = lvl("paladin") >= 18 ? 30 : 10;
    for (const t of allies(range)) await effectOn(t, "Half Cover", [["system.attributes.ac.bonus", "+2", "add"], ["system.abilities.dex.bonuses.save", "+2", "add"]], { special: ["turnStartSource"], seconds: 12 });
    say(`you and your allies in your aura have Half Cover until the start of your next turn.`);
    return;
  }
  case "soul-of-vengeance": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const t = asTokens(wf.targets)[0];
    const w = actor.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.activities.some((a) => a.type === "attack" && a.actionType === "mwak"));
    if (!t || !w) return say("target the creature of your Vow of Enmity (within reach) and equip a melee weapon.");
    later(() => MidiQOL.completeActivityUse(w.system.activities.find((a) => a.type === "attack"), { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 300);
    return;
  }

  // ======================================================================= Ranger
  case "beguiling-twist": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const t = asTokens(wf.failedSaves)[0];
    if (!t) return;
    const cond = await choose("Beguiling Twist", `<p>${esc(t.name)} fails: Charmed or Frightened (1 minute, it repeats the save at the end of its turns)?</p>`, [{ action: "charmed", label: "Charmed", default: true }, { action: "frightened", label: "Frightened" }]);
    if (cond) await effectOn(t, cond === "charmed" ? "Charmed" : "Frightened", [["flags.midi-qol.OverTime", `turn=end,saveAbility=wis,saveDC=${Number(actor.system.attributes.spell?.dc ?? 10)},label=Beguiling Twist`]], { statuses: [cond], seconds: 60 });
    return;
  }
  case "stalkers-flurry": {
    if (pass !== "postActiveEffects" || !wf?.cgaFlurryOf || !firstCall(pass)) return;
    const t = tokenAt(wf.cgaFlurryOf);
    if (!t) return;
    later(async () => {
      const pick = await choose("Stalker's Flurry", "<p>Your Dreadful Strike also:</p>", [{ action: "sudden", label: "Sudden Strike (another attack against a creature within 5 ft of the target)", default: true }, { action: "fear", label: "Mass Fear (the target and creatures within 10 ft of it: WIS save or Frightened)" }]);
      if (pick === "sudden") return say(`make one more weapon attack against a different creature within 5 ft of ${esc(t.name)}.`);
      if (pick !== "fear") return;
      const victims = [t, ...canvas.tokens.placeables.filter((o) => o.actor && o !== t && o !== me && o.document.disposition !== me?.document?.disposition && MidiQOL.computeDistance?.(t, o) <= 10)];
      for (const v of victims) if (await runSave("mass-fear-save", v)) await effectOn(v, "Frightened", [], { statuses: ["frightened"], special: ["turnStartSource"], seconds: 12 });
    });
    return;
  }
  case "superior-hunters-prey": {
    if (pass !== "postActiveEffects" || !wf?.cgaMarkHit || usedThisTurn() || !firstCall(pass)) return;
    const marked = tokenAt(wf.cgaMarkHit);
    if (!marked) return;
    const near = canvas.tokens.placeables.filter((o) => o.actor && o !== marked && o !== me && o.document.disposition !== me?.document?.disposition && (o.actor.system.attributes.hp.value ?? 0) > 0 && MidiQOL.computeDistance?.(marked, o) <= 30);
    if (!near.length) return;
    await markUsed();
    later(async () => {
      const t = await pickToken("Superior Hunter's Prey", `<p>Deal the Hunter's Mark damage to another creature within 30 ft of ${esc(marked.name)}:</p>`, near);
      if (!t) return;
      const r = await new Roll(has("foe-slayer") ? "1d10" : "1d6").evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Superior Hunter's Prey: ${esc(t.name)}` });
      await MidiQOL.applyTokenDamage([{ value: r.total, type: "force" }], r.total, new Set([t]), feat, new Set(), {});
    });
    return;
  }

  // ======================================================================= Rogue
  case "magical-ambush": {
    // Casting while Invisible: the spell's targets have Disadvantage on their saves against it.
    if (pass !== "preambleComplete" || usedItem?.type !== "spell" || !actor.statuses?.has("invisible") || !firstCall(pass)) return;
    for (const t of asTokens(wf.targets).filter((x) => x.actor && x !== me))
      await effectOn(t, "Magical Ambush", [["flags.midi-qol.disadvantage.save.all", "1"]], { special: ["isSave"], seconds: 6 });
    return;
  }
  case "envenom-weapons": {
    if (pass !== "postActiveEffects" || !firstCall(pass)) return;
    const c = [wf?.cgaCunning, wf?.cgaCunning2].find((x) => x?.key === "poison");
    const t = c && tokenAt(c.target);
    if (!t) return;
    const r = await new Roll("2d6").evaluate();
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Envenom Weapons: ${esc(t.name)}` });
    await MidiQOL.applyTokenDamage([{ value: r.total, type: "poison" }], r.total, new Set([t]), feat, new Set(), {});
    return;
  }
  case "death-strike": {
    if (pass !== "postActiveEffects" || !wf?.cgaSneak || combat?.round !== 1 || !firstCall(pass)) return;
    const t = tokenAt(wf.cgaSneak);
    if (!t?.actor) return;
    const dealt = [...(wf.damageRolls ?? []), ...(wf.bonusDamageRolls ?? [])].reduce((s, r) => s + Number(r.total ?? 0), 0);
    later(async () => {
      if (!(await runSave("death-strike-save", t))) return say(`${esc(t.name)} resists the Death Strike.`);
      await MidiQOL.applyTokenDamage([{ value: dealt, type: wf.defaultDamageType ?? "piercing" }], dealt, new Set([t]), feat, new Set(), {});
      say(`Death Strike: ${esc(t.name)} takes the damage again (${dealt}).`);
    });
    return;
  }
  case "rend-mind": {
    if (pass !== "postActiveEffects" || !wf?.cgaSneak || usedItem?.system?.identifier !== "psychic-blades" || !firstCall(pass)) return;
    const t = tokenAt(wf.cgaSneak);
    const psi = item("psionic-power");
    const free = left(feat) > 0;
    if (!t?.actor || (!free && left(psi) < 3)) return;
    later(async () => {
      if (!(await confirm("Rend Mind", `<p>${free ? "Use Rend Mind (once per Long Rest)" : `Spend 3 Psionic Energy Dice (${left(psi)} left)`}? ${esc(t.name)} makes a WIS save or is Stunned for 1 minute.</p>`))) return;
      await (free ? spend(feat) : spend(psi, 3));
      if (await runSave("rend-mind-save", t)) await effectOn(t, "Stunned", [["flags.midi-qol.OverTime", `turn=end,saveAbility=wis,saveDC=${dc("dex")},label=Rend Mind`]], { statuses: ["stunned"], seconds: 60 });
    });
    return;
  }

  // ======================================================================= Sorcerer
  case "revelation-in-flesh": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const pts = SPOINTS();
    const opts = [["aqua", "Aquatic adaptation: Swim Speed twice your Speed, breathe water"], ["fly", "Glistening flight: Fly Speed equal to your Speed (hover)"], ["eyes", "See the invisible (within 60 ft)"], ["squeeze", "Wormlike movement: squeeze through 1-inch spaces"]];
    const picked = await foundry.applications.api.DialogV2.wait({ window: { title: "Revelation in Flesh" },
      content: `<p>Spend 1 Sorcery Point per benefit (${left(pts)} left), for 10 minutes:</p>${opts.map(([k, l]) => `<div class="form-group"><label><input type="checkbox" name="${k}"> ${l}</label></div>`).join("")}`,
      buttons: [{ action: "ok", label: "Transform", default: true, callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object }], rejectClose: false }).catch(() => null);
    const keys = Object.entries(picked ?? {}).filter(([, v]) => v).map(([k]) => k).slice(0, left(pts));
    if (!keys.length) return;
    await spend(pts, keys.length);
    const changes = [];
    if (keys.includes("aqua")) changes.push(["system.attributes.movement.swim", String(2 * walk()), "upgrade"]);
    if (keys.includes("fly")) changes.push(["system.attributes.movement.fly", String(walk()), "upgrade"], ["system.attributes.movement.hover", "true", "override"]);
    if (keys.includes("eyes")) changes.push(["system.attributes.senses.ranges.truesight", "60", "upgrade"]);
    await effectOn(actor, `Revelation in Flesh (${keys.join(", ")})`, changes, { seconds: 600 });
    return;
  }
  case "bend-luck": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const t = asTokens(wf.targets)[0] ?? asTokens(game.user.targets)[0];
    if (!t) return say("target the creature first.");
    const pick = await choose("Bend Luck", `<p>${esc(t.name)}'s next D20 Test:</p>`, [{ action: "add", label: "Add 1d4 (it chooses when)", default: t.document.disposition === me?.document?.disposition }, { action: "sub", label: "Subtract 1d4" }]);
    if (pick === "add") await effectOn(t, "Bend Luck (+1d4)", [["flags.midi-qol.optional.cgaBend.label", "Bend Luck: add 1d4"], ["flags.midi-qol.optional.cgaBend.attack.all", "1d4"], ["flags.midi-qol.optional.cgaBend.save.all", "1d4"], ["flags.midi-qol.optional.cgaBend.check.all", "1d4"], ["flags.midi-qol.optional.cgaBend.skill.all", "1d4"], ["flags.midi-qol.optional.cgaBend.count", "1"]], { seconds: 12 });
    else if (pick === "sub") await effectOn(t, "Bend Luck (-1d4)", [["system.bonuses.mwak.attack", "-1d4", "add"], ["system.bonuses.rwak.attack", "-1d4", "add"], ["system.bonuses.msak.attack", "-1d4", "add"], ["system.bonuses.rsak.attack", "-1d4", "add"],
      ["system.bonuses.abilities.save", "-1d4", "add"], ["system.bonuses.abilities.check", "-1d4", "add"], ["system.bonuses.abilities.skill", "-1d4", "add"]], { special: ["1Attack", "isSave", "isCheck", "isSkill"], seconds: 12 });
    return;
  }

  // ======================================================================= Warlock
  case "clairvoyant-combatant": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    for (const t of asTokens(wf.failedSaves).filter((x) => x !== me))
      await effectOn(t, "Clairvoyant Combatant", [["flags.midi-qol.disadvantage.attack.all", `targetActorUuid === "${actor.uuid}"`], ["flags.midi-qol.grants.advantage.attack.all", `workflow?.actor?.uuid === "${actor.uuid}"`]], { seconds: 60 });
    return;
  }

  // ======================================================================= Wizard
  case "the-third-eye": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const pick = await choose("The Third Eye", "<p>Which benefit until your next Short or Long Rest?</p>", [
      { action: "dark", label: "Darkvision 120 ft", default: true }, { action: "lang", label: "Greater Comprehension (read any language)" }, { action: "see", label: "See Invisibility" }]);
    if (!pick) return;
    const changes = pick === "dark" ? [["system.attributes.senses.ranges.darkvision", "120", "upgrade"]] : pick === "see" ? [["system.attributes.senses.special", "See Invisibility", "override"]] : [];
    const old = actor.effects.filter((e) => e.flags?.world?.cgaThirdEye);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
    await effectOn(actor, { dark: "Darkvision 120 ft", lang: "Greater Comprehension", see: "See Invisibility" }[pick], changes, { special: ["shortRest", "longRest"], flags: { world: { cgaThirdEye: true } } });
    return;
  }
  case "overchannel": {
    if (pass === "postActiveEffects" && ownActivity()) {
      await feat.setFlag("world", "cgaOverchannel", true);
      return say("your next level 1-5 Wizard spell that deals damage deals maximum damage.");
    }
    if (pass !== "postDamageRoll" || usedItem?.type !== "spell" || !feat.getFlag("world", "cgaOverchannel") || !firstCall(pass)) return;
    const slot = Number(wf.castData?.castLevel ?? 0);
    if (slot < 1 || slot > 5) return;
    const rolls = wf.damageRolls ?? [];
    if (!rolls.some((r) => !["healing", "temphp"].includes(r.options?.type))) return;
    for (let i = 0; i < rolls.length; i++) {
      const opts = foundry.utils.deepClone(rolls[i].options ?? {}); opts.configured = false;
      rolls[i] = await new CONFIG.Dice.DamageRoll(rolls[i].formula, rolls[i].data ?? {}, opts).evaluate({ maximize: true });
    }
    await wf.setDamageRolls(rolls);
    await feat.unsetFlag("world", "cgaOverchannel");
    // Second and later uses before a Long Rest: 2d12 Necrotic per slot level (+1d12 per level each time after).
    const uses = Number(feat.getFlag("world", "cgaOverchannelUses") ?? 0);
    await feat.setFlag("world", "cgaOverchannelUses", uses + 1);
    if (uses > 0) {
      const r = await new Roll(`${(1 + uses) * slot}d12`).evaluate();
      later(async () => {
        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Overchannel: Necrotic damage to you (it ignores Resistance and Immunity)" });
        await actor.update({ "system.attributes.hp.value": Math.max(0, Number(actor.system.attributes.hp.value) - r.total) });
      });
    }
    return;
  }
}
