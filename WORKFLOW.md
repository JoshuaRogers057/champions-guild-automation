# Adding a fix

## Layout

| Path | What it is |
| --- | --- |
| `src/packs/<pack>/*.json` | One Item per file. Edit these. Packs: `spells`, `features`, `items`, `monster-features`. |
| `src/macros/*.js` | ItemMacro source. An item names its macro with a top-level `"_cgaMacro": "beams.js"`. The build inlines it into `flags.dae.macro`. |
| `scripts/fn-macros/index.js` | Optional macros in CAT's own format (new ones, or overrides of a CAT / midi-qol macro). |
| `packs/` | Built compendiums. Never edit by hand; rebuild instead. |
| `tools/build.ps1` | Builds `packs/` from `src/`. `-Check` validates without writing. |
| `tools/release.ps1` | Publishes a version to GitHub (see step 6). |

## Steps

1. **Reproduce** the broken spell or feature in a test world (not a live campaign).
2. **Build the fix** as an Item: start from the dnd5e 2024 compendium copy (or the item CAT applied), then fix
   activities, effects and midi flags. Put any macro in `src/macros/`.
3. **Required on every item:**
   - `_id`: 16 letters/digits, unique in the module. Convention: `cga` + 3-letter type + name, e.g. `cgaSplEldritchBl`.
   - `system.identifier`: must match the identifier CAT sees on actor items (e.g. `eldritch-blast`). CAT matches on it.
   - `system.source.rules`: `"2024"` or `"2014"`.
   - `flags.cat.automation.version`: start at `1.0.0` and bump it on every change.
   - Optional: `flags.cat.automation.notes` is shown in CAT's UI.
   - No rules text is needed. CAT keeps the actor's own description, name, prepared state and uses when it applies
     the fix, so a one-line description of what's automated is enough (and keeps book text out of the module).
4. Run `.\tools\build.ps1`. It refuses to write if an `_id`, identifier, version or macro syntax is wrong.
   Packs can't be rebuilt while a world with this module enabled is open: return to Setup first.
5. **Test** in a v14 world: CAT shield on a test actor → apply the Champions Guild source → use the spell.
6. **Release:** commit your fix, add a `## <new version>` section to CHANGELOG.md, then run
   `.\tools\release.ps1 -Version <new version>`. It stamps the version into module.json, builds, zips (with
   Linux-safe paths), commits, tags `v<version>`, pushes, and creates the GitHub release with `module.zip` +
   `module.json`. Use `-DryRun` to package without touching git or GitHub. DMs then click Update and Mass Apply.

## Don't update this module through Foundry on the dev PC

This folder (`Data\modules\champions-guild-automation`) is the git working copy. If Foundry's Setup screen offers
an Update for it here, **skip it**: Foundry would replace the folder with the release zip and wipe `src\`, `tools\`
and `.git`. Pull from GitHub instead (`git pull`) and rebuild.

## When CAT catches up

If CAT, midi-qol or CPR ships a working version of something we fixed, delete our item and note it in the
CHANGELOG. Otherwise ours keeps winning, because it ranks first.
