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

## Characters from the Champions Guild website

The website's **Download for Foundry** file lists what a character has, but its items carry no rules data.

1. Make a blank Player Character, right-click it → **Import Data** → pick the file.
2. Open the character's sheet (as GM, or as its owner when no GM is on). The module fills the items in from the dnd5e
   2024 compendium, and a whispered message says what it did.
3. Click the CAT shield → **Mass Apply / Update**, as for any other character.

The fill-in step covers:

- **Classes**: scale values, such as sorcery points and rage uses.
- **Items**: the activities, uses and effects of features, species traits, feats, spells and gear. Weapons and armor
  are matched by base item too, so a "Longsword +1" works.
- **Picks the site keeps as text**: Metamagic, Eldritch Invocations, Fighting Style and Weapon Mastery.
- **Species**: the lineage (for example a Goliath's Fire's Burn) and species resistances.
- **Magic items**: names like "Vicious Longsword" and "Mariner's Chain Mail" are matched to the book items.
- **Unarmed Strike**: added if the character has none.

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
