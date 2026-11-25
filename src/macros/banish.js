// Banishment and Banishing Smite (2024): the banished creature vanishes from the map until the spell ends.
//   DAE macro.itemMacro on the "Banished" effect: "on" hides the token, "off" brings it back.
//   Banishing Smite item onUse [postActiveEffects]: after the smite's damage, a creature hit with 50 HP or fewer left
//   makes a Charisma save and, on a failure, is banished (the item's "Banished" effect is applied to it).
const pass = args[0]?.macroPass;
if (pass === "postActiveEffects") {
  const wf = args[0]?.workflow ?? workflow;
  const spell = wf?.item ?? item;
  const banished = spell?.effects?.find((e) => e.name === "Banished");
  if (!banished) return;
  for (const t of Array.from(wf.hitTargets ?? [])) {
    const target = t?.actor;
    const hp = target?.system?.attributes?.hp?.value ?? 999;
    if (!target || hp > 50 || hp <= 0) continue;
    if (target.effects.some((e) => e.name === banished.name && e.origin === spell.uuid)) continue;
    // The target gets a Charisma save against your spell save DC to resist.
    const dc = Number(wf.actor.system.attributes?.spell?.dc ?? 10);
    let rolls = null;
    try { rolls = await target.rollSavingThrow({ ability: "cha", target: dc }, { configure: false }, { data: { flavor: `${spell.name}: resist banishment (DC ${dc})` } }); }
    catch (err) { console.warn("Banishing Smite | save failed to roll", err); }
    if (((Array.isArray(rolls) ? rolls[0] : rolls)?.total ?? 0) >= dc) continue;
    const data = banished.toObject();
    delete data._id;
    Object.assign(data, { origin: spell.uuid, transfer: false, disabled: false });
    try {
      await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: target.uuid, effects: [data] });
      // End the banishment with the smite's concentration.
      const created = target.effects.find((e) => e.name === banished.name && e.origin === spell.uuid);
      const conc = Array.from(wf.actor?.concentration?.effects ?? []).find((e) => e.flags?.dnd5e?.item?.id === spell.id)
        ?? Array.from(wf.actor?.effects ?? []).find((e) => e.statuses?.has("concentrating") && e.flags?.dnd5e?.item?.id === spell.id);
      if (created && conc) await MidiQOL.addDependent(conc, created);
    } catch (err) { console.warn("Banishing Smite | couldn't banish", err); }
  }
  return;
}
if (args[0] !== "on" && args[0] !== "off") return;
const last = args.at(-1) ?? {};
const tokenDoc = (last.tokenUuid ? fromUuidSync(last.tokenUuid) : null)
  ?? (last.actorUuid ? fromUuidSync(last.actorUuid)?.getActiveTokens?.()[0]?.document : null);
const doc = tokenDoc?.document ?? tokenDoc;
if (!doc) return;
try { await MidiQOL.socket().executeAsGM("toggleTokenHidden", { tokenUuid: doc.uuid, force: args[0] === "on" }); }
catch (err) { console.warn("Banishment | couldn't hide or show the token", err); }
