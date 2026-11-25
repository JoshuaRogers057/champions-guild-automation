// Vampiric Touch (2024): on a hit you regain Hit Points equal to half the Necrotic damage dealt.
// Runs after damage is applied ([postActiveEffects]) for both the cast and the Siphon Life repeat attack.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (!wf?.hitTargets?.size) return;
const dealt = (wf.damageList ?? []).reduce((sum, d) => sum + Math.max(0, (d.hpDamage ?? 0) + (d.tempDamage ?? 0)), 0);
const heal = Math.floor(dealt / 2);
if (heal <= 0) return;
const me = wf.token ?? MidiQOL.tokenForActor?.(wf.actor);
if (!me) return;
try { await MidiQOL.applyTokenDamage([{ value: heal, type: "healing" }], heal, new Set([me]), wf.item, new Set(), {}); }
catch (err) { console.warn("Vampiric Touch | healing failed", err); }
