// Cordon of Arrows (2024): up to four pieces of ammunition (two more per slot level above 2nd) guard 30 ft around the
// spot; each time one strikes a creature it's destroyed, and the spell ends when none remain.
//  - [postActiveEffects] of the cast: remember how many pieces there are (on the spell item)
//  - [postActiveEffects] of the hidden "Cordon of Arrows: Strike" activity (run by the area): one piece is used up;
//    with none left the area is removed.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
const spell = wf?.item;
if (!spell) return;
if (!wf.activity?.midiProperties?.automationOnly) {
  const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell.system.level) || 2;
  const pieces = 4 + 2 * Math.max(0, level - 2);
  await spell.setFlag("world", "cgaCordon", { left: pieces });
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p><strong>${spell.name}:</strong> ${pieces} pieces of ammunition planted.</p>` });
  return;
}
const left = Math.max(0, (spell.getFlag("world", "cgaCordon")?.left ?? 1) - 1);
await spell.setFlag("world", "cgaCordon", { left });
if (left > 0) {
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p><strong>${spell.name}:</strong> ${left} piece${left === 1 ? "" : "s"} of ammunition left.</p>` });
  return;
}
ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p><strong>${spell.name}:</strong> the last piece of ammunition is spent; the spell ends.</p>` });
for (const scene of game.scenes) {
  const ids = scene.regions.filter((r) => r.behaviors.some((b) => b.system?.sourceItemUuid === spell.uuid)).map((r) => r.id);
  if (!ids.length) continue;
  try { await scene.deleteEmbeddedDocuments("Region", ids); }
  catch (err) {
    console.warn("Cordon of Arrows | couldn't remove the area", err);
    ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id), content: `<p>${spell.name} has no ammunition left: please delete its area.</p>` });
  }
}
