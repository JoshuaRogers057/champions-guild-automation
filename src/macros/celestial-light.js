// Conjure Celestial (2024): a creature in the pillar (or that it moves onto, or that enters or ends its turn there) is
// bathed in Healing Light or Searing Light, once per turn. The pillar's region runs the hidden "Choose the Light"
// activity; this macro ([postActiveEffects] of it) heals your allies and sears everyone else.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.midiProperties?.identifier !== "celestialLight") return;
const spell = wf.item;
const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell.system.level) || 7;
const me = spell.actor?.getActiveTokens?.()[0]?.document;
for (const t of Array.from(wf.targets ?? [])) {
  const ally = me && t.document.disposition === me.disposition;
  const act = spell.system.activities.find((a) => a.midiProperties?.identifier === (ally ? "celestialHeal" : "celestialSear"));
  if (!act) continue;
  try {
    await MidiQOL.completeActivityUse(act, { midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } },
      spell: { slot: `spell${level}` }, consume: { spellSlot: false, resources: false }, concentration: { begin: false, end: null }, create: { measuredTemplate: false } }, { configure: false }, {});
  } catch (err) { console.warn("Conjure Celestial | light failed", err); }
}
