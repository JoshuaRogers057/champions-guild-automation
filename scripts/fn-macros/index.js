// CAT function macros.
//
// Most fixes are plain Item documents (src/packs/...) with a midi-qol / DAE ItemMacro, and need nothing here.
// Use this file when a fix is better written in CAT's own macro format (CAT event passes such as
// "actorTurnEnd", "targetPreItemRoll", "itemRollFinished"; see the CAT wiki and `console.log(cat.utils)`).
//
// ownMacros: new macros under this module's source. Fields: identifier, rules ("2014" | "2024" | "all"),
//   and trigger arrays such as roll / combat / effect / move, each [{ pass, macro, priority }].
//   An item uses one by listing it in flags.cat.macros.<type>:
//   [{ source: "champions-guild-automation", identifier, rules }].
//
// overrideMacros: replace a macro CAT or midi-qol already registered. Give its original source, identifier
//   and rules. The override replaces every pass of that macro.

export const ownMacros = [];

export const overrideMacros = [];
