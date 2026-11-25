// Champions Guild Automation - priority-2 class and subclass features (2024 Player's Handbook). One macro shared by the
// P2 feature items (macroItem.system.identifier picks the part). Same helpers as class-features.js. Module rules for
// P2 live in scripts/class-rules-p2.js (Relentless Rage, World Tree, Guided Strike, Countercharm, wards, ...).
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
const alive = (t) => (t?.actor?.system?.attributes?.hp?.value ?? 0) > 0;
const CD_IDS = ["channel-divinity-cleric", "channel-divinity-paladin", "channel-divinity"];
const cdItem = () => CD_IDS.map(item).find((i) => left(i) > 0) ?? CD_IDS.map(item).find(Boolean);
const nearTokens = (ft, filter = () => true) => (me?.document?.parent?.tokens ?? []).filter((o) => o.actor && (o === me.document || MidiQOL.computeDistance?.(me, o.object) <= ft) && filter(o)).map((o) => o.object);
const allies = (ft) => nearTokens(ft, (o) => o.disposition === me.document.disposition);
const gmUpdate = (a, updates) => (a === actor ? actor.update(updates) : MidiQOL.socket().executeAsGM("updateActor", { actorUuid: a.uuid, updates }));
const giveTemp = async (t, n) => { if (t?.actor && Number(t.actor.system.attributes.hp.temp ?? 0) < n) await gmUpdate(t.actor, { "system.attributes.hp.temp": n }); };
const setType = async (type, keep = (r) => !["healing", "temphp"].includes(r.options?.type)) => {
  const rolls = wf.damageRolls ?? [];
  for (const r of rolls) if (keep(r)) { r.options.type = type; r.options.types = [type]; }
  await wf.setDamageRolls(rolls);
};
const speed0 = ["walk", "fly", "swim", "climb", "burrow"].map((m) => [`system.attributes.movement.${m}`, "0", "override"]);
const ownActivity = () => activity?.item?.id === feat.id;
const ident = activity?.midiProperties?.identifier ?? "";

// Activities that spend Channel Divinity or a Superiority Die: checked and spent before the activity runs.
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
  case "brutal-strike": {
    if (pass === "preAttackRoll") {
      if (!combat || !isMyTurn() || attackAbility() !== "str" || !rageOn() || usedThisTurn() || !firstCall(pass)) return;
      if (!actor.effects.some((e) => /Reckless/.test(e.name) && !e.disabled)) return;
      const dice = lvl("barbarian") >= 17 ? "2d10" : "1d10";
      if (!(await confirm("Brutal Strike?", `<p>Give up Advantage on this attack? If it hits, it deals an extra ${dice} and a Brutal Strike effect.</p>`))) return;
      await markUsed();
      if (wf.attackRollModifierTracker?.disadvantage?.add) wf.attackRollModifierTracker.disadvantage.add("brutal-strike", "Brutal Strike (no Advantage)");
      wf.cgaBrutal = true;
      return;
    }
    if (pass === "DamageBonus" && wf?.cgaBrutal && firstCall(pass)) {
      const t = hitTokens().find((x) => x.actor && x !== me);
      if (!t) return;
      const opts = [["forceful", "Forceful Blow: push 15 ft (you can move half your Speed toward it)"], ["hamstring", "Hamstring Blow: its Speed drops 15 ft"]];
      if (lvl("barbarian") >= 13) opts.push(["staggering", "Staggering Blow: Disadvantage on its next save, no Opportunity Attacks"], ["sundering", "Sundering Blow: +5 to the next attack against it"]);
      const pick = await choose("Brutal Strike", `<p>You hit <strong>${esc(t.name)}</strong>. Pick the effect:</p>`, opts.map(([k, l], i) => ({ action: k, label: l, default: i === 0 })));
      wf.cgaBrutalPick = { key: pick ?? "forceful", keys: [pick ?? "forceful"], target: t.document.uuid };
      // Improved Brutal Strike (17): two different effects
      if (lvl("barbarian") >= 17) {
        const rest = opts.filter(([k]) => k !== wf.cgaBrutalPick.key);
        const pick2 = await choose("Brutal Strike", "<p>Pick a second, different effect:</p>", rest.map(([k, l], i) => ({ action: k, label: l, default: i === 0 })));
        if (pick2) wf.cgaBrutalPick.keys.push(pick2);
      }
      return { damageRoll: lvl("barbarian") >= 17 ? "2d10" : "1d10", damageType: wf.defaultDamageType, flavor: "Brutal Strike" };
    }
    if (pass === "postActiveEffects" && wf?.cgaBrutalPick && firstCall("brutal-effect")) {
      const { keys, target } = wf.cgaBrutalPick;
      const t = canvas.tokens.placeables.find((p) => p.document.uuid === target);
      if (!t?.actor) return;
      for (const key of keys) {
      if (key === "forceful") await pushAway(t, 15);
      else if (key === "hamstring") await effectOn(t, "Hamstrung", [["system.attributes.movement.walk", "-15", "add"]], { special: ["turnStartSource"], seconds: 12 });
      else if (key === "staggering") await effectOn(t, "Staggered", [["flags.midi-qol.disadvantage.save.all", "1"], ["flags.midi-qol.actions.reactionsUsed", "1"], ["flags.midi-qol.actions.reaction", "true"]], { special: ["turnStartSource"], seconds: 12 });
      else if (key === "sundering") await effectOn(t, "Sundered", [["flags.midi-qol.grants.attack.bonus.all", "5", "add"]], { special: ["isAttacked", "turnStartSource"], seconds: 12 });
      }
    }
    return;
  }
  case "retaliation": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const t = asTokens(wf.targets)[0];
    const w = actor.items.find((i) => i.type === "weapon" && (i.system.equipped || isUnarmed(i)) && i.system.activities.some((a) => a.type === "attack" && a.actionType === "mwak"));
    if (!t || !w) return say("no melee weapon or attacker to strike back at.");
    later(() => MidiQOL.completeActivityUse(w.system.activities.find((a) => a.type === "attack"),
      { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } } }, { configure: false }, {}), 300);
    return;
  }
  case "zealous-presence": {
    if (pass === "postActiveEffects" && ownActivity() && ident === "zealous-recharge") { await feat.update({ "system.uses.spent": 0 }); say("you spend a Rage use to restore Zealous Presence."); }
    return;
  }

  // ======================================================================= Bard
  case "dazzling-footwork": {
    if (pass !== "postDamageRoll" || !activity?.attack || !isUnarmed(usedItem) || !firstCall(pass)) return;
    if (actor.system.attributes.ac?.equippedArmor || actor.system.attributes.ac?.equippedShield) return;
    if (has("martial-arts") && maDie() >= bardDie()) return;
    const rolls = wf.damageRolls ?? [];
    if (!rolls.length) return;
    const opts = foundry.utils.deepClone(rolls[0].options ?? {});
    opts.configured = false; opts.isCritical = !!wf.isCritical;
    rolls[0] = await new CONFIG.Dice.DamageRoll(`1d${bardDie()} + ${Math.max(mod("dex"), mod("str"))}`, actor.getRollData(), opts).evaluate();
    await wf.setDamageRolls(rolls);
    return;
  }
  case "beguiling-magic": {
    if (pass !== "postActiveEffects" || usedItem?.type !== "spell" || !["enc", "ill"].includes(usedItem.system.school) || Number(wf.castData?.castLevel ?? 0) < 1 || !firstCall(pass)) return;
    const insp = item("bardic-inspiration");
    const free = left(feat) > 0;
    if (!free && left(insp) <= 0) return;
    const cands = nearTokens(60, (o) => o !== me?.document && o.disposition !== me?.document?.disposition && (o.actor.system.attributes.hp.value ?? 0) > 0);
    if (!cands.length) return;
    later(async () => {
      const pick = await choose("Beguiling Magic", `<p>${free ? "Use Beguiling Magic (once per Long Rest)" : `Spend a Bardic Inspiration (${left(insp)} left)`}? A creature within 60 ft makes a WIS save or is Charmed or Frightened by you for 1 minute.</p>`,
        [...cands.map((o, i) => ({ action: o.document.id, label: o.name, default: i === 0 })), { action: "none", label: "Not now" }]);
      const o = cands.find((x) => x.document.id === pick);
      if (!o) return;
      const cond = await choose("Beguiling Magic", "<p>Charmed or Frightened?</p>", [{ action: "charmed", label: "Charmed", default: true }, { action: "frightened", label: "Frightened" }]);
      if (!cond) return;
      await (free ? spend(feat) : spend(insp));
      if (!(await runSave("beguiling-save", o))) return say(`${esc(o.name)} resists.`);
      const dc = Number(actor.system.attributes.spell?.dc ?? 10);
      await effectOn(o, cond === "charmed" ? "Charmed" : "Frightened", [["flags.midi-qol.OverTime", `turn=end,saveAbility=wis,saveDC=${dc},label=Beguiling Magic`]], { statuses: [cond], seconds: 60 });
    });
    return;
  }
  case "mantle-of-inspiration": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const ts = asTokens(wf.targets).filter((x) => x.actor).slice(0, Math.max(1, mod("cha")));
    if (!ts.length) return say("target up to your Charisma modifier in creatures first.");
    const r = await new Roll(`1d${bardDie()}`).evaluate();
    const temp = 2 * r.total;
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Mantle of Inspiration: ${temp} Temporary Hit Points each` });
    for (const t of ts) await giveTemp(t, temp);
    say("each of them can use its Reaction to move up to its Speed without provoking Opportunity Attacks.");
    return;
  }

  // ======================================================================= Cleric
  case "sear-undead": {
    if (pass !== "postActiveEffects" || !/turn undead/i.test(activity?.name ?? "") || !firstCall(pass)) return;
    const undead = asTokens(wf.failedSaves).filter((t) => t.actor?.system?.details?.type?.value === "undead");
    const n = Math.max(1, mod("wis"));
    for (const t of undead) {
      const r = await new Roll(`${n}d8`).evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Sear Undead: ${esc(t.name)}` });
      await MidiQOL.applyTokenDamage([{ value: r.total, type: "radiant" }], r.total, new Set([t]), feat, new Set(), {});
    }
    return;
  }
  case "radiance-of-the-dawn": {
    if (pass === "postActiveEffects" && ownActivity()) say("any magical Darkness within 30 ft is dispelled.");
    return;
  }
  case "improved-warding-flare": {
    if (pass !== "postActiveEffects" || usedItem?.system?.identifier !== "warding-flare" || !firstCall(pass)) return;
    const near = allies(30);
    if (!near.length) return;
    later(async () => {
      const pick = near.length === 1 ? near[0].document.id : await choose("Improved Warding Flare", "<p>Who was protected by the flare?</p>", near.map((o, i) => ({ action: o.document.id, label: o.name, default: i === 0 })));
      const t = near.find((o) => o.document.id === pick);
      if (!t) return;
      const r = await new Roll(`2d6 + ${mod("wis")}`).evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Improved Warding Flare: ${esc(t.name)} gains Temporary Hit Points` });
      await giveTemp(t, r.total);
    });
    return;
  }
  case "invoke-duplicity": {
    if (pass === "postActiveEffects" && ownActivity() && me) {
      const scene = me.document.parent;
      const old = scene.tokens.filter((t) => t.flags?.world?.cgaDuplicate === actor.uuid);
      if (old.length) await MidiQOL.socket().executeAsGM("deleteToken", { tokenUuid: old[0].uuid }).catch(() => {});
      const data = me.document.toObject();
      delete data._id;
      Object.assign(data, { name: `${me.name} (Illusion)`, x: me.document.x + scene.grid.size * me.document.width, actorLink: false, alpha: 0.75,
        flags: { ...(data.flags ?? {}), world: { ...(data.flags?.world ?? {}), cgaDuplicate: actor.uuid } } });
      await game.modules.get("champions-guild-automation")?.api?.createTokens(scene, [data]);
      say("an illusory duplicate appears (move it up to 30 ft as a Bonus Action). You can cast spells as though you were in its space, and you have Advantage on attacks against a creature when you and the illusion are both within 5 ft of it.");
      return;
    }
    if (pass === "preAttackRoll" && me && firstCall(pass)) {
      const dupe = me.document.parent.tokens.find((t) => t.flags?.world?.cgaDuplicate === actor.uuid)?.object;
      const t = asTokens(wf.targets)[0];
      if (!dupe || !t || MidiQOL.computeDistance?.(dupe, t) > 5 || MidiQOL.computeDistance?.(me, t) > 5) return;
      if (wf.attackRollModifierTracker?.advantage?.add) wf.attackRollModifierTracker.advantage.add("invoke-duplicity", "Invoke Duplicity");
      else wf.advantage = true;
    }
    return;
  }

  // ======================================================================= Druid
  case "circle-of-the-land-spells": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const LAND = {
      arid: { label: "Arid", spells: [[3, ["phbsplBlur000000", "phbsplBurningHan", "phbsplFireBolt00"]], [5, ["phbsplFireball00"]], [7, ["phbsplBlight0000"]], [9, ["phbsplWallofSton"]]] },
      polar: { label: "Polar", spells: [[3, ["phbsplFogCloud00", "phbsplHoldPerson", "phbsplRayofFrost"]], [5, ["phbsplSleetStorm"]], [7, ["phbsplIceStorm00"]], [9, ["phbsplConeofCold"]]] },
      temperate: { label: "Temperate", spells: [[3, ["phbsplMistyStep0", "phbsplShockingGr", "phbsplSleep00000"]], [5, ["phbsplLightningB"]], [7, ["phbsplFreedomofM"]], [9, ["phbsplTreeStride"]]] },
      tropical: { label: "Tropical", spells: [[3, ["phbsplAcidSplash", "phbsplRayofSickn", "phbsplWeb0000000"]], [5, ["phbsplStinkingCl"]], [7, ["phbsplPolymorph0"]], [9, ["phbsplInsectPlag"]]] }
    };
    const pick = await choose("Circle of the Land", "<p>Which land do you draw on until your next Long Rest?</p>", Object.entries(LAND).map(([k, v], i) => ({ action: k, label: v.label, default: i === 0 })));
    if (!pick) return;
    const old = actor.items.filter((i) => i.flags?.world?.cgaLandSpell);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((i) => i.id));
    const ids = LAND[pick].spells.filter(([l]) => l <= lvl("druid")).flatMap(([, s]) => s);
    const data = [];
    for (const sid of ids) {
      const doc = await fromUuid(`Compendium.dnd5e.spells24.Item.${sid}`);
      if (!doc || actor.items.some((i) => i.type === "spell" && i.name === doc.name && !i.flags?.world?.cgaLandSpell)) continue;
      const d = doc.toObject();
      d.system.prepared = 2; d.system.sourceClass = "druid";
      d.flags = { ...(d.flags ?? {}), world: { cgaLandSpell: pick } };
      data.push(d);
    }
    if (data.length) await actor.createEmbeddedDocuments("Item", data);
    await feat.setFlag("world", "cgaLand", pick);
    say(`${LAND[pick].label} land: ${data.map((d) => d.name).join(", ") || "no new spells"} prepared (always).`);
    return;
  }
  case "improved-circle-forms": {
    // Only runs in Wild Shape (the module adds this pass to the beast form).
    if (pass !== "postDamageRoll" || !actor.flags?.dnd5e?.isPolymorphed || !activity?.attack || usedItem?.type === "spell" || !firstCall(pass)) return;
    let pref = actor.getFlag("world", "cgaLunar");
    if (pref === undefined) {
      pref = !!(await confirm("Lunar Radiance", "<p>Should your attacks in this form deal Radiant damage instead of their normal type? (Asked once per form.)</p>"));
      await actor.setFlag("world", "cgaLunar", pref);
    }
    if (pref) await setType("radiant");
    return;
  }
  case "cosmic-omen": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    let kind = feat.getFlag("world", "cgaOmen");
    if (!kind) kind = await choose("Cosmic Omen", "<p>Your omen hasn't been rolled since your last Long Rest. Which is it?</p>", [{ action: "weal", label: "Weal (even)", default: true }, { action: "woe", label: "Woe (odd)" }]);
    const t = asTokens(wf.targets)[0] ?? asTokens(game.user.targets)[0];
    if (!kind || !t) return say("target a creature within 30 ft first.");
    if (kind === "weal") {
      await effectOn(t, "Weal", [["flags.midi-qol.optional.cgaOmen.label", "Cosmic Omen (Weal): add 1d6"], ["flags.midi-qol.optional.cgaOmen.attack.all", "1d6"], ["flags.midi-qol.optional.cgaOmen.save.all", "1d6"],
        ["flags.midi-qol.optional.cgaOmen.check.all", "1d6"], ["flags.midi-qol.optional.cgaOmen.skill.all", "1d6"], ["flags.midi-qol.optional.cgaOmen.count", "1"]], { seconds: 60 });
      say(`${esc(t.name)} can add 1d6 to its next D20 Test (within the next minute).`);
    } else {
      const minus = [["system.bonuses.mwak.attack", "-1d6", "add"], ["system.bonuses.rwak.attack", "-1d6", "add"], ["system.bonuses.msak.attack", "-1d6", "add"], ["system.bonuses.rsak.attack", "-1d6", "add"],
        ["system.bonuses.abilities.save", "-1d6", "add"], ["system.bonuses.abilities.check", "-1d6", "add"], ["system.bonuses.abilities.skill", "-1d6", "add"]];
      await effectOn(t, "Woe", minus, { special: ["1Attack", "isSave", "isCheck", "isSkill"], seconds: 12 });
      say(`${esc(t.name)} subtracts 1d6 from its next D20 Test.`);
    }
    return;
  }

  // ======================================================================= Fighter
  case "eldritch-strike": {
    if (pass !== "postActiveEffects" || !isWeapon || !activity?.attack || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me);
    if (!t) return;
    await effectOn(t, "Eldritch Strike", [["flags.midi-qol.disadvantage.save.all", `workflow?.actor?.uuid === "${actor.uuid}" && workflow?.item?.type === "spell"`]], { special: ["isSave"], seconds: 12 });
    return;
  }
  case "telekinetic-adept": {
    if (pass === "postActiveEffects" && ownActivity()) {
      if (!firstCall("leap")) return;
      const fly = 2 * (Number(actor.system.attributes.movement.walk) || 30);
      await effectOn(actor, "Psi-Powered Leap", [["system.attributes.movement.fly", String(fly), "upgrade"]], { special: ["turnEnd"], seconds: 6 });
      say(`you gain a ${fly}-ft Fly Speed until the end of the turn.`);
      return;
    }
    if (pass === "postActiveEffects" && wf?.cgaPsiStrike && lvl("fighter") >= 7 && firstCall("thrust")) {
      const t = canvas.tokens.placeables.find((p) => p.document.uuid === wf.cgaPsiStrike);
      if (!t?.actor) return;
      later(async () => {
        if (!(await runSave("telekinetic-thrust", t))) return say(`${esc(t.name)} resists the Telekinetic Thrust.`);
        const pick = await choose("Telekinetic Thrust", `<p>${esc(t.name)} fails the STR save:</p>`, [{ action: "prone", label: "Knock it Prone", default: true }, { action: "push", label: "Move it up to 10 ft" }]);
        if (pick === "prone") await MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: t.actor.uuid, statusId: "prone", options: { active: true } });
        else if (pick === "push") await pushAway(t, 10);
      });
    }
    return;
  }
  case "maneuver-commanders-strike":
  case "maneuver-evasive-footwork":
  case "maneuver-feinting-attack":
  case "maneuver-lunging-attack":
  case "maneuver-rally": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const die = supDie();
    const t = asTokens(wf.targets).find((x) => x.actor) ?? null;
    const dmg = (d) => [["system.bonuses.mwak.damage", `+1d${d}`, "add"], ["system.bonuses.rwak.damage", `+1d${d}`, "add"]];
    if (id === "maneuver-commanders-strike") {
      if (!t) return say("target the ally first.");
      await effectOn(t, `Commander's Strike (+1d${die})`, dmg(die), { special: ["1Attack"], seconds: 6 });
      say(`${esc(t.name)} can use its Reaction to make one weapon attack (+1d${die} damage).`);
    } else if (id === "maneuver-evasive-footwork") {
      const r = await new Roll(`1d${die}`).evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Evasive Footwork: AC bonus" });
      await effectOn(actor, `Evasive Footwork (+${r.total} AC)`, [["system.attributes.ac.bonus", `+${r.total}`, "add"]], { special: ["turnStart"], seconds: 12 });
      say("you take the Disengage action.");
    } else if (id === "maneuver-feinting-attack") {
      if (!t) return say("target the creature within 5 ft first.");
      await effectOn(actor, `Feinting Attack (+1d${die})`, [["flags.midi-qol.advantage.attack.all", `targetActorUuid === "${t.actor.uuid}"`], ...dmg(die)], { special: ["1Attack", "turnEnd"], seconds: 6 });
    } else if (id === "maneuver-lunging-attack") {
      await effectOn(actor, `Lunging Attack (+1d${die})`, [["system.bonuses.mwak.damage", `+1d${die}`, "add"]], { special: ["1Attack", "turnEnd"], seconds: 6 });
      say("you take the Dash action; your next melee hit this turn adds the die (move at least 5 ft straight toward the target first).");
    } else if (id === "maneuver-rally") {
      if (!t) return say("target the ally first.");
      const r = await new Roll(`1d${die} + ${Math.floor(lvl("fighter") / 2)}`).evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Rally: ${esc(t.name)} gains Temporary Hit Points` });
      await giveTemp(t, r.total);
    }
    return;
  }

  // ======================================================================= Monk
  case "empowered-strikes": {
    if (pass === "postActiveEffects" && ownActivity()) {
      const on = feat.getFlag("world", "cgaForce") === false;
      await feat.setFlag("world", "cgaForce", on);
      say(on ? "your Unarmed Strikes deal Force damage." : "your Unarmed Strikes deal their normal damage type.");
      return;
    }
    // With Martial Arts the Force type is set there (it rebuilds the Unarmed Strike roll); this covers the rest.
    if (pass !== "postDamageRoll" || !isUnarmed(usedItem) || has("martial-arts") || feat.getFlag("world", "cgaForce") === false || !firstCall(pass)) return;
    await setType("force");
    return;
  }
  case "elemental-burst": {
    if (pass !== "postDamageRoll" || !ownActivity() || !firstCall(pass)) return;
    const type = await pickType(["acid", "cold", "fire", "lightning", "thunder"], "Elemental Burst");
    const rolls = wf.damageRolls ?? [];
    const opts = foundry.utils.deepClone(rolls[0]?.options ?? {});
    Object.assign(opts, { type, types: [type], configured: false });
    rolls[0] = await new CONFIG.Dice.DamageRoll(`3d${maDie()}`, {}, opts).evaluate();
    await wf.setDamageRolls(rolls);
    return;
  }

  // ======================================================================= Paladin
  case "inspiring-smite": {
    if (pass !== "postActiveEffects" || !(usedItem?.system?.identifier === "divine-smite" || /divine smite/i.test(usedItem?.name ?? "")) || !firstCall(pass)) return;
    const cd = cdItem();
    if (left(cd) <= 0) return;
    later(async () => {
      if (!(await confirm("Inspiring Smite", `<p>Spend Channel Divinity (${left(cd)} left) to share 2d8 + ${lvl("paladin")} Temporary Hit Points among creatures within 30 ft?</p>`))) return;
      await spend(cd);
      const r = await new Roll(`2d8 + ${lvl("paladin")}`).evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Inspiring Smite" });
      const near = allies(30);
      const share = await foundry.applications.api.DialogV2.wait({ window: { title: `Inspiring Smite: share ${r.total}` },
        content: `<p>Split ${r.total} Temporary Hit Points:</p>${near.map((o, i) => `<div class="form-group"><label>${esc(o.name)}</label><input type="number" name="${o.document.id}" value="${i === 0 ? r.total : 0}" min="0"></div>`).join("")}`,
        buttons: [{ action: "ok", label: "Give", default: true, callback: (e, b) => new foundry.applications.ux.FormDataExtended(b.form).object }], rejectClose: false }).catch(() => null);
      let pool = r.total;
      for (const o of near) {
        const n = Math.min(pool, Math.max(0, Number(share?.[o.document.id] ?? 0)));
        if (!n) continue;
        pool -= n;
        await giveTemp(o, n);
      }
    });
    return;
  }
  case "natures-wrath": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const dc = Number(actor.system.attributes.spell?.dc ?? 10);
    for (const t of asTokens(wf.failedSaves).filter((x) => x !== me))
      await effectOn(t, "Restrained", [["flags.midi-qol.OverTime", `turn=end,saveAbility=str,saveDC=${dc},label=Nature's Wrath`]], { statuses: ["restrained"], seconds: 60 });
    return;
  }
  case "relentless-avenger": {
    if (pass !== "postActiveEffects" || !wf?.AoO || actionType !== "mwak" || !firstCall(pass)) return;
    const t = hitTokens().find((x) => x.actor && x !== me);
    if (!t) return;
    await effectOn(t, "Speed 0", speed0, { special: ["turnEnd"], seconds: 6 });
    say(`${esc(t.name)}'s Speed is 0 for the rest of the turn; you can move up to half your Speed as part of this Reaction without provoking Opportunity Attacks.`);
    return;
  }

  // ======================================================================= Ranger
  case "defensive-tactics": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const pick = await choose("Defensive Tactics", "<p>Which option (change it after a Short or Long Rest)?</p>",
      [{ action: "horde", label: "Escape the Horde (Opportunity Attacks against you have Disadvantage)", default: true }, { action: "multiattack", label: "Multiattack Defense (after a creature hits you, its other attacks against you this turn have Disadvantage)" }]);
    if (!pick) return;
    await feat.setFlag("world", "cgaTactic", pick);
    const old = actor.effects.filter((e) => e.flags?.world?.cgaEscapeHorde);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
    if (pick === "horde") { const [e] = await effectOn(actor, "Escape the Horde", [["flags.midi-qol.grants.disadvantage.attack.all", "workflow?.AoO"]]); if (e) await e.setFlag("world", "cgaEscapeHorde", true); }
    say(pick === "horde" ? "Escape the Horde: Opportunity Attacks against you have Disadvantage." : "Multiattack Defense: after a creature hits you, its other attacks against you this turn have Disadvantage.");
    return;
  }

  // ======================================================================= Rogue
  case "soul-blades": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const r = await new Roll(`1d${psiDie()}`).evaluate();
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Psychic Teleportation" });
    say(`you teleport up to ${r.total * 10} ft to an unoccupied space you can see (move your token).`);
    return;
  }

  // ======================================================================= Sorcerer
  case "bastion-of-law": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const pts = item("font-of-magic") ?? item("sorcery-points");
    const max = Math.min(5, left(pts));
    const t = asTokens(wf.targets)[0] ?? me;
    if (max <= 0) return say("no Sorcery Points left.");
    const n = Number(await choose("Bastion of Law", `<p>Spend how many Sorcery Points (${left(pts)} left)? ${esc(t.name)} gets that many d8s of ward.</p>`,
      Array.from({ length: max }, (_, i) => ({ action: String(i + 1), label: String(i + 1), default: i === 0 }))) ?? 0);
    if (!n) return;
    await spend(pts, n);
    const old = t.actor.effects.filter((e) => e.flags?.world?.cgaBastion);
    if (old.length) await MidiQOL.socket().executeAsGM("deleteEffectsByUuid", { effectsToDelete: old.map((e) => e.uuid) }).catch(() => {});
    await effectOn(t, `${n}d8`, [], { special: ["longRest"], flags: { world: { cgaBastion: n } } });
    say(`${esc(t.name)} is warded by ${n}d8 (spent when it takes damage; lasts until your next Long Rest).`);
    return;
  }
  case "elemental-affinity": {
    if (pass === "postActiveEffects" && ownActivity()) {
      const types = ["acid", "cold", "fire", "lightning", "poison"];
      const pick = await choose("Elemental Affinity", "<p>Your draconic ancestry's damage type:</p>", types.map((t, i) => ({ action: t, label: CONFIG.DND5E.damageTypes[t]?.label ?? t, default: (feat.getFlag("world", "cgaAffinity") ?? "fire") === t })));
      if (!pick) return;
      await feat.setFlag("world", "cgaAffinity", pick);
      const old = actor.effects.filter((e) => e.flags?.world?.cgaAffinityFx);
      if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
      const [e] = await effectOn(actor, `Resistance (${pick})`, [["system.traits.dr.value", pick, "add"]]);
      if (e) await e.setFlag("world", "cgaAffinityFx", true);
      say(`Resistance to ${pick} damage; your spells that deal ${pick} damage add your Charisma modifier to one damage roll.`);
      return;
    }
    if (pass !== "DamageBonus" || usedItem?.type !== "spell" || !firstCall(pass)) return;
    const type = feat.getFlag("world", "cgaAffinity");
    if (!type || !(wf.damageRolls ?? []).some((r) => r.options?.type === type || (r.options?.types ?? []).includes(type))) return;
    return { damageRoll: `${mod("cha")}`, damageType: type, flavor: "Elemental Affinity" };
  }
  case "wild-magic-surge": {
    if (pass !== "postActiveEffects" || usedItem?.type !== "spell" || Number(wf.castData?.castLevel ?? 0) < 1 || !firstCall(pass)) return;
    const src = usedItem.system.sourceClass;
    if (src && src !== "sorcerer") return;
    const tides = item("tides-of-chaos");
    const forced = !!tides?.getFlag("world", "cgaTidesUsed");
    let surge = forced;
    if (!surge) {
      const r = await new Roll("1d20").evaluate();
      await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Wild Magic Surge check (a 20 surges)" });
      surge = r.total === 20;
    }
    if (forced) { await tides.update({ "system.uses.spent": 0 }); await tides.unsetFlag("world", "cgaTidesUsed"); say("Tides of Chaos recharges, and wild magic surges."); }
    if (surge) {
      // Controlled Chaos (Wild Magic 14): roll twice and pick either result.
      const times = has("controlled-chaos") ? 2 : 1;
      for (let i = 0; i < times; i++) {
        const d = await new Roll("1d100").evaluate();
        await d.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: times > 1 ? `Wild Magic Surge (Controlled Chaos roll ${i + 1} of 2 - pick one)` : "Wild Magic Surge! Look this roll up on the Wild Magic Surge table." });
      }
    }
    return;
  }
  case "tides-of-chaos": {
    if (pass === "postActiveEffects" && ownActivity()) await feat.setFlag("world", "cgaTidesUsed", true);
    return;
  }

  // ======================================================================= Warlock
  case "eldritch-smite": {
    if (pass === "DamageBonus") {
      if (!isWeapon || !activity?.attack || usedThisTurn() || !firstCall(pass)) return;
      const pact = actor.system.spells?.pact;
      if (!(Number(pact?.value ?? 0) > 0)) return;
      const t = hitTokens().find((x) => x.actor && x !== me);
      if (!t) return;
      const lv = Number(pact.level ?? 1);
      if (!(await confirm("Eldritch Smite", `<p>Spend a Pact Magic slot (${pact.value} left) for ${1 + lv}d8 Force damage? A Huge or smaller target is also knocked Prone.</p>`))) return;
      await markUsed();
      await actor.update({ "system.spells.pact.value": Number(pact.value) - 1 });
      wf.cgaSmite = t.document.uuid;
      return { damageRoll: `${1 + lv}d8`, damageType: "force", flavor: "Eldritch Smite" };
    }
    if (pass === "postActiveEffects" && wf?.cgaSmite && firstCall("smite-prone")) {
      const t = canvas.tokens.placeables.find((p) => p.document.uuid === wf.cgaSmite);
      if (t?.actor && sizeRank(t.actor) <= Number(CONFIG.DND5E.actorSizes?.huge?.numerical ?? 4))
        await MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: t.actor.uuid, statusId: "prone", options: { active: true } });
    }
    return;
  }
  case "lifedrinker": {
    if (pass === "DamageBonus") {
      if (!isWeapon || !activity?.attack || usedThisTurn() || !hitTokens().length || !firstCall(pass)) return;
      await markUsed();
      wf.cgaLifedrinker = true;
      const type = await pickType(["necrotic", "psychic", "radiant"], "Lifedrinker");
      return { damageRoll: "1d6", damageType: type, flavor: "Lifedrinker" };
    }
    if (pass === "postActiveEffects" && wf?.cgaLifedrinker && firstCall("lifedrinker-heal")) {
      const hd = Number(actor.system.attributes?.hd?.value ?? 0);
      if (hd <= 0) return;
      later(async () => {
        if (await confirm("Lifedrinker", `<p>Spend one of your Hit Point Dice (${hd} left) to heal?</p>`)) await actor.rollHitDie?.({}, { configure: false }).catch(() => actor.rollHitDie());
      });
    }
    return;
  }
  case "misty-escape": {
    if (pass !== "postActiveEffects" || !ownActivity()) return;
    const steps = item("steps-of-the-fey");
    const act = steps?.system.activities.find((a) => a.type === "utility");
    if (act && left(steps) > 0) { later(() => MidiQOL.completeActivityUse(act, {}, { configure: false }, {}), 300); return; }
    const spell = actor.items.find((i) => i.type === "spell" && /misty step/i.test(i.name));
    if (spell) later(() => spell.system.activities.contents[0]?.use({}, {}, {}), 300);
    else say("cast Misty Step now (no free Steps of the Fey uses left).");
    return;
  }
  case "radiant-soul": {
    if (pass !== "DamageBonus" || usedItem?.type !== "spell" || usedThisTurn() || !firstCall(pass)) return;
    const type = (wf.damageRolls ?? []).map((r) => r.options?.type).find((t) => t === "radiant" || t === "fire");
    if (!type) return;
    await markUsed();
    return { damageRoll: `${mod("cha")}`, damageType: type, flavor: "Radiant Soul" };
  }
  case "psychic-spells": {
    if (pass !== "postDamageRoll" || usedItem?.type !== "spell" || !firstCall(pass)) return;
    const src = usedItem.system.sourceClass;
    if (src && src !== "warlock") return;
    if (!(wf.damageRolls ?? []).some((r) => !["healing", "temphp", "psychic"].includes(r.options?.type))) return;
    if (await confirm("Psychic Spells", `<p>Change ${esc(usedItem.name)}'s damage to Psychic?</p>`)) await setType("psychic");
    return;
  }

  // ======================================================================= Wizard
  case "expert-divination": {
    if (pass !== "postActiveEffects" || usedItem?.type !== "spell" || usedItem.system.school !== "div" || !firstCall(pass)) return;
    const cast = Number(wf.castData?.castLevel ?? 0);
    if (cast < 2) return;
    const s = actor.system.spells;
    for (let l = Math.min(5, cast - 1); l >= 1; l--) {
      const slot = s[`spell${l}`];
      if (slot && Number(slot.value) < Number(slot.max)) {
        await actor.update({ [`system.spells.spell${l}.value`]: Number(slot.value) + 1 });
        return say(`you regain a level ${l} spell slot.`);
      }
    }
    return;
  }
  case "potent-cantrip": {
    // Saves: midi's potentCantrip flag (half on a success). A missed cantrip attack still deals half damage.
    if (pass !== "postActiveEffects" || usedItem?.type !== "spell" || Number(usedItem.system.level) !== 0 || !activity?.attack || !firstCall(pass)) return;
    const hit = new Set(asTokens(wf.hitTargets));
    const missed = asTokens(wf.targets).filter((t) => t.actor && !hit.has(t));
    if (!missed.length) return;
    const cfg = activity.getDamageConfig?.({});
    const parts = cfg?.rolls?.[0];
    if (!parts?.parts?.length) return;
    const type = parts.options?.type ?? parts.options?.types?.[0] ?? "force";
    const r = await new CONFIG.Dice.DamageRoll(parts.parts.join(" + "), parts.data ?? actor.getRollData(), { type }).evaluate();
    const half = Math.floor(r.total / 2);
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Potent Cantrip: the miss still deals half (${half} ${type})` });
    if (half > 0) await MidiQOL.applyTokenDamage([{ value: half, type }], half, new Set(missed), feat, new Set(), {});
    return;
  }
  case "empowered-evocation": {
    if (pass !== "DamageBonus" || usedItem?.type !== "spell" || usedItem.system.school !== "evo" || !firstCall(pass)) return;
    const src = usedItem.system.sourceClass;
    if (src && src !== "wizard") return;
    if (!(wf.damageRolls ?? []).some((r) => !["healing", "temphp"].includes(r.options?.type))) return;
    return { damageRoll: `${mod("int")}`, damageType: wf.defaultDamageType, flavor: "Empowered Evocation" };
  }
}
