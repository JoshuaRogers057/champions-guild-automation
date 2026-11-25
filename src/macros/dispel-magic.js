// Dispel Magic (2024): spells on the target of the slot's level or lower end; for each higher-level spell, make a
// spellcasting ability check (DC 10 + its level) to end it. Runs after the cast ([postActiveEffects]).
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
const slot = Number(wf.castData?.castLevel ?? wf.spellLevel ?? wf.item.system.level) || 3;
const ability = wf.actor.system.attributes.spellcasting || "int";
const levelOf = (e) => {
  const cast = e.flags?.["midi-qol"]?.castData?.castLevel ?? e.flags?.dnd5e?.spellLevel;
  if (cast) return Number(cast);
  let src = null;
  try { src = e.origin ? fromUuidSync(e.origin) : null; } catch (err) { src = null; }
  const it = src instanceof Item ? src : (src?.item ?? (src?.parent instanceof Item ? src.parent : null));
  return it?.type === "spell" ? Number(it.system.level) : null;
};
for (const t of Array.from(wf.targets ?? [])) {
  const actor = t.actor;
  if (!actor) continue;
  const spells = Array.from(actor.effects).filter((e) => !e.transfer && levelOf(e) > 0);
  if (!spells.length) {
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p><strong>Dispel Magic:</strong> no spell effects found on ${t.name}.</p>` });
    continue;
  }
  const ended = [], kept = [];
  for (const e of spells) {
    const lvl = levelOf(e);
    let ok = lvl <= slot;
    if (!ok) {
      const rolls = await wf.actor.rollAbilityCheck({ ability, target: 10 + lvl }, { configure: false }, { data: { flavor: `Dispel Magic: ${e.name} (DC ${10 + lvl})` } });
      ok = ((Array.isArray(rolls) ? rolls[0] : rolls)?.total ?? 0) >= 10 + lvl;
    }
    if (!ok) { kept.push(e.name); continue; }
    try {
      if (e.isOwner) await e.delete(); else await MidiQOL.socket().executeAsGM("removeEffect", { effectUuid: e.uuid });
      ended.push(e.name);
    } catch (err) { kept.push(e.name); }
  }
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }),
    content: `<p><strong>Dispel Magic</strong> on ${t.name}: ended ${ended.join(", ") || "nothing"}${kept.length ? `; still active: ${kept.join(", ")}` : ""}.</p>` });
}
