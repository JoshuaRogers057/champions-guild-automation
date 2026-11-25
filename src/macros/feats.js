// Champions Guild Automation - feats (2024 Player's Handbook). One macro shared by every feat item; it does the part
// for the feat it runs from (macroItem.system.identifier). Each feat's passive (transfer) effect sets
// flags.midi-qol.onUseMacroName = "ItemMacro,<pass>" for the passes it needs:
//   savage-attacker        postDamageRoll   once per turn on a weapon hit, roll the weapon's damage again, keep the higher
//   great-weapon-fighting  postDamageRoll   1s and 2s on the damage dice count as 3s (two-handed melee weapon attacks)
//   healer                 postDamageRoll   reroll 1s on the healing dice of your spells (Healing Rerolls)
//                          item macro       Battle Medic activity
//   great-weapon-master    damageBonus      +Proficiency Bonus damage with Heavy weapons on your turn
//                          postActiveEffects  Hew: after a melee crit or dropping a creature to 0 HP, offer a Bonus Action attack
//   dueling                damageBonus      +2 damage with a one-handed melee weapon and no other weapon
//   two-weapon-fighting    damageBonus      add the ability modifier back to the off-hand attack's damage
//   sentinel               postActiveEffects  Halt: an Opportunity Attack that hits drops the target's Speed to 0 this turn
//   tavern-brawler, unarmed-fighting  postDamageRoll  bigger Unarmed Strike die (+ Tavern Brawler's push prompt)
//   charger                damageBonus      +1d8 or push 10 ft after moving 10+ ft this turn
//   crusher / slasher      postActiveEffects  push prompt / Speed -10 ft, plus their critical-hit effects
//   piercer                postDamageRoll   reroll the lowest piercing die, extra die on a crit
//   shield-master          postActiveEffects  Shield Bash (hidden "shield-bash" save activity)
//   grappler               postActiveEffects  Punch and Grab (hidden "punch-and-grab" save activity)
//   thrown-weapon-fighting damageBonus      +2 on thrown ranged attacks
//   elemental-adept        postDamageRoll   1s count as 2s; item macro "Choose Damage Type"
//   durable / musician / telekinetic       item macros for their activities
//   poisoner               postActiveEffects  a coated weapon's next hit runs the hidden "poisoner-dose" save
//   boon-of-irresistible-offense damageBonus  natural 20: + the higher of STR/DEX score
//   boon-of-speed / boon-of-energy-resistance item macros (Escape Artist; choose types / Energy Redirection)
// Heavy Armor Master, Mage Slayer's Concentration Breaker, Alert's Initiative Swap, Interception, Protection and
// Lucky's saving-throw prompt are module rules in main.js.
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

// Creatures the attack hit (midi's "Auto check hits: none" leaves hitTargets empty, so compare the roll to AC then).
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
const turnKey = combat ? `${combat.id}.${combat.round}.${combat.turn}` : null;
const isMyTurn = () => !combat || combat.combatant?.actorId === actor.id || combat.combatant?.actor === actor;
// Once-per-turn benefits: remembered per feat on the actor (outside combat there's no limit).
const usedThisTurn = () => !!turnKey && actor.getFlag("world", `cgaFeatTurn.${id}`) === turnKey;
const markUsed = async () => { if (turnKey) await actor.setFlag("world", `cgaFeatTurn.${id}`, turnKey).catch(() => {}); };
// The same feat owned twice (or called once per damage part) acts once per workflow.
function firstCall(tag) {
  if (!wf) return true;
  wf.cgaFeatCalls ??= new Set();
  const key = `${id}|${tag}`;
  if (wf.cgaFeatCalls.has(key)) return false;
  wf.cgaFeatCalls.add(key);
  return true;
}
const DieTerm = foundry.dice?.terms?.Die ?? Die;
const dieTerms = (roll) => roll.terms.filter((t) => t instanceof DieTerm);
const retotal = (roll) => { roll._total = roll._evaluateTotal(); return roll; };
// Great Weapon Fighting: does it apply to this attack?
const gwfApplies = (a = actor) => actionType === "mwak" && isWeapon
  && a.items.some((i) => i.system?.identifier === "great-weapon-fighting")
  && (usedItem.system.properties?.has("two") || (usedItem.system.properties?.has("ver") && wf?.attackMode === "twoHanded"));
function applyMin3(roll) {
  let changed = 0;
  for (const t of dieTerms(roll)) for (const r of t.results) if (r.active !== false && !r.discarded && r.result < 3) { r.result = 3; changed++; }
  if (changed) retotal(roll);
  return changed;
}

// ---- helpers for the priority-2 feats
const me = token ?? MidiQOL.tokenForActor?.(actor);
const sizeRank = (a) => Number(CONFIG.DND5E.actorSizes?.[a?.system?.traits?.size]?.numerical ?? 2);
const notTooBig = (t, larger = 1) => sizeRank(t.actor) - sizeRank(actor) <= larger;
const dmgTypes = () => new Set((wf?.damageRolls ?? []).map((r) => r.options?.type ?? r.options?.types?.[0]).filter(Boolean));
const isUnarmed = (it) => it?.system?.identifier === "unarmed-strike" || /unarmed strike/i.test(it?.name ?? "");
const holdsWeaponOrShield = (a = actor) => a.items.some((i) => i.system?.equipped && ((i.type === "weapon" && !["natural", "siege"].includes(i.system.type?.value) && !isUnarmed(i))
  || (i.type === "equipment" && i.system.type?.value === "shield")));
const hasShield = (a = actor) => a.items.some((i) => i.type === "equipment" && i.system.equipped && i.system.type?.value === "shield");
const confirm = (title, html) => foundry.applications.api.DialogV2.confirm({ window: { title: `${feat.name}: ${title}` }, content: html, rejectClose: false });
const choose = (title, html, buttons) => foundry.applications.api.DialogV2.wait({ window: { title: `${feat.name}: ${title}` }, content: html, buttons, rejectClose: false }).catch(() => null);
const later = (fn, ms = 400) => setTimeout(() => fn().catch((err) => console.warn(`${feat.name} |`, err)), ms);
async function pushAway(t, feet) {
  if (!me || !t) return;
  await MidiQOL.moveTokenAwayFromPoint(t, feet, me.center, { animate: false, autoRotate: false });
}
async function pullToward(t, feet) {
  if (!me || !t) return;
  const gs = canvas.grid.size; const steps = Math.floor(feet / (canvas.scene.grid.distance || 5));
  const box = (tk, x = tk.document.x, y = tk.document.y) => ({ cx: x + tk.w / 2, cy: y + tk.h / 2, w: tk.w, h: tk.h });
  const gap = (a, b) => Math.max(Math.max(0, Math.abs(a.cx - b.cx) - (a.w + b.w) / 2), Math.max(0, Math.abs(a.cy - b.cy) - (a.h + b.h) / 2)) / gs;
  let x = t.document.x, y = t.document.y;
  for (let i = 0; i < steps; i++) {
    const b = box(t, x, y), c = box(me);
    if (gap(b, c) < 1) break;
    const dx = c.cx - b.cx, dy = c.cy - b.cy;
    x += Math.abs(dx) > gs / 2 ? Math.sign(dx) * gs : 0;
    y += Math.abs(dy) > gs / 2 ? Math.sign(dy) * gs : 0;
  }
  if (x !== t.document.x || y !== t.document.y) await MidiQOL.moveToken(t.document, { x: x + t.w / 2, y: y + t.h / 2 }, { teleport: true, autoRotate: false });
}
async function effectOn(t, name, changes, { special = [], expiry = null, statuses = [] } = {}) {
  const data = { name: `${feat.name}: ${name}`, img: feat.img, transfer: false, origin: feat.uuid, statuses,
    duration: { value: null, units: "seconds", expiry }, system: { changes: changes.map(([key, value, type = "override"]) => ({ key, value, type, priority: 50, phase: "initial" })) },
    flags: { dae: { specialDuration: special, stackable: "noneName" } } };
  return MidiQOL.socket().executeAsGM("createEffects", { actorUuid: t.actor.uuid, effects: [data] });
}
const setStatus = (t, statusId) => MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: t.actor.uuid, statusId, options: { active: true } });
// Run one of the feat's hidden save activities at a creature; true when it failed the save.
async function failsSave(identifier, t) {
  const act = feat.system.activities.find((a) => a.midiProperties?.identifier === identifier);
  if (!act) return false;
  const w = await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } },
    consume: { resources: false, spellSlot: false }, create: { measuredTemplate: false } }, { configure: false }, {});
  return !!w && Array.from(w.failedSaves ?? []).some((x) => (x.document ?? x) === t.document);
}
// Spend one of a creature's own Hit Point Dice and heal the roll (Durable). Returns the roll or null.
async function spendOwnHitDie(extra = "") {
  const cls = actor.items.filter((i) => i.type === "class" && (i.system.hd?.value ?? 0) > 0)
    .sort((a, b) => Number(String(b.system.hd.denomination).slice(1)) - Number(String(a.system.hd.denomination).slice(1)))[0];
  const npcHd = actor.type === "npc" && (actor.system.attributes.hd?.value ?? 0) > 0;
  if (!cls && !npcHd) return null;
  const den = cls ? cls.system.hd.denomination : (actor.system.attributes.hd.denomination ?? "d8");
  const roll = await new Roll(`1${den}${extra}`).evaluate();
  if (cls) await cls.update({ "system.hd.spent": Number(cls.system.hd.spent ?? 0) + 1 });
  else await actor.update({ "system.attributes.hd.spent": Number(actor.system.attributes.hd.spent ?? 0) + 1 });
  return roll;
}
// How far this token has moved this combat turn (the core movement history is cleared each turn).
function movedThisTurn() {
  if (!combat || !me?.document) return null;
  const hist = me.document.movementHistory ?? [];
  if (hist.length < 1) return 0;
  try { return canvas.grid.measurePath([...hist, { x: me.document.x, y: me.document.y }]).distance; } catch (err) { return null; }
}

switch (id) {
  // ---------------------------------------------------------------- Tavern Brawler / Unarmed Fighting
  case "tavern-brawler":
  case "unarmed-fighting": {
    if (!isUnarmed(usedItem) || !activity?.attack) return;
    const tb = actor.items.some((i) => i.system?.identifier === "tavern-brawler");
    const uf = actor.items.some((i) => i.system?.identifier === "unarmed-fighting");
    if (pass === "postDamageRoll") {
      // Both feats run this; the first call builds the Unarmed Strike damage for both.
      if (wf.cgaUnarmedDone) return;
      wf.cgaUnarmedDone = true;
      const rolls = wf.damageRolls ?? [];
      if (!rolls.length) return;
      const faces = uf ? (holdsWeaponOrShield() ? 6 : 8) : 4;
      const current = Math.max(0, ...dieTerms(rolls[0]).map((t) => t.faces));
      if (current > faces) return; // e.g. a Monk's Martial Arts die is already bigger
      const mod = Number(actor.system.abilities.str?.mod ?? 0);
      const opts = foundry.utils.deepClone(rolls[0].options ?? {});
      opts.configured = false; opts.type = "bludgeoning"; opts.types = ["bludgeoning"]; opts.isCritical = !!wf.isCritical;
      const roll = await new CONFIG.Dice.DamageRoll(`1d${faces}${tb ? "r1" : ""} + ${mod}`, actor.getRollData(), opts).evaluate();
      rolls[0] = roll;
      await wf.setDamageRolls(rolls);
      return;
    }
    if (pass === "postActiveEffects" && id === "tavern-brawler") {
      // Push: once per turn, an Unarmed Strike hit during the Attack action on your turn can also push 5 ft.
      if (!combat || !isMyTurn() || usedThisTurn() || !firstCall(pass)) return;
      const t = hitTokens().find((x) => x.actor && x !== me);
      if (!t) return;
      later(async () => {
        if (!(await confirm("Push", `<p>Also push <strong>${esc(t.name)}</strong> 5 feet away from you?</p>`))) return;
        await markUsed(); await pushAway(t, 5);
      });
    }
    return;
  }

  // ---------------------------------------------------------------- Charger
  case "charger": {
    if (pass !== "DamageBonus" || !activity?.attack || !["mwak", "msak"].includes(actionType) || !isMyTurn() || usedThisTurn() || !firstCall(pass)) return;
    const t = hitTokens()[0];
    if (!t) return;
    const moved = movedThisTurn();
    if (moved !== null && moved < 10) return;
    const canPush = notTooBig(t);
    const buttons = [{ action: "d8", label: "+1d8 damage", default: true }];
    if (canPush) buttons.push({ action: "push", label: "Push 10 ft" });
    buttons.push({ action: "no", label: "No" });
    const pick = await choose("Charge Attack", `<p>Did you move at least 10 feet in a straight line toward <strong>${esc(t.name)}</strong> right before this hit?${moved !== null ? ` (You moved ${moved} ft this turn.)` : ""}</p>`, buttons);
    if (!pick || pick === "no") return;
    await markUsed();
    if (pick === "push") { later(() => pushAway(t, 10), 800); return; }
    return { damageRoll: "1d8", damageType: wf.defaultDamageType, flavor: "Charger" };
  }

  // ---------------------------------------------------------------- Crusher / Slasher / Piercer
  case "crusher": {
    if (pass !== "postActiveEffects" || !activity?.attack || !dmgTypes().has("bludgeoning") || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me);
    if (!t) return;
    if (wf.isCritical) await effectOn(t, "Enhanced Critical (attacks have Advantage)", [["flags.midi-qol.grants.advantage.attack.all", "1"]], { special: ["turnStartSource"] });
    if (usedThisTurn() || !notTooBig(t)) return;
    later(async () => {
      if (!(await confirm("Push", `<p>Move <strong>${esc(t.name)}</strong> 5 feet away from you?</p>`))) return;
      await markUsed(); await pushAway(t, 5);
    });
    return;
  }
  case "slasher": {
    if (pass !== "postActiveEffects" || !activity?.attack || !dmgTypes().has("slashing") || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me && (x.actor.system.attributes.hp.value ?? 0) > 0);
    if (!t) return;
    if (!usedThisTurn()) {
      await markUsed();
      await effectOn(t, "Hamstring (Speed -10 ft)", [["system.attributes.movement.walk", "-10", "add"]], { special: ["turnStartSource"] });
    }
    if (wf.isCritical) await effectOn(t, "Enhanced Critical (Disadvantage on attacks)", [["flags.midi-qol.disadvantage.attack.all", "1"]], { special: ["turnStartSource"] });
    return;
  }
  case "piercer": {
    if (pass !== "postDamageRoll" || !activity?.attack || !hitTokens().length || !firstCall(pass)) return;
    const rolls = wf.damageRolls ?? [];
    const piercing = rolls.filter((r) => (r.options?.type ?? r.options?.types?.[0]) === "piercing");
    if (!piercing.length) return;
    let changed = false;
    const notes = [];
    if (!usedThisTurn()) {
      // Puncture: reroll the lowest piercing die if it rolled below average.
      let low = null;
      for (const r of piercing) for (const t of dieTerms(r)) for (const res of t.results) {
        if (res.active === false || res.discarded) continue;
        if (!low || res.result / t.faces < low.res.result / low.t.faces) low = { r, t, res };
      }
      if (low && low.res.result < (low.t.faces + 1) / 2) {
        const was = low.res.result;
        low.res.result = Math.ceil(CONFIG.Dice.randomUniform() * low.t.faces);
        retotal(low.r); changed = true; await markUsed();
        notes.push(`rerolled a ${was} on a d${low.t.faces} (now ${low.res.result})`);
      }
    }
    if (wf.isCritical) {
      const faces = Math.max(0, ...piercing.flatMap((r) => dieTerms(r).map((t) => t.faces)));
      if (faces) {
        const extra = await new CONFIG.Dice.DamageRoll(`1d${faces}`, {}, { type: "piercing", types: ["piercing"] }).evaluate();
        rolls.push(extra); changed = true; notes.push(`adds an extra d${faces} for the critical hit (${extra.total})`);
      }
    }
    if (changed) { await wf.setDamageRolls(rolls); say(notes.join("; ") + "."); }
    return;
  }

  // ---------------------------------------------------------------- Shield Master
  case "shield-master": {
    if (pass !== "postActiveEffects" || !isWeapon || actionType !== "mwak" || !hasShield() || !isMyTurn() || usedThisTurn() || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me && (x.actor.system.attributes.hp.value ?? 0) > 0);
    if (!t || (me && MidiQOL.computeDistance?.(me, t) > 5)) return;
    later(async () => {
      const pick = await choose("Shield Bash", `<p>Bash <strong>${esc(t.name)}</strong> with your Shield? It makes a Strength saving throw or is pushed 5 feet or knocked Prone (your choice).</p>`,
        [{ action: "push", label: "Push 5 ft", default: true }, { action: "prone", label: "Knock Prone" }, { action: "no", label: "No" }]);
      if (!pick || pick === "no") return;
      await markUsed();
      if (!(await failsSave("shield-bash", t))) return;
      if (pick === "push") await pushAway(t, 5); else await setStatus(t, "prone");
    });
    return;
  }

  // ---------------------------------------------------------------- Grappler
  case "grappler": {
    // Punch and Grab: once per turn, an Unarmed Strike hit during the Attack action on your turn can also grapple.
    if (pass !== "postActiveEffects" || !isUnarmed(usedItem) || !activity?.attack || !isMyTurn() || usedThisTurn() || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me && (x.actor.system.attributes.hp.value ?? 0) > 0);
    if (!t || !notTooBig(t)) return;
    later(async () => {
      if (!(await confirm("Punch and Grab", `<p>Also try to grapple <strong>${esc(t.name)}</strong>? It makes a Strength or Dexterity saving throw.</p>`))) return;
      await markUsed();
      if (!(await failsSave("punch-and-grab", t))) return;
      await effectOn(t, `Grappled by ${actor.name}`, [], { statuses: ["grappled"] });
      say(`${esc(t.name)} is Grappled.`);
    });
    return;
  }

  // ---------------------------------------------------------------- Thrown Weapon Fighting
  case "thrown-weapon-fighting": {
    if (pass !== "DamageBonus" || !isWeapon || !usedItem.system.properties?.has("thr")) return;
    if (actionType !== "rwak" && !String(wf.attackMode ?? "").startsWith("thrown")) return;
    if (!hitTokens().length || !firstCall(pass)) return;
    return { damageRoll: "2", damageType: wf.defaultDamageType, flavor: "Thrown Weapon Fighting" };
  }

  // ---------------------------------------------------------------- Elemental Adept
  case "elemental-adept": {
    const type = feat.getFlag("world", "cgaElementalType");
    if (pass === "postActiveEffects" && activity?.item?.id === feat.id) {
      // "Choose Damage Type" activity: switch on that type's effect.
      const pick = await choose("Energy Mastery", "<p>Which damage type do your spells master?</p>",
        ["acid", "cold", "fire", "lightning", "thunder"].map((d, i) => ({ action: d, label: CONFIG.DND5E.damageTypes[d]?.label ?? d, default: d === (type ?? "fire") })));
      if (!pick) return;
      await feat.setFlag("world", "cgaElementalType", pick);
      await feat.updateEmbeddedDocuments("ActiveEffect", feat.effects.filter((e) => e.flags?.world?.cgaElementalType)
        .map((e) => ({ _id: e.id, disabled: e.flags.world.cgaElementalType !== pick })));
      say(`your spells now ignore Resistance to ${pick} damage and treat 1s on its damage dice as 2s.`);
      return;
    }
    if (pass !== "postDamageRoll" || usedItem?.type !== "spell" || !type || !firstCall(pass)) return;
    const rolls = wf.damageRolls ?? [];
    let changed = 0;
    for (const r of rolls) {
      if ((r.options?.type ?? r.options?.types?.[0]) !== type) continue;
      let c = 0;
      for (const t of dieTerms(r)) for (const res of t.results) if (res.active !== false && !res.discarded && res.result === 1) { res.result = 2; c++; }
      if (c) { retotal(r); changed += c; }
    }
    if (changed) await wf.setDamageRolls(rolls);
    return;
  }

  // ---------------------------------------------------------------- Durable / Musician / Telekinetic (activities)
  case "durable": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const roll = await spendOwnHitDie();
    if (!roll) return say("you have no Hit Point Dice left to spend.");
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${feat.name}: Speedy Recovery - spends a Hit Die and regains Hit Points` });
    if (me) await MidiQOL.applyTokenDamage([{ value: roll.total, type: "healing" }], roll.total, new Set([me]), feat, new Set(), {});
    return;
  }
  case "musician": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const prof = Number(actor.system.attributes.prof ?? 0);
    const allies = asTokens(wf.targets).filter((t) => t.actor && t.actor !== actor).slice(0, prof);
    if (!allies.length) return ui.notifications.warn(`${feat.name}: target the allies who hear your song (up to ${prof}).`);
    for (const t of allies) {
      try { await MidiQOL.socket().executeAsGM("updateActor", { actorUuid: t.actor.uuid, updates: { "system.attributes.inspiration": true } }); }
      catch (err) { console.warn(`${feat.name} | couldn't give Heroic Inspiration`, err); }
    }
    say(`${allies.map((t) => esc(t.name)).join(", ")} ${allies.length === 1 ? "gains" : "gain"} Heroic Inspiration.`);
    return;
  }
  case "telekinetic": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id || activity?.type !== "save") return;
    const failed = asTokens(wf.failedSaves).filter((t) => t !== me);
    for (const t of failed) {
      const pick = await choose("Telekinetic Shove", `<p>Move <strong>${esc(t.name)}</strong> 5 feet:</p>`,
        [{ action: "away", label: "Away from you", default: true }, { action: "toward", label: "Toward you" }, { action: "no", label: "Leave it" }]);
      if (pick === "away") await pushAway(t, 5);
      else if (pick === "toward") await pullToward(t, 5);
    }
    return;
  }

  // ---------------------------------------------------------------- Poisoner
  case "poisoner": {
    // A coated weapon: the self effect from Apply Poison. The next weapon hit that deals damage runs the dose's save.
    if (pass !== "postActiveEffects" || !isWeapon || !activity?.attack || !firstCall(pass)) return;
    const coat = actor.effects.find((e) => e.flags?.world?.cgaPoisonCoat && !e.disabled);
    const t = hitTokens().find((x) => x.actor && x !== me);
    if (!coat || !t || !(wf.damageTotal > 0 || (wf.damageRolls ?? []).length)) return;
    try { await coat.delete(); } catch (err) { /* already gone */ }
    later(async () => { await failsSave("poisoner-dose", t); }, 300);
    return;
  }

  // ---------------------------------------------------------------- Epic Boons
  case "boon-of-irresistible-offense": {
    if (pass !== "DamageBonus" || !activity?.attack || !firstCall(pass)) return;
    const natural = wf.attackRoll?.dice?.[0]?.results?.find((r) => r.active !== false && !r.discarded)?.result ?? wf.diceRoll;
    if (natural !== 20 || !hitTokens().length) return;
    const score = Math.max(Number(actor.system.abilities.str?.value ?? 0), Number(actor.system.abilities.dex?.value ?? 0));
    return { damageRoll: `${score}`, damageType: wf.defaultDamageType, flavor: "Overwhelming Strike" };
  }
  case "boon-of-speed": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const grapples = actor.effects.filter((e) => e.statuses?.has("grappled"));
    if (grapples.length) await actor.deleteEmbeddedDocuments("ActiveEffect", grapples.map((e) => e.id)).catch(() => {});
    say(`takes the Disengage action${grapples.length ? " and breaks free of the grapple" : ""}.`);
    return;
  }
  case "boon-of-energy-resistance": {
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    const TYPES = ["acid", "cold", "fire", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];
    const chosen = feat.getFlag("world", "cgaEnergyTypes") ?? [];
    if (activity.midiProperties?.identifier === "choose-resistances") {
      const boxes = TYPES.map((d) => `<label style="display:inline-block;width:32%"><input type="checkbox" name="${d}" ${chosen.includes(d) ? "checked" : ""}> ${CONFIG.DND5E.damageTypes[d]?.label ?? d}</label>`).join("");
      const picked = await foundry.applications.api.DialogV2.prompt({ window: { title: `${feat.name}: Energy Resistances` },
        content: `<p>Pick two damage types to resist (you can change them after a Long Rest):</p><div>${boxes}</div>`,
        ok: { label: "Save", callback: (ev, btn) => TYPES.filter((d) => btn.form.elements[d]?.checked) }, rejectClose: false }).catch(() => null);
      if (!picked) return;
      const two = picked.slice(0, 2);
      await feat.setFlag("world", "cgaEnergyTypes", two);
      const eff = feat.effects.find((e) => e.flags?.world?.cgaEnergyResist);
      if (eff) await eff.update({ "system.changes": two.map((d) => ({ key: "system.traits.dr.value", value: d, type: "add", priority: 20, phase: "initial" })) });
      say(`resists ${two.join(" and ") || "nothing yet"}.`);
      return;
    }
    // Energy Redirection (Reaction): pick which of your types to send back, then the target makes the DEX save.
    // (The hidden "redirect-<type>" saves come back through here too; ignore them.)
    if (activity.midiProperties?.identifier !== "energy-redirection") return;
    const t = asTokens(wf.targets).find((x) => x.actor && x !== me);
    if (!t || !chosen.length) return ui.notifications.warn(`${feat.name}: choose your resistances first, and target the creature.`);
    const type = chosen.length === 1 ? chosen[0] : await choose("Energy Redirection", `<p>Which damage type do you redirect at <strong>${esc(t.name)}</strong>?</p>`,
      chosen.map((d, i) => ({ action: d, label: CONFIG.DND5E.damageTypes[d]?.label ?? d, default: i === 0 })));
    if (type) await failsSave(`redirect-${type}`, t);
    return;
  }

  // ---------------------------------------------------------------- Savage Attacker
  case "savage-attacker": {
    if (pass !== "postDamageRoll" || !isWeapon || !activity?.attack || !firstCall(pass)) return;
    if (!hitTokens().length || usedThisTurn()) return;
    const rolls = wf.damageRolls ?? [];
    if (!rolls.length) return;
    const first = rolls[0];
    const again = await first.clone().evaluate();
    if (gwfApplies()) applyMin3(again);
    try { if (game.dice3d) await game.dice3d.showForRoll(again, game.user, true); } catch (err) { /* cosmetic */ }
    await markUsed();
    const keep = again.total > first.total;
    if (keep) { rolls[0] = again; await wf.setDamageRolls(rolls); }
    say(`rolled the weapon's damage twice (${first.total} and ${again.total}) and keeps ${Math.max(first.total, again.total)}.`);
    return;
  }

  // ---------------------------------------------------------------- Great Weapon Fighting
  case "great-weapon-fighting": {
    if (pass !== "postDamageRoll" || !gwfApplies() || !firstCall(pass)) return;
    const rolls = wf.damageRolls ?? [];
    let changed = 0;
    for (const r of rolls) changed += applyMin3(r);
    if (changed) await wf.setDamageRolls(rolls);
    return;
  }

  // ---------------------------------------------------------------- Healer
  case "healer": {
    if (pass === "postDamageRoll") {
      // Healing Rerolls: a 1 on a healing die of your own spell is rerolled once (Battle Medic rolls with r1 itself).
      if (usedItem?.type !== "spell" || !firstCall(pass)) return;
      const rolls = wf.damageRolls ?? [];
      let changed = 0;
      for (const roll of rolls) {
        const type = roll.options?.type ?? roll.options?.types?.[0];
        if (type !== "healing" && type !== "temphp") continue;
        for (const t of dieTerms(roll)) for (const r of t.results) {
          if (r.active === false || r.discarded || r.result !== 1) continue;
          r.result = Math.ceil(CONFIG.Dice.randomUniform() * t.faces);
          changed++;
        }
        if (changed) retotal(roll);
      }
      if (changed) { await wf.setDamageRolls(rolls); say(`rerolled ${changed} healing ${changed === 1 ? "die" : "dice"} that came up 1.`); }
      return;
    }
    if (pass !== "postActiveEffects" || activity?.item?.id !== feat.id) return;
    // Battle Medic: spend a Healer's Kit use; the target spends a Hit Die, you roll it (rerolling a 1) + your PB.
    const target = asTokens(wf.targets)[0];
    if (!target?.actor) return ui.notifications.warn(`${feat.name}: target the creature you're tending to first.`);
    const kit = actor.items.find((i) => i.system?.identifier === "healers-kit" || /healer'?s kit/i.test(i.name));
    const kitLeft = kit ? (kit.system.uses?.max ? Number(kit.system.uses.value ?? 0) : Number(kit.system.quantity ?? 0)) : 0;
    if (!kit || kitLeft <= 0) return say(`you need a Healer's Kit with a use left.`);
    const ta = target.actor;
    let den = null; let spend = null;
    const classes = ta.items.filter((i) => i.type === "class" && (i.system.hd?.value ?? (i.system.levels - (i.system.hd?.spent ?? 0))) > 0);
    if (classes.length) {
      const best = classes.sort((a, b) => Number(String(b.system.hd.denomination).slice(1)) - Number(String(a.system.hd.denomination).slice(1)))[0];
      den = best.system.hd.denomination;
      spend = { kind: "class", item: best };
    } else if (ta.type === "npc" && (ta.system.attributes.hd?.value ?? 0) > 0) {
      den = ta.system.attributes.hd.denomination ?? "d8";
      spend = { kind: "npc" };
    }
    if (!den) return say(`${esc(target.name)} has no Hit Point Dice left to spend.`);
    const prof = Number(actor.system.attributes.prof ?? 0);
    const roll = await new Roll(`1${den}r1 + ${prof}`).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${feat.name}: Battle Medic - ${esc(target.name)} spends a Hit Die (${den}) and regains Hit Points` });
    await MidiQOL.applyTokenDamage([{ value: roll.total, type: "healing" }], roll.total, new Set([target]), feat, new Set(), {});
    // Pay the costs: the kit use, then the target's Hit Die.
    try {
      if (kit.system.uses?.max) await kit.update({ "system.uses.spent": Number(kit.system.uses.spent ?? 0) + 1 });
      else await kit.update({ "system.quantity": Math.max(0, Number(kit.system.quantity ?? 1) - 1) });
    } catch (err) { console.warn(`${feat.name} | couldn't use up the Healer's Kit`, err); }
    const hdUpdate = spend.kind === "class"
      ? () => MidiQOL.socket().executeAsGM("updateItems", { actorUuid: ta.uuid, updates: [{ _id: spend.item.id, "system.hd.spent": Number(spend.item.system.hd.spent ?? 0) + 1 }] })
      : () => MidiQOL.socket().executeAsGM("updateActor", { actorUuid: ta.uuid, updates: { "system.attributes.hd.spent": Number(ta.system.attributes.hd.spent ?? 0) + 1 } });
    try { await hdUpdate(); } catch (err) { console.warn(`${feat.name} | couldn't spend the Hit Die`, err); }
    return;
  }

  // ---------------------------------------------------------------- Great Weapon Master
  case "great-weapon-master": {
    if (pass === "DamageBonus") {
      if (!isWeapon || !activity?.attack || !usedItem.system.properties?.has("hvy") || !isMyTurn()) return;
      if (!hitTokens().length || !firstCall(pass)) return;
      const prof = Number(actor.system.attributes.prof ?? 0);
      return { damageRoll: `${prof}`, damageType: wf.defaultDamageType, flavor: "Great Weapon Master" };
    }
    if (pass !== "postActiveEffects" || !isWeapon || actionType !== "mwak" || !firstCall(pass)) return;
    const hits = hitTokens();
    const dropped = hits.some((t) => (t.actor?.system?.attributes?.hp?.value ?? 1) <= 0);
    if (!hits.length || !(wf.isCritical || dropped)) return;
    if (combat && (MidiQOL.hasUsedBonusAction?.(actor) || usedThisTurn())) return;
    const why = wf.isCritical ? "scored a Critical Hit" : "dropped a creature to 0 Hit Points";
    const again = activity;
    setTimeout(async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: `${feat.name}: Hew` },
        content: `<p>You ${why} with <strong>${esc(usedItem.name)}</strong>. Make one attack with it as a Bonus Action?</p><p><em>Target the creature first.</em></p>`,
        rejectClose: false
      });
      if (!ok) return;
      await markUsed();
      try { await MidiQOL.setBonusActionUsed?.(actor); } catch (err) { /* action tracking off */ }
      try { await again.use(); } catch (err) { console.warn(`${feat.name} | Hew attack failed`, err); }
    }, 400);
    return;
  }

  // ---------------------------------------------------------------- Dueling
  case "dueling": {
    if (pass !== "DamageBonus" || !isWeapon || actionType !== "mwak" || !activity?.attack) return;
    if (usedItem.system.properties?.has("two") || wf.attackMode === "twoHanded" || String(wf.attackMode ?? "").endsWith("offhand")) return;
    const others = actor.items.filter((i) => i.type === "weapon" && i.id !== usedItem.id && i.system.equipped
      && !["natural", "siege"].includes(i.system.type?.value) && i.system.identifier !== "unarmed-strike" && !/unarmed/i.test(i.name));
    if (others.length || !hitTokens().length || !firstCall(pass)) return;
    return { damageRoll: "2", damageType: wf.defaultDamageType, flavor: "Dueling" };
  }

  // ---------------------------------------------------------------- Two-Weapon Fighting
  case "two-weapon-fighting": {
    if (pass !== "DamageBonus" || !isWeapon || !String(wf.attackMode ?? "").endsWith("offhand")) return;
    const ability = activity?.ability ?? usedItem.system.abilityMod;
    const mod = Number(actor.system.abilities?.[ability]?.mod ?? 0);
    if (mod <= 0 || !hitTokens().length || !firstCall(pass)) return;
    return { damageRoll: `${mod}`, damageType: wf.defaultDamageType, flavor: "Two-Weapon Fighting" };
  }

  // ---------------------------------------------------------------- Sentinel
  case "sentinel": {
    // An attack you make on someone else's turn is almost always an Opportunity Attack; ask before applying Halt.
    if (pass !== "postActiveEffects" || !combat || isMyTurn() || !activity?.attack || actionType !== "mwak" || !firstCall(pass)) return;
    const target = hitTokens().find((t) => (t.actor?.system?.attributes?.hp?.value ?? 0) > 0);
    if (!target) return;
    setTimeout(async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: `${feat.name}: Halt` },
        content: `<p>Was this an <strong>Opportunity Attack</strong>? If so, <strong>${esc(target.name)}</strong>'s Speed becomes 0 for the rest of this turn.</p>`,
        rejectClose: false
      });
      if (!ok) return;
      const effect = {
        name: `${feat.name}: Halted`, img: feat.img, transfer: false, origin: feat.uuid,
        duration: { value: null, units: "seconds", expiry: "turnEnd" },
        system: { changes: [{ key: "system.attributes.movement.multiplier", value: "0", type: "override", priority: 50, phase: "initial" }] },
        flags: { dae: { specialDuration: ["turnEnd"], stackable: "noneName" } }
      };
      try { await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: target.actor.uuid, effects: [effect] }); }
      catch (err) { console.warn(`${feat.name} | Halt failed`, err); }
      say(`${esc(target.name)}'s Speed is 0 for the rest of this turn.`);
    }, 300);
    return;
  }
}
