# 20 Below Roster

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension for GMs running [20 Below](https://feralucce.github.io/20_Below/). Load player and NPC character JSONs, see them as a list, click one to view it read-only. No editing, no dice, no functionality beyond looking a character up mid-session.

## Installing

In Owlbear Rodeo, open the extensions menu and add a custom extension using this URL:

```
https://feralucce.github.io/20_Below_Roster/manifest.json
```

## Using it

- **Add character JSON(s)...** accepts one or more files at once (players and NPCs both work the same way) - export them from the 20 Below character creator's Sheet step.
- Click a name in the list to view their full sheet: Figured Characteristics, Attributes, Skills, Boons, Resources, Gifts, Flaws, Scars.
- **Remove** drops a character from the roster. The roster persists in local storage between sessions (per browser/device), so you don't need to re-add everyone each time.
- A file that isn't a valid 20 Below export shows as "Couldn't load this file" in the list instead of failing silently, so a bad import doesn't just vanish.

## Notes

This is a companion to [20 Below Dice](https://github.com/feralucce/20_Below_Dice) - Dice is the player-facing roller (optionally linked to their own single character), Roster is the GM-facing multi-character lookup. Same character JSON export works in both.
