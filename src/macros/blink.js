// Blink (2024): at the end of each of your turns, roll 1d6; on 4-6 you vanish to the Ethereal Plane until the start of
// your next turn. The "Blinking" effect runs the hidden "Blink: Roll" activity at the end of your turns (midi
// ActivityOverTime); this macro ([postActiveEffects] of that activity) rolls and applies "Ethereal" on 4-6.
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
if (wf?.activity?.midiProperties?.identifier !== "blinkRoll") return;
const me = wf.actor;
const roll = await new Roll("1d6").evaluate();
const gone = roll.total >= 4;
await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: me }), flavor: `Blink: ${gone ? "you vanish to the Ethereal Plane until the start of your next turn" : "you stay where you are"}` });
if (!gone) return;
const ethereal = wf.item.effects.find((e) => e.name === "Ethereal");
if (!ethereal) return;
const data = ethereal.toObject();
delete data._id;
Object.assign(data, { origin: wf.item.uuid, transfer: false, disabled: false, duration: { value: 1, units: "rounds", expiry: "turnStart" } });
try { await me.createEmbeddedDocuments("ActiveEffect", [data]); } catch (err) { console.warn("Blink | couldn't go ethereal", err); }
