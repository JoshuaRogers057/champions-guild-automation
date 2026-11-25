// Repeat the spell's saving throw each time the affected creature takes damage, ending the effect on a success.
// Used by Tasha's Hideous Laughter (2024: the damage-triggered save has Advantage).
// The condition effect carries the change flags.midi-qol.onUseMacroName = "ItemMacro,isDamaged" and, optionally,
// flags.world.cgaSaveOnDamage = { ability: "wis", advantage: true }. The DC is the caster's spell save DC.
if (args[0]?.macroPass !== "isDamaged") return;
const wf = args[0]?.workflow ?? workflow;
const spell = macroItem ?? item;
let target = args[0]?.options?.token;
target = target?.object ?? target;
const victim = target?.actor ?? actor;
if (!victim || !spell) return;
const effect = victim.effects.find((e) => e.flags?.world?.cgaSaveOnDamage && (e.origin === spell.uuid || e.origin?.startsWith?.(spell.uuid)))
  ?? victim.effects.find((e) => e.flags?.world?.cgaSaveOnDamage);
if (!effect) return;
// Once per damage event: several damage parts call this more than once.
wf.cgaSaveOnDamage ??= new Set();
if (wf.cgaSaveOnDamage.has(effect.uuid)) return;
wf.cgaSaveOnDamage.add(effect.uuid);
const { ability = "wis", advantage = false } = effect.flags.world.cgaSaveOnDamage;
const caster = spell.actor;
const dc = Number(caster?.system?.attributes?.spell?.dc ?? caster?.system?.attributes?.spelldc ?? 10);
setTimeout(async () => {
  if (!effect.parent || (victim.system.attributes.hp.value ?? 0) <= 0) return;
  let rolls;
  try {
    // midi-qol reads advantage from midiOptions; plain dnd5e reads it from the config.
    rolls = await victim.rollSavingThrow({ ability, target: dc, advantage, midiOptions: { advantage } }, { configure: false },
      { data: { flavor: `${spell.name}: saving throw after taking damage (DC ${dc})` } });
  } catch (err) { console.warn(`${spell.name} | damage save failed to roll`, err); return; }
  const total = (Array.isArray(rolls) ? rolls[0] : rolls)?.total;
  if (total === undefined || total < dc) return;
  try {
    if (effect.isOwner) await effect.delete();
    else await MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: effect.uuid });
  } catch (err) { console.warn(`${spell.name} | couldn't end the effect`, err); }
}, 500);
