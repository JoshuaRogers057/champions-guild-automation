// Steel Wind Strike (2024): a separate melee spell attack against each of up to five creatures you target within 30 ft
// (6d10 Force on a hit, +1d10 per slot level above 5th). Runs after the Cast activity ([postActiveEffects]): one
// attack per target through the hidden "Strike" activity, at the cast's slot level, without spending another slot.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.midiProperties?.automationOnly) return;
const spell = wf.item;
const strike = spell.system.activities.find((a) => a.midiProperties?.identifier === "steelWindStrike");
if (!strike) return;
const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell.system.level) || 5;
const targets = Array.from(wf.targets ?? []).slice(0, 5);
if (!targets.length) return ui.notifications.warn(`${spell.name}: target up to five creatures first.`);
for (const t of targets) {
  try {
    await MidiQOL.completeActivityUse(strike, {
      midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } },
      spell: { slot: `spell${level}` }, consume: { spellSlot: false, resources: false }, create: { measuredTemplate: false }
    }, { configure: false }, {});
  } catch (err) { console.warn(`Steel Wind Strike | attack on ${t.name} failed`, err); }
}
ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }),
  content: `<p><strong>${spell.name}:</strong> you can now teleport to an unoccupied space within 5 ft of one of the targets (use the Teleport activity).</p>` });
