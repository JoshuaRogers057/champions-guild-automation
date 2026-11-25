// Armor of Agathys (2024): 5 temp HP per slot level; while you have it, a creature that hits you with a melee attack
// takes 5 cold damage per slot level. The spell ends when the temp HP is gone.
//   item onUse [postActiveEffects]  -> stamp the slot level on the caster's "Armor of Agathys" effect
//   effect onUseMacroName isHit     -> retaliate against melee hitters (runs in the attacker's workflow)
//   effect onUseMacroName isDamaged -> end the spell once the temp HP is used up
const FLAG = "agathys";
const pass = args[0]?.macroPass;
const wf = args[0]?.workflow ?? workflow;
if (!wf) return;
const spell = macroItem ?? item;
const wards = (a) => Array.from(a?.effects ?? []).filter((e) => e.flags?.world?.[FLAG])
  .sort((x, y) => (y._stats?.createdTime ?? 0) - (x._stats?.createdTime ?? 0));
const removeEffect = async (e) => (e.isOwner ? e.delete() : MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: e.uuid }));

if (pass === "postActiveEffects") {
  const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell?.system?.level ?? 1) || 1;
  const [current, ...older] = wards(wf.actor);
  for (const e of older) await removeEffect(e);
  if (current) await current.update({ name: `Armor of Agathys (${5 * level} cold)`, [`flags.world.${FLAG}.level`]: level });
  return;
}

let defender = args[0]?.options?.token;
defender = defender?.object ?? defender;
if (!defender?.document) defender = MidiQOL.tokenForActor?.(actor);
const defenderActor = defender?.actor ?? actor;
const ward = wards(defenderActor)[0];
if (!ward) return;
const temp = Number(defenderActor.system.attributes.hp.temp ?? 0);

if (pass === "isDamaged") {
  // The damage may not be applied yet when this runs; check again shortly after.
  setTimeout(async () => {
    if (Number(defenderActor.system.attributes.hp.temp ?? 0) <= 0 && ward.parent) {
      await removeEffect(ward);
      ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: defenderActor }), content: `<p><strong>Armor of Agathys</strong> fades: the temporary hit points are gone.</p>` });
    }
  }, 750);
  return;
}
if (pass !== "isHit") return;
wf.agathysHandled ??= new Set();
if (wf.agathysHandled.has(defenderActor.uuid)) return;
wf.agathysHandled.add(defenderActor.uuid);
if (temp <= 0) { await removeEffect(ward); return; }
if (!["mwak", "msak"].includes(wf.activity?.actionType)) return; // melee attacks only
const attacker = wf.token;
if (!attacker || attacker.actor === defenderActor) return;
const level = Number(ward.flags.world[FLAG].level ?? 1) || 1;
const value = 5 * level;
await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: defenderActor }),
  content: `<p><strong>Armor of Agathys:</strong> ${attacker.name} takes ${value} cold damage.</p>` });
try { await MidiQOL.applyTokenDamage([{ value, type: "cold", properties: ["mgc"] }], value, new Set([attacker]), spell, new Set(), {}); }
catch (err) { console.warn("Armor of Agathys | retaliation failed", err); }
