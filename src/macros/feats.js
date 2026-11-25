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
// Heavy Armor Master, Mage Slayer's Concentration Breaker and Alert's Initiative Swap are module rules in main.js.
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

switch (id) {
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
