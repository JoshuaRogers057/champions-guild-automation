// Champions Guild Automation - Report Bug.
//
// Every item on a character sheet (feature, spell, weapon, armor, magic item, feat, species trait...) gets a
// "Report Bug" button in its sheet's title bar and in the right-click menu on the actor sheet. It asks what the
// player expected to happen and what actually happened, and sends that to championsguildrpg.com with what's needed
// to find the problem: the item's automation, activities and effects, module versions and recent errors.
// Reports are read at championsguildrpg.com/admin/foundry-bugs (CGTEST docs/foundry-bug-reports.md).
import { MODULE_ID } from "./main.js";

const DEFAULT_URL = "https://championsguildrpg.com/api/foundry/bug-reports";
const MAX_TEXT = 4000;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const clip = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

// ------------------------------------------------------------------ recent errors, sent with a report
const recentErrors = [];
function remember(kind, parts) {
  const text = parts.map((p) => (p instanceof Error ? `${p.message}\n${p.stack ?? ""}` : typeof p === "string" ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })())).join(" ");
  recentErrors.push({ at: new Date().toISOString(), kind, text: clip(text, 800) });
  if (recentErrors.length > 15) recentErrors.shift();
}
const origError = console.error.bind(console);
console.error = (...args) => { try { remember("error", args); } catch {} return origError(...args); };
window.addEventListener("error", (e) => remember("uncaught", [e.error ?? e.message]));
window.addEventListener("unhandledrejection", (e) => remember("unhandled promise", [e.reason]));

// ------------------------------------------------------------------ setting
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "bugReportUrl", {
    name: "Bug report address",
    hint: "Where Report Bug sends reports. Leave as is unless the Champions Guild site moves.",
    scope: "world", config: true, type: String, default: DEFAULT_URL
  });
});

// ------------------------------------------------------------------ where the button shows
const reportable = (item) => item instanceof Item && item.parent instanceof Actor && item.isOwner;

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const item = app.document;
  if (!reportable(item)) return;
  if (controls.some((c) => c.action === "cgaReportBug")) return;
  controls.push({ action: "cgaReportBug", icon: "fa-solid fa-bug", label: "Report Bug", onClick: () => openReport(item) });
});

// Also a bug icon right in the title bar, so players don't have to find it in the ⋮ menu.
Hooks.on("renderApplicationV2", (app, element) => {
  const item = app.document;
  if (!reportable(item)) return;
  const header = (app.element ?? element)?.querySelector?.(".window-header");
  if (!header || header.querySelector(".cga-report-bug")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control icon fa-solid fa-bug cga-report-bug";
  btn.dataset.tooltip = "Report Bug";
  btn.setAttribute("aria-label", "Report Bug");
  btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openReport(item); });
  const before = header.querySelector('[data-action="toggleControls"]') ?? header.querySelector('[data-action="close"]');
  if (before) header.insertBefore(btn, before); else header.append(btn);
});

Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
  if (!reportable(item)) return;
  options.push({ name: "Report Bug", label: "Report Bug", icon: '<i class="fa-solid fa-bug"></i>', group: "action", callback: () => openReport(item) });
});

// ------------------------------------------------------------------ what gets sent
function automationOf(item) {
  const cat = item.flags?.cat?.automation;
  const src = item._stats?.compendiumSource ?? "";
  if (cat && (cat.source === MODULE_ID || src.includes(`Compendium.${MODULE_ID}.`) || /Champions Guild Automation/i.test(cat.notes ?? ""))) return `Champions Guild Automation ${cat.version ?? ""}`.trim();
  if (cat) return `CAT automation ${cat.version ?? ""}${cat.source ? ` (${cat.source})` : ""}`.trim();
  if (src.includes("midi-qol")) return "midi-qol";
  if (src.startsWith("Compendium.dnd5e.")) return "dnd5e (no CAT automation applied)";
  if (item.flags?.[MODULE_ID]?.site) return "Champions Guild website item (no CAT automation applied)";
  return "none found";
}

function siteCharacterId(actor) {
  const exp = actor?.flags?.[MODULE_ID]?.export;
  if (!exp || exp.test) return null;
  return /^\d+$/.test(String(exp.character ?? "")) ? String(exp.character) : null;
}

function itemDetails(item) {
  const sys = item.system ?? {};
  return {
    uuid: item.uuid,
    compendiumSource: item._stats?.compendiumSource ?? null,
    catAutomation: item.flags?.cat?.automation ?? null,
    siteImport: item.flags?.[MODULE_ID]?.site ?? null,
    midiOnUse: item.flags?.["midi-qol"]?.onUseMacroName ?? null,
    hasItemMacro: !!(item.flags?.dae?.macro?.command || item.flags?.itemacro?.macro?.command),
    uses: sys.uses ? { value: sys.uses.value ?? null, max: sys.uses.max ?? null, recovery: (sys.uses.recovery ?? []).map((r) => r.period) } : null,
    equipped: sys.equipped ?? null, attuned: sys.attuned ?? null, prepared: sys.prepared ?? sys.preparation?.mode ?? null,
    activities: (sys.activities?.contents ?? [...(sys.activities ?? [])]).map((a) => ({
      id: a.id, name: a.name, type: a.type, activation: a.activation?.type ?? null,
      otherActivityId: a.otherActivityId ?? null, midiIdentifier: a.midiProperties?.identifier ?? null,
      consumption: (a.consumption?.targets ?? []).map((t) => `${t.type}:${t.target ?? ""}:${t.value ?? ""}`),
      effects: (a.effects ?? []).map((e) => e._id)
    })),
    effects: item.effects.map((e) => ({ id: e.id, name: e.name, type: e.type, disabled: e.disabled, transfer: e.transfer, statuses: [...(e.statuses ?? [])], changes: (e.system?.changes ?? e.changes ?? []).length }))
  };
}

function recentChat(actor) {
  return game.messages.contents.slice(-25).filter((m) => !actor || m.speaker?.actor === actor.id).slice(-6).map((m) => ({
    at: new Date(m.timestamp).toISOString(),
    flavor: clip(m.flavor, 150),
    text: clip(String(m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 300)
  }));
}

function buildReport(item, expected, actual) {
  const actor = item.parent;
  return {
    moduleVersion: game.modules.get(MODULE_ID)?.version ?? null,
    expected, actual,
    item: { name: item.name, type: item.type, identifier: item.system?.identifier ?? null, automation: automationOf(item) },
    actor: { name: actor?.name ?? null, siteCharacterId: siteCharacterId(actor) },
    reporter: { name: game.user.name, isGM: game.user.isGM },
    world: { title: game.world.title },
    foundryVersion: game.version,
    systemVersion: game.system.version,
    details: {
      item: itemDetails(item),
      actor: actor ? { type: actor.type, level: actor.system?.details?.level ?? null, classes: Object.values(actor.classes ?? {}).map((c) => `${c.name} ${c.system.levels}`) } : null,
      modules: Object.fromEntries(game.modules.filter((m) => m.active).map((m) => [m.id, m.version])),
      recentErrors: [...recentErrors],
      recentChat: recentChat(actor)
    }
  };
}

// ------------------------------------------------------------------ the form
async function openReport(item) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const content = `
    <p style="margin-top:0">Something about <strong>${esc(item.name)}</strong> on ${esc(item.parent?.name)}'s sheet isn't working right?
    Tell us and it goes straight to the Champions Guild team.</p>
    <div class="form-group stacked">
      <label for="cga-bug-expected"><strong>What did you expect to happen?</strong></label>
      <textarea id="cga-bug-expected" name="expected" rows="4" maxlength="${MAX_TEXT}" required
        placeholder="e.g. My punch should only deal damage."></textarea>
    </div>
    <div class="form-group stacked">
      <label for="cga-bug-actual"><strong>What actually happened?</strong></label>
      <textarea id="cga-bug-actual" name="actual" rows="4" maxlength="${MAX_TEXT}" required
        placeholder="e.g. It also grappled the target and knocked it prone."></textarea>
    </div>
    <p class="hint" style="font-size:0.85em;opacity:0.8">Sent with it: your Foundry user name, the character's name, this item's
    automation settings, the game's module versions, recent error messages and the last few chat messages from this character.</p>`;
  const result = await DialogV2.wait({
    window: { title: `Report Bug: ${item.name}`, icon: "fa-solid fa-bug" },
    position: { width: 520 },
    content,
    rejectClose: false,
    buttons: [
      { action: "send", label: "Send Report", icon: "fa-solid fa-paper-plane", default: true,
        callback: (event, button) => ({ expected: button.form.elements.expected.value.trim(), actual: button.form.elements.actual.value.trim() }) },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" }
    ]
  }).catch(() => null);
  if (!result || typeof result !== "object") return;
  if (!result.expected || !result.actual) {
    ui.notifications.warn("Report Bug: please fill in both boxes, what you expected and what actually happened.");
    return openReport(item);
  }
  return sendReport(item, result.expected, result.actual);
}

async function sendReport(item, expected, actual) {
  const report = buildReport(item, expected, actual);
  const url = game.settings.get(MODULE_ID, "bugReportUrl") || DEFAULT_URL;
  let reply = null, problem = null;
  try {
    // text/plain keeps this a "simple" request, so the browser sends it without a CORS preflight.
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(report) });
    reply = await res.json().catch(() => null);
    if (!res.ok || !reply?.ok) problem = reply?.error ?? `the site answered ${res.status}`;
  } catch (err) {
    problem = err?.message ?? String(err);
  }
  if (!problem) {
    ui.notifications.info(`Bug report #${reply.id} sent for ${item.name}. Thank you!`);
    return reply.id;
  }
  // Not lost: the report goes to the GMs in chat so it can be passed on by hand.
  console.warn(`${MODULE_ID} | bug report could not be sent (${problem})`, report);
  ui.notifications.error(`Report Bug: couldn't reach the Champions Guild site (${problem}). The report was whispered to the GM instead.`);
  const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
  await ChatMessage.create({ speaker: { alias: "Champions Guild Automation" }, whisper: [...new Set([...gms, game.user.id])],
    content: `<p><strong>Bug report (not sent: ${esc(problem)})</strong><br>${esc(item.name)} on ${esc(item.parent?.name)}, from ${esc(game.user.name)}</p>
      <p><em>Expected:</em> ${esc(expected)}</p><p><em>Actually happened:</em> ${esc(actual)}</p>
      <p>Please pass this on to the Champions Guild team.</p>` });
  return null;
}

// For macros and testing: game.modules.get("champions-guild-automation").api.reportBug(item)
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = Object.assign(mod.api ?? {}, { reportBug: openReport, sendBugReport: sendReport });
});
