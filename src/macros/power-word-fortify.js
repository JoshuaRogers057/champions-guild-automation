// Power Word Fortify (2024): up to six creatures you can see within 60 ft share 120 Temporary Hit Points, divided as
// you choose. Runs before the cast resolves ([postActiveEffects]): asks how to split it (evenly by default).
if (args[0]?.macroPass !== "postActiveEffects") return;
const wf = args[0]?.workflow ?? workflow;
const targets = Array.from(wf.targets ?? []).slice(0, 6);
if (!targets.length) return ui.notifications.warn("Power Word Fortify: target up to six creatures first.");
const even = Math.floor(120 / targets.length);
const rows = targets.map((t, i) => `<div class="form-group"><label>${t.name}</label><input type="number" name="t${i}" value="${i === 0 ? 120 - even * (targets.length - 1) : even}" min="0" max="120"></div>`).join("");
const split = await foundry.applications.api.DialogV2.prompt({
  window: { title: "Power Word Fortify: divide 120 Temporary Hit Points" },
  content: `<p>Divide 120 Temporary Hit Points between the targets.</p>${rows}`,
  ok: { label: "Fortify", callback: (event, button) => targets.map((t, i) => Math.max(0, Number(button.form.elements[`t${i}`].value) || 0)) },
  rejectClose: false
});
if (!split) return;
const total = split.reduce((a, b) => a + b, 0);
if (total > 120) return ui.notifications.warn(`Power Word Fortify: that's ${total}, more than 120. Cast it again.`);
for (const [i, t] of targets.entries()) {
  if (!split[i]) continue;
  try { await MidiQOL.applyTokenDamage([{ value: split[i], type: "temphp" }], split[i], new Set([t]), wf.item, new Set(), {}); }
  catch (err) { console.warn(`Power Word Fortify | ${t.name}`, err); }
}
