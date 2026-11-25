// Hail of Thorns and Lightning Arrow (2024): Bonus Action spells cast right after a ranged weapon attack. The spell's
// passive (transfer) effect calls this macro in the caster's ranged weapon attacks, so it can offer the spell:
//   Hail of Thorns (after a hit): the target and each creature within 5 ft make the DEX save (the spell's activity).
//   Lightning Arrow (after a hit or a miss): the target takes 4d8 Lightning instead of the weapon's damage (half on a
//   miss), then each other creature within 10 ft makes the DEX save. Both +1d8/+1d10 per slot level above the base.
// Config on the spell: flags.world.cgaRangedSpell = { when: "hit" | "any", radius, replace?: { dice, faces, type } }.
// The slot is spent (and the Bonus Action marked used) when you say yes; the save is rolled at that slot level.
const pass = args[0]?.macroPass;
const wf = args[0]?.workflow ?? workflow;
const spell = macroItem;
const cfg = spell?.flags?.world?.cgaRangedSpell;
if (!wf || !cfg || wf.item?.uuid === spell.uuid) return;
if (wf.item?.type !== "weapon" || wf.activity?.actionType !== "rwak") return;
const target = Array.from(wf.targets ?? [])[0];
if (!target) return;
const hit = !!wf.hitTargets?.has?.(target);
const key = `cgaRanged_${spell.id}`;
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));

async function offer() {
  if (wf[key] !== undefined) return wf[key];
  wf[key] = null;
  const { method, prepared, level } = spell.system;
  if (method === "spell" && !(prepared > 0)) return null;
  if (game.combat?.started && MidiQOL.hasUsedBonusAction?.(wf.actor)) return null;
  const slots = Object.entries(wf.actor.system.spells ?? {})
    .map(([k, s]) => ({ key: k, level: Number(s?.level ?? 0), value: Number(s?.value ?? 0), max: Number(s?.max ?? 0) }))
    .filter((s) => s.value > 0 && s.max > 0 && s.level >= level)
    .sort((a, b) => a.level - b.level);
  if (!slots.length) return null;
  const select = `<select name="slot">${slots.map((s) => `<option value="${s.key}">${s.key === "pact" ? `Pact slot (level ${s.level})` : `Level ${s.level}`} - ${s.value} left</option>`).join("")}</select>`;
  let data = null;
  try {
    data = await foundry.applications.api.DialogV2.input({
      window: { title: spell.name },
      content: `<p>You ${hit ? "hit" : "missed"} <strong>${esc(target.name)}</strong>. Cast <strong>${esc(spell.name)}</strong> (Bonus Action)?</p><div class="form-group"><label>Spell slot</label>${select}</div>`,
      ok: { label: `Cast ${spell.name}` },
      buttons: [{ action: "no", label: "Not now" }],
      rejectClose: false
    });
  } catch (err) { console.warn(`${spell.name} | dialog failed`, err); }
  if (!data || typeof data !== "object" || !data.slot) return null;
  const slot = slots.find((s) => s.key === data.slot);
  try {
    await wf.actor.update({ [`system.spells.${slot.key}.value`]: slot.value - 1 });
    await MidiQOL.setBonusActionUsed?.(wf.actor);
  } catch (err) { console.warn(`${spell.name} | couldn't spend the slot`, err); }
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p>${esc(wf.actor.name)} casts <strong>${esc(spell.name)}</strong> (level ${slot.level}).</p>` });
  wf[key] = { level: slot.level };
  return wf[key];
}
const extra = (level) => Math.max(0, level - spell.system.level);

// Lightning Arrow: decide once the hit or miss is known, before damage is rolled.
if (pass === "postAttackRoll" && cfg.when === "any") { await offer(); return; }

if (pass === "postDamageRoll" && cfg.replace && hit && wf[key]) {
  const r = cfg.replace;
  const n = (r.dice + extra(wf[key].level)) * (wf.isCritical ? 2 : 1);
  const roll = await new CONFIG.Dice.DamageRoll(`${n}d${r.faces}`, {}, { type: r.type, properties: ["mgc"] }).evaluate();
  await wf.setDamageRolls([roll]);
  return;
}

if (pass !== "postActiveEffects") return;
if (cfg.when === "hit" && !hit) return;
const cast = cfg.when === "hit" ? await offer() : wf[key];
if (!cast) return;
if (cfg.replace && !hit) {
  const r = cfg.replace;
  const roll = await new Roll(`${r.dice + extra(cast.level)}d${r.faces}`).evaluate();
  const half = Math.floor(roll.total / 2);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), flavor: `${spell.name}: the bolt misses, ${target.name} takes half (${half} ${r.type})` });
  await MidiQOL.applyTokenDamage([{ value: half, type: r.type, properties: ["mgc"] }], half, new Set([target]), spell, new Set(), {}).catch(() => {});
}
const burst = spell.system.activities.find((a) => a.type === "save") ?? spell.system.activities.contents[0];
const caught = canvas.tokens.placeables.filter((t) => t.actor && !t.document.hidden && (t === target
  ? cfg.includeTarget : MidiQOL.computeDistance(target, t, { wallsBlock: true }) <= cfg.radius));
if (!burst || !caught.length) return;
try {
  await MidiQOL.completeActivityUse(burst, {
    midiOptions: { targetUuids: caught.map((t) => t.document.uuid), workflowOptions: { targetConfirmation: "none" } },
    spell: { slot: `spell${cast.level}` }, consume: { spellSlot: false, resources: false, action: false },
    concentration: { begin: false, end: null }, create: { measuredTemplate: false }
  }, { configure: false }, {});
} catch (err) { console.warn(`${spell.name} | burst failed`, err); }
