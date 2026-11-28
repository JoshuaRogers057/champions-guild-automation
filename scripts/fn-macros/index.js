// CAT function macros.
//
// Most fixes are plain Item documents (src/packs/...) with a midi-qol / DAE ItemMacro, and need nothing here.
// Use this file when a fix is better written in CAT's own macro format (CAT event passes such as
// "actorTurnEnd", "targetPreItemRoll", "itemRollFinished"; see the CAT wiki and `console.log(cat.utils)`).
//
// ownMacros: new macros under this module's source. Fields: identifier, rules ("2014" | "2024" | "all"),
//   and trigger arrays such as roll / combat / effect / move, each [{ pass, macro, priority }].
//   An item uses one by listing it in flags.cat.macros.<type>:
//   [{ source: "champions-guild-automation", identifier, rules }].
//
// overrideMacros: replace a macro CAT or midi-qol already registered. Give its original source, identifier
//   and rules. The override replaces every pass of that macro.

// Command, Dragon's Breath and Sanctuary: midi-qol 14.7 dropped these spells for CPR's and removes their macros in
// 14.8, so the CGA copies of the spells use these ports of midi-qol 14.7's macros instead.
const U = () => globalThis.cat.utils;

// Command: at the start of the target's turn its owners are told the command; Grovel also knocks it prone.
async function commandTurnStart({ document: effect }) {
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  const word = effect.name.replace(/^Command:\s*/, "");
  if (word === "Grovel") await U().actorUtils.applyConditions(actor, ["prone"]);
  const owners = game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), whisper: owners, content: `<p><strong>${effect.name}</strong></p>${effect.description ?? ""}` });
}

// Dragon's Breath: pick the damage type; each target gets an exhale feature (caster's DC, cast-level dice) that ends
// with the caster's concentration.
async function dragonsBreathCast({ workflow }) {
  const { dialogUtils, workflowUtils, effectUtils, itemUtils } = U();
  if (!workflow.activity.isLike("utility") || !workflow.targets.count) return;
  const exhale = workflow.item.system.activities.find((a) => a.isLike("save"));
  if (!exhale) return;
  const types = exhale.damage.parts[0]?.types ? [...exhale.damage.parts[0].types] : ["acid", "cold", "fire", "lightning", "poison"];
  const type = await dialogUtils.selectDamageType(types, workflow.item.name, "Choose the breath's damage type");
  if (!type) return;
  const level = workflowUtils.getCastLevel(workflow) ?? workflow.item.system.level;
  const data = exhale.toObject();
  data.save.dc = { calculation: "", formula: String(exhale.save.dc.value) };
  data.damage.parts[0].types = [type];
  data.damage.parts[0].number = 3 + Math.max(0, level - 2);
  data.damage.parts[0].scaling = { mode: "", number: null, formula: "" };
  data.midiProperties = { ...(data.midiProperties ?? {}), automationOnly: false };
  const itemData = {
    name: workflow.item.name, type: "feat", img: workflow.item.img,
    system: {
      description: { value: `<p>Magic action: exhale a 15-foot Cone of ${type}. DC ${exhale.save.dc.value} Dexterity save, ${data.damage.parts[0].number}d6 damage, half on a success.</p>` },
      type: { value: "spellFeature" }, properties: ["mgc"], activities: { [data._id]: data }
    },
    flags: { "champions-guild-automation": { dragonsBreath: workflow.item.uuid } }
  };
  const concentration = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
  await Promise.all(workflow.targets.documents.map(async (t) => { if (t.actor) await itemUtils.createItems(t.actor, [itemData], { favorite: true, parentEntity: concentration }); }));
}

// Sanctuary: a creature targeting the warded creature with an attack or damaging spell saves first (cancelled on a
// failure); the ward ends when the warded creature attacks, casts a spell or deals damage.
function harmful(activity) {
  if (!activity) return false;
  if (activity.isLike("attack")) return true;
  return activity.item?.type === "spell" && !!activity.damage?.parts?.length;
}
async function sanctuaryTargeted({ document: effect, workflow }) {
  const { effectUtils, workflowUtils } = U();
  if (workflow.targets.count !== 1 || !workflow.token) return;
  if (!harmful(workflow.activity) || workflow.activity.target?.template?.type) return;
  const target = workflow.targets.documents[0];
  const attacker = workflow.token.document ?? workflow.token;
  if (target.disposition === attacker.disposition) return;
  const save = effectUtils.getOriginActivitySync(effect)?.item?.system.activities.find((a) => a.isLike("save"));
  if (!save) return;
  const roll = await workflowUtils.syntheticActivityRoll(save, [attacker]);
  if (!roll?.failedSaves?.count) return;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ token: attacker }), content: `${workflow.token.name} can't bring themselves to target ${target.name} (Sanctuary).` });
  return true;
}
async function sanctuaryActed({ document: effect, workflow }) {
  const damaged = workflow.damageList?.some((d) => (d.totalDamage ?? 0) > 0 && d.actorId !== workflow.actor?.id);
  if (!workflow.activity?.isLike("attack") && workflow.item?.type !== "spell" && !damaged) return;
  if (workflow.activity?.item?.id === U().effectUtils.getOriginActivitySync(effect)?.item?.id) return;
  await effect.delete();
}

export const ownMacros = [
  { identifier: "command", name: "Command", version: "1.0.0", rules: "2024", combat: [{ pass: "actorTurnStart", macro: commandTurnStart, priority: 50 }] },
  { identifier: "dragons-breath", name: "Dragon's Breath", version: "1.0.0", rules: "2024", roll: [{ pass: "activityRollFinished", macro: dragonsBreathCast, priority: 50 }] },
  { identifier: "sanctuary", name: "Sanctuary", version: "1.0.0", rules: "2024", roll: [
    { pass: "targetPreItemRoll", macro: sanctuaryTargeted, priority: 50 },
    { pass: "actorRollFinished", macro: sanctuaryActed, priority: 50 }] }
];

export const overrideMacros = [];
