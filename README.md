# 20 Below Roster

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension for GMs running [20 Below](https://20belowrpg.com/). Load player and NPC character JSONs, look them up read-only, and run a fight from the same panel - Initiative, Action Brackets, turn order, and the Health/Poise/Sanity/Ki tracks.

## Installing

In Owlbear Rodeo, open the extensions menu and add a custom extension using this URL:

```
https://feralucce.github.io/20_Below_Roster/manifest.json
```

## Using it

### The roster

- **Add character JSON(s)...** accepts one or more files at once (players and NPCs both work the same way) - export them from the 20 Below character creator's Sheet step.
- Click a name in the list to view their full sheet: Figured Characteristics, Attributes, Skills, Boons, Resources, Gifts, Flaws, Scars.
- **Remove** drops a character from the roster, and pulls them out of the turn order if a fight is running.
- A file that isn't a valid 20 Below export shows as "Couldn't load this file" in the list instead of failing silently, so a bad import doesn't just vanish.
- The **role chip** on each row cycles PC → Ally → NPC. Nothing in the export file distinguishes them, so this is yours to set. It only decides who rolls their own Initiative.

### Running a fight

1. **Set Initiative.** *Roll* on a row rolls 1d10 + that character's Initiative sub-stat; **Roll all non-PC Initiative** does every Ally and NPC at once. PCs report what they rolled at the table, so type theirs in. Initiative is rolled once and holds for the whole fight.
2. **Begin combat** once everyone has a number.
3. **Declare phase.** Pick Slow, Normal, or Fast for each character. **Bump (1 Ki)** spends a point of Ki to move a declared bracket up a step - Slow to Normal, or Normal to Fast.
4. **Resolve round** builds the order: all Fast act, then all Normal, then all Slow, with Initiative breaking ties inside each bracket. The current combatant is highlighted, and their linked token is selected on the scene.
5. **Next turn** walks the order. At the end of it the round advances and everyone re-declares - brackets are per-round.
6. **End combat** clears Initiative and brackets. Damage is left alone, since it doesn't heal just because the fight ended.

The **HP / POI / SAN / KI** tracks on each row take damage and healing with the − and + buttons, capped at that character's own maximums. Health, Poise, and Sanity can go below zero on purpose - Unconscious, Dead, Flustered, Humiliated, Overwhelmed, and Shattered all show as a chip on the row when reached.

### Tokens

**Link token** binds a roster entry to a token already on the scene: select the token in Owlbear, then click the button. Once linked, that character's token gets selected automatically when their turn comes up. Click the button again to unlink. Deleting a token from the scene clears the link on its own.

Linking works with any token, including the ones the players placed. For getting monster tokens *onto* the scene in the first place, see [20 Below Bestiary](https://github.com/feralucce/20_Below_Bestiary).

## Notes

Everything is per-browser: the roster and the combat state both live in local storage, so a fight survives a reload but stays on the GM's machine. Players don't see the turn order in their own panel.

Health, Poise, and Sanity thresholds are imported live from the character creator at [20belowrpg.com](https://20belowrpg.com/) rather than hand-copied, so this can't quietly disagree with the app or the desktop Combat Tracker about what Dead or Shattered means. If that fetch fails, identical local fallbacks stand in and everything keeps working.

Opened outside Owlbear Rodeo, everything except token linking still works - useful for testing.

This is a companion to [20 Below Dice](https://github.com/feralucce/20_Below_Dice) - Dice is the player-facing roller (optionally linked to their own single character), Roster is the GM-facing multi-character lookup and combat tracker. Same character JSON export works in both.
