// Conjure Minor Elementals (2024): while you concentrate, any attack you make deals an extra 2d8 damage of the chosen type
// (+1d8 per slot level above 4th) when it hits a creature within 15 ft of you.
//  - item onUse [postActiveEffects]: stamp the slot level on your "Conjure Minor Elementals (...)" effect
//  - that effect's flags.midi-qol.onUseMacroName "ItemMacro,damageBonus": add the dice to your attacks
const pass = args[0]?.macroPass;
const wf = args[0]?.workflow ?? workflow;
const spell = macroItem ?? item;
const mine = (a) => Array.from(a?.effects ?? []).filter((e) => e.flags?.world?.cgaMinorElementals && !e.disabled);
if (pass === "postActiveEffects" && wf?.item?.uuid === spell.uuid) {
  const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell.system.level) || 4;
  for (const e of mine(wf.actor)) await e.update({ "flags.world.cgaMinorElementals.level": level });
  return;
}
if (pass !== "DamageBonus" || !wf?.activity?.attack) return;
const aura = mine(wf.actor)[0];
if (!aura) return;
const me = wf.token ?? MidiQOL.tokenForActor?.(wf.actor);
const hits = Array.from(wf.hitTargets ?? []).filter((t) => me && MidiQOL.computeDistance(me, t, { wallsBlock: false }) <= 15);
if (!hits.length) return;
const { type, level = 4 } = aura.flags.world.cgaMinorElementals;
return { damageRoll: `${2 + Math.max(0, level - 4)}d8`, damageType: type, flavor: "Conjure Minor Elementals" };
