// Push on a failed save (Thunderous Smite 10 ft, Unarmed Strike "Shove (Push)" 5 ft).
// midi-qol onUse: [postActiveEffects]. The activity's midiProperties.identifier says how far: "push-10", "push-5".
if (args[0]?.macroPass !== "postActiveEffects") return;
const id = workflow?.activity?.midiProperties?.identifier ?? "";
// The identifier is "push-15", or ends with it ("gustZone-push-15") so an area spell's activities can differ.
const m = id.match(/(?:^|-)push-(\d+)$/);
if (!m) return;
const feet = Number(m[1]);
const casterToken = token ?? MidiQOL.tokenForActor?.(actor);
if (!casterToken || !MidiQOL.moveTokenAwayFromPoint) return;
const failed = (workflow.failedSaves?.tokens ?? Array.from(workflow.failedSaves ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);
for (const t of failed) {
  if (t === casterToken) continue;
  // animate: false - animated moves stall when the GM's tab is in the background
  try { await MidiQOL.moveTokenAwayFromPoint(t, feet, casterToken.center, { animate: false, autoRotate: false }); }
  catch (err) { console.warn(`${workflow.item?.name} | push failed`, err); }
}
