// Beam spells (Eldritch Blast, Scorching Ray and their scrolls) - one attack roll per beam.
// midi-qol onUse: [postActiveEffects] on the "Cast" activity (midiProperties.identifier "beam-cast").
// Config on the item: flags.world.beams = { kind: "cantrip" } or { kind: "spell", base: 3, level: 2, scales: true }.
// Repelling Blast (Eldritch Blast only): if the caster has the Repelling Blast invocation, or the item was enchanted, a creature hit
// that is Large or smaller is pushed 10 ft straight away.
// Agonizing Blast (Eldritch Blast only): the beam's damage bonus is set to @mod when the caster has the invocation and
// cleared when they don't, so one shared item works for every warlock.
if (args[0]?.macroPass !== "postActiveEffects") return;
const used = workflow?.activity;
if (used?.midiProperties?.identifier !== "beam-cast") return;

const realItem = actor.items.get(rolledItem?.id ?? macroItem?.id) ?? rolledItem ?? macroItem;
const title = realItem.name;
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));
let beam = realItem.system.activities.find((a) => a.midiProperties?.identifier === "beam");
if (!beam) return ui.notifications.warn(`${title}: beam activity is missing.`);

if (realItem.system?.identifier === "eldritch-blast" || /Eldritch Blast/i.test(realItem.name)) {
  const agonizing = actor.items.some((i) => i.type === "feat" && (i.system?.identifier === "agonizing-blast" || /Agonizing Blast/i.test(i.name)));
  const wantBonus = agonizing ? "@mod" : "";
  const parts = beam.toObject().damage?.parts ?? [];
  if (parts.some((p) => (p.bonus ?? "") !== wantBonus)) {
    await realItem.update({ [`system.activities.${beam.id}.damage.parts`]: parts.map((p) => ({ ...p, bonus: wantBonus })) });
    beam = realItem.system.activities.get(beam.id);
  }
}

const cfg = realItem.flags?.world?.beams ?? {};
let count;
if (cfg.kind === "cantrip") {
  const lvl = actor.type === "character" ? Number(actor.system.details?.level ?? 1) : Math.max(1, Math.floor(Number(actor.system.details?.cr ?? 1)));
  count = 1 + (lvl >= 5) + (lvl >= 11) + (lvl >= 17);
} else {
  const baseLevel = Number(cfg.level ?? realItem.system.level ?? 2) || 2;
  const castLevel = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? baseLevel) || baseLevel;
  count = Number(cfg.base ?? 3) + (cfg.scales === false ? 0 : Math.max(0, castLevel - baseLevel));
}

const targets = (workflow.targets?.tokens ?? Array.from(workflow.targets ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);
if (!targets.length) return ui.notifications.warn(`${title}: target one or more creatures before casting.`);

let plan = targets.map(() => 0);
if (targets.length === 1) plan[0] = count;
else {
  for (let i = 0; i < count; i++) plan[i % targets.length]++;
  const rows = targets.map((t, i) => `<div class="form-group"><label>${esc(t.name)}</label>
    <input type="number" name="t${i}" value="${plan[i]}" min="0" max="${count}" step="1"></div>`).join("");
  let data = null;
  try {
    data = await foundry.applications.api.DialogV2.input({
      window: { title }, content: `<p>Split <strong>${count}</strong> ${count === 1 ? "beam" : "beams"} between your targets.</p>${rows}`,
      ok: { label: "Fire" }, rejectClose: false
    });
  } catch (err) { console.warn(`${title} | beam dialog failed`, err); }
  if (data) {
    const asked = targets.map((_, i) => Math.max(0, parseInt(data[`t${i}`]) || 0));
    let total = asked.reduce((a, b) => a + b, 0);
    if (total > 0) {
      while (total > count) { const i = asked.findLastIndex((n) => n > 0); asked[i]--; total--; }
      for (let i = 0; total < count; i++) { asked[i % asked.length]++; total++; }
      plan = asked;
    }
  }
}

// Repelling Blast: on when the caster has the invocation (or the item was enchanted "…, Repelling"), unless the
// invocation's on/off toggle effect (flags.world.repellingToggle) is disabled. Eldritch Blast only - Scorching Ray
// shares this macro.
const isEldritchBlast = realItem.system?.identifier === "eldritch-blast" || /Eldritch Blast/i.test(realItem.name);
const invocation = actor.items.find((i) => i.type === "feat" && /Repelling Blast/i.test(i.name));
const pushToggle = invocation?.effects?.find((e) => e.flags?.world?.repellingToggle);
const repelling = isEldritchBlast && (!!invocation || /Repelling/i.test(realItem.name)) && !pushToggle?.disabled;
// midi's hit check turned off ("Auto check hits: none") leaves hitTargets empty; the push then compares the roll to AC.
let checkHits = "all";
try { checkHits = game.settings.get("midi-qol", "ConfigSettings")?.autoCheckHit ?? "all"; } catch (err) { /* keep default */ }
const casterToken = token ?? MidiQOL.tokenForActor?.(actor);
for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  for (let k = 0; k < plan[i]; k++) {
    if ((t.actor?.system?.attributes?.hp?.value ?? 1) <= 0 && k > 0) break; // stop wasting beams on a downed target
    const wf = await MidiQOL.completeActivityUse(beam, {
      midiOptions: { targetUuids: [t.document.uuid], ignoreUserTargets: true, workflowOptions: { targetConfirmation: "none" } }
    }, { configure: false }, {});
    if (!repelling || !wf || !casterToken || !MidiQOL.moveTokenAwayFromPoint) continue;
    let hit = (wf.hitTargets?.tokens ?? Array.from(wf.hitTargets ?? [])).some((h) => (h?.document ?? h)?.uuid === t.document.uuid);
    if (!hit && checkHits === "none" && wf.attackRoll && !wf.isFumble) {
      hit = wf.isCritical || Number(wf.attackRoll.total ?? 0) >= Number(t.actor?.system?.attributes?.ac?.value ?? 10);
    }
    const size = t.actor?.system?.traits?.size;
    if (hit && ["tiny", "sm", "med", "lg"].includes(size)) {
      try { await MidiQOL.moveTokenAwayFromPoint(t, 10, casterToken.center, { animate: false, autoRotate: false }); }
      catch (err) { console.warn(`${title} | Repelling Blast push failed`, err); }
    }
  }
}
