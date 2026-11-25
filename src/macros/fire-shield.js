// Fire Shield (2024): when a creature within 5 ft hits you with a melee attack roll, it takes 2d8 Fire (warm shield)
// or 2d8 Cold (chill shield). The shield effect carries flags.midi-qol.onUseMacroName = "ItemMacro,isHit" and
// flags.world.cgaRetaliate = { formula, type }; this runs in the attacker's workflow.
if (args[0]?.macroPass !== "isHit") return;
const wf = args[0]?.workflow ?? workflow;
if (!wf) return;
const spell = macroItem ?? item;
let defender = args[0]?.options?.token;
defender = defender?.object ?? defender;
if (!defender?.document) defender = MidiQOL.tokenForActor?.(actor);
const defenderActor = defender?.actor ?? actor;
// allApplicableEffects also covers effects transferred from items (a summoned spirit's Heated Body).
const shield = Array.from(defenderActor?.allApplicableEffects?.() ?? defenderActor?.effects ?? []).find((e) => e.flags?.world?.cgaRetaliate && !e.disabled);
if (!shield) return;
wf.cgaRetaliated ??= new Set();
if (wf.cgaRetaliated.has(defenderActor.uuid)) return;
wf.cgaRetaliated.add(defenderActor.uuid);
if (!["mwak", "msak"].includes(wf.activity?.actionType)) return; // melee attack rolls only
const attacker = wf.token;
if (!attacker || attacker.actor === defenderActor) return;
const distance = MidiQOL.computeDistance?.(attacker, defender, { wallsBlock: false }) ?? 5;
if (distance > 5) return;
const { formula = "2d8", type = "fire" } = shield.flags.world.cgaRetaliate;
const roll = await new Roll(formula).evaluate();
await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
  flavor: `${shield.name}: ${attacker.name} takes ${type} damage` });
try { await MidiQOL.applyTokenDamage([{ value: roll.total, type, properties: ["mgc"] }], roll.total, new Set([attacker]), spell, new Set(), {}); }
catch (err) { console.warn("Fire Shield | retaliation failed", err); }
