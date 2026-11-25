// Swift Quiver (2024): when you cast it and as a Bonus Action on later turns, make two attacks with a weapon that fires
// Arrows or Bolts; the spell makes the ammunition. Runs after Cast and Shoot / Two More Shots ([postActiveEffects]):
// two attacks with your equipped bow or crossbow, at your one target or split between two targets.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
const actor = wf.actor;
const weapon = actor.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.properties?.has?.("amm")
  && /bow|crossbow/i.test(`${i.system.type?.baseItem ?? ""} ${i.name}`))
  ?? actor.items.find((i) => i.type === "weapon" && i.system.equipped && i.system.properties?.has?.("amm"));
if (!weapon) return ui.notifications.warn("Swift Quiver: equip a bow or crossbow first.");
const attack = weapon.system.activities.find((a) => a.type === "attack");
const targets = Array.from(wf.targets ?? []).length ? Array.from(wf.targets) : Array.from(game.user.targets);
if (!targets.length) return ui.notifications.warn("Swift Quiver: target one or two creatures, then use Two More Shots.");
const shots = [targets[0], targets[1] ?? targets[0]];
for (const t of shots) {
  try {
    await MidiQOL.completeActivityUse(attack, {
      midiOptions: { targetUuids: [t.document.uuid], workflowOptions: { targetConfirmation: "none" } },
      consume: { resources: false, ammunition: false, action: false }, create: { measuredTemplate: false }
    }, { configure: false }, {});
  } catch (err) { console.warn(`Swift Quiver | shot at ${t.name} failed`, err); }
}
