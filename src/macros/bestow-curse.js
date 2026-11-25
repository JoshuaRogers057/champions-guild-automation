// Bestow Curse (2024).
//  - item onUse [postActiveEffects], Curse Attacks: the curse's "Disadvantage on attack rolls" applies only to attacks
//    against the caster, so point its condition at the caster's token.
//  - passive (transfer) effect flags.midi-qol.onUseMacroName "ItemMacro,damageBonus", Curse Resilience: when the caster
//    deals damage to the cursed creature with an attack roll or a spell, it takes an extra 1d8 Necrotic.
const pass = args[0]?.macroPass;
const spell = macroItem ?? item;
const wf = args[0]?.workflow ?? workflow;
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);
const fromThisCaster = (ef) => {
  if (ef.disabled || ef.transfer) return false;
  const origin = String(ef.origin ?? "");
  // The curse's origin is the spell or the caster's concentration effect, so anything from this caster counts.
  return !!spell.actor && (origin.startsWith(spell.uuid) || origin.startsWith(`${spell.actor.uuid}.`));
};

if (pass === "DamageBonus") {
  if (!wf || wf.item?.uuid === spell.uuid) return;
  const isAttack = !!wf.activity?.attack;
  const isSpell = wf.item?.type === "spell";
  if (!isAttack && !isSpell) return;
  const victims = asTokens(isAttack ? wf.hitTargets : wf.targets);
  const cursed = victims.some((t) => Array.from(t.actor?.effects ?? []).some((ef) => fromThisCaster(ef) && ef.name === "Cursed Resilience"));
  if (!cursed) return;
  wf.cgaCurseBonus ??= 0;
  if (Date.now() - wf.cgaCurseBonus < 2000) return; // once per damage roll
  wf.cgaCurseBonus = Date.now();
  return { damageRoll: "1d8", damageType: "necrotic", flavor: spell.name };
}

if (pass === "postActiveEffects" && wf?.activity?.name === "Curse Attacks") {
  const casterToken = wf.token ?? MidiQOL.tokenForActor?.(wf.actor);
  if (!casterToken) return;
  const KEY = "flags.midi-qol.disadvantage.attack.all";
  for (const t of asTokens(wf.failedSaves)) {
    const ef = Array.from(t.actor.effects).find((e) => e.name === "Cursed Attacks" && fromThisCaster(e));
    if (!ef) continue;
    const changes = (ef.system?.changes ?? ef.changes ?? []).map((c) => {
      const o = typeof c.toObject === "function" ? c.toObject() : { ...c };
      if (o.key === KEY) o.value = `targetUuid === "${casterToken.document.uuid}"`;
      return o;
    });
    try {
      if (ef.isOwner) await ef.update({ "system.changes": changes });
      else await MidiQOL.socket().executeAsGM("updateEffects", { actorUuid: t.actor.uuid, updates: [{ _id: ef.id, "system.changes": changes }] });
    } catch (err) { console.warn("Bestow Curse | couldn't aim the curse at the caster", err); }
  }
}
