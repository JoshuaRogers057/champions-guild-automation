// Hex / Hunter's Mark (2024). Config on the item: flags.world.markBonus = { match: "Hex", formula: "1d6", type: "necrotic" }.
//
// 1. Bonus damage - runs from the spell's passive (transfer) effect, flags.midi-qol.onUseMacroName "ItemMacro,damageBonus":
//    midi calls it for every damage roll the caster makes; it adds the die when an attack roll hit a creature carrying
//    this caster's mark (cast from the spell or a scroll of it).
// 2. Moving the mark - item onUse [preItemRoll] + [postActiveEffects] on the activity whose
//    midiProperties.identifier is "mark-move" ("Move Mark" / "Curse New Creature"):
//    - preItemRoll: needs concentration on the spell; if a marked creature is still above 0 HP, asks first (the spell
//      only lets you move the mark once the target drops to 0 HP). Refusing costs nothing.
//    - postActiveEffects: removes this caster's old mark from every other creature. The new mark joins the existing
//      concentration, so the caster keeps concentrating.
const pass = args[0]?.macroPass;
const spell = macroItem ?? rolledItem ?? item;
const cfg = spell?.flags?.world?.markBonus;
if (!cfg) return;
const rx = new RegExp(cfg.match, "i");
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);

function sourceItemOf(ef) {
  const o = ef.system?.origin ?? {};
  const candidates = [o.item, ef.flags?.dae?.itemUuid, typeof o.activity === "string" ? o.activity.split(".Activity.")[0] : null, ef.origin];
  for (const uuid of candidates) {
    if (!uuid || typeof uuid !== "string") continue;
    let doc = null;
    try { doc = fromUuidSync(uuid); } catch (err) { continue; }
    if (!doc) continue;
    if (doc instanceof Item) return doc;
    if (doc.item instanceof Item) return doc.item;
    if (doc.parent instanceof Item) return doc.parent;
    if (doc instanceof ActiveEffect) { const it = MidiQOL.getItemFromEffectOrigin?.(uuid); if (it) return it; }
  }
  return null;
}
const isMine = (ef) => {
  if (ef.transfer) return false;
  const src = sourceItemOf(ef);
  return !!src && src.actor?.id === actor.id && (src.id === spell.id || rx.test(src.name));
};
// Every creature on the scene that carries this caster's mark: [{ token, effects }]
function marks() {
  const out = [];
  for (const t of canvas.tokens?.placeables ?? []) {
    if (!t.actor || t.actor === actor) continue;
    const effects = t.actor.effects.filter(isMine);
    if (effects.length) out.push({ token: t, effects });
  }
  return out;
}

// ---------- 1. bonus damage ----------
if (pass === "DamageBonus") {
  if (!workflow?.activity?.attack) return;
  let hits = asTokens(workflow.hitTargets);
  // midi's hit check turned off ("Auto check hits: none"): hitTargets stays empty, so compare the attack to AC here.
  let checkHits = "all";
  try { checkHits = game.settings.get("midi-qol", "ConfigSettings")?.autoCheckHit ?? "all"; } catch (err) { /* keep default */ }
  if (!hits.length && checkHits === "none" && workflow.attackRoll && !workflow.isFumble) {
    const total = Number(workflow.attackRoll.total ?? 0);
    hits = asTokens(workflow.targets)
      .filter((t) => t.actor && (workflow.isCritical || total >= Number(t.actor.system?.attributes?.ac?.value ?? 10)));
  }
  const marked = hits.find((t) => Array.from(t.actor?.appliedEffects ?? t.actor?.effects ?? []).some((ef) => !ef.disabled && isMine(ef)));
  if (!marked) return;
  // A character can own the spell twice (e.g. a Vengeance paladin's oath spell plus the class-list copy). Each copy's
  // passive effect calls this macro for the same damage roll, so only the first call adds the die.
  const key = `cga-mark|${cfg.match}`.toLowerCase();
  const now = Date.now();
  workflow.cgaMarkBonus ??= {};
  if (now - (workflow.cgaMarkBonus[key] ?? 0) < 2000) return;
  workflow.cgaMarkBonus[key] = now;
  workflow.cgaMarkHit = marked.document?.uuid; // Superior Hunter's Prey (Hunter 11) follows up on this
  // Foe Slayer (Ranger 20): the Hunter's Mark die becomes a d10.
  const foeSlayer = /hunter/i.test(cfg.match) && workflow.actor?.items?.some((i) => i.system?.identifier === "foe-slayer");
  return { damageRoll: foeSlayer ? "1d10" : (cfg.formula ?? "1d6"), damageType: cfg.type, flavor: spell.name };
}

// ---------- 2. moving the mark ----------
const act = workflow?.activity ?? rolledActivity ?? macroActivity;
if (act?.midiProperties?.identifier !== "mark-move") return;

if (pass === "preItemRoll") {
  const concentrating = actor.effects.some((e) => e.statuses?.has("concentrating") && !e.disabled
    && (e.flags?.dnd5e?.item?.id === spell.id || e.name?.includes(spell.name)));
  if (!concentrating) {
    ui.notifications.warn(`${spell.name}: you aren't concentrating on ${spell.name}, so there's no mark to move. Cast it again instead.`);
    return false;
  }
  const living = marks().filter((m) => (m.token.actor.system.attributes?.hp?.value ?? 1) > 0);
  if (!living.length) return true;
  const names = living.map((m) => `<strong>${esc(m.token.name)}</strong>`).join(", ");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: spell.name },
    content: `<p>${names} still ${living.length === 1 ? "has" : "have"} your ${esc(spell.name)} and ${living.length === 1 ? "is" : "are"} above 0 HP.</p>
      <p>You can normally only move it after the target drops to 0 HP. Move it anyway?</p>`,
    rejectClose: false
  });
  return ok ? true : false;
}

if (pass === "postActiveEffects") {
  const keep = new Set(asTokens(workflow.targets).map((t) => t.actor?.uuid));
  for (const m of marks()) {
    if (keep.has(m.token.actor.uuid)) continue;
    const ids = m.effects.map((e) => e.id);
    try {
      if (m.token.actor.isOwner) await m.token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      else await MidiQOL.socket().executeAsGM("removeEffects", { actorUuid: m.token.actor.uuid, effects: ids });
    } catch (err) { console.warn(`${spell.name} | could not remove the old mark from ${m.token.name}`, err); }
  }
}
