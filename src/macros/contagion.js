// Contagion (2024): the Poisoned target repeats the CON save at the end of each of its turns until it has three
// successes (the spell ends) or three failures (it lasts 7 days and the saves stop). Runs after each repeat save
// ([postActiveEffects] of the hidden "Contagion: Repeat Save" activity) and counts on the target's effect.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.midiProperties?.identifier !== "contagionSave") return;
const spell = wf.item;
const target = Array.from(wf.targets ?? [])[0]?.actor;
if (!target) return;
const ef = target.effects.find((e) => e.name.startsWith("Infected") && String(e.origin ?? "").startsWith(spell.actor.uuid));
if (!ef) return;
const saved = wf.saves?.size > 0;
const tally = { success: 0, failure: 0, ...(ef.flags?.world?.cgaContagion ?? {}) };
tally[saved ? "success" : "failure"] += 1;
const say = (text) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: target }), content: `<p><strong>${spell.name}:</strong> ${text}</p>` });
const update = async (data) => {
  if (ef.isOwner) return ef.update(data);
  return MidiQOL.socket().executeAsGM("updateEffects", { actorUuid: target.uuid, updates: [{ _id: ef.id, ...data }] });
};
try {
  if (tally.success >= 3) {
    say(`${target.name} succeeds on a third save and shakes off the contagion.`);
    if (ef.isOwner) await ef.delete(); else await MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: ef.uuid });
  } else if (tally.failure >= 3) {
    say(`${target.name} fails a third save: the contagion lasts 7 days.`);
    const changes = (ef.system?.changes ?? ef.changes ?? []).map((c) => (typeof c.toObject === "function" ? c.toObject() : { ...c }))
      .filter((c) => !c.key.startsWith("flags.midi-qol.ActivityOverTime"));
    await update({ "system.changes": changes, duration: { value: 604800, units: "seconds", expiry: null }, "flags.world.cgaContagion": tally });
  } else {
    say(`${target.name}: ${tally.success} success${tally.success === 1 ? "" : "es"}, ${tally.failure} failure${tally.failure === 1 ? "" : "s"}.`);
    await update({ "flags.world.cgaContagion": tally });
  }
} catch (err) { console.warn("Contagion | couldn't record the save", err); }
