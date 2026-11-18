# Champions Guild Automation

Fixes and additions for **Coven's Automation Toolkit (CAT)** on Foundry v14 / dnd5e 6. Covers spells, class features
and items that CAT and its sources are missing or get wrong.

Requires: CAT 0.1.8+, midi-qol 14.6.5+, DAE 14.6.4+, lib-wrapper.

## For DMs: install (once)

1. Foundry Setup screen → **Add-on Modules → Install Module** → paste the manifest URL at the bottom of this page
   into **Manifest URL** → Install.
2. Launch your world → **Manage Modules** → enable **Champions Guild Automation**.
3. A whispered chat message confirms it. The module puts itself at the **top of CAT's Automation Sources** list,
   so its fixes win over other sources. It only does this once. If you reorder it in CAT's settings, it stays where
   you put it.
4. On each player character, click the **CAT shield** in the sheet's title bar → **Mass Apply / Update**.

## For DMs: after an update

1. Foundry Setup screen → Add-on Modules → **Update** (or "Update All").
2. Launch your world. A whispered message lists the old and new version.
3. On each character, click the CAT shield → **Mass Apply / Update**. Items with a newer fix show as "Out of date".

Mass Apply keeps each character's own item names, descriptions, prepared spells and remaining uses. It replaces the
mechanics: activities, effects and macros. It **does** overwrite any hand edits a DM made to those mechanics. CAT
keeps backups on the actor (the CAT shield → Backups).

## What's fixed

See [CHANGELOG.md](CHANGELOG.md).

## Manifest URL

```
https://github.com/JoshuaRogers057/champions-guild-automation/releases/latest/download/module.json
```

Report broken automations: <https://github.com/JoshuaRogers057/champions-guild-automation/issues>
