# Lunar Base rules specification

This is the rule set the engine implements. Every rule has a number. The
`Source` column cites the printed page of the rulebook, a card (`card`,
data in [`cards.json`](../design/cards.json)), or a reading recorded in
[`open-questions.md`](./open-questions.md) (`Q` and a number).

| Topic | Answer |
| --- | --- |
| Players | 2 to 6 |
| Basic game | 6 Stations, 50 Modules, 26 Agents. Influences are an optional variant (section 10) |
| Start | 1 Station (Terran Outpost side up), 3 cards, 3 Credits each; Supply of 3 + N cards |
| Turn | Play Agents, then one Main Action, then the Shuttle check |
| Win | 20 Credits, or 10 colonists, or 5 different achievements, or 4 Influences revealed at the end of your turn |
| Kickstarter cards | Not in the rulebook. Optional, off by default (section 12) |

Words with a capital letter (Draft, Build, Supply, Base) are game terms
defined below. N is the number of players.

## 1. Components

| Rule | Text | Source |
| --- | --- | --- |
| R1.1 | The base game has 90 cards: 6 Stations, 50 Modules, 26 Agents, 8 Influences. | p. 1 |
| R1.2 | Each player has a Credit total, an integer of 0 or more. All Credit totals are public. | p. 2, 8, Q24 |
| R1.3 | A Station card has two sides. One side is Terran Outpost on every Station. The other is a named Station. Both sides have the same five half-orbs. | p. 5, 25, card |
| R1.4 | The colours are red, blue, yellow and gray. Gray is wild. | p. 17 |
| R1.5 | `cards.json` is the authority for card data: cost, half-orbs, printed Orbs, colonists, achievements, actions and copies. | card |
| R1.6 | A Module or Station shows 0 or more colonists and 0 or more scientific achievements. 14 different achievements are printed in the base game, 16 with the Kickstarter Stations. | p. 4, 10, Q9 |
| R1.7 | The Kickstarter set adds 4 Stations and 8 Influences. They are used only when the game option is on. A game never uses more than 8 Influences (R3.4). | card, p. 33, Q30 |

## 2. Zones, seats and information

| Rule | Text | Source |
| --- | --- | --- |
| R2.1 | Players sit in a fixed circle. Turn order is clockwise. The neighbours of a player are the next and the previous player in the circle. With 2 players the one opponent is both neighbours. | p. 9, Q14 |
| R2.2 | An opponent of a player is any other player. "Each player" includes the player who acts. A target is any one player the acting player chooses, the acting player included. | card, Q14 |
| R2.3 | The game has these zones. | |

| Zone | Holds | Who sees the cards |
| --- | --- | --- |
| Deck | Face-down pile | Nobody. The number of cards is public. Transparency shows the top card (R12.11) |
| Discard pile | Face-up pile | Everybody, every card. Under Transparency nobody; the number of cards is public (R12.12) |
| Supply | Face-up row | Everybody |
| Hand, one per player | Any number of cards, no limit | The owner. The number of cards is public |
| Base, one per player | The Station and the Modules the player built | Everybody |
| Play area | The Agent being resolved | Everybody |
| Removed Stations | Stations not dealt | Nobody |

| Rule | Text | Source |
| --- | --- | --- |
| R2.4 | Only the owner knows the named side of a Station that has never been Flipped. After its first Flip the named side is public for the rest of the game. | p. 5, Q8 |
| R2.5 | When a pile must be shuffled, the engine uses its random source. The order of the Deck is hidden from every player. | p. 5 |

## 3. Setup

| Rule | Text | Source |
| --- | --- | --- |
| R3.1 | A game is created with N from 2 to 6 and two options: Influences (default off) and Kickstarter cards (default off). | p. 5, 33, Q23, Q30 |
| R3.2 | Seats follow the order in which players joined. The engine picks the starting player at random. In a rematch the player to the left of the single winner starts; with several winners the engine picks at random. | p. 8, Q7 |
| R3.3 | Shuffle the Station cards in use (6, or 10 with Kickstarter cards). Deal 1 to each player, Terran Outpost side up, as the start of the Base. Remove the rest unseen. | p. 5 |
| R3.4 | Shuffle the 50 Modules and 26 Agents into the Deck. With the Influence option exactly 8 Influences are shuffled into the same Deck before any card is dealt: the 8 base Influences, or with Kickstarter cards the 8 picked by R12.2. | p. 5, 33, Q23 |
| R3.5 | Each player, from the starting player clockwise, draws 3 cards. | p. 7 |
| R3.6 | Deal 3 + N cards face up from the Deck to the Supply. | p. 7 |
| R3.7 | Each player starts with 3 Credits. | p. 8 |
| R3.8 | An Influence dealt to a hand stays in that hand. An Influence dealt to the Supply is active at once (R10.3). Setup deals are not Drafts and trigger nothing. | Q23 |

## 4. Turn structure

| Rule | Text | Source |
| --- | --- | --- |
| R4.1 | Players take turns clockwise from the starting player until the game ends (section 11). | p. 9 |
| R4.2 | A turn has three steps in this order: Agent step, Main Action step, Shuttle step. | p. 11 |
| R4.3 | **Agent step.** The active player may play any number of Agent cards from hand, one after another. Agents cannot be played at any other time. An Agent that enters the hand during this step may be played in it. | p. 11 |
| R4.4 | To play an Agent: (a) the player must be able to pay its cost (section 6) and pays it; (b) the card moves to the play area and its actions are resolved (section 8); (c) the card moves to the Discard pile. | p. 12, Q27 |
| R4.5 | **Main Action step.** The active player must choose exactly one Main Action box in their Base and perform its actions. The boxes available are those on the visible side of their Station and on every Module in their Base. | p. 13 |
| R4.6 | A Main Action must be chosen even when none of its actions can do anything. | p. 13, Q26 |
| R4.7 | **Shuttle step.** In this order: (a) if the Supply holds no Module and no Agent, the Shuttles arrive and pay the Shuttle Credits (R4.8); (b) the end-of-turn check (R11.4); (c) if the Shuttles arrived and the game goes on, the Shuttle deal (R4.9). The Supply is looked at once per turn, at (a). | p. 15, 35, Q5, Q22 |
| R4.8 | Shuttle Credits. Every player gains 1 Credit for each Orb in their Base that is yellow or wild gray. All players gain at the same time, in one step. | p. 15, 17, Q21 |
| R4.9 | Shuttle deal. Deal 3 + N cards from the Deck face up to the Supply. Influences already in the Supply stay and do not reduce the number. If the Deck runs out, R8.7 applies. The Supply gets new cards only here. | p. 15, 34, Q31 |
| R4.10 | After the Shuttle step the next player's turn begins. | p. 9 |

## 5. The Base and Orbs

### 5.1 Geometry

| Rule | Text | Source |
| --- | --- | --- |
| R5.1 | A Base is a Station and Modules on a square grid. Every card covers two cells that share an edge: its top cell and its bottom cell. | p. 18, 23, Q1 |
| R5.2 | A card has six slots on its outer edges: T, RU, RL, B, LL, LU. A slot holds a half-orb of one colour or nothing. | p. 4, card |
| R5.3 | A placement is (x, y, q): the top cell is at (x, y), y grows downward, and q is the number of clockwise quarter turns, 0 to 3. | p. 23, Q1 |
| R5.4 | The Station is at (0, 0, 0) and never moves. | Q1 |

Slot positions at q = 0. For other q, turn each direction clockwise q times
(N to E to S to W).

| Slot | Cell | Edge at q = 0 |
| --- | --- | --- |
| T | top | N |
| RU | top | E |
| RL | bottom | E |
| B | bottom | S |
| LL | bottom | W |
| LU | top | W |

| q | Bottom cell is at |
| --- | --- |
| 0 | (x, y + 1) |
| 1 | (x - 1, y) |
| 2 | (x, y - 1) |
| 3 | (x + 1, y) |

### 5.2 Orbs

| Rule | Text | Source |
| --- | --- | --- |
| R5.5 | A joint is a cell edge shared by two cards of one Base. A joint with a half-orb on both sides forms one Orb. | p. 17 |
| R5.6 | The Orb's colour: two halves of one colour give that colour; gray with a colour gives that colour; gray with gray gives a wild Orb. | p. 17 |
| R5.7 | A complete Orb printed on a card is an Orb of that colour while that side is visible. Named Station sides other than Kafka print two; Kafka prints none (its green Exchange symbol is not an Orb). Artificial Intellect prints one red. | p. 17, card |
| R5.8 | The Orbs of a Base are its printed Orbs plus its joint Orbs. They are recomputed after every Build, Flip, Steal Module and Exchange. | p. 17, 25 |
| R5.9 | A wild Orb stands for any one colour each time it is counted. | p. 17, 19, Q21 |

### 5.3 Placing a Module

A placement of a Module in a Base is legal when all of these hold.

| Rule | Text | Source |
| --- | --- | --- |
| R5.10 | Both cells are empty. | p. 24 |
| R5.11 | At every joint the new card makes, either both sides have a half-orb and the two match (same colour, or at least one gray), or both sides have none. A half-orb against an edge with no half-orb is illegal. Two different colours are illegal. | p. 23-24, Q2 |
| R5.12 | At least one joint the new card makes forms an Orb. The other card of that joint may be the Station or any Module of the Base, including one cut off by a Steal. | p. 23, Q32 |
| R5.13 | Any of the four values of q is allowed. Empty cells next to a half-orb are never a problem. | p. 23, Q3 |

### 5.4 What a Base counts

| Rule | Text | Source |
| --- | --- | --- |
| R5.14 | The colonists of a Base are the colonists on the visible side of its Station plus those on all its Modules. | p. 9 |
| R5.15 | The achievements of a Base are the set of different achievement icons on the visible side of its Station and on all its Modules. Two icons of the same kind count once. The four Domes share one icon. | p. 9, 32, card |
| R5.16 | A Module that a Steal left without any joint to the rest of the Base stays where it is and keeps all its functions: colonists, achievements, Main Action, printed Orbs and the joints it still has. | p. 26 |

## 6. Paying costs

| Rule | Text | Source |
| --- | --- | --- |
| R6.1 | The cost of an Agent or Module is the list of Orbs printed in its top-right corner. A card with none is free. | p. 19 |
| R6.2 | Each Orb in the payer's Base can cover one cost Orb of its colour. A wild Orb can cover one cost Orb of any colour. An Orb covers at most one cost Orb per card. | p. 19 |
| R6.3 | Each cost Orb left uncovered costs 1 Credit. | p. 19 |
| R6.4 | A player cannot play or Build a card whose Credit price is more than their Credits. | p. 19 |
| R6.5 | Orbs are not used up. The same Orbs count again for the next card. | p. 19 |
| R6.6 | The price is computed from the Base as it is when the cost is paid. A Module's own half-orbs do not help to pay for it. | p. 22 |

Price of a card: for each colour c in red, blue, yellow let need(c) be the
cost Orbs of that colour and have(c) the Base's Orbs of that colour. Let
open = the sum of max(0, need(c) - have(c)). Price = max(0, open - wild Orbs).

Engine API in `src/engine/price.ts`:

| Export | Contract |
| --- | --- |
| `OrbCounts` | Read-only counts `red`, `blue`, `yellow`, `wild`; each is a non-negative integer |
| `priceOf(cost, orbs)` | Takes a catalogue cost list and current Base Orb counts; returns the Credit price without changing either input. Costs contain red, blue or yellow; gray costs have no defined rule and throw `RangeError` |
| `canPay(price, credits)` | Returns whether `price <= credits`, including exact payment and free cards. Both inputs are non-negative integers |

| Example | Base Orbs | Cost | Price | Source |
| --- | --- | --- | --- | --- |
| Solicitor | 2 blue | blue, blue, yellow, yellow | 2 | p. 27 |
| Mormon Scientist | 2 blue, 2 red | red, red, blue, blue | 0 | p. 20 |
| Space Elevator | 2 blue, 2 red | blue, blue, yellow, yellow, red, red | 2 | p. 20 |
| Double Agent | none | blue, yellow | 2 | p. 12, Q29 |

## 7. Actions

| Rule | Text | Source |
| --- | --- | --- |
| R7.1 | An action must be performed unless its rule says "may". If it cannot be done in full, the player does as much as possible. | p. 13 |
| R7.2 | "x2", "x3", "two cards" and the like mean the action is done that many times, one at a time. | p. 21, 25 |
| R7.3 | When a rule says a player does an action, that player makes every choice in it, unless the rule names another chooser. | Q13 |

| Rule | Action | Text | Source |
| --- | --- | --- | --- |
| R7.4 | Draft | Take 1 card of your choice from the Supply into your hand. Skip if the Supply has no card you can Draft. Influences can be Drafted, within section 10. | p. 21, 34 |
| R7.5 | Discard | Put 1 card of your choice from your hand face up on the Discard pile. Skip with an empty hand. Discarding an Influence triggers R10.7. | p. 21, 35 |
| R7.6 | Draw | Take the top card of the Deck into your hand. With an empty Deck, apply R8.7 first. | p. 21 |
| R7.7 | Build | You **may** Build 1 Module from your hand: (a) choose a Module, a legal placement (5.3) and be able to pay; (b) pay its cost; (c) put it into your Base at that placement; (d) resolve "when any player Builds" effects (R10.8); (e) resolve its "On playing this card" actions, now or later (R8.3). A Module with no legal placement cannot be Built. | p. 22, 23, 37 |
| R7.8 | Flip | Turn the Stations named by the action to their other side (table below). A Flip is not optional. The Station keeps its place and its joints. Its printed Orbs, Main Action boxes, colonists and achievements are those of the side now visible. | p. 25, Q26 |
| R7.9 | Resell | Put 1 Agent or Module of your choice from the Supply on the Discard pile and gain 1 Credit. Influences cannot be Resold. Skip if the Supply has no Agent or Module. | p. 25, 34 |
| R7.10 | An opponent Resells | The acting player chooses an opponent, even if the Supply has no Agent or Module. That opponent chooses and Resells one card at a time, gaining each Credit. Skip any Resells that cannot be done. During D8, `pending.seat` is the opponent; the active seat stays unchanged. | card, Q12 |
| R7.11 | Gain Credits | The named player's Credits go up by the amount. Space Unicorn: 1 Credit per card in your hand when the action resolves. | p. 25, card |
| R7.12 | Lose Credits | The named player's Credits go down by the amount, not below 0. | p. 25, Q24 |
| R7.13 | Steal Credits | Choose an opponent. Take the amount, or all they have if less, from their Credits and add it to yours. | p. 26 |
| R7.14 | Steal Module | Choose a Module of the named kind in an opponent's Base and take it into your hand. Skip if there is none. The other Modules stay in place (R5.16). The kinds are Satellite, Rover, Asteroid Grinder and Inflatable Habitat. | p. 26, card, Q10, Q11 |
| R7.15 | Look at a hand | Choose an opponent. You see every card in their hand. Other players do not. | card |
| R7.16 | Another player Discards | "Target Discards": the acting player chooses a target; the target Discards 1 card. "Each Opponent Discards two cards": every opponent Discards 2, clockwise from the active player. "That opponent Discards": the opponent chosen earlier on the same card Discards 1. The discarding player chooses the cards. | card, Q13 |
| R7.17 | Discard all your cards | The cards in your hand when the action starts are the set to Discard. Discard them one at a time, in the order you choose (R7.5). The effects of a Discarded Influence interrupt at once (R10.7). A card that enters your hand after the action started is not in the set and stays in your hand. A card of the set that has already left your hand is skipped. The action ends when no card of the set is in your hand. Example E3. | card, Q37 |
| R7.18 | Resell per Influence | Count the Influences in the Supply when the action resolves and Resell that many times. | card |

Flip actions.

| Code in `cards.json` | Printed | Stations that Flip | Source |
| --- | --- | --- | --- |
| `own` | "Flip your Station"; "Flip" on Underground Headquarters and Helium Factory | The acting player's | card |
| `any_one` | "Flip a Station" | One Station the acting player chooses, their own allowed | card |
| `any_two` | "Flip two Stations" | Two different Stations the acting player chooses | card, Q17 |
| `any_number` | "Flip any number of Stations" | Any set of Stations the acting player chooses, none allowed; each Flips once | card, Q17 |
| `each_player` | "Each player Flips their Station" | All | card |
| `neighbours_of_target` | "Both neighbours of target player Flip their Station once" | The acting player chooses a target; each neighbour of the target Flips once. With 2 players that is the one other player | card, Q14 |
| `all_to_terran_outpost` | "Flip all Stations to Terran Outposts" | Every Station that shows a named side | card |

## 8. Resolving cards

| Rule | Text | Source |
| --- | --- | --- |
| R8.1 | The actions of a box or of an "On playing this card" text are resolved one at a time from left to right. | p. 13 |
| R8.2 | "Do one of the following" and "choose one box": the player chooses exactly one option and resolves only that one. An option that can do nothing may be chosen. | p. 4, 13, Q26 |
| R8.3 | When an action Builds a Module that has an "On playing this card" text, the builder chooses: resolve that text at once, or defer it. A deferred text waits until the current card is finished: until all remaining actions of the box or text that holds the Build are done. With no remaining actions there is no choice and the text resolves at once. | p. 13, 29, Q25 |
| R8.4 | An action marked "immediately" is resolved before any other waiting action. If several are waiting at once, the active player chooses their order. | p. 33 |
| R8.5 | A step is one single state change: one card moved by a Draft, Draw, Discard or Resell; one payment; one Module placed; one Flip action (all its Stations at once); one Credit gain, loss or Steal (all its players at once); one Steal Module; one Exchange. The victory check (R11.2) runs after every step except the Shuttle Credits, which the end-of-turn check follows (R11.4). | p. 31, Q4, Q5 |
| R8.6 | When several players must choose in one action, they choose clockwise from the active player. | Q13 |
| R8.7 | When a card must come from an empty Deck, shuffle the Discard pile to form the new Deck and continue. If the Discard pile is empty too, the rest of the Draw or deal is skipped. | p. 15, 21, Q22 |
| R8.8 | An Agent in the play area is not in the Discard pile and is not shuffled into a new Deck. | p. 12, Q27 |
| R8.9 | Before an Agent action affects a player, that player may use an Influence to ignore it (R10.6). | p. 35 |
| R8.10 | Several texts deferred during one card (R8.3) are resolved in the order in which they were deferred, first deferred first. Each is resolved in full, with everything it causes, before the next begins. A text deferred while another "On playing this card" text is resolved waits only for the end of that text. Example E4. | Q38 |

## 9. Card types and effects

`cards.json` fields: `cost` (R6.1), `half_orbs` (R5.2), `orbs` (R5.7),
`colonists`, `achievements`, `main_action` (list of boxes, each a list of
actions), `on_play` (list of actions), `kind` (the name used by Steal Module
and Laika's Paradise), `tags`.

| Code (`op`) | Rule | Code (`op`) | Rule |
| --- | --- | --- | --- |
| `draft` | R7.4 | `steal_module` | R7.14 |
| `discard` | R7.5 | `look_at_opponent_hand` | R7.15 |
| `draw` | R7.6 | `target_discards`, `each_opponent_discards`, `that_opponent_discards` | R7.16 |
| `build` | R7.7 | `discard_hand` | R7.17 |
| `flip` | R7.8 | `resell_per_supply_influence` | R7.18 |
| `resell` | R7.9 | `choose_one` | R8.2 |
| `opponent_resells` | R7.10 | `shuttle_red_orbs_pay` | R9.6 |
| `gain_credit_per_hand_card` | R7.11 | `exchange_station`, `neighbours_exchange_stations` | R12.3, R12.4 |
| `each_player_loses_credits` | R7.12 | `that_opponent_discards_all_agents` | R12.5 |
| `steal_credits` | R7.13 | | |

### 9.1 Stations

| Rule | Text | Source |
| --- | --- | --- |
| R9.1 | A Station is never in a hand, the Deck or the Supply. It cannot be Stolen, Discarded or Resold. | p. 5 |
| R9.2 | A Station offers the Main Action boxes of its visible side. The player chooses one box (R4.5). | p. 13, card |

| Side | Printed Orbs | Colonists | Achievements | Main Action boxes |
| --- | --- | --- | --- | --- |
| Terran Outpost | none | 0 | none | Draft / Build / Resell x2, Draw |
| Shackleton | blue, blue | 2 | none | Draft / Build x2, Draw |
| Selene Labs | red, red | 1 | flask, DNA | Draft / Build / Draw x3 |
| Taikotech | yellow, yellow | 2 | none | Build / Draft, Resell x2 |
| The Oasis | blue, red | 1 | lotus | Draft / Build, Draw x2 |
| Dark Side | red, yellow | 1 | cyber head | Draft / Build / Build, Draft, Target Discards |
| Imbrium | blue, yellow | 2 | helmet | Draft / Steal 3 Credits, Build |

Every Station side has the half-orbs T red, RU gray, RL yellow, LL blue,
LU blue and none at B.

### 9.2 Modules

| Rule | Text | Source |
| --- | --- | --- |
| R9.3 | A Module enters a Base only by Build. It leaves a Base only by Steal Module. | p. 22, 26 |
| R9.4 | A Module with a Main Action box adds that box to its owner's choices (R4.5). | p. 13 |
| R9.5 | "On playing this card" actions are resolved once, by the builder, each time the Module is Built. | p. 22 |
| R9.6 | While an Artificial Intellect is in any Base, every player also gains 1 Credit for each red Orb in their own Base in R4.8. A second Artificial Intellect adds nothing. | card, Q21 |

| Module | Copies | Cost | Colonists | Achievement | Effect |
| --- | --- | --- | --- | --- | --- |
| Fusion Reactor | 2 | 2 blue, 2 red | 1 | atom | Main Action: Build, Draw, Discard |
| Beruang Engineers | 2 | 4 blue, 1 yellow | 2 | | On playing: Flip a Station, Build |
| Indigo Egregore | 2 | 4 blue | 3 | | none |
| Lunar Capital | 2 | 4 blue, 2 yellow | 3 | | On playing: Flip any number of Stations |
| Underground Headquarters | 2 | 2 blue | 2 | | Main Action: Flip your Station, Build |
| Depot | 2 | 2 blue | 1 | | On playing: Build |
| Inflatable Habitat | 4 | free | 2 | | none. Can be Stolen |
| Laika Memorial | 2 | free | 0 | dog | On playing: Discard all your cards |
| Space Elevator | 2 | 2 blue, 2 yellow, 2 red | 2 | elevator | Main Action: Draft x2 |
| Dome (Chandrasekhar, Hayashi, Oort, Struve) | 1 each | red, blue, yellow | 2 | dome | On playing: an opponent Resells 2 |
| Experimental Borehole | 4 | free | 0 | | On playing: Draw 2 |
| Rover (4 artworks) | 4 | 1 red | 0 | rover | On playing: an opponent Resells 1. Can be Stolen |
| Satellite (2 artworks) | 2 | 2 red | 0 | satellite | On playing: Resell 1 per Influence in the Supply. Can be Stolen |
| Smart Spaceship | 2 | 5 red | 0 | brain | On playing: Draft 2 |
| Bacon Printer | 2 | 3 red | 1 | printer | On playing: Draw, Discard |
| J. Lagg Telescope | 2 | 4 red | 0 | observatory | On playing: Draw 2, Draft |
| Asteroid Grinder | 4 | 2 yellow | 0 | | On playing: an opponent Resells 2. Can be Stolen |
| Lang Huan Concrete | 2 | free | 0 | | On playing: Build, then each player Loses 1 Credit |
| Helium Factory | 2 | 2 yellow, 1 blue, 1 red | 2 | | Main Action: Steal 2 Credits, Flip your Station |
| Artificial Intellect | 2 | 1 yellow, 5 red | 0 | | Prints 1 red Orb. R9.6 |

### 9.3 Agents

| Rule | Text | Source |
| --- | --- | --- |
| R9.7 | An Agent is played only by R4.3 and R4.4. It never enters a Base. | p. 11 |

| Agent (2 copies each) | Cost | On playing |
| --- | --- | --- |
| Double Agent | blue, yellow | Both neighbours of a target Flip their Station once |
| Market Manipulator | 5 yellow | Resell 2; an opponent Resells 2; Steal 3 Credits. All three, in order. The two opponents are chosen separately (Q16) |
| Crazy President | free | Each player Flips their Station |
| Investor | blue, yellow, red | Resell 1; Flip a Station |
| Kim the Mech Pilot | 5 red | Draw 2; Build |
| Hacker Pirate | 2 red, 2 yellow | One of: Flip your Station / Steal a Satellite / Steal a Rover |
| Space Unicorn | 2 red, 2 yellow | Draw 1; gain 1 Credit per card in your hand |
| Panaman Broker | 4 yellow | One of: Draft 1 / Steal 3 Credits |
| Solicitor | 2 blue, 2 yellow | One of: Flip a Station / Steal an Asteroid Grinder / Steal an Inflatable Habitat |
| Saboteur | 4 yellow | Each opponent Discards 2 |
| Mormon Scientist | 2 red, 2 blue | Draft 1; Build |
| Rebel Captain | 3 blue | One of: Flip your Station / Discard 1, then Flip two Stations (Q15) |
| Spybot.py | free | Look at an opponent's hand. Then one of: Draw 1 / that opponent Discards 1 (Q34) |

## 10. Variant: Influences

| Rule | Text | Source |
| --- | --- | --- |
| R10.1 | An Influence has no cost. It cannot be played, Built or Resold. It can be Drawn, Drafted, held and Discarded. | p. 34, 35 |
| R10.2 | An Influence in a hand has no effect except R10.5 and R10.6. | p. 35 |
| R10.3 | The Supply effect of an Influence is active from the moment the card lies face up in the Supply until it leaves. | p. 34 |
| R10.4 | For the Shuttle check an Influence is neither a Module nor an Agent (R4.7, R4.9). | p. 15, 34 |
| R10.5 | Influence victory: R11.1 and R11.4. | p. 35 |
| R10.6 | **Defence.** When an action of an Agent is about to affect a player or their Base, and after the acting player has made the choices of that action, the affected player may Discard 1 Influence from hand. The player who played the Agent can be the affected player. If they do, that action and every later action of that Agent card do nothing to them or their Base. Effects that were already resolved stand. The acting player's choices stand; nothing is re-targeted. Examples E1 and E2. | p. 35, Q18 |
| R10.7 | When a player Discards an Influence for any reason, R10.6 included, that player resolves its "When you Discard this Influence" actions immediately (R8.4). | p. 35 |
| R10.8 | "When any player Builds a Dome or a Laika Memorial" triggers after the Module is placed (R7.7 c) and before its "On playing this card" text. A Dome is any of the four. | p. 37, Q33 |
| R10.9 | "When any player Drafts an Influence (incl. this one)" triggers after the Drafted Influence is in the hand. It triggers for every such card that was in the Supply when the Draft began, the Drafted card included. The drafter resolves the effects; the active player orders them (R8.4). | card, Q19 |
| R10.10 | A player gets one chance to defend for each Agent action that is about to affect them, before the first step of that action. Declining does not stop a defence against a later action of the same Agent. A player who has defended is not asked again for that Agent. A player with no Influence in hand is not asked. Several affected players decide clockwise, the active player first. | p. 35, Q18 |

An Agent action affects a player when it would Flip their Station, make them
Discard, make them Resell as the chosen opponent, take their Credits, take a
Module from their Base, or show their hand (Q18). For the player who played
the Agent that leaves a Flip of their own Station and their own Discard. The
action affects the player it reaches even when it would then change nothing
for them, such as a Steal from a player with 0 Credits. An action that is
skipped, or that an Influence in the Supply turns into nothing (Lunar
Alliance, Moonstone Cops), affects nobody.

| Influence | Where it works | Effect | Source |
| --- | --- | --- | --- |
| Quarantine | Supply | No other Influence can be Drafted while this one is in the Supply | card, Q20 |
| Lunar Alliance | Supply | Every Steal Credits action does nothing | card, Q35 |
| Entropic Cascade | On Discard | The discarder Draws 4 cards, then Discards 3 | card |
| Terran Embargo | Supply | R4.8 gives no Credits to anyone, R9.6 included | card, Q21 |
| Terran Crackdown | On Discard | Flip every Station that shows a named side | card |
| Laika's Paradise | Supply | When any player Builds a Dome or a Laika Memorial, that player Drafts 1 (R10.8) | card, p. 37 |
| Space Cowboy Capitalism | Supply | When any player Drafts an Influence, that player Steals 2 Credits (R7.13) | card |
| Runaway Bureaucracy | Supply | When any player Drafts an Influence, that player Discards 2 | card |

## 11. End of the game and scoring

| Rule | Text | Source |
| --- | --- | --- |
| R11.1 | The four victory conditions (table below). | p. 9, 31 |
| R11.2 | After every step (R8.5) other than the Shuttle Credits, the engine checks conditions 1 to 3 for every player. If at least one player meets at least one, the game ends at once. Nothing more is resolved. Condition 4 is not checked here. | p. 31, Q4 |
| R11.3 | Each player's score is the number of conditions they meet at the moment the game ends. Conditions 1 to 3 count for every player. Condition 4 counts only as R11.4 and R11.6 say. The player with the highest score wins. Players tied for the highest score share the victory. A player with score 0 never wins. | p. 31, Q6 |
| R11.4 | **End-of-turn check**, once per turn at R4.7 (b). If the active player holds 4 or more Influences, they are revealed and that player meets condition 4. The reveal is automatic. In the same check the engine checks conditions 1 to 3 for every player. If any player meets any condition, the game ends and scores are counted by R11.3. The Shuttle Credits of this turn and the reveal therefore count as the same moment. | p. 9, 31, 35, Q5 |
| R11.5 | The rulebook gives no other way to end the game and no draw. The turn limit and the step budget in [`architecture.md`](./architecture.md) are service limits that end a game with no winner; they are not rules. | Q22, Q40, Q42 |
| R11.6 | Condition 4 is met in no other way than R11.4. Influences in the hand of a player who is not the active player never count. The active player's Influences do not count when the game ends by R11.2 before the end-of-turn check. | p. 9, 35, Q5 |

| No. | Condition | Met by a player when | Checked |
| --- | --- | --- | --- |
| 1 | Credits | Their Credits are 20 or more | After every step (R11.2) and in the end-of-turn check |
| 2 | Colonists | Their Base has 10 or more colonists (R5.14) | After every step (R11.2) and in the end-of-turn check |
| 3 | Achievements | Their Base has 5 or more different achievements (R5.15) | After every step (R11.2) and in the end-of-turn check |
| 4 | Influences | They are the active player and reveal 4 or more Influences from hand in the end-of-turn check | Only in the end-of-turn check (R11.4) |

| Case | Result |
| --- | --- |
| A is the active player and holds 4 Influences. The Shuttle Credits of A's turn take B to 20 Credits | End-of-turn check: A meets condition 4, B meets condition 1. Each scores 1. A and B share the victory |
| The same, and the Shuttle Credits also take A to 20 | A scores 2, B scores 1. A wins |
| A holds 4 Influences. On B's turn a Steal takes B to 20 Credits | R11.2 ends the game. A's Influences do not count. B wins |
| A is the active player, holds 4 Influences and Builds to 10 colonists in the Main Action step | R11.2 ends the game at the Build. A scores 1, for the colonists only |

## 12. Kickstarter cards

The rulebook has no rules for these cards. Every rule here is a reading of
the card text (Q30). They are used only with the Kickstarter option.

| Rule | Text | Source |
| --- | --- | --- |
| R12.1 | The 4 Kickstarter Stations are shuffled with the 6 base Stations in R3.3. | card, Q30 |
| R12.2 | When both options are on, the engine picks 8 of the 16 Influences at random with its random source, before R3.4. Those 8 are the Influences of the game and their names are public. The other 8 are not used. | p. 33, Q23 |
| R12.3 | Exchange: two Station cards swap Bases. Each takes the other's place on the grid and keeps the side it shows. | card, Q30 |
| R12.4 | Kafka: when a Flip turns a Station to its Kafka side, the player whose Base holds it must at once choose another Station in play and Exchange the two. Metamorphosis: the two neighbours of the drafter Exchange their Stations; with 2 players nothing happens. | card, Q30 |
| R12.5 | Blood Moon: the drafter chooses an opponent and looks at their hand; that opponent then Discards every Agent in it. | card |
| R12.6 | "Drafting an Influence costs extra": to Draft any Influence, this one included, the player pays the printed Orbs as a cost (section 6). The extra costs of all such cards in the Supply form one cost. A player who cannot pay cannot Draft an Influence. | card, Q30 |
| R12.7 | Thresholds: while Welfare is in the Supply, condition 3 needs 6 different achievements. While Longevity is in the Supply, condition 2 needs 12 colonists. | card |
| R12.8 | Transparency: while it is in the Supply, the Deck is face up and the Discard pile is face down. R12.11 to R12.16 say what that means. | card, Q36 |
| R12.9 | Moonstone Cops: while it is in the Supply, every Steal Module action does nothing. | card |
| R12.10 | Credit Reform: when any player Drafts an Influence, each player Loses 3 Credits (R7.12). | card |
| R12.11 | Face-up Deck. The top card of the Deck is public. The order of the Deck does not change: the top card is the card that the next Draw or deal takes. When it is taken, the new top card is public. Every Draw is therefore public. The cards below the top stay hidden. | card, Q36 |
| R12.12 | Face-down Discard pile. No player may look at the cards in the Discard pile, whenever and however they got there. Only their number is public. | card, Q36 |
| R12.13 | A card Discarded from a hand goes to the pile unseen by the other players. They learn only that a card was Discarded. An Influence is the exception: it is shown to all players as it is Discarded, because its defence and its "When you Discard this Influence" text are public acts. | card, Q36 |
| R12.14 | A Resold card and a resolved Agent were public before they reached the pile. Once in the pile they are hidden like every other card (R12.12). What the players saw is not taken back. | card, Q36 |
| R12.15 | Start and end. When Transparency enters the Supply, at setup or in a Shuttle deal, R12.11 and R12.12 apply at once, to every card already in the pile too. When Transparency leaves the Supply, the top of the Deck is hidden again and every card in the Discard pile is public again, including the cards that were Discarded unseen. | card, Q36 |
| R12.16 | A reshuffle (R8.7) works as always. The new Deck is face up: its top card is public as soon as the shuffle is done. | card, Q36 |

| Station side | Printed Orbs | Colonists | Achievements | Main Action boxes |
| --- | --- | --- | --- | --- |
| Braun | yellow, yellow | 1 | flag | Draft / Build / Build, an opponent Resells 1, Draft |
| Korolev | red, red | 1 | rocket | Draft / Build / Discard, Draft x2 |
| Tipu | blue, blue | 2 | none | Draft / Build / Build, Draft, Discard |
| Kafka | none | 0 | none | Draft / Build. R12.4 |

| Influence | Effect while in the Supply |
| --- | --- |
| Transparency | R12.8 |
| Blood Moon | When any player Drafts an Influence: R12.5 |
| Welfare | Extra cost blue, blue, blue (R12.6). R12.7 |
| Free Market | Extra cost yellow, yellow, yellow (R12.6) |
| Moonstone Cops | R12.9 |
| Metamorphosis | When any player Drafts an Influence: R12.4 |
| Credit Reform | When any player Drafts an Influence: R12.10 |
| Longevity | Extra cost red, red, red (R12.6). R12.7 |

## 13. Decisions the engine asks for

Every point where a player chooses. The engine offers only legal options.
With one legal option the engine may apply it without asking.

| No. | Who | Decision | Rule |
| --- | --- | --- | --- |
| D1 | Active player | Play an Agent from hand, or go on to the Main Action | R4.3 |
| D2 | Active player | Which Main Action box | R4.5 |
| D3 | Acting player | Which option of a "do one" | R8.2 |
| D4 | Acting player | Draft: which Supply card | R7.4 |
| D5 | Discarding player | Discard: which hand card | R7.5, R7.16 |
| D6 | Acting player | Build: skip, or which Module and which placement (x, y, q) | R7.7 |
| D7 | Acting player | After a Build: resolve the "On playing" text now or after the current card | R8.3 |
| D8 | Reselling player | Resell: which Supply card | R7.9, R7.10 |
| D9 | Acting player | Which opponent or target: opponent Resells, Steal Credits, Look, Target Discards, Double Agent | R7.10 to R7.16 |
| D10 | Acting player | Flip: which Station or Stations | R7.8 |
| D11 | Acting player | Steal Module: which Module in which Base | R7.14 |
| D12 | Affected player, the acting player included | Discard an Influence to ignore an Agent, and which one | R10.6, R10.10 |
| D13 | Active player | Order of several immediate actions | R8.4 |
| D14 | Station's holder | Kafka: which Station to Exchange with | R12.4 |

## 14. Timing examples

Each example fixes one outcome that the rules above decide. They are
conventions of this specification where the rulebook is silent (Q18, Q37,
Q38).

| No. | Situation | Outcome | Rule |
| --- | --- | --- | --- |
| E1 | A plays Crazy President and holds an Influence | A is affected by their own Agent. A may Discard the Influence; then A's Station does not Flip and every other Station does | R10.6 |
| E2 | A plays Spybot.py and chooses B. B holds an Influence and does not defend against the look. A sees B's hand and chooses "that opponent Discards" | B is asked again and may now defend. If B does, B does not Discard. The look stands: A has seen the hand | R10.6, R10.10 |
| E3 | A Builds Laika Memorial with the hand Entropic Cascade, X, Y. A Discards Entropic Cascade first and Draws P, Q, R, S | The set is Entropic Cascade, X, Y. A must now Discard 3 cards from X, Y, P, Q, R, S. If A Discards X, Y, P, the set is gone and A keeps Q, R, S. If A Discards P, Q, R, A must then Discard X and Y and keeps S | R7.17, R10.7 |
| E4 | A chooses Shackleton's box "Build x2, Draw", Builds Experimental Borehole and defers its text, then Builds Laika Memorial and defers its text | A Draws 1 for the box. Then the Borehole text: Draw 2. Then the Laika text: Discard all. A's hand is empty. To keep the Borehole cards A must resolve the Laika text at once when Laika Memorial is Built | R8.3, R8.10 |
