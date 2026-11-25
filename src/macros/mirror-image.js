/*
 * Mirror Image (2024) - midi-qol + DAE only (replaces the Chris's Premades macro).
 * Casting applies "Mirror Image (3)" to the caster for 1 minute. The effect carries
 * flags.midi-qol.onUseMacroName "ItemMacro, isHit", so midi runs this macro when an attack roll hits the caster.
 *   [postActiveEffects] (the cast)  -> keep only the newest effect and reset it to 3 duplicates
 *   isHit (attacker's workflow)     -> roll a d6 per duplicate; any 3+ means a duplicate is hit instead: the caster is
 *                                      dropped from the hit targets (no damage, no on-hit effects) and one duplicate
 *                                      is destroyed. Blinded attackers and Blindsight/Truesight in range aren't fooled.
 */
const FLAG = "mirrorImage";
const DUPLICATES = 3;
const pass = args[0]?.macroPass;
const wf = args[0]?.workflow ?? workflow;
if (!wf) return;

const imageEffects = (a) => (Array.from(a?.effects ?? []).filter((e) => e.flags?.world?.[FLAG]))
  .sort((x, y) => (y._stats?.createdTime ?? 0) - (x._stats?.createdTime ?? 0));
const baseName = (e) => e.flags.world[FLAG].name ?? e.name.replace(/\s*\(\d+\)$/, "");
const plural = (n) => `${n} duplicate${n === 1 ? "" : "s"}`;

async function updateEffect(effect, data) {
  if (effect.isOwner) return effect.update(data);
  try {
    return await MidiQOL.socket().executeAsGM("updateEffects", { actorUuid: effect.parent.uuid, updates: [{ _id: effect.id, ...data }] });
  } catch (err) {
    console.warn(`${baseName(effect)} | could not update the duplicate count`, err);
  }
}
async function removeEffect(effect) {
  if (effect.isOwner) return effect.delete();
  return MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: effect.uuid });
}

if (pass === "postActiveEffects") {
  const [current, ...older] = imageEffects(wf.actor);
  for (const effect of older) await removeEffect(effect);
  if (current) await updateEffect(current, { name: `${baseName(current)} (${DUPLICATES})`, [`flags.world.${FLAG}.images`]: DUPLICATES });
  return;
}
if (pass !== "isHit") return;

let defender = args[0]?.options?.token;
defender = defender?.object ?? defender;
if (!defender?.document) defender = (wf.hitTargets?.tokens ?? []).find((t) => t.actor?.uuid === actor?.uuid);
const defenderActor = defender?.actor;
if (!defenderActor) return;

wf.mirrorImageHandled ??= new Set();
if (wf.mirrorImageHandled.has(defender.document.uuid)) return;
wf.mirrorImageHandled.add(defender.document.uuid);

const effect = imageEffects(defenderActor)[0];
if (!effect) return;
const name = baseName(effect);
const images = Number(effect.flags.world[FLAG].images ?? 0);
const remaining = effect.duration?.remaining;
if (images < 1 || (typeof remaining === "number" && remaining <= 0)) { await removeEffect(effect); return; }

const speaker = ChatMessage.getSpeaker({ token: defender.document });
const attackerActor = wf.actor;
const attacker = wf.token;
if (attackerActor?.statuses?.has("blinded")) {
  await ChatMessage.create({ speaker, content: `<p><strong>${name}:</strong> ${attackerActor.name} is Blinded and isn't fooled by the duplicates.</p>` });
  return;
}
const senses = attackerActor?.system?.attributes?.senses ?? {};
const senseRange = (key) => Number(senses.ranges?.[key] ?? senses[key] ?? 0) || 0;
let distance = 0;
try { if (attacker) distance = MidiQOL.computeDistance(attacker, defender, { wallsBlock: false }); } catch (err) { /* adjacent */ }
const seer = [["blindsight", "Blindsight"], ["truesight", "Truesight"]].find(([key]) => senseRange(key) > 0 && (distance < 0 || distance <= senseRange(key)));
if (seer) {
  await ChatMessage.create({ speaker, content: `<p><strong>${name}:</strong> ${attackerActor.name}'s ${seer[1]} sees through the duplicates.</p>` });
  return;
}

const roll = await new Roll(`${images}d6`).evaluate();
await roll.toMessage({ speaker, flavor: `${name}: ${plural(images)} - any 3 or higher means a duplicate is hit instead` });
const decoyHit = (roll.dice[0]?.results ?? []).some((r) => r.active !== false && r.result >= 3);
if (!decoyHit) {
  await ChatMessage.create({ speaker, content: `<p><strong>${name}:</strong> the attack finds the real ${defender.name}.</p>` });
  return;
}

// Drop the caster from this attack's hits (midi 14 hit sets hold tokens or token documents).
const uuid = defender.document.uuid;
for (const set of [wf.hitTargets, wf.hitTargetsEC]) {
  if (!set) continue;
  for (const m of Array.from(set)) if ((m?.document ?? m)?.uuid === uuid) set.delete(m);
}
const display = wf.hitDisplayData?.[uuid];
if (display) Object.assign(display, { hitClass: "failure", hitSymbol: "fa-xmark", isHit: false });

const left = images - 1;
if (left > 0) await updateEffect(effect, { name: `${name} (${left})`, [`flags.world.${FLAG}.images`]: left });
else await removeEffect(effect);
await ChatMessage.create({
  speaker,
  content: `<p><strong>${name}:</strong> the attack strikes one of ${defender.name}'s duplicates instead, and it vanishes. `
    + (left > 0 ? `${plural(left)} left.` : `That was the last one - the spell ends.`) + `</p>`
});
