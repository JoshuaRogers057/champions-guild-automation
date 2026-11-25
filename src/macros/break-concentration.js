// Sleet Storm and Earthquake (2024): a creature that fails the save is knocked Prone (the activity's effect) and loses
// its Concentration. Runs after each save ([postActiveEffects]), including the area's repeat saves.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.type !== "save") return;
for (const t of Array.from(wf.failedSaves ?? [])) {
  const target = t?.actor ?? t?.object?.actor;
  const conc = Array.from(target?.effects ?? []).filter((e) => e.statuses?.has("concentrating"));
  for (const e of conc) {
    try {
      if (e.isOwner) await e.delete(); else await MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: e.uuid });
      ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: target }), content: `<p><strong>${wf.item.name}:</strong> ${target.name} loses Concentration.</p>` });
    } catch (err) { console.warn(`${wf.item.name} | couldn't break concentration`, err); }
  }
}
