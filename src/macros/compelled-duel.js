// Compelled Duel (2024): on a failed save the target has Disadvantage on attack rolls against anyone but the caster.
// midi-qol onUse: [postActiveEffects] - writes the caster's token uuid into the target's "Compelled Duel" effect.
if (args[0]?.macroPass !== "postActiveEffects") return;
const casterToken = token ?? MidiQOL.tokenForActor?.(actor);
if (!casterToken) return;
const KEY = "flags.midi-qol.disadvantage.attack.all";
const failed = (workflow.failedSaves?.tokens ?? Array.from(workflow.failedSaves ?? [])).map((t) => t?.object ?? t).filter((t) => t?.actor);
for (const t of failed) {
  const ef = Array.from(t.actor.effects).find((e) => e.flags?.world?.compelledDuel);
  if (!ef) continue;
  const changes = (ef.system?.changes ?? ef.changes ?? []).map((c) => {
    const o = typeof c.toObject === "function" ? c.toObject() : { ...c };
    if (o.key === KEY) o.value = `targetUuid !== "${casterToken.document.uuid}"`;
    return o;
  });
  const update = { _id: ef.id, "system.changes": changes };
  try {
    if (ef.isOwner) await ef.update({ "system.changes": changes });
    else await MidiQOL.socket().executeAsGM("updateEffects", { actorUuid: t.actor.uuid, updates: [update] });
  } catch (err) { console.warn("Compelled Duel | could not set the duel target", err); }
}
