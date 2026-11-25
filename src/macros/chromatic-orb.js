// Chromatic Orb (2024): if two or more of the damage d8s match, the orb leaps to a different creature within 30 ft of
// the target: a new attack and damage roll, no slot spent. It can leap as many times as the slot level, and each
// creature can be targeted only once per casting. Runs after each orb's damage is applied ([postActiveEffects]).
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
const spell = wf?.item ?? item;
const activity = wf?.activity;
if (!wf || !activity) return;
const chains = (globalThis.cgaOrbChains ??= new Map());
const chainId = wf.workflowOptions?.cgaOrbChain ?? foundry.utils.randomID();
const level = Number(wf.castData?.castLevel ?? wf.spellLevel ?? spell.system.level ?? 1) || 1;
const chain = chains.get(chainId) ?? { leapsLeft: level, hit: new Set() };
chains.set(chainId, chain);
const target = Array.from(wf.hitTargets ?? [])[0];
for (const t of wf.targets ?? []) chain.hit.add(t.document?.uuid ?? t.uuid);
const done = () => chains.delete(chainId);
if (!target) return done();
const dice = (wf.damageRolls ?? []).flatMap((r) => r.dice ?? []).filter((d) => d.faces === 8).flatMap((d) => d.results.filter((x) => x.active !== false).map((x) => x.result));
const matched = dice.some((v, i) => dice.indexOf(v) !== i);
if (!matched || chain.leapsLeft <= 0) return done();
const near = canvas.tokens.placeables.filter((t) => t.actor && t !== target && t.document.uuid !== wf.token?.document?.uuid
  && !chain.hit.has(t.document.uuid) && !t.document.hidden && (t.actor.system.attributes?.hp?.value ?? 0) > 0
  && MidiQOL.computeDistance(target, t, { wallsBlock: true }) <= 30);
if (!near.length) {
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: wf.actor }), content: `<p><strong>${spell.name}:</strong> the dice matched, but there's no other creature within 30 ft of ${target.name} to leap to.</p>` });
  return done();
}
const type = wf.damageRolls?.[0]?.options?.type ?? "";
const pick = await foundry.applications.api.DialogV2.wait({
  window: { title: `${spell.name}: the orb leaps` },
  content: `<p>The damage dice matched (${dice.join(", ")}). Pick a creature within 30 ft of ${target.name} (${chain.leapsLeft} leap${chain.leapsLeft === 1 ? "" : "s"} left).</p>`
    + `<div class="form-group"><select name="target">${near.map((t) => `<option value="${t.document.uuid}">${t.name}</option>`).join("")}</select></div>`,
  buttons: [
    { action: "leap", label: "Leap", icon: "fa-solid fa-bolt", default: true, callback: (event, button) => button.form.elements.target.value },
    { action: "no", label: "Don't leap", icon: "fa-solid fa-xmark" }
  ],
  rejectClose: false
});
if (!pick || pick === "no") return done();
chain.leapsLeft -= 1;
const next = fromUuidSync(pick);
next?.object?.setTarget?.(true, { releaseOthers: true });
try {
  await MidiQOL.completeActivityUse(activity, {
    midiOptions: { targetUuids: [pick], workflowOptions: { targetConfirmation: "none", cgaOrbChain: chainId } },
    spell: { slot: level > 0 ? `spell${level}` : undefined }, consume: { spellSlot: false, resources: false },
    create: { measuredTemplate: false }
  }, { configure: false }, {});
} catch (err) { console.warn("Chromatic Orb | leap failed", err); done(); }
