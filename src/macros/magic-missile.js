// Magic Missile (2024). midi-qol onUse: [postActiveEffects] on the "Cast" activity (midiProperties.identifier "mm-cast").
// - Darts: 3 at 1st level, +1 per slot level above 1st.
// - Who gets them: one targeted creature gets every dart. Several targeted creatures: a dialog splits the darts between
//   just those. Nothing targeted: the dialog lists every visible creature within range. "Fire" unlocks when exactly
//   all darts are assigned.
// - Damage: the dart damage (the "Dart" activity, 1d4 + 1 Force) is rolled ONCE; every dart deals that amount, so a
//   creature hit by 3 darts takes 3x the roll. Damage goes through midi (resistances, damage cards, concentration).
if (args[0]?.macroPass !== "postActiveEffects") return;
if (workflow?.activity?.midiProperties?.identifier !== "mm-cast") return;

const spell = actor.items.get(rolledItem?.id ?? macroItem?.id) ?? rolledItem ?? macroItem;
const TITLE = spell.name;
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);
const casterToken = token ?? MidiQOL.tokenForActor?.(actor);

const baseLevel = Number(spell.system.level ?? 1) || 1;
const castLevel = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? baseLevel) || baseLevel;
const darts = 3 + Math.max(0, castLevel - baseLevel);
const range = Number(workflow.activity.range?.value ?? spell.system.range?.value ?? 120) || 120;

// ---------- who can be targeted ----------
let candidates = asTokens(workflow.targets).filter((t) => t !== casterToken);
const picked = candidates.length > 0;
if (!picked) {
  const D = CONST.TOKEN_DISPOSITIONS;
  candidates = (canvas.tokens?.placeables ?? []).filter((t) => {
    if (t === casterToken || !t.actor || t.document.hidden || !t.visible) return false;
    if ((t.actor.system.attributes?.hp?.value ?? 1) <= 0) return false;
    if (!casterToken || !MidiQOL.computeDistance) return true;
    return MidiQOL.computeDistance(casterToken, t, { wallsBlock: false, includeCover: false }) <= range + 0.01;
  }).sort((a, b) => (a.document.disposition === D.HOSTILE ? 0 : 1) - (b.document.disposition === D.HOSTILE ? 0 : 1)
    || a.name.localeCompare(b.name));
}
if (!candidates.length) return ui.notifications.warn(`${TITLE}: no creatures within ${range} ft to target. The slot is spent.`);

// ---------- split the darts ----------
let plan;
if (candidates.length === 1) plan = [darts];
else {
  const start = candidates.map((_, i) => (picked ? Math.floor(darts / candidates.length) + (i < darts % candidates.length ? 1 : 0) : 0));
  const rows = candidates.map((t, i) => {
    const dist = casterToken && MidiQOL.computeDistance ? Math.round(MidiQOL.computeDistance(casterToken, t, { wallsBlock: false, includeCover: false })) : null;
    return `<tr>
      <td><img src="${esc(t.document.texture?.src)}" width="28" height="28" style="vertical-align:middle;border:none"> ${esc(t.name)}</td>
      <td style="text-align:right;opacity:.7">${dist != null ? dist + " ft" : ""}</td>
      <td style="width:70px"><input type="number" name="t${i}" value="${start[i]}" min="0" max="${darts}" step="1"></td></tr>`;
  }).join("");
  const content = `<p>Assign <strong>${darts}</strong> darts (level ${castLevel} slot). <span class="cga-mm-count"></span></p>
    <table><tbody>${rows}</tbody></table>`;
  let data = null;
  try {
    data = await foundry.applications.api.DialogV2.input({
      window: { title: TITLE },
      position: { width: 380 },
      content,
      ok: { label: "Fire", icon: "fa-solid fa-wand-sparkles" },
      rejectClose: false,
      render: (event, dialog) => {
        const root = dialog.element;
        const fire = root.querySelector('button[data-action="ok"]');
        const counter = root.querySelector(".cga-mm-count");
        const update = () => {
          const total = [...root.querySelectorAll('input[type="number"]')].reduce((n, el) => n + Math.max(0, parseInt(el.value) || 0), 0);
          counter.textContent = `${total} / ${darts} assigned`;
          counter.style.color = total === darts ? "" : "var(--color-level-error, #c33)";
          if (fire) fire.disabled = total !== darts;
        };
        root.addEventListener("input", update);
        update();
      }
    });
  } catch (err) { console.warn(`${TITLE} | dialog failed`, err); }
  if (!data) {
    // Closed without firing: spread the darts evenly over the creatures you targeted (or the first few in range).
    plan = candidates.map((_, i) => Math.floor(darts / candidates.length) + (i < darts % candidates.length ? 1 : 0));
    ui.notifications.info(`${TITLE}: dialog closed - darts spread evenly.`);
  } else {
    plan = candidates.map((_, i) => Math.max(0, parseInt(data[`t${i}`]) || 0));
  }
}
const hits = candidates.map((t, i) => ({ token: t, n: plan[i] })).filter((h) => h.n > 0);
if (!hits.length) return;

// ---------- one damage roll for every dart ----------
const dart = spell.system.activities.find((a) => a.midiProperties?.identifier === "mm-dart") ?? spell.system.activities.find((a) => a.type === "damage");
const part = dart?.damage?.parts?.[0];
const formula = part?.formula || "1d4 + 1";
const type = part?.types?.first?.() ?? Array.from(part?.types ?? [])[0] ?? "force";
const DamageRoll = CONFIG.Dice.DamageRoll ?? Roll;
const roll = await new DamageRoll(formula, dart?.getRollData?.() ?? actor.getRollData(), { type, properties: ["mgc"] }).evaluate();
const per = Math.max(0, roll.total);
await roll.toMessage({
  speaker: ChatMessage.getSpeaker({ actor, token: casterToken?.document }),
  flavor: `<strong>${esc(TITLE)}</strong> - each dart deals <strong>${per}</strong> ${esc(type)} (${esc(formula)}, rolled once)<br>`
    + hits.map((h) => `${esc(h.token.name)}: ${h.n} ${h.n === 1 ? "dart" : "darts"} = <strong>${h.n * per}</strong>`).join("<br>")
});

// Optional animation (JB2A + Sequencer, if installed).
try {
  const file = "jb2a.magic_missile";
  if (casterToken && game.modules.get("sequencer")?.active && globalThis.Sequencer?.Database?.entryExists?.(file)) {
    const seq = new Sequence();
    for (const h of hits) seq.effect().file(file).atLocation(casterToken).stretchTo(h.token).repeats(h.n, 180).randomizeMirrorY();
    seq.play();
  }
} catch (err) { console.warn(`${TITLE} | animation skipped`, err); }

for (const h of hits) {
  const value = h.n * per;
  try {
    await MidiQOL.applyTokenDamage([{ value, type, properties: ["mgc"] }], value, new Set([h.token]), spell, new Set(), { workflow });
  } catch (err) {
    console.error(`${TITLE} | damage to ${h.token.name} failed`, err);
    ui.notifications.error(`${TITLE}: couldn't apply damage to ${h.token.name} - see the console (F12).`);
  }
}
