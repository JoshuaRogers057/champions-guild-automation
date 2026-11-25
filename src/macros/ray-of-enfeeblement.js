// Ray of Enfeeblement (2024): a creature that succeeds on the save has Disadvantage on its next attack roll before the
// start of your next turn. The failed-save effect (Enervated) comes from the activity; this adds the success effect.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.isOverTimeFlag || wf?.activity?.midiProperties?.automationOnly) return; // not the repeat save
const spell = wf?.item ?? item;
const brief = spell?.effects?.find((e) => e.name === "Brief Enfeeblement");
if (!brief) return;
for (const t of Array.from(wf.saves ?? [])) {
  const target = t?.actor ?? t?.object?.actor;
  if (!target) continue;
  const data = brief.toObject();
  delete data._id;
  Object.assign(data, { origin: spell.uuid, transfer: false, disabled: false });
  try {
    if (target.isOwner) await target.createEmbeddedDocuments("ActiveEffect", [data]);
    else await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: target.uuid, effects: [data] });
  } catch (err) { console.warn("Ray of Enfeeblement | couldn't apply the success effect", err); }
}
