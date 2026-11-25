// Heroes' Feast (2024): each creature that partakes gets its Hit Point maximum raised by 2d10 (and gains those Hit
// Points) for 24 hours, plus the feast's resistances and immunities (the "Feast's Benefits" effect).
// Runs after Consume Feast ([postActiveEffects]): rolls 2d10 per creature, adds it to the effect as a maximum-HP
// bonus, then heals that much.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.name !== "Consume Feast") return;
const spell = wf.item;
for (const t of Array.from(wf.targets ?? [])) {
  const target = t.actor;
  const ef = target?.effects.find((e) => e.name === "Feast's Benefits" && String(e.origin ?? "").startsWith(spell.uuid))
    ?? target?.effects.find((e) => e.name === "Feast's Benefits");
  if (!ef) continue;
  const roll = await new Roll("2d10").evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: target }), flavor: `${spell.name}: ${target.name}'s Hit Point maximum rises by ${roll.total}` });
  const changes = (ef.system?.changes ?? ef.changes ?? []).map((c) => (typeof c.toObject === "function" ? c.toObject() : { ...c }))
    .filter((c) => c.key !== "system.attributes.hp.tempmax");
  changes.push({ key: "system.attributes.hp.tempmax", value: String(roll.total), type: "add", phase: "initial", priority: 20 });
  try {
    if (ef.isOwner) await ef.update({ "system.changes": changes });
    else await MidiQOL.socket().executeAsGM("updateEffects", { actorUuid: target.uuid, updates: [{ _id: ef.id, "system.changes": changes }] });
    await MidiQOL.applyTokenDamage([{ value: roll.total, type: "healing" }], roll.total, new Set([t]), spell, new Set(), {});
  } catch (err) { console.warn(`Heroes' Feast | ${target.name}`, err); }
}
