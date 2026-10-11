# Open questions

44 points where the rulebook or the cards are unclear, silent or disagree.
Each has the reading that [`rules.md`](./rules.md) uses and the reason. The
operator can overturn any reading; the rule numbers show what to change.

Highest impact, worth an operator look: Q1 and Q2 (placement), Q4 and Q5
(when the game ends), Q9 (which icons are achievements), Q18 (Influence
defence), Q30 and Q36 (Kickstarter cards), Q39 to Q42 (product choices).

An independent rules review revised Q5, Q18, Q23, Q30 and Q34 and added Q36
to Q38. An architecture review added Q42.

Sources: `p.` is a printed rulebook page; `card` is the print file;
`draft` is an older rulebook draft, used only as a hint.

## Client decision detail

| Question | Current reading | Follow-up |
| --- | --- | --- |
| How should D12 identify the exact Agent action being defended? | The client shows the Agent's printed actions. Each D12 option carries the pending public `action` and its `actor` seat; the dialog does not show them. | Show the pending action in the dialog. Preserve the hidden-information rules. |

## Base, Orbs and placement

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q1 | The rulebook never defines where a Module may lie. Is the Base a grid? | p. 18, 23-24, 27-32 | A square grid. A card covers two cells; half-orbs sit at the middle of cell edges; cards turn in quarter turns (R5.1 to R5.4). | Every diagram fits it: turned cards span two upright cards, a Dome sits half a card higher than its neighbour (p. 23), and the 14 joints drawn on p. 18, 23 and 27 match the catalogue under this model. |
| Q2 | Is a half-orb against a card edge with no half-orb allowed? | p. 24 | No. Blank against blank is allowed and forms nothing (R5.11). | "Orb halves adjacent to other cards must always connect to matching Orb halves." The INCORRECT picture circles a blue half against a blank Dome edge. The CORRECT picture has a blank Satellite edge on a blank Headquarters edge. |
| Q3 | "Broken Orbs that cannot be completed": must the engine reject a half-orb facing an empty cell that can never be filled? | p. 24 | No. Only joints with existing cards are checked (R5.13). | The sentence is about halves "adjacent to other cards". A look-ahead rule would be costly and no example shows one. |
| Q32 | May a new Module connect only to a Module that a Steal cut off from the Station? | p. 23, 26 | Yes (R5.12). | Rule 1 says "your Station or another Module in your Base", and cut-off Modules "remain functional". |
| Q21 | Shuttle Credits: does a wild Orb pay twice with Artificial Intellect? Do two Artificial Intellects double it? Does Terran Embargo stop the red Credits? | p. 15, card | An Orb pays at most 1 Credit per arrival: if it is yellow, wild, or (with Artificial Intellect) red. No doubling. Embargo stops all (R4.8, R5.9, R9.6). | A wild Orb "stands for any color", one at a time. "Also gained from red Orbs" adds a colour, not a second payout. Embargo says "No Credits are gained". |
| Q8 | Is the named side of a Station secret after it was Flipped up and down again? | p. 5 | Public from its first Flip (R2.4). | Everyone saw it. Tracking what each player remembers adds nothing. |

## Turn, timing and the end of the game

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q4 | "The game ends immediately": checked in the middle of an action? | p. 31 | Yes, after every single state change (R8.5, R11.2). A Build that reaches 10 colonists ends the game before its "On playing" text. | "Immediately" is the only timing given. A step-level check is exact and simple to test. |
| Q5 | Is the Influence reveal before or after the Shuttle check? Is it a choice? What if the Shuttle Credits and the reveal both win? | p. 9, 15, 31, 35 | One end-of-turn check after the Shuttle Credits and before the Shuttle deal. The reveal is automatic. The check counts condition 4 for the active player and conditions 1 to 3 for everyone, as one moment (R4.7, R11.4). Four Influences count in no other case (R11.6). | Both happen "at the end of your turn", and p. 31 expects players to "achieve victory conditions at the same time". Example: A reveals 4 Influences and the Shuttle Credits of that turn take B to 20: A and B share the victory. The deal cannot change a hand or a score, so checking before it changes no result. A player has no reason to hold back a win. |
| Q6 | How are "the most victory conditions" counted? | p. 31 | Count, per player, the conditions met at the moment the game ends (R11.3). | Nothing else is defined. Example: 20 Credits and 10 colonists beats 5 achievements. |
| Q7 | Starting player and seats online ("the longest trip in the last 30 days"). | p. 8 | Seats in join order; random starting player; rematch: left of the single winner (R3.2). | The trip rule cannot be checked online. The rematch rule is the rulebook's. |
| Q22 | Shuttles when the Deck and Discard pile are both empty; a Supply of only Influences after the deal; a game that cannot end. | p. 15, 34 | Deal what exists. The check runs once per turn, so a Supply of only Influences triggers again next turn. No stalemate rule (R4.7, R8.7, R11.5). | "Complete as much as you can" (p. 13). The rulebook has no draw. An engine turn limit, if wanted, is a product decision, not a rule. |
| Q23 | "Pick 8 Influence cards"; Influences dealt at setup. | p. 33 | A game uses exactly 8 Influences. Base game: all 8. With Kickstarter cards: 8 picked at random from the 16, their names public (R3.4, R12.2). An Influence dealt to a hand or the Supply stays; Supply effects are active from the start; setup triggers nothing (R3.8). | p. 33 says "pick 8" and no card or page raises the number. Players at a table know which cards they picked, so the 8 names are public. The rulebook shuffles them in "before dealing cards to the players or the Supply", so they can land in both. Playing all 16 would be a house variant; it is not built. |
| Q24 | Credits above 20 and below 0. | p. 2, 26 | No upper limit in the engine; never below 0 (R1.2, R7.12). | 20 ends the game, so the dial's limit never matters. "You cannot Steal more Credits than they own" and "complete as much as you can". |
| Q25 | "You may choose to resolve that card before or after continuing to resolve the current card." | p. 13, 29 | A choice of two: the built Module's text at once, or after all remaining actions of the current card (R8.3). | The sample turn shows "before". "After" is read as after the whole current card, the simplest exact meaning. |
| Q26 | Must a Main Action be chosen if it does nothing? May an option that does nothing be chosen? Which actions are optional? | p. 13, 22, draft | A Main Action is always chosen. Any option may be chosen. Only Build is optional; Flip, Draft, Discard, Resell are done if possible (R4.6, R7.1, R7.8, R8.2). | "You must choose one Main Action." "An action must be performed unless indicated otherwise"; only Build says "may". The draft says "You can not skip the Flip action." |
| Q27 | Where is an Agent while it resolves? | p. 12 | In a play area; it reaches the Discard pile after its actions (R4.4, R8.8). | Step 3 of playing an Agent is "Place it face-up on the discard pile", after step 2. It matters when the Discard pile is shuffled during the Agent. |
| Q31 | The "New Cards" grid is labelled 2, 2, 3, 4, 5, 6 PLAYER. | p. 16 | 3 + N cards (R4.9). | The text on p. 15 gives the number. The grid is a layout aid with a misprinted label. |

## Actions and card texts

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q9 | The rulebook shows 18 achievement icons. The cards print 16: Asteroid Grinder (meteorite) and Inflatable Habitat (habitat) have no icon. | p. 10, card | Only printed icons count. Those two Modules give no achievement (R1.6, R5.15). | The print files are the final product. On p. 26 the two icons mark Modules that can be Stolen; that is their only use. |
| Q10 | Satellite has no STEALABLE tag, yet Hacker Pirate says "Steal a Satellite". | card, p. 26 | Satellite can be Stolen. The tag is a reminder, not a rule (R7.14). | The Agent names it; the rulebook lists the satellite icon under Steal Module; Moonstone Cops shows all four kinds. |
| Q11 | Steal Module "from any player's Base": your own too? | p. 26, card | Opponents only (R7.14). | The icon carries the "opponent" mark (a roof above it), as on "An opponent Resells". Stealing your own Module to replay its text is not "stealing". |
| Q12 | "An opponent Resells": who chooses the opponent and the cards, who gains the Credit? | card, draft | The acting player chooses the opponent; that opponent chooses the cards and gains the Credits (R7.10). | The draft: "Chosen opponent must Resell a card if able (opponent puts a card ... and gains one credit)." |
| Q13 | When a player is made to Discard, who chooses the card? Order of several players. | p. 21, card | The discarding player chooses; several players act clockwise from the active player (R7.3, R7.16, R8.6). | Discard is defined as "Take 1 card from your hand". Spybot's look informs the choice between its two options, not the card. |
| Q14 | "Target player", and neighbours with 2 players. | card | A target is any player, the acting player included. With 2 players the one opponent is both neighbours and Flips once (R2.1, R2.2). | The target icon has both the "you" and the "opponent" mark. "Flip their Station once" exists for the 2-player case. |
| Q15 | Rebel Captain's second box holds "Discard a card" and "Flip two Stations". Is the Discard a price? | card, p. 4 | No. Two actions in order; with an empty hand the Discard is skipped and the Flips happen (R7.1). | No card uses a price other than Orbs. "Complete as much as you can." |
| Q16 | Market Manipulator shows three icon groups with no "do one". | card | All three in order; the Reselling opponent and the Steal victim are chosen separately (R8.1). | Cards with a choice say "do one of the following". |
| Q17 | "Flip two Stations", "Flip any number of Stations". | card | Two different Stations; any set, each at most once, none allowed (R7.8). | Flipping one Station twice does nothing and would make "two" meaningless. |
| Q29 | "Double Agent can be played for the cost of 2 Credits", but it shows a blue and a yellow Orb. | p. 12 | The printed Orbs are the cost; 2 Credits is the price with no matching Orbs (R6.3). | Consistent with p. 19. |
| Q33 | "Builds a Dome": which cards? | card | Any of the four named Domes (R10.8, `kind` `dome`). | They share the name DOME, the icon and all values. |

## Influences

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q18 | Defence: who may defend, when, what does "affects you" cover, how much is ignored? | p. 35 | R10.6 and R10.10. Any affected player may defend, the player who played the Agent included. The chance comes after the acting player's choices and before each action that reaches the player. Declining once does not close later chances. A defence stops that action and all later actions of that Agent for that player; effects already resolved stand; no re-targeting. What "affects" covers is listed below the R10 rules. Only Agents can be ignored, not Modules, Stations or Influences. | "When a player plays an Agent card that affects you" excludes nobody, and Crazy President affects its owner. "Ignore that Agent's effect on you or your Base (the Agent may still affect other players)." A defence cannot undo a look that has happened, so it covers only what is still to come. Choosing first, then defending, is how a table plays it. The scope and the repeated chance are conventions, not printed rules. |
| Q19 | "When any player Drafts an Influence (incl. this one)": the card has left the Supply when it triggers. | card | It still triggers; each such card in the Supply when the Draft began triggers once (R10.9). | "Incl. this one" says so. |
| Q20 | Quarantine: "Drafting other Influences before this one is FORBIDDEN." | card | While Quarantine is in the Supply no other Influence can be Drafted. | Plain reading. A Draft with no other legal card is skipped (R7.4). |
| Q34 | Spybot.py when the opponent ignores it. | card, p. 35 | Defence before the look: the look does not happen; the acting player still chooses Draw, or "that opponent Discards", which then does nothing. No defence before the look: the opponent may still defend against the Discard; the look stands (R10.10, example E2). | The Draw affects nobody else. Choices stand (R10.6). |
| Q35 | Lunar Alliance and effects that are not Agents. | card | It stops every Steal Credits: Agents, Imbrium, Helium Factory, Space Cowboy Capitalism. | "Stealing Credits is FORBIDDEN" has no limit. |

## Kickstarter cards

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q30 | The rulebook has no rules for 4 Stations and 8 Influences. | card | Section 12 of `rules.md`, off by default. Exchange swaps the two Station cards, each keeping its visible side; Kafka's holder chooses the other Station; extra costs are paid like any cost and add up; Transparency: see Q36. | Card text only. All ten Stations have the same half-orbs, so an Exchange keeps every joint. |

## Conventions added after the rules review

The sources do not decide these points. Each reading is a convention of this
specification.

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q36 | Transparency: "Play with face up deck and face down discard pile." What exactly is hidden and shown? | card | R12.11 to R12.16. Only the top Deck card is shown; the Deck order is not reversed. Nobody may look into the pile, whatever a card's origin. Hand Discards are unseen by the others, except Influences, which are shown. When Transparency leaves the Supply the whole pile is public again. | A face-up pile shows its top card only. Reversing a hidden random order changes nothing a player can know, so the engine keeps its order. A face-down pile hides every card in it; what was seen before stays known. A defence and a "When you Discard" effect must be seen to be believed. Turning the pile face up again shows all of it, as on a table. |
| Q37 | Laika Memorial with Entropic Cascade in hand: do the cards drawn in between belong to "all your cards"? | card, p. 33 | No. The set is fixed when the action starts; later cards stay; set cards already gone are skipped (R7.17, example E3). | One exact outcome is needed. "Immediately" lets the Influence interrupt; the instruction was given for the hand as it was. |
| Q38 | Two deferred "On playing" texts on one card: which is first? | p. 13 | First deferred, first resolved, each in full (R8.10, example E4). | The rulebook gives the choice "before or after" per card and no order between several. A fixed order needs no extra decision; the player still controls the result by resolving a text at once. |

## Product and architecture

Readings of the product brief and choices of [`architecture.md`](./architecture.md)
that the operator may want to overturn.

| # | Question | Where | Reading chosen | Why |
| --- | --- | --- | --- | --- |
| Q39 | "Any number of them can be non-human": also all of them? Who sits where? | product brief | Yes. A game can have 0 to N non-human players. The creator takes seat 0, unless every seat is non-human; then the creator watches with the public view. Nobody else can watch a game. | "Any number" includes all. A game of only non-human players is the quickest way to see the whole game run. The public view holds nothing hidden. |
| Q40 | A game that never ends (Q22), played by non-human players. | R11.5 | The server ends a game with no winner when it passes 300 turns. This is a server limit, not a rule; the engine has none. | Without a limit an all-bot game could run for ever. 300 turns is far above a real game of about 30 minutes; the number is a setting. |
| Q41 | May the brand typeface Made Evolve Sans be shipped with the game? | The web font licence of the typeface | No, until the operator says the licence covers it. The interface uses Outfit (OFL-1.1). | The web font licence allows linking the font to websites the licensee controls and lists "computer applications and games" among uses that need another licence. The card images already show the brand lettering. Switching later is one token. |
| Q42 | A turn that never ends: a hand of only Entropic Cascade with an empty Deck and Discard pile must Discard it, Draws it back after the reshuffle and must Discard it again. | R7.5, R8.7, R10.7, R11.5 | The engine counts its loop steps per turn and ends the game with no winner at 5000 (`step_limit`). This is a service limit like Q40, not a rule; the rules are unchanged. | The rules give the cycle no exit and no draw. A synchronous engine that followed it would never return and would stop every game on the server. The state is rare: every other card must be in a hand, a Base or the Supply. Ending with no winner invents no victory. The property test prints the largest count of real turns on every run. |
| Q44 | `createGame` returns only a state. Where do the events of the opening go: `game_started` and the first `turn_started`? | architecture, Interface and Event contract | `createGame` keeps its state-only signature. The server uses `startGame`, exported by `src/engine/index.ts`, and passes its state and events to `createRoom`. The room projects the opening events with `eventFor` into each seat's and the public history before its first update and bot request. | The room needs engine events, not a sentence of its own. |
| Q45 | How does Jev retain every offered Module when there are more than 59 Modules plus skip? | architecture, Jev adapter | Treat 60 as a target: retain the best placement per physical Module and skip, even above 60. Return `"too many"` above 255. | Hands have no size limit; preserving each Module is more useful than silently excluding legal cards. |
| Q46 | What if required visible state and choices alone exceed the approximate 6k-token prompt target? | architecture, Jev adapter | Drop recent events oldest first; retain choices, visible state and current-turn hand reveals. Estimate four JSON characters per token. The transport must handle the model's hard context limit separately. | The 6k target is soft; truncating a legal choice set or a seen hand would violate the prompt contract. |
| Q47 | Does "Budget used up" count for the breaker? The failures table says so for a timeout and not for the budget. | architecture, Limits and failures | Yes. A decision whose signal aborts after a request was made is a failed decision. A signal that is already aborted before the request is not. | Two 4 s attempts and the wait between them take about 8.5 s, so a Jev that hangs always ends by the 8 s budget, never by the second timeout. If the budget did not count, a dead service would cost every decision 8 s for ever. The adapter cannot tell the budget from another abort of the signal; the room aborts for no other reason today. |
| Q48 | How can a seed-only game log demonstrate replay to `step_limit` through a room when the known cycle test starts from a constructed state? | Q42 | Keep the log seed-only and retain the constructed-state engine and room tests; add the replay acceptance test when a reproducible seeded game is found. | A search of 2,000 two-seat seeded games with Influences and random legal choices found no `step_limit`; the largest observed turn used 116 of 5,000 steps. Logging the constructed state would change the log contract. |
| Q49 | How can Lobby and Waiting list the chosen eight Influences once the game starts? | architecture, Behaviour | Show the names on the Table from `view.influencesInGame` once setup has picked them. | Lobby and Waiting exist only before setup and their `LobbyGame` data has no selected list. The client cannot publish names before they are picked. |

## Corrections to an earlier rulebook transcription

| # | Point | Where | Correction |
| --- | --- | --- | --- |
| Q28 | An earlier text transcription of the rulebook said Terran Outpost shows two colonists, a red icon and four action buttons; that Rebel Captain has three options; and named a card "Indigo Ecocore". | Sheets 4, 18, 22 of the rulebook | The print and the rulebook show Terran Outpost with no colonists, no achievement and three boxes (Draft / Build / Resell x2, Draw). Rebel Captain has two boxes. The Module is Indigo Egregore. |
| Q43 | The same transcription said Hayashi Dome lies underneath the Terran Outpost on p. 24 and that the Smart Spaceship meets mismatched colours. | Sheet 14 of the rulebook | A 900 dpi render shows Hayashi Dome on the left, a second Dome on the right and the Smart Spaceship lying over that Dome: its fault is rule 3 of the page (R5.10), marked by the orange border. The three red circles are on Hayashi Dome and Beruang Engineers. The three INCORRECT placements are read as these three cards: Hayashi Dome, Beruang Engineers, Smart Spaceship. The Bases are in `src/engine/testing/rulebook-bases.ts`. |

## Not verified

| Point | State |
| --- | --- |
| Card texts and values | Read by eye from 300 dpi renders of every print page. Half-orb colours of all 62 Station and Module pages were also measured from pixels and match `cards.json`. Costs, colonists and icons were checked on enlarged crops of all 50 Module pages. |
| Rules R5 and R6 | 22 pictured examples from the rulebook pass a model fed with `cards.json`. The engine tests hold the pictures of p. 23 and 24 (`src/engine/placement.test.ts`) and those of p. 12, 18, 20, 27 to 30 and 32 (`src/engine/rulebook.test.ts`). They show no disagreement. |
| Agent and Influence duplicates | The two copies of each Agent were compared on contact sheets, not pixel by pixel. |
| Print rulebook among the print files (48 pages, outlined) | Not compared with the published rulebook. |
| Rulebook thumbnails of cards | Not compared one by one with the print files, except those cited above. |
