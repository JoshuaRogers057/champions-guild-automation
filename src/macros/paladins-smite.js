// Paladin's Smite (2024): after you hit with a melee weapon or an Unarmed Strike, offer a smite.
// Runs from the feature's passive (transfer) effect: flags.midi-qol.onUseMacroName "ItemMacro,postActiveEffects".
//
// The prompt lists every smite spell on the sheet you can cast right now (Divine, Searing, Thunderous, Wrathful,
// Shining, Blinding, Staggering, Banishing, ...) with the spell-slot levels you have left, plus the free Divine Smite
// from this feature (once per Long Rest, its own uses). The chosen smite is cast at the creature you hit; a critical hit
// doubles its dice. Divine Smite picks its Fiend/Undead version automatically. No prompt when you've already smitten
// (or used your Bonus Action) this turn in combat, the target is at 0 HP, or you have nothing to smite with.
if (args[0]?.macroPass !== "postActiveEffects") return;
const used = workflow?.activity;
if (!used?.attack || workflow.item?.type === "spell") return;
if (used.actionType !== "mwak") return; // melee weapon attacks (Unarmed Strike included)

const feature = macroItem;
const TITLE = feature?.name ?? "Paladin's Smite";
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);

// Who was hit (midi's "Auto check hits: none" leaves hitTargets empty, so compare the attack to AC then).
let hits = asTokens(workflow.hitTargets);
let checkHits = "all";
try { checkHits = game.settings.get("midi-qol", "ConfigSettings")?.autoCheckHit ?? "all"; } catch (err) { /* keep default */ }
if (!hits.length && checkHits === "none" && workflow.attackRoll && !workflow.isFumble) {
  const total = Number(workflow.attackRoll.total ?? 0);
  hits = asTokens(workflow.targets).filter((t) => t.actor && (workflow.isCritical || total >= Number(t.actor.system?.attributes?.ac?.value ?? 10)));
}
const target = hits.find((t) => (t.actor?.system?.attributes?.hp?.value ?? 1) > 0);
if (!target) return;

// One smite per turn: midi's bonus-action tracking (only on when its action enforcement is enabled), plus our own
// record of the turn we last smote in, so it works either way.
const combat = game.combat?.started ? game.combat : null;
const turnKey = combat ? `${combat.id}.${combat.round}.${combat.turn}` : null;
if (combat && (MidiQOL.hasUsedBonusAction?.(actor) || actor.getFlag("world", "cgaSmiteTurn") === turnKey)) return;

const creatureType = target.actor.system.details?.type?.value ?? "";
const unholy = ["fiend", "undead"].includes(creatureType);
const UNHOLY_RX = /unholy|fiend|undead/i;
const pickActivity = (it) => {
  const acts = it.system.activities.filter((a) => !a.midiProperties?.automationOnly).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (acts.some((a) => UNHOLY_RX.test(a.name ?? ""))) {
    return acts.find((a) => UNHOLY_RX.test(a.name ?? "") === unholy) ?? acts[0];
  }
  return acts[0];
};

// Spell-slot levels left that can cast a spell of `level`: [{ key, level, value }]
const slotsFor = (level) => Object.entries(actor.system.spells ?? {})
  .map(([key, s]) => ({ key, level: Number(s?.level ?? 0), value: Number(s?.value ?? 0), max: Number(s?.max ?? 0) }))
  .filter((s) => s.value > 0 && s.max > 0 && s.level >= level && s.level > 0)
  .sort((a, b) => a.level - b.level || (a.key === "pact") - (b.key === "pact"));

const options = [];
const freeUses = Number(feature?.system?.uses?.value ?? 0);
if (freeUses > 0 && feature.system.activities.size) {
  options.push({ label: `Divine Smite - free (${freeUses}/${feature.system.uses.max} left, Long Rest)`, activity: pickActivity(feature), slots: [] });
}
const smites = actor.items.filter((i) => i.type === "spell" && (/-smite$/.test(i.system.identifier ?? "") || /\bSmite\b/i.test(i.name)));
for (const sp of smites) {
  const { method, prepared, level } = sp.system;
  const isDivine = sp.system.identifier === "divine-smite";
  const usesSlots = ["spell", "pact"].includes(method ?? "spell");
  if (method === "spell" && !(prepared > 0) && !isDivine) continue; // not prepared (Paladin's Smite always prepares Divine Smite)
  const activity = pickActivity(sp);
  if (!activity) continue;
  if (usesSlots) {
    const slots = slotsFor(level);
    if (!slots.length) continue;
    options.push({ label: sp.name, activity, slots });
  } else if (!sp.system.uses?.max || sp.system.uses.value > 0) {
    options.push({ label: sp.name, activity, slots: [] });
  }
}
if (!options.length) return;

const rows = options.map((o, i) => {
  const select = o.slots.length
    ? `<select name="slot${i}">${o.slots.map((s) => `<option value="${s.key}">${s.key === "pact" ? `Pact slot (level ${s.level})` : `Level ${s.level}`} - ${s.value} left</option>`).join("")}</select>`
    : "";
  return `<tr><td style="width:24px"><input type="radio" name="choice" value="${i}" ${i === 0 ? "checked" : ""}></td>
    <td>${esc(o.label)}</td><td>${select}</td></tr>`;
}).join("");

let data = null;
try {
  data = await foundry.applications.api.DialogV2.input({
    window: { title: TITLE },
    position: { width: 460 },
    content: `<p>You hit <strong>${esc(target.name)}</strong>${workflow.isCritical ? " with a <strong>critical hit</strong>" : ""}. Smite?</p>
      <table><tbody>${rows}</tbody></table>`,
    ok: { label: "Smite", icon: "fa-solid fa-sun" },
    buttons: [{ action: "no", label: "No smite", icon: "fa-solid fa-xmark" }],
    rejectClose: false
  });
} catch (err) { console.warn(`${TITLE} | dialog failed`, err); }
if (!data || typeof data !== "object") return; // "No smite" or closed

const choice = options[Number(data.choice)];
if (!choice) return;
const usage = {
  midiOptions: {
    targetUuids: [target.document.uuid],
    ignoreUserTargets: true,
    isCritical: !!workflow.isCritical,
    workflowOptions: { targetConfirmation: "none" }
  }
};
const slotKey = data[`slot${Number(data.choice)}`];
if (slotKey) usage.spell = { slot: slotKey };
try {
  const wf = await MidiQOL.completeActivityUse(choice.activity, usage, { configure: false }, {});
  if (wf && turnKey) await actor.setFlag("world", "cgaSmiteTurn", turnKey);
} catch (err) {
  console.error(`${TITLE} | smite failed`, err);
  ui.notifications.error(`${TITLE}: the smite failed - see the console (F12).`);
}
