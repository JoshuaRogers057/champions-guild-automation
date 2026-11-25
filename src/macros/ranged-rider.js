// Hail of Thorns and Lightning Arrow (2024): the next ranged weapon attack the caster makes triggers the spell.
// Casting puts a rider effect on the caster with flags.midi-qol.onUseMacroName = "ItemMacro,postDamageRoll" and
// "ItemMacro,postActiveEffects", so this runs inside the caster's weapon attack (item = the weapon, macroItem = the spell).
//   Hail of Thorns: on a hit, the target and each creature within 5 ft of it make the DEX save (spell's save activity).
//   Lightning Arrow: the weapon's damage becomes 4d8 Lightning (half on a miss); then every creature within 10 ft of the
//   target makes the DEX save (spell's save activity). Both scale with the slot level stored on the rider.
const pass = args[0]?.macroPass;
const wf = args[0]?.workflow ?? workflow;
const spell = macroItem;
if (!wf || !spell) return;
if (wf.item?.uuid === spell.uuid) {
  // The cast itself: remember the slot level on the rider effect.
  if (pass !== "postActiveEffects") return;
  const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell.system.level) || spell.system.level;
  const own = wf.actor.effects.filter((e) => e.flags?.world?.cgaRangedRider?.spell === spell.system.identifier);
  for (const e of own) await e.update({ "flags.world.cgaRangedRider.level": level });
  return;
}
if (wf.activity?.actionType !== "rwak" || wf.item?.type !== "weapon") return;
const rider = wf.actor.effects.find((e) => e.flags?.world?.cgaRangedRider?.spell === spell.system.identifier);
if (!rider) return;
const { radius, onHitOnly, replace, level: storedLevel } = rider.flags.world.cgaRangedRider;
const level = Number(storedLevel ?? spell.system.level) || spell.system.level;
const target = Array.from(wf.targets ?? [])[0];
if (!target) return;
const hit = wf.hitTargets?.has?.(target);

if (pass === "postDamageRoll" && replace && hit) {
  // Lightning Arrow: the weapon's damage is replaced by 4d8 Lightning (+1d8 per slot level above 3rd).
  const n = (replace.dice + Math.max(0, level - spell.system.level)) * (wf.isCritical ? 2 : 1);
  const roll = await new CONFIG.Dice.DamageRoll(`${n}d8`, {}, { type: replace.type, properties: ["mgc"] }).evaluate();
  await wf.setDamageRolls([roll]);
  return;
}
if (pass !== "postActiveEffects") return;
if (onHitOnly && !hit) return;
if (wf.cgaRiderDone?.has(rider.id)) return;
(wf.cgaRiderDone ??= new Set()).add(rider.id);
if (replace && !hit) {
  // Lightning Arrow miss: half of the 4d8 Lightning.
  const roll = await new Roll(`${replace.dice + Math.max(0, level - spell.system.level)}d8`).evaluate();
  const half = Math.floor(roll.total / 2);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), flavor: `${spell.name}: miss, ${target.name} takes half (${half} Lightning)` });
  await MidiQOL.applyTokenDamage([{ value: half, type: replace.type, properties: ["mgc"] }], half, new Set([target]), spell, new Set(), {}).catch(() => {});
}
const burst = spell.system.activities.find((a) => a.midiProperties?.identifier === `${spell.system.identifier}-burst`);
const caught = canvas.tokens.placeables.filter((t) => t.actor && !t.document.hidden
  && (t === target || MidiQOL.computeDistance(target, t, { wallsBlock: true }) <= radius));
if (burst && caught.length) {
  try {
    await MidiQOL.completeActivityUse(burst, {
      midiOptions: { targetUuids: caught.map((t) => t.document.uuid), workflowOptions: { targetConfirmation: "none" } },
      spell: { slot: `spell${level}` }, consume: { spellSlot: false, resources: false }, concentration: { begin: false, end: null }, create: { measuredTemplate: false }
    }, { configure: false }, {});
  } catch (err) { console.warn(`${spell.name} | burst failed`, err); }
}
// The spell is spent: end it (and the concentration that holds it).
try {
  const conc = Array.from(wf.actor.effects).find((e) => e.statuses?.has("concentrating") && e.flags?.dnd5e?.item?.id === spell.id);
  if (conc) await conc.delete(); else await rider.delete();
} catch (err) { console.warn(`${spell.name} | couldn't end the spell`, err); }
