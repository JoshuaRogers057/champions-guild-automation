// Haste (2024): when the spell ends, the target is Incapacitated with speed 0 until the end of its next turn.
// DAE runs this from the "Hasted" effect (change macro.itemMacro): args[0] is "on" when it's applied and "off" when it
// ends (concentration dropped, duration over, effect deleted). On "off" it gives the target the item's "Lethargy" effect.
if (args[0] !== "off") return;
const last = args.at(-1) ?? {};
const target = (last.actorUuid ? fromUuidSync(last.actorUuid) : null)
  ?? (last.tokenUuid ? fromUuidSync(last.tokenUuid)?.actor : null);
if (!target || (target.system?.attributes?.hp?.value ?? 1) <= 0) return;
const spell = item ?? macroItem;
const lethargy = spell?.effects?.find((e) => e.name === "Lethargy") ?? spell?.effects?.find((e) => e.statuses?.has("incapacitated"));
if (!lethargy) return;
if (target.effects.some((e) => e.name === lethargy.name && e.origin === spell.uuid)) return;
const data = lethargy.toObject();
delete data._id;
Object.assign(data, {
  origin: spell.uuid,
  transfer: false,
  disabled: false,
  // Until the end of the target's next turn.
  duration: { value: 1, units: "rounds", expiry: "targetEnd" },
  flags: foundry.utils.mergeObject(data.flags ?? {}, { dae: { specialDuration: ["turnEnd"] } })
});
try {
  if (target.isOwner) await target.createEmbeddedDocuments("ActiveEffect", [data]);
  else await MidiQOL.socket().executeAsGM("createEffects", { actorUuid: target.uuid, effects: [data] });
} catch (err) { console.warn("Haste | couldn't apply lethargy", err); }
