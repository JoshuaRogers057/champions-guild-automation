// Apply one of the item's effects to each creature hit that already has a condition. Used by the Putrid Undead Spirit's
// Rotting Claw: a Poisoned target is also Paralyzed until the end of its next turn.
// Config: the item's flags.world.cgaIfStatus = { status: "poisoned", effect: "<effect name on this item>" }.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
const source = wf?.item ?? item;
const cfg = source?.flags?.world?.cgaIfStatus;
const effect = cfg && source.effects.find((e) => e.name === cfg.effect);
if (!effect) return;
for (const t of Array.from(wf.hitTargets ?? [])) {
  const target = t?.actor;
  if (!target?.statuses?.has(cfg.status)) continue;
  const data = effect.toObject();
  delete data._id;
  Object.assign(data, { origin: source.uuid, transfer: false, disabled: false });
  try {
    if (target.isOwner) await target.createEmbeddedDocuments("ActiveEffect", [data]);
    else await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: target.uuid, effects: [data] });
  } catch (err) { console.warn(`${source.name} | couldn't apply ${cfg.effect}`, err); }
}
