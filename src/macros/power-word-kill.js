// Power Word Kill (2024): a creature with 100 Hit Points or fewer dies; otherwise it takes 12d12 Psychic damage.
// Runs before the roll ([preItemRoll]): kills a target at 100 HP or less and stops the damage roll.
if (args[0]?.macroPass !== "preItemRoll") return;
const wf = args[0]?.workflow ?? workflow;
const target = Array.from(wf.targets ?? [])[0];
const hp = target?.actor?.system?.attributes?.hp?.value;
if (!target || hp === undefined || hp > 100) return;
try {
  const all = hp + (target.actor.system.attributes.hp.temp ?? 0);
  await MidiQOL.applyTokenDamage([{ value: all, type: "none" }], all, new Set([target]), wf.item, new Set(), {});
  await MidiQOL.socket().executeAsGM("toggleStatusEffect", { actorUuid: target.actor.uuid, statusId: "dead", options: { active: true, overlay: true } }).catch(() => {});
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p><strong>Power Word Kill:</strong> ${target.name} has ${hp} Hit Points or fewer and dies.</p>` });
} catch (err) { console.warn("Power Word Kill | failed", err); return; }
return false;
