// Champions Guild Automation - plugs our fixes into Coven's Automation Toolkit (CAT).
//
// How it works:
//  - Every Item in this module's compendiums carries flags.cat.automation.version and a system.identifier
//    (e.g. "eldritch-blast"). registerAutomationModule() tells CAT to index those compendiums as an
//    automation source named after this module.
//  - Each DM puts "Champions Guild Automation" first in CAT's Automation Sources list, so where we have a
//    fix it wins, and CAT / midi-qol / dnd5e fill in everything else.
//  - CAT's Mass Apply / Update then copies our activities, effects and flags onto matching actor items,
//    keeping the actor's own name, description, prepared state and uses.
//  - Macros written in CAT's own function-macro format live in scripts/fn-macros/ and are registered
//    here too. Changing one of those only needs a module update, no Mass Apply.

import { ownMacros, overrideMacros } from "./fn-macros/index.js";

export const MODULE_ID = "champions-guild-automation";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "lastSeenVersion", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
});

Hooks.once("catReady", async () => {
  const api = globalThis.cat?.api;
  const mod = game.modules.get(MODULE_ID);
  if (!api) {
    console.error(`${mod.title} | CAT's API is missing - is Coven's Automation Toolkit enabled?`);
    return;
  }
  try {
    api.registerSourceName(MODULE_ID, mod.title);
    if (ownMacros.length) api.registerFnMacros(ownMacros.map((m) => ({ ...m, source: MODULE_ID })));
    // Overrides replace an existing CAT / midi-qol macro: each keeps the original source, identifier and rules.
    if (overrideMacros.length) api.registerFnMacros(overrideMacros, true);
    await api.registerAutomationModule(MODULE_ID);
    console.log(`${mod.title} ${mod.version} | registered with CAT`);
    await rankFirstOnce(mod);
  } catch (err) {
    console.error(`${mod.title} | CAT registration failed`, err);
    ui.notifications?.error(`${mod.title}: could not register with CAT - see the console (F12).`);
  }
});

// CAT ranks a source that isn't in its "Automation Sources" setting LAST, so midi-qol, CPR etc. would beat our fixes.
// The first time a GM loads the world with this module, add it at the top. Once the entry exists we never touch it
// again, so a DM who reorders or disables it keeps their choice.
async function rankFirstOnce(mod) {
  if (!game.user.isGM) return;
  const sources = foundry.utils.deepClone(game.settings.get("cat", "automationSources") ?? {});
  if (sources[MODULE_ID]) return;
  const priorities = Object.values(sources).map((s) => Number(s?.priority)).filter(Number.isFinite);
  sources[MODULE_ID] = { enabled: true, pack: false, priority: priorities.length ? Math.min(...priorities) - 1 : 0 };
  await game.settings.set("cat", "automationSources", sources);
  console.log(`${mod.title} | added to the top of CAT's Automation Sources`);
}

// After an update, tell the GM once that there are new fixes to apply.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const mod = game.modules.get(MODULE_ID);
  const last = game.settings.get(MODULE_ID, "lastSeenVersion");
  if (last === mod.version) return;
  const firstRun = !last;
  const content = firstRun
    ? `<h3>${mod.title} ${mod.version}</h3>
       <p>Installed and placed at the top of CAT's <b>Automation Sources</b> list, so its fixes win over other sources.
       (You can change that in CAT's settings; this module won't move it again.)</p>
       <p>Next: on each player character, open the CAT shield in the sheet's title bar and click
       <b>Mass Apply / Update</b>.</p>`
    : `<h3>${mod.title} updated: ${last} &rarr; ${mod.version}</h3>
       <p>New or changed fixes are available. On each character, open the CAT shield in the sheet's title bar and click
       <b>Mass Apply / Update</b> to pick them up. See the module's CHANGELOG for the list.</p>`;
  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    speaker: { alias: mod.title }
  });
  await game.settings.set(MODULE_ID, "lastSeenVersion", mod.version);
});
