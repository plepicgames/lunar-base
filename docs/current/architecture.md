# Architecture

One TypeScript code base on Node.js 24. A pure rules engine decides
everything; a small WebSocket server owns the games and sends each player
only what that player may see; a React client draws the table from that
view. `npm start` starts the game. `bash scripts/validate` is the gate;
`npm run check` adds the browser tests.

| Question | Decision |
| --- | --- |
| Language and runtime | TypeScript 6.0.3 on Node.js 24 (24.15 or newer). Node runs the `.ts` files directly |
| Server | `node:http` + `ws` 8.22.0, one process, state in memory |
| Client | React 19.3.0, built by Vite 8.3.4, plain CSS Modules |
| Engine | Pure functions over a JSON state. No I/O, no clock, no `Math.random`. Seeded xoshiro128** |
| Protocol | JSON over one WebSocket. The server sends a full per-seat view after every change |
| Hidden information | One function, `viewFor(state, seat)`, in the engine. Nothing else leaves the server |
| Non-human players | `DecisionMaker` interface. Jev through `@typesafe-ai/sdk` 0.6.0 when `TYPESAFE_API_KEY` is set; a built-in maker otherwise and on every failure |
| Card images | `pdftoppm` 300 dpi, crop to trim, `sharp` to WebP. Committed under `assets/cards/` |
| Check | `bash scripts/validate`: format, shell lint, lint, types, data, unit and integration tests, build. `npm run check` adds the browser tests |
| Start | `npm start`, then open `http://localhost:4780` |

Rule numbers (`R…`), decisions (`D…`) and questions (`Q…`) refer to
[`rules.md`](./rules.md) and [`open-questions.md`](./open-questions.md).

## Stack

The application uses the versions below; `package.json` pins them. Where the
table names a newer release, it says why that one is not used.

| Part | Package | Version | Why this one |
| --- | --- | --- | --- |
| Runtime | Node.js | 24.x, at least 24.15.0 | Runs TypeScript by type stripping with no flag and no build step. jsdom 30 needs 24.15 |
| Language | `typescript` | 6.0.3 | Type checker only (`noEmit`). Not 7.0.2: `typescript-eslint` 8.71.1 accepts `<6.1.0` only |
| WebSocket | `ws` | 8.22.0 | The standard Node WebSocket server. No framework is needed for one socket endpoint |
| Static files | `sirv` | 3.0.2 | Serves the built client. Safer than a hand-written file handler |
| Validation | `zod` | 4.6.5 | Checks every message at the server boundary and the Jev response |
| Jev | `@typesafe-ai/sdk` | 0.6.0 | Official client for `POST /v1/systemone`. Takes an injected `fetch`, a per-call `AbortSignal`, a timeout and a retry policy |
| UI | `react`, `react-dom` | 19.3.0 | A widely known UI library. No router, no state library |
| Build | `vite`, `@vitejs/plugin-react` | 8.3.4, 6.1.2 | Client build and dev server. Builds with `base: "./"`, so every URL in the build is relative and one build serves any base path. Proxies `/ws` to the game server in development |
| UI font | `@fontsource-variable/outfit` | 5.3.0 | OFL-1.1, served from the game itself. See [Tokens](#tokens) |
| Tests | `vitest` | 5.0.3 | One runner for engine, server and client tests (`test.projects`) |
| Property tests | `fast-check` | 4.10.2 | Random legal games; shrinks a failure to a short decision list |
| Component tests | `@testing-library/react`, `@testing-library/dom`, `jsdom` | 16.3.3, 10.4.2, 30.1.2 | Client tests without a browser |
| Browser tests | `@playwright/test` | 1.64.0 | Each Playwright release drives one Chromium build. The tests never download a browser: after an upgrade, run `npx playwright install chromium` once on a machine that runs them. `.github/workflows/validate.yml` installs the matching build itself |
| Lint | `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals` | 10.12.0, 10.0.1, 8.71.1, 7.1.1, 17.13.0 | Type-aware rules: unhandled promises, exhaustive `switch`. Also enforces the import boundaries |
| Format | `prettier` | 3.9.9 | One formatter, no options to argue about |
| Images | `sharp` | 0.35.5 | Resize and WebP encoding with a prebuilt binary. No system package |
| Types | `@types/node`, `@types/ws`, `@types/react`, `@types/react-dom` | 24.19.2, 8.18.2, 19.3.0, 19.3.0 | Match the runtime versions |
| System tools | `pdftoppm` (poppler), `unzip` | not pinned; 25.03.0 made the committed card images | Only the image build commands need them. Starting the game does not |

Rules for dependencies:

- `package-lock.json` is committed. `.npmrc` sets `save-exact=true`. Install
  with `npm ci`.
- A change that adds or upgrades a dependency updates this table and says
  why.
- One package, no workspaces. One lockfile and one `node_modules` keep every
  worktree cheap to set up.

Rejected: a Python or Go server (two languages, and the engine could not be
shared with tests of the client); Socket.IO and Fastify (more surface than
one socket needs); a canvas or game framework (cards are images; DOM and CSS
transforms rotate and place them); Tailwind and a component library (a
branded table needs custom CSS anyway); Biome (cannot run the type-aware
rules the engine relies on).

## Layout

```
src/engine/     rules: state, setup, actions, resolution, victory, views
src/protocol/   message schemas (zod), view and event types, protocol version
src/bots/       DecisionMaker, built-in maker, Jev adapter
src/server/     http, ws, sessions, lobby, game rooms, game log
src/client/     React application
tools/          image pipeline, replay, soak run, scenario recorder, Jev probe
assets/         derived images (committed) and their manifests
e2e/            Playwright tests
test/           test setup: the network guard
scripts/        validate (the gate), check.sh, start.sh, validate-cards.sh
```

| Directory | May import | Must not use |
| --- | --- | --- |
| `src/engine` | Its own files and `docs/design/cards.json` | Anything else: no Node, DOM, timers, network, `Math.random`, `Date` |
| `src/protocol` | `src/engine` (types, `viewFor` types), `zod` | Node, DOM |
| `src/bots` | `src/engine`, `src/protocol`, `@typesafe-ai/sdk`, `zod` | `src/server`, `src/client`, DOM |
| `src/server` | `src/engine`, `src/protocol`, `src/bots`, Node, `ws`, `sirv` | `src/client` |
| `src/client` | `src/protocol`, React, CSS, `docs/design/cards.json` | `src/engine` code, `src/server`, `src/bots`, Node |

The boundaries are enforced twice, and both are part of the check:

- Each directory has its own `tsconfig.json`. The engine's has
  `"lib": ["es2024"]` and `"types": []`, so `setTimeout`, `process`,
  `fetch` and `document` do not type-check there.
- ESLint `no-restricted-imports` per directory, and for the engine
  `no-restricted-properties` on `Math.random` and `Date.now`.

Node's type stripping sets the code style: `erasableSyntaxOnly`,
`verbatimModuleSyntax`, `allowImportingTsExtensions`, `module: nodenext`.
That means no `enum`, no parameter properties, no namespaces, `import type`
for types, and relative imports that end in `.ts`.

Test files live next to the code as `*.test.ts(x)`. A separate
`tsconfig.tests.json` type-checks them with Node types, so engine tests may
use Node while engine code may not.

## Catalogue

`src/engine/catalogue.ts` loads `docs/design/cards.json` at module startup.
It exports readonly `CardDef` data and the 22-variant `ActionDef` union.
The loader checks every nested action code and reports an unknown code with
its card id. It consumes authored repository data, not untrusted client data;
`scripts/validate-cards.sh` checks the catalogue vocabulary and counts.

| Export | Contract |
| --- | --- |
| `catalogue`, `loadCatalogue(data)` | All 68 faces, including the shared Terran Outpost face and the info card; retain physical-copy counts |
| `cardById(id)` | Return the face or throw an error naming the unknown id |
| `stationSides(config)` | The 6 named base faces, or 10 with Kickstarter; excludes the shared reverse |
| `actionsOf(card)` | Main Action boxes, on-play, passive, on-flip, on-discard and Supply-trigger actions; includes each `choose_one` and its recursively flattened options |
| `actionKey(action)` | The op, except Flip uses `flip:<who>` |
| `deckCards(config)` | One id per physical copy of each eligible Module and Agent, in catalogue order; does not shuffle |
| `influenceCards(config)` | The Influence faces of the sets in use, in catalogue order: the 8 base ones, or all 16 with Kickstarter (R12.2 picks 8). Empty without the Influence option |

The base Deck has all 76 copies: 50 Modules and 26 Agents (R3.4).
Seat count and available Station faces do not filter it. `deckCards` never
holds an Influence. Setup adds the eight base Influences, or with both options
shuffles all sixteen using the engine random source and picks eight before
shuffling the Deck (R12.2). Unselected Influences receive no instance id.
`influencesInGame` publishes the selected names in catalogue order.
Setup accepts Kickstarter Stations: shuffle all ten, deal one per seat and
remove the rest unseen. The lobby accepts Kickstarter alone or with Influences.
`exchange_station`, `neighbours_exchange_stations`
and `that_opponent_discards_all_agents` are implemented.

`src/engine/staging.test.ts` checks that every action of every base Module,
Agent and Station face has a handler. It reads the catalogue directly,
so omitting a card from the Deck cannot hide a missing handler.

## Engine

The engine is the rules and nothing else. The quality of the game depends
on it, so it is pure, small in surface and testable in milliseconds.

### Interface

```ts
createGame(config: GameConfig, seed: string): GameState
startGame(config: GameConfig, seed: string): { state: GameState; events: readonly GameEvent[] }
applyChoice(state: GameState, choice: Choice): ChoiceResult
viewFor(state: GameState, seat: Seat | null): PlayerView
eventFor(event: GameEvent, seat: Seat | null): ViewEvent | null
```

| Type | Holds |
| --- | --- |
| `GameConfig` | `seats` (2 to 6), `influences`, `kickstarter`, optional `startingSeat` (R3.1, R3.2) |
| `Choice` | `seat`, `decision` (id of the pending decision), `option` (id of one offered option) |
| `ChoiceResult` | `{ ok: true, state, events }`, or `{ ok: false, error: { code, message } }` for a rejected choice |
| `GameState` | Plain JSON: config, RNG state, card instances, zones, Bases, Credits, turn, resolution stack, the pending decision, counters, result |
| `GameEvent` | One thing that happened, already split by audience (see [Hidden information](#hidden-information)) |

- `createGame` runs setup (section 3 of the rules), starts the first turn
  and stops at the first decision: the starting seat's D1 when that seat
  holds an Agent it can pay for, otherwise its D2.
- `applyChoice` rejects a choice that is not the pending decision, not from
  its seat, or not one of its options. It checks in that order and returns
  the first error: `stale_decision`, `wrong_seat` or `unknown_option`. A
  rejection is a returned value, not a throw, and carries no state: the
  caller keeps the state it has. With nothing pending, as in a finished
  game, every choice is `stale_decision`.
- A valid choice runs the game forward until the next decision, the end of
  the game, or the end of the turn's step budget (see
  [Step budget](#step-budget)). `applyChoice` never mutates its input.
- The engine is synchronous, bounded and total: a valid choice returns after
  at most `STEP_BUDGET` loop steps and cannot fail. It does not promise
  that every choice reaches another decision: the rules allow a turn that
  never ends, and the budget stops it. A thrown error is an engine bug; the
  server ends that game and logs the replay file.
- A game is fully described by `(config, seed, list of choices)`. Replaying
  them gives the same states and events, byte for byte. Tests, bug reports
  and the game log all use this.

`src/engine/index.ts` is the interface: it exports `createGame`, `startGame`,
`applyChoice`, `eventFor`, `viewFor`, and the types of states, choices,
results, events and views. For visible-card evaluation it also exports the
readonly `catalogue`, `legalPlacements`, `priceOf` and their types. Code outside the engine
imports from this module only, except bots may reuse the pure functions in
`src/engine/rng.ts` to keep their own streams.

`src/engine/game.ts` binds the loop to the game's registry.

| Export | Contract |
| --- | --- |
| `gameRegistry` | `turnHandlers(actionHandlers)` and `victoryAfterStep`: every frame kind of the game |
| `startGame(config, seed, registry?)` | `dealGame`, `pushTurn`, `run`. Returns `{ state, events }`; the events are the opening: `game_started`, then what the run emitted, which is `turn_started` of turn 1 |
| `createGame(config, seed)` | The state of `startGame`. It drops the opening events (Q44) |
| `applyChoice(state, choice)` | The loop's `applyChoice` with `gameRegistry` |

### State

| Field | Content |
| --- | --- |
| `cards` | Instance id to catalogue id for every card in the game. Instance ids (`c1`, `c2`, …) are dealt in shuffled order at setup, so an id says nothing about the card |
| `deck`, `discard`, `supply`, `hands[seat]`, `play`, `removedStations` | Lists of instance ids (R2.3) |
| `bases[seat]` | Station (`named` card, which side shows, `revealed` once Flipped, R2.4) and Modules with `(x, y, q)` (R5.3) |
| `credits[seat]` | Integer |
| `turn` | Number, active seat, step (R4.2), and `work`: the loop steps used in this turn |
| `stack` | The resolution stack, see below |
| `pending` | The decision the game waits for, or `null` |
| `counters` | `frames` and `decisions`: how many were made so far. The next frame is `f<n>` and the next decision `d<n>`, so no id is used twice in a game |
| `rng` | Four 32-bit integers |
| `influencesInGame` | The printed names of the 8 Influences when the option is on, in catalogue order; otherwise empty (R3.4, R12.2) |
| `result` | `null`, or winners, scores and the reason: `victory` (R11), or `step_limit` with no winner |

The state is JSON on purpose: no `Map`, `Set`, class instance or
`undefined`. It can be copied, compared, hashed, logged and replayed with no
adapter. Orbs, colonists and achievements are derived from the Base when
needed (R5.8) and are never stored.

`src/engine/state.ts` defines these JSON types. Seats are zero-based;
`turn` is `{ number, seat, step, work }`, with steps `agent`, `main_action`
and `shuttle`. Result scores are the number of victory conditions met per
seat. Frames have `id`, `kind` and JSON data; pending decisions have `id`,
`seat`, `kind` and ordered options with `id`, `label` and JSON data.
[Resolution](#resolution) gives their behaviour.

`dealGame(config, seed)` in `src/engine/setup.ts` returns setup before any
resolution runs. It requires integer `seats` from 2 to 6, boolean options,
and an optional integer `startingSeat` from 0 to N−1. `influences: true`
deals 8 Influences: the base set without Kickstarter, or 8 sampled from all
16 with Kickstarter. `kickstarter: true` adds the 4 Kickstarter Stations
to the Station pool whether or not Influences are enabled.

| Setup detail | Contract |
| --- | --- |
| Random stream | Shuffle the eligible Stations; with both options, shuffle all 16 Influences and keep 8; shuffle the Deck with selected Influences; then choose the starting seat if omitted. An explicit starting seat consumes no random draw |
| Instances | Assign `c1` onward to shuffled Stations (including removed ones), then to the shuffled Deck. Each physical copy has its own id |
| Dealing | Deck index 0 is the top. Each seat draws its three cards together, clockwise from the starting seat; then deal 3 + N to the Supply, or what remains |
| Initial turn | Number 1, starting seat, step `agent`, work 0 |
| Resolution | Empty stack; pending and result are null; both counters are 0. `createGame` later starts the first turn |
| Influences (R3.4, R3.8) | Eight are in the 84-card Deck before the first card is dealt. Their instances start at `c7` without Kickstarter or `c11` with it. The deal treats them as any card, so one can land in a hand or the Supply and stays there. Setup pushes no frame and emits no event for them |
| Options and ownership | Copy the validated config, omit an absent starting seat, and store no references to caller data. `influencesInGame` names the selected eight Influences in catalogue order, not shuffle order |

`src/engine/base.ts` holds the `Base` type and what a Base counts. Every
function takes the Base and a resolver from instance id to `CardDef`, so it
needs no game state.

| Export | Contract |
| --- | --- |
| `Base` | `station: { card, side, revealed }` and `modules: { card, x, y, q }[]` in build order. `card` is an instance id; a Station's resolves to its named side. `side` is `"terran_outpost"` or `"named"` |
| `visibleSide(station, cardOf)` | The `CardDef` of the side that is up; Terran Outpost is the named side's `other_side` |
| `placedCards(base, cardOf)` | The Station's visible side at (0, 0, 0) (R5.4), then each Module, with placements |
| `halfOrb(card, slot)` | The colour a card prints in a slot, or `null` (R5.2) |
| `orbOfJoint(a, b)` | The Orb two facing half-orbs form, or `null` (R5.5, R5.6). Two different colours give `null`; R5.11 keeps that joint out of a Base |
| `orbsOf(base, cardOf)` | Counts of red, blue, yellow and wild: printed Orbs of visible sides plus joint Orbs (R5.7, R5.8) |
| `colonistsOf(base, cardOf)` | A number (R5.14) |
| `achievementsOf(base, cardOf)` | A `Set` of achievement names (R5.15) |

`src/engine/placement.ts` applies the placement rules (5.3). Nothing else in
the engine decides where a Module may lie.

| Export | Contract |
| --- | --- |
| `isLegal(base, card, placement, cardOf)` | Whether the `CardDef` `card` may be built at `(x, y, q)`: R5.10 to R5.13. A card with no half-orbs is never legal |
| `legalPlacements(base, card, cardOf)` | Every legal `{ x, y, q, orbs }`, ordered by y, then x, then q. It tries only placements with a cell next to a card of the Base, cut-off Modules included (Q32). The same Base and card give the same list |
| `LegalPlacement.orbs` | The Orbs the placement forms (R5.5, R5.6), one per joint, in the slot order of the new card: T, RU, RL, B, LL, LU. Never empty (R5.12) |

`src/engine/testing/build.ts` builds Bases and the `cards` table by hand
from catalogue ids, for engine tests. `src/engine/testing/rulebook-bases.ts`
holds the Bases pictured on rulebook pages 18, 20, 23, 24 and 32.
`src/engine/testing/rulebook-sample-turn.ts` holds the state before the
sample turn of pages 27 to 30 and the placements and Orbs its pictures show.

`src/engine/testing/play.ts` plays whole games for tests.

| Export | Contract |
| --- | --- |
| `seededPicker(seed)` | A picker that takes every offered option with the same chance. Its stream comes from its own seed with the generator of `rng.ts`, never from the game's |
| `play(config, seed, pick, maxTurns?)` | Starts a game and answers every decision with `pick` until the game has a result or a turn after `maxTurns` begins; it then stops at that turn's first decision. `TURN_CAP` is the default, 300 (Q40) |
| `replay(config, seed, choices)` | Plays exactly those choices. Throws when one is rejected |
| `Played` | `states` and `events` at each stop (the opening, then one per choice), `choices`, the last `state`, and `largestWork`: the largest `turn.work` of any turn, counted in the loop's `afterStep`, so the steps after a turn's last decision are in it |

### Randomness

| Point | Decision |
| --- | --- |
| Generator | xoshiro128**, implemented in `src/engine/rng.ts`. State lives in `GameState.rng` |
| Seed | A string. A fixed hash in `rng.ts` turns it into the four state words. Test vectors pin both |
| Seed hash | Word i is 32-bit FNV-1a over the byte i and then the seed's UTF-16 code units (two bytes each, low byte first), finished with MurmurHash3 `fmix32`. Not cryptographic. Four zero words become `[1, 0, 0, 0]` |
| Bounded numbers | Rejection sampling, so a shuffle has no modulo bias |
| Interface | `seedToState(seed)`, `nextUint32(state)`, `nextInt(state, n)` for n from 1 to 2^32, `shuffle(state, list)`. Each returns its result and the next state and never mutates its input |
| Steps used | `nextInt` takes one generator step plus one per rejected output, also for n = 1. `shuffle` is Fisher-Yates from the last index down and takes no step for a list of 0 or 1 items. Replays depend on these counts |
| Uses | Setup shuffles, starting player, the 8 of 16 Influences (R12.2), reshuffles (R8.7). Nothing else |
| Source of the seed | The server draws 16 random bytes per game. `LUNAR_SEED` fixes it for a reproducible local game. Tests always pass a literal |
| Bots | A bot's own random stream is derived from the seed and the seat and kept outside `GameState`. A bot's choice never changes the game's stream |
| Secrecy | The seed and `rng` never leave the server |

### Resolution

A card can ask several players for choices in the middle of its effect
(R8.3, R8.6, R10.6). The engine therefore keeps its own stack in the state
instead of using the call stack: it can stop at any decision, be saved, and
continue.

- A frame is one unit of work: a turn step, a Main Action box, an Agent, an
  "On playing this card" text, one action, a Shuttle deal, an Influence
  effect.
- The loop takes the top frame and performs one step (R8.5). A step changes
  the state, emits events, and may push frames. After every step the loop
  runs the victory check of R11.2, or the end-of-turn check of R11.4 after
  the Shuttle Credits. Then it continues until a frame needs a choice or
  the step budget of the turn is used up.
- An action is data: `cards.json` gives `op` codes, and
  `src/engine/actions/` has one handler per code (22 codes, section 9 of
  the rules).

| Rule | How the stack expresses it |
| --- | --- |
| Actions left to right, x2 one at a time (R7.2, R8.1) | A box frame holds its action list and a position |
| Resolve a built Module's text now or later (R8.3) | Now: push its frame. Later: append it to the `deferred` list of the text frame that holds the Build (below) |
| Several deferred texts (R8.10) | A text frame that finishes its actions pushes its `deferred` entries one at a time, first deferred first |
| Immediate effects interrupt (R8.4, R10.7) | Pushed on top of the stack. Several at once: a D13 decision orders them |
| Defence (R10.6, R10.10) | Before an Agent action's first step the engine lists the affected players clockwise and asks each one who holds an Influence. The Agent frame keeps the set of players who defended; later actions skip them |
| Discard all (R7.17) | The frame stores the instance ids of the hand at its start and works that list down |
| Game ends at once (R11.2) | The check sets `result` and clears the stack |
| Kickstarter cards (section 12) | More handlers and Supply-effect flags. No new mechanism |

`src/engine/loop.ts` is the loop and `src/engine/decisions.ts` the
decisions. Neither knows a rule: every frame kind comes from a registry.

| Export | Contract |
| --- | --- |
| `Registry` | `handlers`, one per frame kind, and `afterStep`. `run` and `applyChoice` take it as their last argument; `src/engine/game.ts` binds the game's registry to give the two-argument [interface](#interface) |
| `FrameHandler` | `(state, frame, answer) => { state, events? }`: one step of the top frame. It returns a new state and never mutates |
| `push(state, kind, data)`, `pop(state)` | Add a frame on top with the next frame id; remove the top frame |
| `update(state, frame)` | Replace the frame of the same id, wherever it lies on the stack. Throws when no frame has that id |
| `ask(state, { seat, kind, options })` | Sets `pending` with the next decision id and the options in the order given. Throws on no option, a repeated option id, or a decision already pending |
| `run(state, registry)` | Returns `{ state, events }`. One pass: stop if `result` is set; end with `step_limit` if `turn.work` has reached the budget; stop if `pending` has several options; else step the top frame, add 1 to `turn.work`, call `afterStep` |
| Asking | A handler asks with `ask` and leaves its frame on top. Its next step gets `answer = { decision, option }` with `pending` cleared, whether the engine or a player chose. A step without a decision gets `answer = null` |
| `afterStep(state, frame)` | Gets the state with the step counted and the frame as it was before the step. Use `victoryAfterStep` from `victory.ts`; a result it sets stands, also on the step that uses up the budget |
| `checkChoice(state, choice)` | The answer a choice gives, or the error `applyChoice` returns |
| `TextFrame`, `isTextFrame` | A frame with `actions`, a `position` (the action to resolve next) and `deferred` (instance ids of the built Modules whose texts wait, first deferred first) |
| Engine bugs | `run` throws on an empty stack with no result, a frame kind with no handler, and a pending decision with no option |

`src/engine/victory.ts` implements conditions 1–3 for every seat and
condition 4 for the active player in the end-of-turn check. Its hook checks
after each step, before another frame or decision can resolve.

| Export / case | Contract |
| --- | --- |
| `thresholds(state)` | Defaults to `{ credits: 20, colonists: 10, achievements: 5 }`. Welfare in the Supply raises achievements to 6; Longevity raises colonists to 12. Recomputed for every victory check and view (R12.7) |
| `INFLUENCES_TO_WIN` | 4: the Influences the active player must hold for condition 4 (R11.1). No card changes it |
| `checkVictory(state)` | Derives colonists and distinct achievements from each Base's visible cards; counts each met threshold once. Never counts condition 4 (R11.2, R11.6) |
| `checkEndOfTurn(state)` | Checks after the whole `shuttle_step`, even without arrival, before `shuttle_deal`. Counts the Influences in the hand of `turn.seat` and of no other seat. With 4 or more it emits one public `influences_revealed` event naming all of them in hand order, and that seat scores condition 4 in the same count as everyone's conditions 1–3 (R11.4). With fewer it is `checkVictory` |
| Reveal | An event only: no card moves and the state gains no field. The hand stays in the owner's view alone. The event is emitted before `game_ended`, and never without it |
| `victoryAfterStep(state, frame)` | Calls `checkEndOfTurn` for `shuttle_step`, otherwise `checkVictory`; both return a loop `Step` |
| No positive score | Leaves the game running |
| Positive score | Sets `result = { reason: 'victory', winners, scores }`, clears `stack` and `pending`, emits one `game_ended` event; every seat tied for the highest score wins |
| Finished game | Checks preserve the result without emitting another event. `applyChoice` rejects with `stale_decision`, even if an old pending decision remains; the input state is unchanged |

Which frame owns a deferred text. A text frame is a frame that holds a list
of actions: a Main Action box, an Agent, an "On playing this card" text or
an Influence effect. The frame of one Build action is not a text frame and
never owns a `deferred` list. A Build defers to the nearest text frame
below it on the stack, found by the frame's id, so Builds nested inside it
and Influence effects that interrupt it do not move the entry. A text
deferred while an "On playing this card" text resolves belongs to that
text's frame and so waits only for its end (R8.10). Examples: E4, where
Shackleton's Draw comes before both deferred texts, and a Lang Huan
Concrete built from "Build, Draw, Discard", where a text deferred inside
its own text (Build, each player Loses 1 Credit) resolves when that text
ends, before the box's Draw. Inside Depot's text, which is only Build,
nothing can be deferred: no action remains, so the built Module's text
resolves at once (R8.3).

### Turn frames

`src/engine/turn.ts` holds the frames of a turn and
`src/engine/actions/index.ts` the action registry. `turnHandlers(actions)`
returns the frame handlers below for a set of action handlers;
`pushTurn(state)` puts the turn that `state.turn` names on the stack.

| Frame kind | One step |
| --- | --- |
| `turn` | Begins the next step of R4.2: sets `turn.step` and pushes `agent_step`, `main_action_step` or `shuttle_step`. The first of these steps also sets `turn.work` to 0 and emits `turn_started`. After the Shuttle step, one step ends the turn: `turn.number` grows by one, `turn.seat` moves clockwise, and a new `turn` frame takes the old one's place (R4.10), so the stack does not grow |
| `agent_step` | Asks D1 while the active seat has an Agent it can pay for; otherwise it leaves the stack. An answer that plays an Agent takes the two steps of the table below, and the frame stays under the `agent` frame, so it asks again when that Agent is done (R4.3). "Go on" leaves the stack |
| `agent` | An Agent in the play area (R4.4): a text frame with `seat`, `repeated` and `card`, the Agent's instance id. It steps as a `box` does, its `deferred` list included. With nothing left, one step moves the Agent from the play area to the Discard pile, emits `agent_discarded` and leaves the stack |
| `main_action_step` | Asks D2. The answer emits `box_chosen` and puts a `box` frame in its place |
| `box` | A text frame with `seat` and `repeated`. Pushes one `action` frame for the next repetition of the action at `position` (R7.2, R8.1). With no action left it takes the first entry off `deferred` and pushes that Module's `on_play` frame, one entry per step (R8.10); with none left it leaves the stack |
| `on_play` | The "On playing this card" text of a built Module (R9.5): a text frame with `seat`, `repeated` and `card`, the Module's instance id. It steps as a `box` does, its own `deferred` list included. `pushOnPlay` in `actions/build.ts` pushes it, for [Build](#build) and for a text frame that resolves a deferred text |
| `action` | `{ action, seat }`: one action, or one repetition of it. Steps the handler of `actionKey(action)` and throws `No handler for action <key>` when there is none; an action is never skipped |
| `shuttle_step` | Inspects the Supply once (R4.7). If no Module or Agent remains, computes every Base's payout from yellow and wild Orbs (R4.8), plus red with Artificial Intellect; Terran Embargo makes all gains zero. It applies the payouts in one step, emits one `shuttles_arrived` event with all gains, and replaces itself with `shuttle_deal`. Otherwise it leaves the stack. In either case, `afterStep` receives `shuttle_step` and runs the end-of-turn check instead of the ordinary victory check |
| `shuttle_deal` | Reached only if the end-of-turn check lets play continue. Appends up to 3 + N cards to the Supply, leaving existing Influences there (R4.9). Uses the saved RNG to reshuffle Discards when the Deck runs out; stops if both piles are empty (R8.7). Emits reshuffle events and one `supply_dealt` event for a nonempty deal, then leaves the stack |

The first decision of a turn with no Agent to play comes at `turn.work` 4:
two steps of `turn`, one of `agent_step` and the step that asks.

| Point | Decision |
| --- | --- |
| D1 | Kind `agent`, for the active seat. One option per Agent in hand that the seat can pay for (R6.4), in hand order, then `go_on`. `agentOptions(state, seat)` lists them without `go_on`. With no Agent to offer D1 is not asked: `agent_step` leaves the stack in that step, so no decision id is used |
| D1 option | `{ id: instance, label, card, price }`: the Agent's instance id and its Credit price, by `priceOf` on the Orbs of the Base as it is (R6.6). Label: "Play Kim the Mech Pilot, pay 2". Last: `{ id: "go_on", label: "Go on to the Main Action" }` |
| D2 | Kind `main_action`, for the active seat. One option per Main Action box of the visible Station side, then of each Module in build order, boxes in printed order (R4.5). Every box is offered, whether or not it can do anything (R4.6) |
| D2 option | `{ id: "<instance>:<box>", label, card, box }`: the card's instance id and the zero-based box. Two Modules of one name give equal labels and different ids |
| Label | `<card name>: <actions>`, with the name of the visible side: "Terran Outpost: Resell x2, Draw". `actionsLabel` in `src/engine/actions/label.ts` joins the action names of rules 7 and 9 with ", "; an action done n times ends in " xN". It names every code of the catalogue |
| Action handler | `(state, frame, answer) => Step`, as a frame handler: its `action` frame is on top, it may ask with `ask`, and it pops the frame when the action is done. `actionHandlers` is the game's registry, keyed by `actionKey` |
| Repetitions | `repetitions(action)` is `n` for Draft, Draw, Discard, Build and Resell, and 1 for every other code: there `n` is an amount taken in one step (R8.5) or a count that follows one choice of a player (R7.10, R7.16), and the handler reads it |
| Box position | The box moves `position` and `repeated` on before it pushes a repetition. While a repetition resolves, `position < actions.length` says that the box has actions or repetitions left (R8.3) |

Playing an Agent (R4.4) takes two steps of `agent_step` and the last step
of its `agent` frame (R8.5), so the victory check runs after each.

| Step | Change | Event |
| --- | --- | --- |
| The answer to D1 | Credits go down by the price. The `agent_step` frame keeps the Agent and the price in `paid` | `credits_changed`, unless the price is 0 |
| The next | The Agent moves from the hand to `play`, `paid` is cleared and an `agent` frame with the Agent's `on_play` actions goes on top | `agent_played`, with the price as `cost` |
| The last of `agent` | The Agent moves from `play` to the end of the Discard pile | `agent_discarded` |

Between the last two steps the Agent is in `play` only. A reshuffle takes
the Discard pile, so it leaves the Agent out (R8.8). A Build in an Agent's
text finds the `agent` frame as its holder (R8.3). A game that ends while
an Agent resolves leaves it in `play`.

### Moving cards

`actions/draft.ts`, `draw.ts`, `discard.ts` and `resell.ts` each resolve one
repetition. `zones.ts` moves one instance without mutating the input,
preserves the source order and appends to the destination. Deck index 0 is
the top; the last Discard entry is the newest card.

| Action | Decision and move | Event |
| --- | --- | --- |
| Draft | D4, kind `draft`, legal cards in Supply order; Quarantine excludes other Influences and R12.6 excludes unaffordable Influences. Pay, then move from Supply to the performing seat's hand | `credits_changed` if paid; `card_drafted` |
| Discard | D5, kind `discard`, that seat's hand order; hand to Discard | `card_discarded` |
| Draw | No decision; Deck index 0 to the performing seat's hand | `card_drawn` |
| Resell | D8, kind `resell`, Supply order restricted to Agents and Modules; Supply to Discard, +1 Credit in the same step | `card_resold`, including proceeds of 1 Credit |

D4, D5 and D8 options are `{ id: instance, card: instance, label }`, labelled
`<action> <card name>`. Copies have distinct ids even when their labels match.
An empty eligible zone skips the action with no decision or event. The loop
applies a single option automatically. Every completed handler pops its frame;
the enclosing text pushes each repetition separately, so the after-step hook
observes every card move.

Draw shuffles the Discard pile with the state's RNG only when the Deck is
empty, saves the advanced RNG, clears Discard and emits `deck_reshuffled`
before `card_drawn` in the same handler step. Cards in play stay outside the
shuffle. With both piles empty, Draw changes no zones and emits nothing.

An Influence is a card like any other for Draw, Draft and Discard (R10.1):
D5 offers it; D4 offers it unless Quarantine forbids it. D1 lists only
Agents, D6 only Modules and D8 only Agents and Modules, so none of them ever
offers one. [Supply restrictions](#supply-restrictions),
[Discard effects](#immediate-influence-effects) and
[Draft and Build triggers](#supply-draft-and-build-triggers) are below.

### Satellite and Artificial Intellect

| Effect | Resolution |
| --- | --- |
| Satellite (R7.18) | Count Supply Influences when its on-play action resolves. Push a box with that many Resells for the builder; zero does nothing. The count stays fixed through later Supply changes. Each Resell uses D8 and its own victory check; a Supply without Agents or Modules skips the remainder |
| Artificial Intellect (R9.6, Q21) | At Shuttle arrival, inspect all built Modules for `shuttle_red_orbs_pay`. If any has it, every Base receives Credits for its own red Orbs as well as yellow and wild. Multiple Intellects do not stack; a wild Orb pays once. Terran Embargo suppresses the entire payout. The passive has no stored flag or on-play change |

### Build

`actions/build.ts` resolves one Build (R7.7). Build is the only optional
action (R7.1): its decision always has a way out.

| Point | Decision |
| --- | --- |
| D6 | Kind `build`, for the performing seat. `skip` first, then one option per Module in hand, legal placement and turn that the seat can pay for (R6.4), ordered by hand position, then y, x and q. `buildOptions(state, seat)` lists them without `skip` |
| Not offered | A card that is not a Module, a Module with no legal placement (R7.7), a Module whose price is more than the seat's Credits. With nothing to offer the decision holds only `skip` and the loop applies it |
| `skip` | `{ id: "skip", label: "Do not Build" }`. It ends the action with no event |
| Option | `{ id: "<instance>:<x>,<y>,<q>", label, card, x, y, q, price, orbs }`: the instance id, the placement (R5.3), the Credit price and the Orbs the placement forms, as `legalPlacements` gives them |
| Label | `Build <name> at <x>,<y> <turn>, pay <price>`. The turn for q = 0 to 3 is "upright", "turned right", "upside down", "turned left": "Build Depot at 2,0 turned right, pay 1" |
| Price | `priceOf` on the card's cost and the Orbs of the Base before the Build, so the Module's own half-orbs do not count (R6.6). One Module has one price at every placement |

A chosen Build takes two steps (R8.5), so the victory check runs after each.
A Module with a text can add D7, which is asked in a step of its own: a
Build that ends the game asks nothing.

| Step | Change | Event |
| --- | --- | --- |
| The answer to D6 | Credits go down by the price. The `action` frame keeps the placement and the price in `paid` | `credits_changed`, unless the price is 0 |
| The next | The Module moves from the hand to the end of the Base's `modules`. What follows is in the table below | `module_built`, with the price as `cost` |
| D7, if asked | The frame asks; the answer takes the `action` frame off the stack | `text_deferred` for "later" |

After the placement (R8.3). The holder is the text frame that
[owns a deferred text](#resolution): the nearest one below the Build's
`action` frame.

| Module and holder | What the placement step does |
| --- | --- |
| No "On playing this card" text | The `action` frame leaves the stack |
| A text, and the holder has no action or repetition left (`position` is past its last action), or no text frame lies below | An `on_play` frame takes the `action` frame's place: the text resolves at once, with no D7 |
| A text, and the holder has actions or repetitions left | The `action` frame stays and keeps the Module's instance id in `built`. Its next step asks D7 |

| Point | Decision |
| --- | --- |
| D7 | Kind `defer`, for the performing seat. Two options, in this order: `now` and `later` |
| Option | `{ id, label, card }`: `card` is the Module's instance id. Labels: "Resolve the text of Depot now" and "Resolve the text of Depot after the current card" |
| `now` | An `on_play` frame takes the `action` frame's place, above the holder. No event |
| `later` | The instance id goes to the end of the holder's `deferred` list, written to the holder by its frame id, and the `action` frame leaves the stack. The holder resolves it after its last action (R8.10) |
| Depot | Its text is only Build. A Module built by that Build finds Depot's `on_play` frame with nothing left, so no D7 is asked, whatever the box below still holds |

Supply "when any player Builds" effects interrupt after placement and before
the on-play text or D7 decision (R10.8).

### Step budget

The rules allow a turn that never ends. A player whose hand is only Entropic
Cascade, with an empty Deck and Discard pile, Discards it, Draws it back
after the reshuffle and must Discard it again (R7.5, R8.7, R10.7): every
Discard is forced, so no decision ever stops the loop. A player with two
cards can keep the same cycle going by choice. Neither the turn limit nor a
bot's time limit can interrupt a synchronous loop.

| Point | Decision |
| --- | --- |
| Counter | `turn.work` counts every pass of the loop in the current turn: steps that change the state, actions that are skipped, and decisions the engine applies itself. It is 0 at the start of each turn and is part of the state |
| Limit | `STEP_BUDGET = 5000`, a constant in `src/engine`. One call of `applyChoice` therefore does at most 5000 loop steps, and the stack cannot grow past that many frames |
| When it is reached | The engine sets `result` to `{ reason: "step_limit", winners: [], scores }`, clears the stack and `pending`, and emits one public `game_ended` event. Every score is 0: the victory check runs after each step, so nobody meets a condition here. Nobody wins: this is a service limit like the turn limit (Q40, Q42), not a rule victory |
| A decision at the limit | The limit is checked before the loop stops for a decision. A decision asked by the step that uses up the budget is dropped, so no player is asked for a choice that cannot be applied |
| Replay | The counter is deterministic, so replaying `(config, seed, choices)` ends in the same `step_limit` result. The game log needs nothing extra |
| The number | A turn of real play uses a few hundred steps at most; the cycle above uses 5 per round. `properties.test.ts` prints the largest `turn.work` of its random games on every run and fails at 5000. `npm run soak` reports the same figure for longer runs |
| Server | A room treats `step_limit` like any other result. Because a call is bounded, one room cannot hold up the other rooms or the socket heartbeat |

### Decisions

`pending` is `{ id, seat, kind, options }`. The 14 decisions of section 13
of the rules map to `kind` values one to one.

- The engine lists every legal option. A client or bot never computes
  legality; it picks an option id. This is the single place where the
  placement rules (R5.10 to R5.13) and prices (section 6) are applied.
- An option is `{ id, label, …data }`: an English label ("Build Depot at
  2,0 turned right, pay 1"), and the data the interface needs (instance id,
  `(x, y, q)`, target seat, price, Orbs the placement forms).
- Options have a fixed, documented order, so option ids are stable for a
  given state. Option ids are unique within a decision. A decision id
  (`d1`, `d2`, …) is never used again, so a late or repeated choice is
  rejected as stale.
- A decision with exactly one option is applied by the engine at once and
  shows up only as events (section 13 of the rules). Applying an option is
  a loop step for the [step budget](#step-budget), whoever chose it. A player with no Influence is
  never asked D12 (R10.10).
- A Build decision can have a few hundred options (Modules times placements
  times turns). That is fine for a message of a few kilobytes; the Jev
  adapter narrows it (see [Non-human players](#non-human-players)).

## Hidden information

The server holds the only full state. `viewFor(state, seat)` builds what
one seat may see, and `eventFor(event, seat)` does the same for the log.
The server sends nothing else about a game. A bot gets the same view and
the same events as a human in its seat, so a bot cannot cheat and does not
know less either.

| Thing | Owner sees | Others see | Rule |
| --- | --- | --- | --- |
| Hand | Every card | The number of cards | R2.3 |
| Influences in a hand | Their own, as part of the hand | Nothing: no count, no marker. Revealed only by the end-of-turn win of the active player, as one public `influences_revealed` event; the view still shows only the hand size | R2.3, R11.4 |
| Deck | The number of cards | The same. Under Transparency also the top card | R2.3, R12.11 |
| Discard pile | Every card | The same. Under Transparency only the number | R2.3, R12.12 |
| Supply, Bases, Credits, play area | All | All | R2.3, R1.2 |
| Station's named side, never Flipped | Yes | No: the view carries `null` | R2.4 |
| Station's named side after its first Flip | Yes | Yes, for the rest of the game | R2.4 |
| Removed Stations, unused Influences | No | No | R3.3, R12.2 |
| The 8 Influences in the game | Names | Names | R12.2 |
| A Draw | The card | That a card was drawn. Under Transparency the card | R7.6, R12.11 |
| A Discard from hand | The card | The card. Under Transparency only that it happened, unless it is an Influence | R7.5, R12.13 |
| Look at a hand (Spybot.py, Blood Moon) | The looker gets one private event with the cards of that hand. It stays in the looker's event history; the view never shows another hand | That a look happened and whose hand | R7.15, R12.5 |
| Pending decision | Its options | Who decides and the kind of decision | |
| Seed, RNG state, instance-to-card table, Deck order | Nobody | Nobody | R2.5 |

How the view stays safe:

- A hidden card is not in the view at all. Opponents' hands and the Deck
  expose counts, not lists of ids. Under Transparency only the Deck's top
  card is also visible. An instance id appears only together with its card.
- Events are split by audience when they are emitted (`all`, or one seat
  plus a reduced form for the others). Whether a Discard is seen depends on
  Transparency at that moment (R12.13), so it cannot be decided later.
  Every event type declares its audiences and the fields each audience
  gets, in one table in `src/engine/events.ts`.
- A `ViewEvent` holds its type, the fields its audience may see and one
  English sentence for the log. An event is never filtered again: what a
  seat was allowed to see when it happened stays in that seat's history,
  even if the card is hidden later (a public Discard that a reshuffle
  hides, a hand that was looked at).
- The room keeps one event history per seat, built only with `eventFor`:
  the newest 200 events. A human gets it on join and resume; a decision
  maker gets it with every request (see
  [Non-human players](#non-human-players)).
- A view with `seat = null` is the public view. Only the creator of an
  all-bot game gets it (Q39).
- Option labels and data are sent only to the deciding seat.

### View contract

`src/engine/view.ts` builds a fresh JSON `PlayerView`; it neither changes
the state nor retains references to its nested data. Fields are selected
explicitly, so adding an internal state field does not expose it.

| Field | Content |
| --- | --- |
| `you` | The viewing seat, or `null` for the public audience |
| `players` | In seat order: `seat`, `credits`, `colonists`, distinct `achievements`, `handSize`, `base` |
| `base.station` | `instance`, `cardId` of the visible side, `side`, `revealed`, and `named`: the named catalogue id for its owner or after its first Flip, otherwise `null` |
| `base.modules`, `base.orbs` | Modules in build order as `{ instance, cardId, x, y, q }`; derived red, blue, yellow and wild Orb counts |
| `hand` | Only the viewer's cards as `{ instance, cardId }`; `[]` for the public audience |
| `supply`, `play` | Visible cards as `{ instance, cardId }`, retaining zone order |
| `discard`, `discardCount` | Every card in pile order normally; `[]` while Transparency is in Supply. The count is always public |
| `deck`, `deckTop` | Card count, plus `{ instance, cardId }` for index 0 only while Transparency is in Supply. `deckTop` is otherwise `null`, including an empty Deck |
| `turn`, `targets` | Turn `number`, `seat`, `step` and the current victory targets from `thresholds(state)`. The internal step counter `work` is never sent |
| `config`, `influencesInGame`, `result` | Game options, the public names of the 8 Influences in the game (empty without the option) for every audience, and the result or `null` |
| `pending` | `null`, the full decision for its deciding seat, or only `{ seat, kind }` for everyone else |

Option ids and data retain the engine decision format. A card referenced
by an option also has its identity in a visible zone of that seat's
view. Hidden hands, removed Stations, the card table, RNG, stack and Deck
order are absent. An Influence in a zone is a card like any other: public
in the Supply, private in a hand, and subject to the Discard pile's visibility.
The view derives Transparency directly from the current Supply every time:
setup and Shuttle deals close the whole pile immediately, Drafting it opens
the whole pile again, and Draws and reshuffles expose the current top only.
View projection never reorders cards or stores visibility flags. Draw and
hand Discard audiences are frozen on their events at emission. Later Supply
changes affect the view, but never change those events or their histories.

`view.test.ts` checks non-interference and provenance on every decision
state of 100 real random games per property and per combination of Influences
and Kickstarter (four combinations), with 2–6 seats and up to 20 turns.
Each batch allows 60 seconds for the larger sample; every seat count is checked.
Every seat and the public audience are checked. Hidden places are
permuted with pending held fixed; never-Flipped named Station identities
are permuted separately. The visible-places allow-list is written in the
test independently of the projection.

`hidden.test.ts` checks every emitted event of 100 random games
per combination of Influences and Kickstarter (2–6 seats, up to the 300-turn game cap) against an
independent copy of the audience table. The test derives Transparency from
the emitting state's Supply, never from the event's audience override, and
requires both public Draws and hidden hand Discards in the both-options run. Registry wrappers check cards at the emitting step, before
later steps can hide them. Fixtures cover private looks, Discard history
after reshuffling, remembered Station sides, Influence hand privacy and
Spybot defence timing. The third seat sees only `pending.seat` and
`pending.kind` differ in the timing fixture; exposing the engine's
`turn.work` would leak another difference. The protocol rejects that field.

### Choose-one and Credit actions

| Action | Resolution |
| --- | --- |
| `choose_one` (R8.2, D3) | Ask the performing seat with kind `choose_one`; options use zero-based string ids and action labels in printed order. Each option also holds `card`, the instance of the card whose text holds the choice: the `card` of the nearest text frame below, or the `source` of a Main Action `box` frame, which `main_action_step` sets. With no such frame the option has no `card`. Keep options even if they do nothing. Replace the action frame with a `box` text frame for the selected action list only; resolve left to right with the normal repetition and deferred-text rules |
| `gain_credit_per_hand_card` (R7.11) | Count the performing seat's current hand, after preceding actions. Gain that many Credits in one step with `credits_changed`; an empty hand skips without an event |
| `each_player_loses_credits` (R7.12, R8.5) | Subtract `n` from every balance, clamped to zero, in one step. Emit one `credits_lost` event with a `losses` array in seat order, including unchanged balances |

The nested R8.10 test Builds Lang Huan Concrete from Fusion Reactor and
resolves it now. A Borehole Built in Lang Huan's text is deferred to that
text: all players lose 1 Credit, the Borehole Draws 2, then the Reactor
Draws and asks for its Discard.

### Discard all

`discardHand` in `actions/discard.ts` resolves `discard_hand` (R7.17). Its
`action` frame stays on the stack until the set is gone, so each Discard is
a step of its own (R8.5) and an effect that a Discard causes resolves above
the frame and returns to it.

| Step | Change | Event |
| --- | --- | --- |
| The first | The frame keeps the seat's hand as `set`, a list of instance ids. The Laika Memorial is in the Base by then and not in it | — |
| Each step without an answer | With no card of `set` in the hand the frame leaves the stack. Otherwise it asks D5, kind `discard`, over the cards of `set` still in the hand, in hand order; options as for Discard | — |
| Each answer | The chosen card moves from the hand to the Discard pile. The frame stays | `card_discarded` |

`set` never changes. A card that enters the hand later is not in it and is
never offered. A card of it that has left the hand is not waited for. The
loop applies the last card of the set without asking.

### Immediate Influence effects

`discardCard` in `actions/discard.ts` moves a hand card to the Discard pile,
emits `card_discarded`, and pushes an Influence's `on_discard` text above
the waiting frames. Every Discard handler and Influence defence use this path. The discarding seat resolves the text even on
another player's turn. Nested Discards interrupt again before the parent
text resumes (R10.7).

| Mechanism | Contract |
| --- | --- |
| `pushImmediate(state, effects)` in `influences/immediate.ts` | Each effect carries its source `card`, resolving `seat`, and `actions`. No effects do nothing; one pushes a text frame directly; several push an `immediate` ordering frame |
| D13, kind `order` | The active player selects the next whole text. Options follow the remaining effects' input order, with their zero-based index as id, public source card, resolving `actor` seat and printed `actions`. The selected text and any nested interrupts finish before another is selected. The last text resolves automatically |
| Entropic Cascade | Its catalogue text runs Draw 4, Discard 3, one repetition at a time. E3 is tested through building Laika Memorial: Discarding X, Y, P keeps Q, R, S; Discarding P, Q, R then X, Y keeps S |
| Terran Crackdown | `flip:all_to_terran_outpost` selects only named Stations and flips them together in one step. Existing Outposts keep their side and reveal state; no named Stations means no Flip event |
| Termination | The forced one-card Cascade cycle reaches `step_limit` with no winner and replays to the same state and events. A synthetic two-Cascade Discard all with a full Deck takes 40 steps, below one tenth of the 5000-step budget; the test prints its count |

### Supply restrictions

`src/engine/influences/supply.ts` exports `supplyEffects(state)`: the
Influences currently in the Supply that have Supply text, in Supply order,
each with its public `card` identity and catalogue `effect`. It reads no
other zone and stores no flags. A Shuttle deal activates an effect for the
very next step; removing its card ends it immediately (R10.3).

| Influence | Resolution |
| --- | --- |
| Quarantine (Q20) | D4 offers Quarantine, Modules and Agents; every other Influence is excluded. Recompute for each Draft repetition, so drafting Quarantine makes the others legal at once. No eligible card skips the Draft |
| Lunar Alliance (Q35) | The shared `steal_credits` handler pops the action before asking D9, with no transfer. This covers Agents, Stations, Modules and Influence actions. Later actions still run. Emit public `action_blocked` with the performing `seat`, `action: "steal_credits"` and the blocking `card`; its sentence explains that Lunar Alliance is in the Supply |
| Terran Embargo (Q21) | Shuttle arrival still emits `shuttles_arrived`, with every gain zero. Yellow, wild and Artificial Intellect red Orbs all pay nothing. The end-of-turn victory check and surviving game's deal still run. An Embargo in that deal cannot cancel the preceding payout |

The client displays a blocked-action log event without card motion.

### Supply Draft and Build triggers

Both handlers pass catalogue actions to `pushImmediate`. The performing
seat resolves each text; the active seat orders simultaneous texts with
D13. The movement or placement still gets its own victory check before
the triggered text runs.

| Trigger | Resolution |
| --- | --- |
| Influence Draft cost (R12.6) | Concatenate Welfare, Free Market and Longevity costs from the current Supply, including the card being Drafted. Apply the performing seat's current Base Orbs once to that combined cost. D4 Influence options carry `price` and a label ending in `pay <price>`; other Supply cards remain free. Recompute for each Draft repetition |
| Draft payment | A positive price reduces Credits and emits `credits_changed` in a separate step, retaining the chosen instance as `paid` on the action frame. Victory is checked before moving it. A zero price moves directly without a payment event. Removing Welfare or Longevity restores its normal target at the next check |
| Influence Draft (R10.9) | Snapshot matching Supply effects before moving the card. Move it into the drafter's hand, then queue each effect once, including the Drafted card's own effect. Module/Agent Drafts, Draws and setup deals do not trigger this text |
| Space Cowboy Capitalism | The drafter chooses an opponent and Steals 2 using the shared Steal handler. Lunar Alliance blocks this if still in the Supply; Drafting Alliance removes the prohibition before the Steal |
| Runaway Bureaucracy | The drafter Discards twice, with the newly Drafted Influence available to Discard. Any Discard text interrupts as usual |
| Laika's Paradise (R10.8) | Match the built Module's catalogue kind against the Supply effect: all four Domes and Laika Memorial qualify. After placement, the builder Drafts 1 and resolves any resulting triggers before the built Module's text or D7. Deferring the Module's text never defers this Draft |
| Satellite (R7.18) | The existing on-play handler counts the Supply Influences when it resolves and Resells that many times. Laika's Paradise does not trigger for a Satellite |

### Kickstarter Influence effects

These effects use the same Supply snapshot and D13 ordering as R10.9.
They resolve as Influence text, so no Agent defence is offered.

| Card | Resolution |
| --- | --- |
| Credit Reform (R12.10) | Each player Loses 3 Credits together, clamped at zero, using `each_player_loses_credits`. One `credits_lost` event records every resulting balance |
| Metamorphosis (R12.4) | Exchange the Stations immediately counterclockwise and clockwise from the drafter, preserving each Station's side and reveal history. Modules stay in place. With two seats the neighbours are the same player, so nothing changes |
| Blood Moon (R12.5) | The drafter chooses an opponent and emits the existing private `hand_seen` snapshot. `that_opponent_discards_all_agents` then offers only that opponent's Agents in D5, one Discard at a time in their chosen order; Modules and Influences stay in hand. An empty hand or a hand without Agents skips Discard |
| Moonstone Cops (R12.9) | A continuous Supply prohibition, not a Draft trigger; see Steal Module below |

Blood Moon's private event stays in the drafter's room event history and
is included in the next decision-maker request. Other seats and spectators
receive only who looked at whom; views never expose the opponent's hand.

### Influence defence

`influences/defence.ts` wraps action dispatch after the acting player's
choice and before its effect. It covers Steal Credits, Steal Module,
An opponent Resells, Target Discards, Look, Spybot's remembered-opponent
Discard, all Flip selections, each opponent Discards, and the acting player's
own Discards. Defence choices finish before the action applies to anyone.

| Mechanism | Contract |
| --- | --- |
| `affectedBy(action, choices, state)` | Lists the selected targets, Station owners or discarding seats. Empty-hand Discards, impossible Resells or Module thefts, and Supply-blocked Steals affect nobody. A Steal from zero Credits still affects its target |
| Source | Choice boxes inherit the enclosing Agent. A Module text or an immediate Influence text is its own source, even with an Agent waiting below it; its actions cannot be defended against |
| D12, kind `defence` | Ask only an affected seat holding an Influence. Options are `decline` followed by Influence instance ids in hand order, each with its `card` and name. Every option carries the public `action` and its performing `actor` seat for decision makers; no stack or hidden hand is exposed. The action frame saves the attacker's answer as JSON while waiting |
| Decline | Continue to the next affected seat clockwise from the active player. Each seat gets one chance for this action; a later action may ask again |
| Defend | Append the seat to the Agent frame's `defenders` and use `discardCard` for the named Influence. Its complete text resolves before the next defence decision. Exclude the defender from this action; the action still reaches other selected seats |
| Later actions | Keep every chosen target and Station set. A defender is neither asked again nor affected for the lifetime of this Agent; other players remain eligible. Resolved effects stand |
| Continuation | The action frame stores affected and asked seats and the saved choice as JSON. `defenceResolved` prevents another window while a multi-step handler resumes. Repeated Discards use `defenceContinuation`; nested Discard boxes use `defenceCovered` because their parent action already collected decisions |
| Several targets | Filter Flips to unprotected selected Stations without replacing targets. Each-opponent Discard retains `defenceExcluded` while visiting opponents; its individual Discards do not offer additional defence |
| Spybot.py | Save the chosen opponent even when the Look is cancelled. No `hand_seen` event is emitted for a defended Look; the following choice still offers Draw or that opponent Discards (Q34). A declined Look stands if the opponent defends against the later Discard (E2) |

### Steal Credits

`src/engine/actions/steal-credits.ts` handles `steal_credits` (R7.13).

| Topic | Behaviour |
| --- | --- |
| Target (D9) | Unless Lunar Alliance blocks the action, ask the performing seat with kind `target`. List every opponent in seat order, even with zero Credits; never list the thief. Option ids are decimal seat indices, with `target` and a public player label |
| Two seats | The loop selects the sole opponent without waiting for input |
| Transfer (R8.5) | Move `min(n, victim Credits)` from victim to thief in one step; pop the action frame. No intermediate balance is visible to the victory check |
| Event | For an unblocked action, one public `credits_stolen` with `thief`, `victim` and actual `amount`, including zero. Its text names both players and the amount |
| Victory (R11.2) | Check immediately after the transfer. A thief reaching 20 Credits wins before the next action; Imbrium's Build is then skipped |
| Printed order | Imbrium resolves Steal 3 Credits before Build. Panaman Broker's chosen Steal resolves through its existing choose-one text |

### Steal Module

`src/engine/actions/steal-module.ts` handles `steal_module` (R7.14). It is
the only way a Module leaves a Base (R9.3).

| Topic | Behaviour |
| --- | --- |
| What can be Stolen | Every Module whose `kind` is the action's `kind`, in every Base except the performing seat's (Q11). The kind decides, not the STEALABLE tag: a Satellite can be Stolen (Q10) |
| None | The action leaves the stack: no decision, no event, no change (R7.14). Its option of a "do one" text is still offered (R8.2) |
| Module (D11) | Ask the performing seat with kind `steal_module`. One option per Module, by seat and then in the order built. The option id is the Module's instance id; the option holds `card`, that id, and `target`, the seat of the Base. The label names the card, its cell and the player: "Steal Rover at 1,-1 from Player 2" |
| One Module | The loop takes the sole option without waiting for input |
| Transfer (R8.5) | One step removes the Module from `bases[target].modules`, appends it to the thief's hand and pops the action frame |
| The rest of the Base (R5.16) | No other Module moves or is removed, with or without a joint left. Its colonists, achievements, Main Action boxes and printed Orbs still count, because they are derived from `modules` |
| Orbs (R5.8) | Nothing is stored: `orbsOf` no longer finds the joints of the Module that left |
| A later Build (R5.12, Q32) | `legalPlacements` treats a cut-off Module as any card of the Base, so a Build may join it alone |
| Event | One public `module_stolen` with `thief`, `victim` and `card`. Its text names both players and the card |
| Victory (R11.2) | Checked after the step like any other. A Steal can only lower the victim's colonists and achievements |
| Moonstone Cops (R12.9) | While in the Supply, blocks every Steal Module action before any target or defence choice. Emit `action_blocked` with `action: "steal_module"` and a sentence naming the blocked action; move no Module. `affectedBy` returns no seats. Recompute from the Supply for every action |

### Flip

`src/engine/actions/flip.ts` holds `flipStations(state, seats)` and the
handlers of `own`, `each_player`, `any_one`, `any_two`, `any_number` and
`neighbours_of_target` and `all_to_terran_outpost`. Every base Station side
is playable; all cards with a Flip are in the full base Deck.

| Topic | Behaviour |
| --- | --- |
| Step | One step turns every Station of the action at once and leaves the stack (R8.5). Any choice precedes the Flip. The victory check follows it like any step (R11.2) |
| State | Only `bases[seat].station` changes: `side` toggles and `revealed` becomes true and stays true (R2.4). The card, its place and the Modules are untouched, so every joint stays |
| What the Base counts | Nothing is stored. Orbs, colonists, achievements and Main Action boxes are derived from the visible side each time (R5.7, R5.14, R5.15, R9.2) |
| `own` | The Station of the seat that performs the action |
| `each_player` | Every Station, the acting player's included (R2.2) |
| `any_one`, `any_two`, `any_number` (D10) | Ask the performing seat with kind `flip`. Options hold `seats` in seat order. Enumerate subsets by ascending bitmask (bit 0 is seat 0); the decimal mask is the stable option id. Keep only sets of one or two for those actions; `any_number` keeps all sets, including empty. Counts are N, N(N-1)/2, and 2^N |
| Labels | Name each selected Station by public seat label, e.g. "Flip Player 1's Station, Player 3's Station"; the empty set says "Flip no Stations". Never reveal a hidden named side. Six seats yield 64 distinct labels |
| Two-player `any_two` | The loop applies the sole option immediately without waiting for input |
| `neighbours_of_target` (D9) | Ask the performing seat with kind `target`. Options in seat order use the target seat's decimal id, with `target` and the affected `seats`. Label the target and Stations. Any player, including the actor, may be targeted. Turn the previous and next seats in the circle once each; deduplicate the two-player neighbour (Q14) |
| Printed order | Rebel Captain's second option skips an empty-hand Discard and still Flips two Stations (Q15). Beruang Engineers Built from a box resolves its Flip decision before its Build |
| Event | One `station_flipped` with one `{ seat, card }` per Station in seat order; `card.cardId` is the side now visible |
| No seat | `flipStations` with no seat changes nothing and emits no event |
| Kafka | After the Flip, push the visible side's `on_flip_to` text as a `box` with the Station as its source and its holder as the acting seat. It resolves before the interrupted text continues. The normal victory check still follows the Flip (R11.2) |

### Kickstarter Stations and Exchange

| Topic | Behaviour |
| --- | --- |
| D2 | Braun, Korolev and Tipu use existing action handlers and their catalogue boxes; Kafka has Draft and Build only |
| D14 | Kafka's holder gets kind `exchange_station`, with one option per other seat in seat order. Option id is the decimal seat, `target` is that seat, and labels use public player numbers. Two seats auto-resolve the sole option |
| Exchange | `exchangeStations` swaps the complete Station records in one step, including `side` and `revealed`. Each remains at `(0, 0, 0)` in its new Base; Modules stay where they are. All Station half-orbs match, so joints remain valid |
| Counts and victory | Orbs, colonists, achievements and boxes derive from the newly held visible side. The usual victory check follows the Exchange |
| Privacy | A never-Flipped named side is visible only to the new holder. A revealed card stays public. Exchange does not Flip or trigger Kafka again |
| Event | `stations_exchanged` publishes only the two seat numbers, never hidden named sides. Per-seat views show the resulting Stations |

### Discards by other players

`src/engine/actions/other-discards.ts` handles `target_discards` and
`each_opponent_discards` (R7.16). Both hand the Discards to the discarding
seat as a `box` text frame with the one action `discard` x n, so each card
is the Discard of "Moving cards": D5 asked of that seat, one step and one
`card_discarded` per card (R7.2, R8.5), and an empty hand skips what is
left. The active seat does not change.

| Topic | Behaviour |
| --- | --- |
| `target_discards` target (D9) | Ask the performing seat with kind `target`. List every seat in seat order, the performing seat included (R2.2), whatever its hand holds. Option ids are decimal seat indices, with `target` and the label "Player N Discards". Two seats are two options, so the loop never chooses |
| `target_discards` answer | The action frame is replaced by the target's text frame |
| `each_opponent_discards` order (R8.6) | The seats after the active seat, clockwise, without the performing seat. With 4 seats and seat 2 active: 3, 0, 1 |
| `each_opponent_discards` steps | The action frame stays and counts the opponents `served`. Each step pushes the text frame of the next one; with none left it leaves the stack. A hand is read only when its player's Discards begin |
| Events | Only `card_discarded`. Neither action has an event of its own |

### Look at a hand

`src/engine/actions/look-hand.ts` implements R7.15 and the linked Discard
of R7.16. Both action keys are supported, admitting Spybot.py to the Deck.

| Topic | Behaviour |
| --- | --- |
| Target (D9) | The acting seat chooses among all opponents in seat order, including empty hands. Options hold `target`, with decimal seat ids; the sole opponent is automatic |
| Look | Emit `hand_seen` with `looker`, `opponent`, and a snapshot of every `{ instance, cardId }` in that hand. Only the looker receives `cards`; other seats and the public audience receive only who looked at whom |
| Memory | Store `opponent` on the nearest source text: an Agent, or a named Module/Influence text. Nested choice boxes inherit that source. Blood Moon owns its target even with an Agent waiting below it; the target leaves the stack when its source finishes |
| Follow-up | Spybot.py offers Draw or That opponent Discards. The latter pushes a Discard text for the remembered seat; that seat chooses the card, or skips with an empty hand. The active seat stays unchanged |
| Views and bots | `viewFor` still exposes only an opponent's hand size. The room's existing per-seat event history gives the looker's maker the seen cards on its next request; other makers receive the reduced event |

### Event contract

`src/engine/events.ts` defines `GameEvent`, `ViewEvent`, `EVENT_AUDIENCE`
and `eventFor`. The table is exhaustive over the event union; adding a
type without a row fails type-checking. Its `public` list names shared
fields, `privateSeat` names the field holding the private recipient, and
`private` lists that recipient's extra fields. A null `public` list means
no event for other audiences; every event so far has a public form.
Draw and hand Discard rows also declare `defaultCardAudience` (`seat` and
`all`, respectively). Their events may override it with `cardAudience`,
frozen by the emitter from the current Supply. Under Transparency a Draw
uses `all`; a non-Influence hand Discard uses `seat`. Influences retain the
public Discard default. Neither audience field is sent to clients.

| Event type | Public fields | Extra fields for private seat |
| --- | --- | --- |
| `game_started` | `seats`, `startingSeat` | — |
| `turn_started` | `seat`, `turn` | — |
| `box_chosen` | `seat`, `card`, `box` | — |
| `card_drafted`, `text_deferred`, `agent_discarded` | `seat`, `card` | — |
| `card_drawn` | `seat`; also `card` under Transparency | `card`, for `seat` |
| `card_discarded` | `seat`; also `card` unless Transparency hides this non-Influence hand Discard | `card`, for `seat` |
| `hand_seen` | `looker`, `opponent` | `cards`, for `looker` |
| `card_resold` | `seat`, `card`, `credits` (proceeds) | — |
| `module_built` | `seat`, `card`, `x`, `y`, `q`, `cost` | — |
| `agent_played` | `seat`, `card`, `cost` (Credits paid) | — |
| `credits_changed` | `seat`, `delta`, `credits` (new balance) | — |
| `credits_lost` | `losses` (one `{seat, delta, credits}` per player, including zero losses) | — |
| `action_blocked` | `seat`, `action`, `card` (the blocking Lunar Alliance or Moonstone Cops in the Supply) | — |
| `credits_stolen` | `thief`, `victim`, `amount` (actual transfer, including zero) | — |
| `module_stolen` | `thief`, `victim`, `card` (the Module, which was public in the Base) | — |
| `station_flipped` | `flips` (one `{seat, card}` per Flipped Station, in seat order; the card is the side now visible) | — |
| `deck_reshuffled` | `count` | — |
| `shuttles_arrived` | `seat`, `turn`, `gains` (one `{seat, delta, credits}` per player, including zero gains) | — |
| `supply_dealt` | `cards` | — |
| `influences_revealed` | `seat`, `cards` (every Influence in the active player's hand, in hand order; R11.4) | — |
| `game_ended` | `reason`, `winners`, `scores` | — |

Each output also has `type` and English `text`. Seats and box
indices are zero-based; log labels are one-based. A card is
`{ instance, cardId }`: its instance id and the catalogue id of the face
visible at emission, never an unresolved instance id. Emitters must supply
that visible face; `eventFor` does not consult game state. It copies only
the declared fields, detaches nested values, then formats text from those
projected fields. A hidden Draw or Discard's public text cannot read the
private card: it says only that the player drew or discarded a card.
Resold cards and resolved Agents remain named in events even while the pile
hides them. When Transparency leaves, unseen Discards become visible in the
pile without acquiring identities in earlier event history. The six cases
in `transparency.test.ts` cover start, hand Discard, Influence Discard,
Resell, reshuffle and end.

Tests that guard it (all in the check). They compare what a seat is told
with what the rules allow it to know. They do not search messages for
forbidden card names: another copy of a hidden card can be in plain sight.

What seat A may know is fixed first: the public facts (sizes of hands and
piles, Supply, Bases, Credits, play area, whose decision it is and of what
kind), A's own hand and Station, what an event showed A when it happened,
and the accepted timing disclosure below. Everything else is hidden from A.

| Test | Checks |
| --- | --- |
| Non-interference of the view | For random reachable states: swap hidden cards between hidden places of the same size (other hands, the Deck below any public top card, removed Stations, never-Flipped named sides), leave `pending` as it is, and `viewFor(A)` is unchanged. Hand sizes and the pending decision's seat and kind are held fixed because they are public |
| View provenance | Every instance id in the serialised `viewFor(A)` belongs to a card visible to A in that state, by a list of visible places written in the test, not taken from `viewFor`: Supply, Bases, play area, A's hand, the Discard pile unless Transparency closes it, the top Deck card under Transparency, the options of A's own pending decision |
| Event audience | For every event of random games and every seat: `eventFor` returns only the fields the event table allows that audience, and a card in it was public at that moment or the seat is the event's private audience. The check is made when the event is emitted, never against a later state |
| Allowed observations | Positive cases that must pass: the looker's event holds the looked-at hand and no other seat's does; under Transparency every seat sees the top Deck card and each Draw; a publicly Discarded card stays in every seat's history after a reshuffle hides it; a named side stays public after its first Flip |
| Influence privacy | Two states that differ only in which cards fill an opponent's hand, one with more Influences, with no defence decision pending: `viewFor(A)` and the opponent's rendered counters are the same |
| Timing disclosure | Two states that differ only in whether an affected opponent holds an Influence: the views for A differ in the pending decision's seat and kind and in nothing else. This pins the accepted limit below |
| Protocol | A game played through the server with recorded sockets: every `game.update` to A equals `viewFor` and `eventFor` for A plus the server's seat fields, and no message holds the seed, the RNG state or the instance-to-card table |
| Transparency | The cases of R12.11 to R12.16: start, hand Discard, Influence Discard, Resell, reshuffle, end |

`src/server/privacy.test.ts` plays 30 seeded games through sessions, the
lobby and rooms with recorded memory connections: 2–6 seats, Influences
off/on, and human-only, mixed and all-bot tables. An independent replay of
accepted choices supplies `viewFor` and `eventFor` expectations for every
update, including the public audience of all-bot games. Raw messages are
checked for private state; captured stdout is checked for seeds, a runtime
credential sentinel and hand card identifiers. Planted leaks and a swapped
seat view prove that the checkers reject and identify the offending message
or log line. The whole-game matrix has a 20-second real-time budget.

Accepted limit: timing is not hidden. A pause before an Agent resolves tells
the table that the affected player holds an Influence and is thinking, and
the public "who decides, what kind" says the same. A table game leaks the
same. Hiding it would need fake prompts and delays; that is not built.

## Protocol

One WebSocket per browser tab at `<base>/ws`; the base path is `/` unless
`LUNAR_BASE_PATH` sets another. Messages are JSON objects with a
`type`. `src/protocol` defines every message as a zod schema; server and
client share the inferred types. The server validates every incoming
message, limits it to 16 KiB, and rejects an upgrade whose `Origin` is not
allowed (see [Visitor limits](#visitor-limits)).

The server is authoritative and the protocol is snapshot-based: after every
applied choice each seat receives its full view (a few kilobytes). The
client keeps no rules and cannot drift; reconnecting is the same message.

### Messages

| From client | Fields | Meaning |
| --- | --- | --- |
| `hello` | `protocol: 1`, `token?`, `name?` | First message. With a known `token` the session resumes. Otherwise a new session is made and `name` is required |
| `lobby.create` | `seats`, `bots`, `influences`, `kickstarter`, `botBrain?` | Create a game and take seat 0 (unless `bots = seats`, Q39). Without `botBrain` the non-human players are `builtin` |
| `lobby.join` | `game` | Take the next free human seat of an open game |
| `game.leave` | | Leave. In an open game the seat is freed; in a running game a bot takes it for good; after the result the session returns to the lobby |
| `game.decide` | `game`, `decision`, `option` | Answer the pending decision |

| From server | Fields | Meaning |
| --- | --- | --- |
| `welcome` | `protocol`, `token`, `name`, `jev` (on or off) | Session accepted. Followed by `lobby.state` or `game.update` |
| `lobby.state` | `games[]`: id, creator, seats, humans joined and wanted, bots, options | Sent to every session in the lobby when the list changes |
| `game.update` | `game`, `seq`, `view`, `events[]` | The seat's full view and the events since its last update. On join or resume `events` holds the seat's last 200 events |
| `error` | `code`, `message` | The message was refused. Nothing changed |
| `server.restart` | | The server is stopping and its games end with it. It is the last message of the socket, which then closes with code 1012 |

Error codes: `bad_message`, `unsupported_protocol`, `name_invalid`,
`name_taken`, `not_in_lobby`, `game_not_found`, `game_full`,
`not_your_decision`, `stale_decision`, `bad_option`.

`view` is the `PlayerView` of the engine plus what the server knows: for
each seat the name, `human` or `bot`, and `connected`. Its `result` names
the reason the game ended: `victory` or `step_limit` from the engine,
`turn_limit` or `engine_error` from the room; only `victory` has winners. `seq` grows with
every update; a client ignores an older one. A `game.decide` with an old
`decision` id gets `stale_decision`, so a double click cannot answer twice.

`server.restart` did not change the protocol version, which stays 1, because
a client built before it still ends in the right place. Such a client
discards the unknown message, as it discards every frame that does not parse.
It then treats the close as a drop: it shows the Reconnecting banner and
retries until the new server answers, which refuses the old token, and it
returns to the Name screen with the game-lost sentence.

`src/protocol/messages.ts` fixes what the tables leave open:

| Detail | Choice |
| --- | --- |
| Unknown fields | Refused. Every message and every level of `view` is a strict object, so a field of the full state (`rng`, `cards`) does not parse. Two places take any JSON: the data of a decision option beside `id` and `label`, and the fields of an event beside `type` and `text` |
| Seat fields | Each entry of `view.players` also holds `name`, `kind` (`human` or `bot`) and `connected` |
| A game in `lobby.state` | `id`, `creator` (a name), `seats`, `bots`, `humans` (the names of the humans who joined, in seat order), `humansWanted`, `options: { influences, kickstarter, botBrain }`. Names are unique, so a client finds its own open game by its name |
| `token` | 32 lower-case hex digits, in `hello` and in `welcome` |
| `name` in `hello` | Any text. The lobby's name rule is `validName`; the server answers a bad name with `name_invalid`, not `bad_message`. A control character anywhere fails it, also a tab or a line break at an end |
| Events | Checked for `type` and `text` only. Their other fields are the engine's event contract; `eventFor` is their one source |
| `ClientMessage`, `ClientMessageInput` | The message as the server handles it (`botBrain` filled in) and as a client may send it (`botBrain` optional) |
| `parseClientMessage(raw)` | `{ ok: true, message }` or `{ ok: false, error }`, where `error` is the `error` message to send back. It checks the size first, as UTF-8 bytes, then JSON, then the schema. A `hello` whose `protocol` is another number gets `unsupported_protocol` whatever else it holds; every other refusal is `bad_message` |
| `GameView` | The type of `view`. Its schema is annotated with it, so a field added to the engine's `PlayerView` fails the Types step until the schema has it |

### Lobby

| Step | Behaviour |
| --- | --- |
| Name | 1 to 20 characters after trimming, no control characters, unique among live sessions without regard to case. There is no login |
| Create | `seats` 2 to 6. `bots` 0 to `seats`. `influences` and `kickstarter` default off (R3.1). `botBrain` is `jev` or `builtin` and may be left out, which means `builtin`; `jev` is offered only when the server has the credential and is refused with `bad_message` without it. Both options are accepted alone or together |
| Seats | The creator has seat 0, bots take the next seats at creation, humans who join take the remaining seats in join order (R3.2). The engine picks the starting player |
| Join | Any open game with a free human seat. A known game with no free seat gets `game_full` |
| Start | Automatic, at the moment the last human seat is taken. A game with no free human seat at creation starts at once. The lobby hands a seat snapshot to the room callback once and removes the game from lobby listings |
| Creator leaves an open game | The game is closed; the others return to the lobby. A later join of that ID gets `game_not_found` |
| Leave a running game | The seat becomes a connected non-human seat with the same name and a built-in maker, regardless of `botBrain`. The session returns to the lobby and cannot resume that seat. The room is dropped when its last human participant leaves (including the watching creator of an all-bot game) |
| End | The result stays on screen. A finished game is dropped when its last human leaves, or after 10 minutes |
| Limits | 20 games at a time, or `LUNAR_MAX_GAMES`. One visitor address creates at most 10 games in an hour, or `LUNAR_MAX_NEW_GAMES_PER_HOUR`. A game that passes 300 turns is ended with no winner (Q40). A turn that passes the engine's step budget ends the game with no winner (Q42) |

The game cap includes open, running, and finished rooms. A create request at
the cap gets an `error` with the code `bad_message` and the text "The server
is at its game limit."; it does not create a room. A create request over the
visitor's hourly cap gets the same kind of `error` with the text "You have
started too many games. Try again later." Joining a game is not counted. Finishing starts a 10-minute
timer. At expiry the room releases every remaining participant to the lobby
with `lobby.state`, then drops the room. Leaving first cancels that timer when
the last participant goes.

### Reconnect

| Event | Behaviour |
| --- | --- |
| Session | The token is 16 random bytes, made by the server, kept by the client in `sessionStorage`. Each tab is its own player, so several tabs on one machine can play each other. A reload keeps the seat; a closed tab does not |
| Socket drops | The session and the seat stay. The seat shows as disconnected to everyone. The game goes on |
| The disconnected seat owes a decision | The server waits 60 seconds from the disconnect. Then the built-in maker answers for that seat, this decision and later ones, until the player is back |
| Player returns | `hello` with the token, then `welcome` and `game.update` with the full view. The player decides again from the next pending decision |
| Same token on a second socket | The new socket wins. The old one is closed with code 4001 |
| Session with no socket, not seated in a running game | Dropped after 30 minutes |
| Server restarts | All games are lost. The server sends each socket `server.restart` and closes it with code 1012 (see [Shutdown](#health-and-shutdown)). The client shows a notice and a button back to the Name screen. Resuming games after a restart is not built |

The 30-minute clock starts at disconnect. Resuming cancels it. A running room
keeps its disconnected seated sessions; a watcher without a seat expires on
schedule. When the room ends, a seated session already absent for 30 minutes
expires immediately. Expiry removes an open-game seat or a room membership and
frees the name and token. The limits named in the Lobby and Reconnect contracts,
including protocol message size, history size, take-over delay, and ping interval,
are defined in `src/server/limits.ts`, beside the
[visitor limits](#visitor-limits); the server passes the message size to the
protocol parser.

The session keeps the disconnect timestamp, including time spent in
an open lobby game. Each absent human seat has a room timer for the remainder
of its 60-second grace period. At expiry the built-in maker answers an owed
decision immediately; later answers use the normal bot delay. Temporary takeover
keeps the seat human and disconnected. It never uses Jev.

Resuming cancels the grace timer and restores human control. A bot answer
already requested finishes its current decision; the returning player can
answer the next one. Attempts to answer that in-flight decision receive
`not_your_decision`. A later disconnect starts a fresh grace period. Ending or
dropping the room clears grace timers and aborts pending bot work; late answers
cannot change the room.

The server pings every socket every 15 seconds and drops one that does not
answer, so a dead connection is noticed.

`sessions` and `transport` fix how:

| Detail | Choice |
| --- | --- |
| Timer | One per connection, from `accept`, also before `hello`. It ends with the connection's close and does not keep the process alive |
| Each tick | A connection that has not answered the previous ping is dropped with `terminate`. Otherwise it is pinged. A socket that dies is dropped 15 to 30 seconds later |
| The drop | An ordinary close with code 1006: the session keeps its seat and has no socket, the room sends every seat `connected: false` for it |
| Resume | `hello` with the token on a new socket: `welcome`, then one `game.update` with the seat's view and its history, or `lobby.state` when the session is in no started game. A seat in an open game is kept too. The other seats get the same update with `connected: true` |
| A replaced socket | Closed with 4001. The seat never shows as not connected, and only the new socket's messages count |
| A malformed frame | `ws` closes that socket with 1002. The server treats it as a drop and runs on |
| `PING_INTERVAL_MS`, `pingIntervalMs` | The 15 seconds: defined in `limits.ts` and re-exported by `sessions.ts`. `SessionsOptions` and `ServerOptions` take another value for the test over a real socket |

`src/client/connection.ts` is the client side of these tables:

| Detail | Choice |
| --- | --- |
| Socket | One `WebSocket` to `ws` beside the page (`/ws` at the root, `/play/lunar-base/ws` under that base), opened by `useConnection` and closed on unmount. Status: `connecting`, `resuming`, `open`, `closed` |
| Token | Kept in `sessionStorage` under `lunar-base.token`, with `:<base>/` appended when the base path is not `/`, so two games on one origin keep separate tokens. On open, a stored token is sent as `hello` at once. If the server answers `name_invalid` the token is forgotten without an error and the Name screen shows |
| Server messages | Parsed with `serverMessageSchema`. A frame that is not JSON or does not parse is dropped: no state change, no notification |
| Stale update | A `game.update` of the current game with a lower `seq` is dropped. Another game starts again from its own `seq` |
| State | `session` (from `welcome`), `lobby` (from `lobby.state`, which clears `game`), `game` (from `game.update`, which clears `lobby`), `error` (the latest refusal; the next send or four-second timeout clears it) |
| After a drop | Keep the last screen visible and disable its controls beneath a Reconnecting banner. Retry after 250 ms, doubling the delay to a 5-second cap. On open, send `hello` with the stored token. The first resumed `game.update` replaces retained event history; later updates append new events. Keep the banner until `game.update` or `lobby.state` restores the view. If the token is unavailable when the new socket opens, clear the old session and game and return to Name with the game-lost sentence |
| Lost session | A stored token refused with `name_invalid`, or a welcome with a different token, clears the old game and returns to the Name screen with a game-lost sentence |
| Replaced tab | A close with code 4001 shows the other-tab banner and does not retry |
| Server restart | `server.restart`, or a close with code 1012 without it, forgets the token, keeps the last screen visible with its controls disabled and does not retry. A notice says "The server restarted. This game has ended. Start a new game from the lobby."; outside a game it leaves out the middle sentence. Its one button, **Start again**, has the focus and opens a new socket on the Name screen. Before a session exists nothing is lost, so both are an ordinary drop and the client retries |
| Notices | Server errors appear briefly above the screen. `stale_decision` leaves the current options usable |

## Server

One Node process. `src/server/main.ts` builds everything from the
environment and listens.

| Module | Job |
| --- | --- |
| `transport` | Wraps a `ws` socket as `Connection` (`send`, `onMessage`, `close`). A second, in-memory `Connection` serves the tests |
| `sessions` | Token to session: name, connection, game and seat |
| `lobby` | Open games, create, join, leave, the lobby broadcast |
| `room` | One game: engine state, seat table, decision makers, one event history per seat. Applies choices one at a time from a queue, sends updates, asks a bot when a bot's seat must decide, runs the disconnect and turn limits, and ends the game if the engine throws |
| `gamelog` | Appends a header and every choice to `<id>.jsonl` in the log directory, and deletes old logs. `npm run replay -- <file>` replays a log through the engine. The file holds the seed: it is a debugging aid for the person who runs the server, not for players |
| `static` | Serves `dist/client` with `sirv` below the base path. The bare base redirects to `<base>/` with 308. A path outside the base, or one that names no file, is 404 |
| `base-path` | Checks and normalises `LUNAR_BASE_PATH` |
| `limits` | The constants of the Lobby and Reconnect contracts. Reads and checks the five limit settings and the Jev budget setting, decides whether an `Origin` is allowed, names the visitor address of a request, and counts connections and new games per address |

The log directory is `LUNAR_LOG_DIR`, or `.data/games` under the working
directory (ignored by Git) when that is unset or blank. It is created when the
first game is logged. `main.ts` reads the directory, `LUNAR_LOG_DAYS` and
`LUNAR_BUILD` once and passes them to `http.startServer` as `logs`; the server
hands them to each `createGameLog` and to its sweep. `gamelog` never reads the
environment, so a server's logs and its sweep always use the same directory. A
log directory that is itself a symbolic link stops the start with an error.

The first JSONL line is `{config,seed,build,protocol,created}`: the build is
`LUNAR_BUILD` or `dev`, the protocol is `PROTOCOL_VERSION`, and `created` is
the UTC time in ISO 8601 form. A log written before these fields existed has
`{config,seed}` only and still replays. Each later line has exactly `seat`,
`decision`, `option` and `by` for an accepted choice. A log holds seat numbers
only: no player name, session token, address or account
([decision 0007](../decisions/0007-keep-game-logs-for-30-days.md)). Writes are
synchronous and a write failure logs `gamelog_write_error` without stopping
play. An `engine_error` line includes the log path. Replay reads a log in any
directory. It prints the turn number, choice count, result reason and winners;
`--at <n>` also prints the public view after the first `n` choices (`0` is the
opening view).

A server that is given `logs.days`, as `main.ts` always does, sweeps its log
directory once it listens and then once a day, on a timer that does not keep
the process alive; the server's `close()` stops it. A server given no days
deletes nothing. A sweep deletes each log last written
more than `LUNAR_LOG_DAYS` days ago (default 30); a log exactly that old stays.
The value must be a whole number, 1 or more: anything else, a fraction
included, stops the start with an error. A sweep deletes only a regular file
directly in the log directory whose name is a UUID game ID and `.jsonl`. It
never deletes a symbolic link, a directory, another file, or the log of a game
whose room still exists in the same server: each server keeps its own set of
open games, shared by its logs and its sweep. The limit: the directory must be
one that only this server writes to. The check and the delete are two steps,
so a file that another process puts in a log's place between them is not
protected. A sweep never throws, even when the log callback does: it logs one
`gamelog_sweep_error` line with the count and the first error code, and the
next sweep tries again. A sweep that deleted something logs one
`gamelog_sweep deleted=<n>` line.

`http.startServer(options)` owns the HTTP listener, WebSocket upgrade and
session/lobby/room wiring. It returns the bound port (including the assigned
port when asked for 0), an async `close()` for tests and `shutdown()` (see
[Health and shutdown](#health-and-shutdown)). The static handler
answers 404 until a client build exists. An upgrade requires `<base>/ws` and an
allowed `Origin`; anything else gets 403. A client reset while the refusal is
sent leaves the server running.
Each room receives its own random 16-byte seed, unless
`LUNAR_SEED` supplies the same seed for every new room.

### Visitor limits

The server has no sign-in. These limits make it safe to reach from the
internet. They cap the games that are started, not the Jev requests those
games make: the [Jev budget](#jev-budget) bounds what Jev can cost
([decision 0010](../decisions/0010-turn-jev-on-in-the-public-deployment.md)).
`main.ts` reads the settings once with `limitSettings`, stops the start on a
bad value, prints one line with the counts, and passes them to
`http.startServer` as `limits`. `limits.ts` never reads the environment.

| Setting | Default | Rule |
| --- | --- | --- |
| `LUNAR_ALLOWED_ORIGINS` | unset | In both modes the `Origin` must be a bare origin: `http` or `https`, a host and an optional port. A missing one, or one with a path (a lone `/` included), a query, a fragment, credentials, a backslash, a space or a control character, is refused. Unset: its host and port must equal the request's `Host`, without regard to case; the `Host` may spell out the scheme's default port (`:443` for `https`, `:80` for `http`). Set: a comma-separated list, and the `Origin` must be one entry: same scheme, host and port, with scheme and host compared without regard to case. The `Host` then plays no part. An entry is `http` or `https`, a host and an optional port; a trailing `/` is accepted. A blank value, an empty entry, or an entry with a path, a query, a fragment or credentials stops the start. The error names the entry by its place, never by its text |
| `LUNAR_TRUST_PROXY` | `false` | `true` or `false`; anything else stops the start. `false`: the visitor address is the socket's, and no header is read. `true`: it is `CF-Connecting-IP` when that is one valid IP address, else the right-most entry of `X-Forwarded-For` when that is one, else the socket's. Set it only behind a proxy that writes these headers itself |
| `LUNAR_MAX_GAMES` | `20` | Games at a time. A whole number, 1 or more, like the two below |
| `LUNAR_MAX_CONNECTIONS_PER_ADDRESS` | `8` | Open sockets of one visitor address. An upgrade over the cap gets 429 before a WebSocket exists, so no session is made |
| `LUNAR_MAX_NEW_GAMES_PER_HOUR` | `10` | Games one visitor address creates in any 60 minutes. A create refused for another reason is not counted |

| Detail | Behaviour |
| --- | --- |
| Address | An IPv4 address counts as itself, also when it arrives as `::ffff:a.b.c.d`. An IPv6 address counts by its /64 prefix, so one network is one visitor |
| Connection place | Taken at the upgrade and held by the TCP socket. Its close gives the place back, whatever ended it: a close from either side, an error, a failed handshake, or the ping timeout |
| Resume | A resuming socket is a new socket: it needs a free place, and the socket it replaces keeps its place until it has closed. A visitor whose places are all held by dead sockets gets 429 until the ping timeout frees them, at most two ping intervals (30 s). The client keeps retrying, and the token then resumes the session |
| New games | One list of times per address. A time is forgotten 60 minutes after it was recorded: when that address next asks, and for every address every minute on a timer that does not keep the process alive and that `close()` and `shutdown()` stop. A refused request records nothing |
| Whose counters | Each `startServer` call has its own counters, clock (`now`, for tests) and salt. Two servers in one process share none |
| Refused upgrade | Every refusal answers with the status, `Content-Length: 0` and `Connection: close`, then destroys the socket: when the answer is flushed, on an error, or after 2 s. A client that never closes its side holds nothing open |
| No address | A socket with no recorded address cannot create a game: the request is refused and logged with `address=none` |
| Log | No address is logged. The first refusal of a tag and reason logs `limit refused=connections address=<tag>` or `limit refused=new_games address=<tag>`. Later ones are counted and logged at most once a minute per tag and reason as the same line with ` count=<n>`, the refusals since the line before. The tag is the first 16 hex characters of a SHA-256 over a random salt of this server and the counted address. The salt is never stored or logged. The server remembers at most 1000 such lines, forgets one after a quiet minute, and counts any further tags together as `address=other` |

### Health and shutdown

`GET <base>/healthz` (`/healthz` at the root, `/play/lunar-base/healthz` under
that base) answers `200` with the body `ok` and a line break, as
`text/plain; charset=utf-8` with `Cache-Control: no-store`. `HEAD` gets the
same without a body; any other method gets `405` with `Allow: GET, HEAD`. The
server answers it before the static handler, so it needs no client build. It
names no version and no count, and outside the base the path is 404. Once a
shutdown has begun it answers `503` with `shutting down`.

`startServer` returns `shutdown(options)` beside `close()`. `main.ts` calls it
on `SIGTERM` and on `SIGINT`:

| Step | What happens |
| --- | --- |
| Begin | One log line: `shutdown begin signal=<name> connections=<open sockets> games=<started games>`. From here the health path answers 503, a WebSocket upgrade is refused with 503 before its path, origin and connection cap are looked at (it takes no connection place, and its socket is closed like every refused upgrade), and every message a client still sends is dropped before the sessions see it: a `lobby.create` or `lobby.join` that arrives during the close handshake starts no game |
| Sockets | Every open socket, also one that has not said `hello`, gets `server.restart` and is closed with code 1012 and the reason `Server restarting` |
| Games | The log sweep and the limits timer stop. Every room stops: its grace timers, its result timer and its bot work end, and its log leaves the open set. Game logs are written synchronously, so nothing is flushed |
| Listener | When the last socket has closed the HTTP listener closes. It stays up until then, so that a probe can read the 503. The server counts the unfinished responses of each connection, so pipelined requests all get their whole response; the connection closes after the last one. A connection with none is closed at once, also one that never sent a request. No response carries `Connection: close`: Node drops the responses queued behind one that does |
| Deadline | 10 seconds after the begin (`SHUTDOWN_DEADLINE_MS`), every connection still open is destroyed and one line says so: `shutdown deadline hit ms=10000 sockets=<n>`. Nothing is destroyed by force before that. A connection place is held by its TCP socket, so each one is given back however the socket ends: by the close handshake or by the deadline |
| End | One log line, `shutdown end`. The promise resolves with `{ deadlineHit }`. A log callback or an injected scheduler that throws does not stop it; the default timer then keeps the deadline. A second call returns the same promise |

`main.ts` exits with code 0 when the promise resolves, also after the
deadline. A second signal during the shutdown exits at once with code 1.
`scripts/start.sh` ends with `exec node src/server/main.ts`, so a signal sent
to that script's process reaches the server. Under `npm start` it does not:
`npm` passes `SIGTERM` and `SIGINT` to its immediate child, and that child is
the shell that runs the script line, which does not pass them on to Node. `npm`
then exits and the server runs on. A container therefore starts Node directly
(`node src/server/main.ts`) or `bash scripts/start.sh`, never `npm start`. `close()` is for tests: it drops every socket without
a message.

`main.ts` trims `TYPESAFE_API_KEY` and builds one `jevMaker` when it is
non-empty, using `LUNAR_JEV_MODEL` or `jev-latest`. The adapter and its
breaker serve every game in the process. `http.startServer` receives that
maker; its presence controls both `welcome.jev` and the lobby's acceptance
of `botBrain: "jev"`. `main.ts` also reads `LUNAR_JEV_MAX_DECISIONS_PER_HOUR`
once with `jevBudgetSetting`, stops the start on a bad value and passes the
number on as `jevDecisionsPerHour`. `http.startServer` builds one budget from
it and wraps the Jev maker once (see [Jev budget](#jev-budget)). The startup
line says whether Jev is on and states the budget:
`Jev is on, at most 2000 decisions per hour`, `Jev is off` without a
credential, or `Jev is off because the budget is 0 decisions per hour`. It
never prints the credential. A second startup line names the log directory,
the days a log is kept and the build.

| Game brain | Maker for each non-human seat |
| --- | --- |
| Omitted or `builtin` | Its own seeded built-in maker, wrapped with itself as fallback; no Jev request |
| `jev` | `withFallback(withDecisionBudget(sharedJev, serverBudget), builtinMaker(seed, seat))`; neither a failure nor a used-up budget prevents built-in play |

An empty or whitespace-only credential means Jev is off. No credential is
passed to the lobby, room, client or game log; only the adapter holds it.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | 4780 | HTTP and WebSocket port |
| `HOST` | 127.0.0.1 | Set to `0.0.0.0` to let other machines on the network join |
| `LUNAR_BASE_PATH` | `/` | The URL path the game is served under, for example `/play/lunar-base`. A trailing slash is dropped. The server stops at startup on any other form: a relative path, an empty segment, `.` or `..`, a query, or a character outside `A-Z a-z 0-9 . _ ~ -` |
| `TYPESAFE_API_KEY` | not set | Turns Jev on. Read from the environment only. Never written, logged or sent to a client |
| `LUNAR_JEV_MODEL` | `jev-latest` | Model name for Jev |
| `LUNAR_JEV_MAX_DECISIONS_PER_HOUR` | 2000 | Jev decisions the whole server makes in an hour, a whole number, 0 or more. 0: no Jev request is ever made. See [Jev budget](#jev-budget) |
| `LUNAR_SEED` | random | Fixed seed for every new game, for reproduction |
| `LUNAR_LOG_DIR` | `.data/games` | Directory of the game logs |
| `LUNAR_LOG_DAYS` | 30 | Whole days a game log is kept, 1 or more |
| `LUNAR_BUILD` | `dev` | Build version in the log header and the startup line; the client build reads it too |
| `LUNAR_BOT_DELAY_MS` | 700 | Smallest time a bot takes to answer, so people can follow. 0 in tests |
| `LUNAR_TAKEOVER_DELAY_MS` | 60000 | Grace period in milliseconds before the built-in player takes an absent seat's decisions. 1000 in browser tests |

`transport` and `sessions` fix what the table leaves open:

| Detail | Choice |
| --- | --- |
| `Connection` | Text in, text out: `send`, `onMessage`, `onClose(code)`, `close(code?, reason?)`. A binary frame closes the socket with 1003. `ping`, `onPong` and `terminate` serve the heartbeat (see [Reconnect](#reconnect)); the memory pair answers a ping at once unless its `answersPing` option says no |
| First message | Must be `hello`; anything else gets `bad_message` and the connection waits for a `hello`. A second `hello` on a bound connection gets `bad_message` |
| Unknown token | A new session: `name` is required, as with no token |
| Known token | `name` is ignored; the new connection replaces the old, which is closed with 4001 and does not disconnect the session |
| Names | Stored trimmed; compared lower-cased. A name stays taken while its session has no socket, until `drop` |

`room` takes the state and opening events from `startGame` (exported
by `src/engine/index.ts`) and the lobby's complete
seat snapshot. The server supplies the configured bot maker factory, a separate
built-in maker factory for takeover, `onLeave` and
`onEmpty`; it routes session messages, binds and disconnects to the room
while `room.has(session)` is true.

| Room detail | Contract |
| --- | --- |
| Choice queue | Synchronous FIFO, including replies received during a broadcast. Validate the game id, then the engine's decision id, seat and option; map `wrong_seat` to `not_your_decision` and `unknown_option` to `bad_option` |
| Updates | Initial seq is 1. Each broadcast increments it once for all recipients. Seat connection fields come from live sessions; bot seats are connected. A bind sends that seat its history and broadcasts the updated connection fields |
| Histories | Separate newest-200 histories for every seat and the public audience, populated only through `eventFor`. The first broadcast projects the required `RoomOptions.events` opening batch into histories before sending updates or requesting a bot decision (Q44). Normal updates contain the current choice's events; a resume contains history |
| Makers | One `withFallback` maker per bot, built by the server's factory (see [Non-human players](#non-human-players)). Each request copies the seat's view and event history. The answer and its label go back through the choice queue no earlier than the minimum delay (`LUNAR_BOT_DELAY_MS`, default 700 ms), except the first takeover answer at the end of the 60-second grace period. The delay runs beside the decision's budget, not after it: an answer at 8 s is applied at 8 s. The room still validates the option like a human's; a refused option or a wrapper that rejects is logged and leaves the same decision pending without a retry loop |
| Room endings | Check the 300-turn cap at creation and after each applied choice. Room-only endings overlay the view with no pending decision, no winners and zero scores. Engine exceptions produce a log line containing the game, seat and decision kind, never the thrown payload |
| Finished leave | Remove only that participant, call `lobby.release(session)` to clear lobby membership and send `lobby.state`, then `onEmpty` when the last human or watching creator leaves. Other participants retain the result. The lobby forgets its started-game entry after its final member is released |
| Running leave | Convert the departing human seat to a built-in bot, then release the session to the lobby. Keep playing for remaining participants; drop the room and stop its timers and bot work when the final participant leaves. A disconnect uses the grace period in [Reconnect](#reconnect); result expiry is in [Lobby](#lobby) |

The room logs one line per applied decision to stdout:
`game=<id> seat=<n> decision=<kind> by=<who>`. `who` is `human` or the
wrapper's label: `jev`, `builtin`, `builtin-after-jev-failure` or
`builtin-too-many-options`. A refused choice and a decision the engine
forces log no such line. The server never logs a view of another seat's hand
at the default level, and never a header or the credential.

## Non-human players

Any seat can be non-human. All of them work through one interface,
and the game never depends on Jev answering.

### Interface

```ts
interface DecisionMaker {
  decide(request: DecisionRequest, signal: AbortSignal): Promise<OptionId>;
}
type DecisionRequest = {
  view: PlayerView;
  decision: PendingDecision;
  seat: Seat;
  events: ViewEvent[];
};
```

- The request holds only that seat's view and that seat's events. A maker
  cannot see more than a human in the seat, and it sees as much: the hand
  that Spybot.py or Blood Moon showed the seat is in `events`.
- `events` is the seat's event history kept by the room (see
  [Hidden information](#hidden-information)), newest last, at most 200. It
  is built with `eventFor`, never from the full event log. Every maker gets
  the same request: built-in, random and Jev.
- The room validates the returned option id like a human's choice.
- `withFallback(primary, fallback, limits)` wraps two makers. It is the
  only thing the room talks to.

`src/bots/fallback.ts`:

| Wrapper detail | Contract |
| --- | --- |
| Result | `decideBy(request, signal)` resolves `{ option, by }`, where `by` is the label for the log. `decide` gives the option alone |
| Budget | `limits.budgetMs`, default `DECISION_BUDGET_MS` = 8000. The primary gets its own signal. It is aborted when the budget is used up or when the caller's signal aborts. The timer is cleared as soon as the primary settles |
| Fallback asked | When the primary rejects, throws, is aborted, or answers an id that is not offered. An answer that comes after the abort is ignored. The fallback gets the caller's signal. The wrapper does not check the fallback's answer; the room does |
| Labels | `jev`: the primary named an offered option. `builtin-after-jev-failure`: the fallback after any failure of the primary. A primary that makes no attempt rejects with `Declined`: `Declined("too-many-options")` gives `builtin-too-many-options`, `Declined("off")` (breaker open, Jev off after a 401, or the [Jev budget](#jev-budget) used up) gives `builtin` |
| One maker | `withFallback(maker, maker)` has no primary: the maker is asked once, without a budget, and the label is `builtin`. The server gives a non-human seat of a `builtin` game, and a seat a bot took over, `withFallback(builtin, builtin)` |

### Jev budget

The visitor limits cap games, and one game can ask Jev for hundreds of
decisions. Without a budget the ceiling is about 100,000 Jev decisions an
hour. With it, at the default, the whole server makes at most 2,000 Jev
decisions an hour, however many games and visitors there are.

`src/bots/budget.ts`. `http.startServer` creates one budget for the server
and wraps the shared Jev maker in it; `src/bots` knows nothing of the server.

| Budget detail | Contract |
| --- | --- |
| Setting | `LUNAR_JEV_MAX_DECISIONS_PER_HOUR`, default 2000. `ServerOptions.jevDecisionsPerHour` for a server started in a test |
| Scope | One `createDecisionBudget` per server, shared by every Jev seat of every game. A game with the built-in brain, and a seat a bot took over, never touch it |
| One decision | A decision that `withDecisionBudget` passes to the Jev maker counts once, whatever its retries and whether Jev answers, fails or runs out of time. A decision the Jev maker declines (`Declined`: too many options, breaker open, off after a 401) made no request and is taken back. A decision the engine forces reaches no maker and is not counted |
| Refund | `take()` returns the refund of that one decision. It takes from the minute the decision was counted in, never from another decision's minute, and once only: a second call, and a call after the minute left the window, change nothing |
| Window | The last 60 minutes, counted per clock minute: at most 61 numbers are remembered. A decision stays counted for 60 to 61 minutes, so no 60 minutes hold more than the limit. The clock is `ServerOptions.now`, in production `Date.now`, a wall clock. The budget keeps the latest time it has read: an earlier reading, from a clock that was set back, counts as no time passed, so no decision is freed early and no more than 61 minutes are remembered. A clock set forward frees decisions early by that much |
| Over the budget | The wrapper rejects with `Declined("off")` before the Jev maker is asked. `withFallback` asks the built-in maker and labels the decision `builtin`. Jev is not contacted, the breaker hears nothing, and no failure is logged. When the window has room again, later decisions of the same game go to Jev |
| Budget 0 | No Jev request is ever made. `main.ts` builds no Jev maker, also with a credential: `welcome.jev` is off and the lobby refuses `botBrain: "jev"`, as without a credential. A server started with a maker and `jevDecisionsPerHour: 0` refuses every decision |
| Log | `jev budget exhausted limit=<n> window=60m` at the first refused decision, and `jev budget resumed limit=<n> window=60m` at the next decision that is let through. One pair per exhaustion, never a line per refused decision. Nothing with a budget of 0 |
| Players | Nothing changes in the protocol or the client. A seat over the budget plays as a seat does whose Jev request failed: the built-in maker's choice is applied, and no message says which maker chose |

### Built-in maker

Always present. It makes the game playable with no credential and catches
every Jev failure.

| Property | Requirement |
| --- | --- |
| Pure | A synchronous function of the request (view, decision, events) and its own seeded random stream. No network, no clock |
| Total | Always returns one of the offered options. Never throws |
| Fast | Under 5 ms per decision |
| Sensible | Scores each option from the view and the option data: colonists and different achievements gained, Credits gained or kept, price, Orbs formed that hand cards need, cards gained, harm to the leading opponent. Takes the best; its random stream breaks ties |
| Measured | In the check: over 100 seeded two-player games it beats a maker that picks at random in at least 65 |

The remaining base-game decisions use these deterministic heuristics:

| Decision | Score |
| --- | --- |
| D3 choose-one | Evaluate the source card's printed action branch, including Flip, Steal Credits and Steal Module; labels are not parsed |
| D5 Discard, D8 Resell | Remove the card with the lowest discounted Draft value: preserve useful Modules affordable with current Credits and Orbs |
| D9 target | For harmful effects, spare self and prefer the opponent nearest a public victory threshold (Credits, colonists or distinct achievements). An opponent Resells grants Credits: its options carry `op: "opponent_resells"`, and the maker prefers the opponent furthest from those thresholds. Labels are not parsed |
| D10 Flip, D9 neighbour Flip | Sum the affected Stations' changes in colonists, distinct achievements and Orbs; reward own gains and opponents' losses, weighted by their progress. Never guess a hidden named face |
| D14 Kafka Exchange | Compare both Bases using only the showing Station faces: 12 per colonist, 18 per distinct achievement, 5 per printed Orb; weight harm to the opponent by public victory progress. Reaching a colonist or achievement target scores 1,000,000. Exchange preserves sides; hidden named faces are never guessed |
| D11 Steal Module | Value the card entering the hand plus the owner's lost Base value; weight harm toward the leading opponent |
| Spybot.py | Use the newest own `hand_seen` event since the current Agent was played. Value the cheapest forced discard in that hand. One Influence favours Discard; an empty hand favours Draw. Ignore other seats' looks and event prose |

`src/bots/builtin/strength.test.ts` runs in the normal check. Its 100 game
seeds are `builtin-strength:0` through `builtin-strength:99`, with the
built-in maker in seat 0, random maker in seat 1, and the starting seat
alternating. Both receive only their projected view and last 200 projected
events. Games stop at victory or the shared 300-turn cap. The test requires
at least 65 wins, no step-budget endings, and less than 20 seconds. It prints
wins, losses, games without a winner, mean turns and elapsed time.

The same 100 seeds, alternating starting seats and thresholds also run with
Influences enabled, and with both Influences and Kickstarter enabled.
All three variants must win at least 65 games and have
no step-budget endings. The Influence scorer uses only projected information:

| Decision | Influence heuristic |
| --- | --- |
| D12 defence | Defend against a theft reaching the thief's Credit target, a stolen Module, or at least 3 lost Credits. Value harmful Flips from the visible state and forced Discards by the lost cards, collection value and immediate effects. Preserve three Influences when Drafting a visible fourth would retain the collection, unless declining forces Influence losses; compare the Discard costs in that case. Keep four even on another seat's turn when declining preserves the pending win; an immediate lost win takes priority |
| D4 Draft | Deduct 3 per Credit of the offered extra price before evaluating triggers, including a Cowboy theft toward victory. Main Action estimates combine all extra Orb costs before applying own Orbs and exclude unaffordable or Quarantine-blocked Influences. Value collection progress, especially the fourth Influence. Include all matching pre-Draft Supply triggers, including the drafted card's own text. Evaluate Steals after removing the drafted card, so Drafting Alliance unblocks Cowboy |
| D5 Discard | Subtract lost card/collection value and add the discarded Influence's immediate effect. Losing one of exactly four as the active seat incurs a winning-hand penalty, so another legal card is discarded first |
| D13 order | Score the offered printed actions for their resolving seat. Prefer own benefits and opponents' losses; a credit-winning effect takes precedence over subsequent text. Opponents' cards remain unknown |
| Approximation | Collection values for 0–4 held Influences are 0, 6, 15, 36, 250. Unknown drawn cards have generic value 3. Discard effects recurse at most twice; no hidden card identities or exact future sequence is predicted. This is a shallow heuristic, not an engine simulation |

`src/bots/builtin/strength.test.ts` also plays four seeded games with the
built-in maker in both seats: one base game and three with Influences and
Kickstarter. Each must end in victory within the 300-turn cap.

A second maker, `randomMaker`, picks uniformly. Tests and property runs use
it. `src/bots/maker.ts` exports the interface, request, `OptionId` (a string)
and `randomMaker(seed, seat)`.

| Random maker detail | Contract |
| --- | --- |
| Stream seed | `seedToState(JSON.stringify(["randomMaker", seed, seat]))`; unambiguous seed/seat encoding, separate from the game stream |
| Selection | `nextInt` rejection sampling over the ordered options; advance the closure's RNG on every call, including a single option |
| Totality | For a valid request with at least one option, immediately resolve an offered id, even if the signal is aborted. An empty option list is an engine bug, not a decision |
| Isolation | Never mutate the request, event history or game state; each maker owns its stream |
| Types and imports | Node types supply `AbortSignal`, without the DOM library. Bots import engine types and the public pure catalogue, price and placement helpers from `index.ts`, plus RNG functions from `rng.ts`; no other engine internals |

The built-in maker exposes `builtinMaker(seed, seat)` and `score(request, option)` in
`src/bots/builtin/index.ts`. Scoring runs synchronously; `decide` immediately
resolves its answer to match `DecisionMaker`. Valid requests have at least one
option, as for the random maker. An aborted signal does not prevent a choice.

| Core scoring | Behaviour |
| --- | --- |
| D6 Build | A Build reaching the view's colonist or achievement target scores 1,000,000. Otherwise: 4 for building, 12 per colonist, 18 per new distinct achievement, quadratic progress toward both targets, minus 3 per Credit spent. Each formed Orb adds 1; each Credit it or a printed Orb saves on another held card adds 5. Skip scores 0 |
| D2 Main Action | Evaluate the printed box of the visible Station or Module. Build uses the best affordable legal placement from the current hand and Base, sharing placement results within this request. Draw values available Deck and recyclable discard cards (using the public count even when hidden) at 3 each, replacing the first card's value with its visible Module/Agent or Influence collection value when `deckTop` is public; Draft values visible Supply cards; a Module or an Agent the Draft can take counts for at least 1, so a box that takes a card from the Supply beats a box that does nothing, and an Influence keeps its computed value, which can be below 0; Resell values Credits at 3 each, limited by eligible Supply cards; discards lose card value |
| D4 Draft | Discount the Module's future Build value and penalize costs beyond current Credits. A drafted card never scores as an immediate victory. Agents get a modest value minus price |
| D1 Agent | Value its printed actions minus its offered price; prospective Builds use the Credits remaining after payment. Going on scores 0 |
| D7 Now or later | Resolve positive immediate text now; defer negative text such as discarding the hand. Later scores 0 |
| Ties | Private stream seeded with `seedToState(JSON.stringify(["builtinMaker", seed, seat]))`; `nextInt` selects among best options in offered order, advancing on every call |

These are shallow heuristics: they do not predict hidden draws, replay actions,
use hidden Station faces, or credit repeated Builds of the same held Module.
Unscored action effects contribute zero. The remaining decision heuristics and
the seeded win-rate measurement are specified above.

### Jev adapter

The prompt includes the Kickstarter rules digest and D14 Kafka instructions.
Its piles carry `deckTop` and `discardCount` from the projected view, alongside
the visible cards. A snapshot covers the Kickstarter prompt; no hidden pile
identities are reconstructed.

Jev is a System One model: it does not write text, it answers typed
questions about a `state`. A game decision is a Choice question, pick one
of N, which is exactly what the engine offers.

| Point | Decision |
| --- | --- |
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` through `TypeSafeClient.systemOne` |
| Credential | `TYPESAFE_API_KEY` from the environment, passed to the SDK in memory |
| Model | `jev-latest`. The model id in each response is logged |
| Request | One request per decision. `state`: a short rules digest, the seat's view as named JSON fields (you, opponents, Supply, piles), the last 10 of `request.events`, any hand the seat was shown this turn even if that event is older, and the decision in words. `questions.pick`: a Choice whose `criteria` map option id to option label |
| Answer | `answers.pick.choice`. It must be one of the option ids sent, else the built-in maker decides |
| Many options | A Choice takes at most 255 options; that is the hard limit. 60 is the target for a Build decision only: the adapter keeps the skip option and the best placements per Module by the built-in maker's score until 60 are left. Every other kind is sent whole: Flip any number has 64 options with six players, and a hand has no size limit. The rule is deterministic and keeps the engine's option ids. If more than 255 options remain, no request is made and the built-in maker decides (`builtin-too-many-options` in the log) |
| Size | Limit of the model: 32k tokens for `state` plus the question. The adapter aims for under 6k and drops old events first |
| Forced decisions | Never sent. The engine applies them |
| Cost | Input tokens only, $0.042 per million: about $0.0003 per decision at 6k tokens |
| Prompt code | `src/bots/jev/prompt.ts` is a pure function from request to `{ state, questions }`, covered by snapshot tests |

### Prompt construction

`buildPrompt(request)` returns `{ state, questions }` or the literal `"too many"`.
The transport adds `model`; this function performs no I/O. The request shape and
the 255-option Choice limit follow the
[TypeSafe API reference](https://docs.typesafe.ai/api).

| Detail | Behaviour |
| --- | --- |
| Build narrowing | `narrow(request)` reserves skip and the best placement for each physical Module instance. It fills remaining slots to 60 by descending built-in score. Ties use offered order; the result also preserves offered order and IDs. More than 59 Modules may exceed the target to retain every Module; over 255 retained options returns `"too many"` (Q45) |
| Other decisions | Keep all options through 255. Above that, return `"too many"` before constructing state or questions |
| View | Named fields `you`, `opponents`, `Supply`, `piles`, `turn`, `targets`, `config` and `influencesInGame`. Never include the view's pending options a second time or accept authoritative state |
| Events | Last ten filtered events, newest last. `seenHands` separately keeps every own private `hand_seen` since the last `turn_started`. If that boundary has fallen outside the room's event window, all retained events belong to the current turn. Past-turn reveals may remain in the recent ten, but are not pinned |
| Size | Estimate tokens as serialized JSON characters divided by four; remove oldest recent events while over 24,000 characters. Required visible state, Choice criteria and current-turn reveals remain intact even if they exceed the target (Q46). This is not an exact tokenizer or the model's hard context check |
| Offline coverage | Five full prompt snapshots (Build, Draft, target, an engine-produced defence-free Spybot.py and D12 defence), narrowing/limit cases, event trimming and private-information checks |

The rules digest includes the four-Influence end-of-own-turn win, defence
against current and later Agent actions, Discard text, Supply Draft triggers,
Quarantine and Alliance, and simultaneous-effect ordering. D12 includes the
public threatened action and actor; D13 includes each effect's actor and actions.

### Limits and failures

| Limit | Value |
| --- | --- |
| Time for one Jev attempt | 4 s (`timeout`) |
| Retries | 1 (`retry.maxRetries`), only if the budget allows |
| Budget for one decision | 8 s, enforced with the `AbortSignal` |
| Breaker | After 3 failed decisions in a row Jev is off for 60 s for the whole process, then one decision tries again |
| Smallest bot answer time | `LUNAR_BOT_DELAY_MS` |

| Situation | Behaviour |
| --- | --- |
| No credential | The adapter is not built. Every bot uses the built-in maker. The lobby says that Jev is off |
| Timeout, connection error, 429, 529, 5xx | The SDK retries once inside the budget. Then the built-in maker decides. Counts for the breaker |
| 401 | Jev is off until the server restarts. One log line, without the key |
| 422 or an answer that names no offered option | The built-in maker decides. The log names the decision kind. Counts for the breaker |
| Budget used up | The request is aborted. The built-in maker decides. Counts for the breaker (Q47) |
| More than 255 options after narrowing | No request. The built-in maker decides. Does not count for the breaker |
| Any failure | The game continues within the budget. The log records which maker decided: `jev`, `builtin`, `builtin-after-jev-failure` or `builtin-too-many-options` |

Tests never reach Jev. The adapter takes its `fetch` from the
caller; tests pass a stub with recorded responses. See [Tests](#tests) for
the network guard.

### Adapter and breaker

`jevMaker(options)` in `src/bots/jev/adapter.ts` is the primary of
`withFallback`. `createBreaker(now)` in `src/bots/jev/breaker.ts` holds the
on and off state. The client options and error classes are those of
`@typesafe-ai/sdk` 0.6.0.

| Detail | Behaviour |
| --- | --- |
| Options | `apiKey`, `fetch`, `model` (default `jev-latest`), `log` (default `console.log`), `breaker` (default: a new one). The `apiKey` is trimmed. An empty one throws: no adapter is built |
| Whole process | The breaker belongs to the maker. The server builds one maker for the process. Makers given the same `breaker` go off together |
| SDK client | `baseURL`, `defaultModel` and `logLevel: "off"` are always passed, so `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL` and `TYPESAFE_LOG_LEVEL` change nothing. The SDK's own log prints headers at `debug`; it stays off |
| Attempts | `timeout` 4000 and `retry.maxRetries` 1, with the decision's signal. The SDK retries a timeout, a connection error, 408, 429 and 5xx (529 included) after about 0.5 s, or after `Retry-After`. It does not retry 401 or 422. An abort ends an attempt or the wait before the retry |
| No request | In this order: more than 255 options rejects with `Declined("too-many-options")`; a signal that is already aborted rejects with a plain error; Jev off rejects with `Declined("off")`. None of them counts for the breaker or writes a line |
| Answer | Checked with zod: `model` is a string and `answers.pick.choice` is one of the ids in the `criteria` that were sent. An offered option that narrowing left out is refused like any other id |
| Failure | Rejects with a plain error that holds only the reason. The SDK's error is not passed on: it can quote the response |
| Breaker | Closed: counts failed decisions in a row; a success sets the count to 0. The third failure opens it for 60 s. Then the first decision is the trial and the others are refused until it reports: a success closes the breaker, a failure opens it for another 60 s |
| Late results | `admit()` gives each admitted decision a pass, and the decision reports `success`, `failure` or `disable` on it. A result of a decision admitted before the last pause began changes nothing: it does not end or extend the pause, end the trial, or touch the count after it. Its answer is still used |
| 401 | `disable()`: off until the process ends, also from a late decision. No result turns it on again |

Log lines, one per decision that was sent:

| Line | When |
| --- | --- |
| `jev decision=<kind> model=<id>` | A valid answer. `<id>` is the response's model id, or `unknown` (see below) |
| `jev decision=<kind> model=<id> failed=invalid_answer` | A 200 that names no option that was sent |
| `jev decision=<kind> failed=<reason>` | `timeout`, `connection`, `aborted`, `status_<code>` or `error` |
| `jev decision=<kind> failed=status_401: Jev is off until the server restarts` | The one line of a 401 |
| `jev breaker=open: Jev is off for 60 s` | A failure opened the breaker |

`<id>` is the only text of a response that reaches a line or an error. It
is `unknown` unless all of these hold:

| Check | Rule |
| --- | --- |
| Plain name | 1 to 64 characters of letters, digits, `_`, `.`, `:` and `-` |
| No credential | It does not contain the `apiKey`, in any letter case |
| No header text | It does not contain `authorization`, `bearer` or `api-key`, in any letter case |

A line never holds the credential, a header, the response body or an error
message. The room logs which maker decided.

### Manual Jev probe

`npm run jev:probe` plays one seeded two-seat game with Jev as both seats'
primary maker and the usual built-in fallback. It is a manual command, outside
the gate, `npm run check` and every test. It asks Jev directly, outside the
server's [Jev budget](#jev-budget): it ignores
`LUNAR_JEV_MAX_DECISIONS_PER_HOUR`, also when that is 0. Without `TYPESAFE_API_KEY`, it prints one
missing-credential line and exits without constructing the adapter or making a
request. With a credential, it prints each decision's kind, elapsed time for
`decideBy` (including fallback), maker label and the sanitized response model
id when available. The totals count decisions, Jev answers and fallbacks, the
median and largest decision latency, and approximate input tokens. That token
estimate is the sum of HTTP request body characters divided by four; retries
count again. It is not a billed token count. The command does not log prompts,
responses, transport errors or the credential.

## Assets

The print files are large (3.1 GB) and are not in this repository. The game
must start without them. So the images are made by a tool and the results
are committed.

| Step | What happens |
| --- | --- |
| Input | `docs/design/cards.json` names the PDF and page of every face (`sources`, `backs`). The PDFs are read from the directory in `LUNAR_PRODUCTION_DIR`, default `.cache/production`; if that directory is missing the tool unpacks `CARDS/*` into it from the archive in `LUNAR_PRODUCTION_ARCHIVE`, and stops with a message when that is not set |
| Render | `pdftoppm -r 300 -f P -l P -x 35 -y 35 -W 591 -H 1181 -png`: one page, cropped to the 50 x 100 mm trim. The first page of `sources` is used; further pages are copies of the same face |
| Encode | `sharp`: `w591` (591 x 1181, WebP quality 82) for the zoom view and `w240` (240 x 480, WebP quality 80) for the table |
| Output | `assets/cards/w591/<id>.webp`, `assets/cards/w240/<id>.webp`. `<id>` is the catalogue id, plus `back-deck`. 67 playing faces and the back: 136 files |
| Manifest | `assets/cards/manifest.json`: for each file the card id, source PDF and page, pixel size and SHA-256, and the tool versions |
| Corners | Not cut into the image. The client rounds them with CSS; the radius is measured once from the cutline of the print files |
| Commands | `npm run assets:build` (needs the PDFs and `pdftoppm`; `unzip` for an archive). `npm run assets:verify` (needs no print file; part of the gate) |

`assets:verify` fails when a playing face of `cards.json` has no image, a
file does not match its manifest hash or size, or a file is not in the
manifest.

The full set of 136 images is committed (6.3 MB). `scripts/validate` runs
`assets:verify` in its Data step.

Why committed, not generated at start:

- A fresh clone or worktree has no ignored files. A generated image set
  would have to be rebuilt there from 3 GB of print files, which the
  repository does not hold.
- `npm start` must not need the print files, poppler or minutes of
  rendering.
- The set is small: 55 to 97 KB for a sampled card at `w591` and 16 to
  25 KB at `w240`, 6.3 MB in all.

Other artwork is copied by `tools/assets/brand.ts` into `assets/brand/`
with its own manifest (source label, SHA-256): the logo, the three
backgrounds, the type badges cut from the card type tabs image, the web
icons, the Plepic wordmark, and the 16 achievement icons cut from a render
of rulebook page 10. Vite serves `assets/` as its public directory, so the
client loads `cards/w240/<id>.webp` below the page's base. `assetUrl` and
`socketUrl` in `src/client/base.ts` read that base from `document.baseURI`;
no base path is written into the build.

`npm run assets:brand` copies the two Lunar Base logo forms, website logo and
icon, six web icons, and Plepic wordmark from the directory in
`LUNAR_BRAND_DIR`, which holds the brand source folders `LF`, `LS` and `PF`.
It encodes the three backgrounds as WebP at no more than 1920 px wide. It cuts
seven badges from the card type tabs and 16 printed achievement icons from
printed rulebook page 10 (PDF sheet 7 of the rulebook in
`LUNAR_RULEBOOK_PDF`) at 400 dpi. Crop boxes are in
`tools/assets/brand.ts`; meteorite and habitat are omitted under Q9. The
manifest records each source and output SHA-256. `assets:verify` checks the
fixed file set, source labels, hashes, WebP dimensions, and the combined
background size below 1 MB.

`npm run assets:help` reads the rulebook in `LUNAR_RULEBOOK_PDF`. It renders
printed page 4 from PDF sheet 4 and pages 21–26 from sheets 13–15. It crops each printed page from its two-page
sheet at 600 dpi, encodes it as a 1000 px wide WebP, and writes seven files
and a source, page, sheet, dimensions and SHA-256 manifest to `assets/help/`.
`assets:verify` checks the exact file set, hashes, dimensions, and a combined
image size below 2 MB. The table's Help button and `?` open a modal with
these pages and the highest-impact readings from `open-questions.md`.
Arrow keys or Previous and Next change pages; Escape or Close dismisses it.
Focus stays in the modal and returns to the opening control.

## Interface

Direction: the table is the game's own artwork on its own night sky. The
cards carry the colour; the interface around them stays dark, quiet and
out of the way. Everything a player can do is visibly offered; nothing has
to be remembered from the rulebook.

### Material

| Use | Artifact |
| --- | --- |
| Cards on the table and in the zoom view | Card fronts, Terran Outpost face, deck back, corner radius from the cutline |
| Lobby background and header | Hero nebula, Lunar Base logo |
| Table background | Footer nebula, darkened |
| Panels: log, dialogs | Contour background |
| Counters for Credits, colonists, achievements, Influences and card-type marks | Card type tabs, achievement icons |
| Small icons | Web icons |
| Layout models | Fanned hand with one raised, glowing card; a Base of cards joined at their Orbs, as the brand artwork shows them |
| Credit counter | A compact value ring like the printed counter, with one tick per value, numbered start, midpoint and target, a rotating marker and real current and target text |
| Publisher credit in the footer | Plepic wordmark, at least 160 px wide |
| Help overlay | Rulebook pages 4 and 21 to 26 |

Not used: photos of people, campaign graphics.

### Tokens

The colours are sampled from the artwork. They are CSS custom properties in
one file; components use only the tokens.

| Token | Value | From |
| --- | --- | --- |
| `--space-900` | `#101533` | Contour background |
| `--space-800` | `#131E4E` | Footer nebula, mean |
| `--space-700` | `#272476` | Panel of the hand-cards artwork |
| `--nebula` | `#2D1D5B` | Hero image, mean |
| `--paper` | `#F7F4EC` | Plepic warm white; text on dark |
| `--credit` | `#FCB61F` | Credits badge |
| `--colonist` | `#1D8CCC` | Colonists badge |
| `--achievement` | `#D81F38` | Scientific achievement badge |
| `--influence` | `#F4804E` | Influence badge; also the glow of a selected card |
| `--action` | `#25A8C5` | Plepic cyan; things the player can click now |

Typeface: Outfit (variable, OFL-1.1), shipped with the game through
`@fontsource-variable/outfit`. The brand typeface Made Evolve Sans is not
shipped: its web font licence covers websites and names games as a
separate licence (Q41). The card images already carry the brand lettering.

`src/client/styles/tokens.css` owns the ten colours and shared spacing and
radius scales. `global.css` loads Outfit locally and sets the page defaults.
Paper body text has at least 4.5:1 contrast on each of the three space colours.
Available plain controls glow on hover and keyboard focus; card buttons keep their legal or selected highlight, and disabled buttons are muted.
The Shell uses the hero nebula and logo for Name, Lobby and Waiting; the
table uses the darkened footer nebula. It credits Plepic with a 160 px
wordmark on every screen. Name's contour panel is the model for later panels.
Beside the wordmark the footer holds the links "Report a problem" and
"Suggest a change" and the build version (`src/client/ReportLink.tsx`); see
[Overview, Problem reports and suggestions](./overview.md#problem-reports-and-suggestions).

### Cards

| Part | Rule |
| --- | --- |
| `Card` (`src/client/cards/Card.tsx`) | Draws a catalogue id, or `back-deck`, at a pixel width with 0 to 3 quarter turns, from `/cards/w240/<id>.webp`. The card's name is the alternative text; the Deck back is "Deck back". Height is twice the width |
| Corners | CSS rounds them: `--card-radius-ratio` (0.06) times the width. Measured once from the cutline: 3.0 mm on 50 mm |
| `ZoomCard` (`src/client/cards/Zoom.tsx`) | One button named by the card. Hover for 500 ms with a mouse or pen, a touch held for 500 ms, or the space bar opens a dialog with the `w591` image, the name and the printed rules, defence and footer text from `cards.json` as real text. Escape closes it and returns focus to the card; moving away or ending the press closes it |
| Data | The client imports `cards.json` for names and texts only (`src/client/cards.ts`) |

### Screens

| Screen | Content |
| --- | --- |
| Name | Logo on the hero nebula, one field, one button |
| Lobby | Open games with seats and options; "Create game" with players, non-human players, Influences, Kickstarter cards |
| Waiting | Seats and options shown while seats fill; the game starts by itself |
| Table | Below |
| Result | Winner or winners, each player's conditions met (R11.3), back to the lobby |

`src/client/App.tsx` picks the screen:

| State | Screen |
| --- | --- |
| No `welcome` yet | Name |
| `game` set (a `game.update` arrived), `view.result` null | Table: the picture table, or the plain table at `?plain=1`, and, for a seated player, Leave game |
| `game` set, `view.result` set | Result |
| `lobby` holds a game whose `humans` has the player's name | Waiting: seats in seat order (creator, non-human, joined humans, free), and Leave (`game.leave`) |
| Otherwise | Lobby |

The Lobby's Create sends `seats`, `bots`, and the selected `influences` and
`kickstarter` values. It defaults to the built-in player and omits
`botBrain` for that choice. When `welcome.jev` is true, a Non-human brain
selector also offers Jev and sends `botBrain: "jev"` when selected. With
Jev off, the selector is absent and the form says that non-human players
use the built-in player. Non-human players are held at or below the players. Both card options are enabled; the form explains that Kickstarter cards have no printed rules and follow the specification's readings. The lobby list and Waiting screen show each game's options. Any refusal shows as the server worded it, such as
`game_full`.

The plain table (`src/client/table/PlainTable.tsx`) shows the turn and the
active player; per player the name, Credits, colonists, achievements, hand
size and the Base as a list ("Depot at 1,0 turned right"); the Supply, the
Deck and Discard counts, your hand and the log. The Station's line names the
side that is up and, while the Terran Outpost side is up and the view carries
`base.station.named`, the side under it: "Terran Outpost (other side:
Shackleton)". A pending decision of this
seat shows its kind and one button per option, named by the engine's label;
a press sends `game.decide` with the game, decision and option ids. Another
seat's decision shows as a line naming that player and the kind. The log
keeps one sentence per event for every update since the client joined the
game (`GameState.log`). The Result screen (`src/client/screens/Result.tsx`)
names the winner or winners, shows each player's three public conditions
against the view's `targets` with the engine's score, says plainly that a
`step_limit`, `turn_limit` or `engine_error` game was stopped with no
winner, and offers Back to lobby (`game.leave`). Condition 4 shows from
the `influences_revealed` event. `?plain=1` selects the
plain table over the picture table.

Both tables show a seated player a "Leave game" button
(`src/client/table/Leave.tsx`); the watching creator of an all-bot game has
none. On the picture table in a window 48rem wide or more it sits at the
right of the footer band, where it covers no table region
(`e2e/table-layout.spec.ts`); on the plain table and in a narrower window it
sits beside Help. From 64rem wide the picture table has your counters under
its top right corner, so Help is in the footer band too, left of Leave game;
a watcher sees Help alone there. The same test holds that neither button
covers a table region or the other. Leave game opens a confirmation dialog
with "Stay", which has the
focus and is what Escape does, and "Leave game". Only the latter sends
`game.leave`, once: the button is then disabled until `lobby.state` takes the
table away. A dropped connection enables it again, because the message may be
lost with it. What follows is the row "Leave a running game" in Lobby. The
button shares Help's layer, so a choice dialog or the Discard pile covers it:
the player answers or closes that first.

The picture table (`src/client/table/PictureTable.tsx`) lays out the
regions below. Opponents and you share `Counters`
(`src/client/table/Counters.tsx`): name, human or non-human, connected,
Credits and colonists as `n/target` from `view.targets`, then hand size on a
Deck back, then achievements as `n/target` with their icons. Credits use the
dial. The owner's Influence count comes last when enabled. It draws no
Influence count or hand card for an opponent. The Supply
is one `ZoomCard` per card beside the Deck and Discard counts. The Base
area draws the focused player's cards on a grid, with pan, zoom and fit
controls. Your Base is in focus by default; selecting an opponent's preview
shows theirs, and Your Base returns to yours. The decision bar is
generic: the kind and one button per option that names no card, named "Your
decision" when this seat is asked and "Decision" otherwise. Four kinds have
an interaction of their own (`src/client/table/Decisions.tsx`;
`src/client/table/build/`); any other kind keeps the generic bar:

| Decision | Interaction |
| --- | --- |
| D2 `main_action` | Every card of the Base that has a box is highlighted. The bar lists the boxes in one group per card, named by the card and with its small image. A button sends its option |
| D3 `choose_one` | A dialog over the table shows the card named by the options' `card` and one button per printed option. With no `card` it shows the buttons alone |
| D6 `build` | Module, place, turn, Confirm: [Build](#build-interaction) below |
| D7 `defer` | The same dialog shows the built Module and the two buttons, resolve now or after the current card |

The dialog moves focus to its first button and keeps it inside: Tab wraps,
and focus that lands outside is pulled back. It has no close control, because
the choice has to be made. When it goes, focus returns to the control that had
it, if that is still on the table. Every button is named by the engine's label.

Your hand (`src/client/table/Hand.tsx`) is a fan: the cards share the
width of the region, overlapping only as much as the hand needs, and the
hovered or focused card rises. For D1, D4, D5 and D8 (kinds `agent`,
`draft`, `discard`, `resell`) an option's `card` is an instance id. The card
with that instance, in your hand or the Supply, glows in the action colour
and is a button whose accessible name is the option's label; pressing it
sends that option. Such an option is not in the decision bar. Options with
no card (`go_on`) stay in the bar, and so does every option of D2, whose
`card` names a box and not a card to pick. Every other card is a zoom
trigger named by the card. While another seat decides, no card glows.

#### Build interaction

`buildSelection(options, action, from)` in `build/selection.ts` is a pure
reducer over the D6 options. It groups them by Module (`card`), then by top
cell (`x`, `y`), then by turn (`q`), in the engine's order, and holds the
chosen Module, cell and turn. Its `option` is the engine's own option for
that choice. An action no option stands behind changes nothing.
`useBuild` (`build/Build.tsx`) holds one selection per decision id and gives
the hand, the Base and the bar their parts.

| Step | What shows | Control and its name |
| --- | --- | --- |
| 1. Module | Each Module the options name glows in your hand; the picked one is `aria-pressed` and glows in the selection colour | Card button "Build Depot" |
| 2. Place | One dashed outline per top cell of that Module on your Base. The Base is fitted around every placement of the Module, and comes back into focus if an opponent's was shown | Outline button "Place Depot at 1,0" |
| 3. Turn | The Module lies at the place, turned as the option says, starting with the first turn the engine lists. The other places stay as outlines | Preview button "Turn Depot"; a press or R takes the next legal turn of the place and comes round |
| 4. Confirm | The bar reads "Price: 1 Credit. Orbs formed: yellow, red. Turn 2 of 3" from the previewed option's `price` and `orbs` | "Confirm: " and the engine's label sends that option |

| Point | Decision |
| --- | --- |
| Skip | An option that names no placement (`skip`) is a button in the bar with the engine's label at every step. An option whose `card`, `x`, `y`, `q`, `price` or `orbs` is missing is treated the same way, so no option is ever lost |
| Back | Escape, or the Back button, steps from the turn to the places and from the places to the Modules. Escape belongs to an open dialog, such as a zoom view, first |
| Keyboard | Tab, Enter and R are enough. Picking a Module moves focus to its first place; picking a place moves it to the preview; stepping back returns it to the place or the Module that was left. R with Ctrl, Alt or Meta is left to the browser |
| Nothing computed | The client reads the places, turns, price and Orb colours from the options. It checks no placement and works out no price |
| Bar height | One line of text and one row of buttons, like the generic bar. The centre column of the three-column table is narrower than that needs: in a window under 82rem wide the text keeps the room of two lines at every step, and under 72rem the buttons, with less padding, keep the room of two rows. The bar is then as tall as its fullest step, so the Base does not move while a Module is placed. `e2e/build.spec.ts` holds the board's height at 1024x720 and 1280x720 and plays the path with the mouse and with the keyboard |
| `BaseView` | Takes an `offer`: cells to outline, a card to preview and the placements to fit. It knows nothing of Build |
| Plain table | Unchanged: one button per option |

The table is as tall as the window and the page never scrolls. From 1,024 px
(64rem) wide it is as wide as the window too and has three columns, so that
the Base, where a player builds, is the largest region:

- Left, a rail 13rem wide: the opponents, one below the other, each with its
  counters, its decision buttons and the control that shows its Base.
- Centre, the width that is left: Supply, the Base, the decision bar and your
  hand, top to bottom. Supply, the bar and the hand keep their size. The Base
  takes the height that is left and shrinks before anything scrolls, so the
  whole Base is on screen. The bar puts its lead and its buttons on one row
  when they fit.
- Right, 14rem wide: your own counters, the Influences of the game when there
  are any, and the log, which scrolls inside its column.

Every player's progress stays on screen: when the rail is short of height it
draws each opponent denser (four opponents in a window up to 850 px high, five
up to 1,040 px), with a smaller dial, the counters in a grid, the name on one
line and a lower Base control. Nothing is left out. The rail scrolls inside
itself only when even that does not fit, as when five opponents each carry a
decision button in a window 720 px high.

Under 1,024 px wide the table keeps the stacked arrangement: the opponents in
a row on top, Supply and Base (one scrolling column) beside the Influences of
the game and the log, the decision bar, then your hand with your counters at
its right. The lobby, waiting, result and plain-table screens keep a width of
72rem; the plain table and the result scroll as an ordinary page.

`e2e/table-layout.spec.ts` holds the three columns at 1280x720 and 1024x768
and the stacked arrangement at 1000x720; the fit at 1280x720 and 1024x720 with
up to six seats and 200 log events; and with four seats, that the Base at
1280x720 has at least twice the 832x151 px it had in the stacked table, that
the whole Base is on screen at 1440x900 and 1920x1080 with nothing scrolling,
that the table reaches both edges of a 1920 px window, and that the Base is
the largest region at all three sizes.

Supply cards are 44 px wide at every window height: Supply is a small strip
and the two piles lie in its row. In a window 800 px high or less the hand is
drawn smaller (64 px wide, not 110), the gaps shrink and the Base may be
5rem high. At 1280x720, 1024x768, 1440x900 and 1920x1080, with up to six seats
and nine Supply cards, the seven regions (Opponents, Supply, Base, Log,
decision, hand, your counters) and the decision bar's buttons lie inside the
window and no two regions overlap (`e2e/keyboard.spec.ts`). The zoom view
shows the full card.

**Tab order.** The document order is the tab order: the decision bar, your
hand and counters, the Base, Supply, the opponents, the log. The grid places
the regions, so the order does not change what is seen: your counters follow
your hand in the order and are drawn in the right column. Every option can be
reached: an option that no card, Station or Module carries (its card is in no
hand or Supply, its target has no seat) is a button in the decision bar.

**Dialogs.** A modal dialog (a choice, a private look at a hand, a zoom view
opened by the space bar, from the log or by the button for a Station's other
side, the leave confirmation) takes the
focus when it opens, keeps
Tab and Shift+Tab inside it, pulls back focus that lands outside, closes on
Escape wherever the focus is, and gives the focus back to the control that had
it. When that control is gone, the focus goes to the first control of the
decision bar or the hand. `src/client/cards/modal-focus.ts` holds the rules.
When dialogs overlap, only the last dialog in document order traps focus and
handles Escape. The leave confirmation follows the table dialogs, and Help
follows both and stays active above them.

```
+-------------+----------------------------------+---------------+
| Opponents,  | Supply (3 + N cards)             | Your counters |
| stacked:    |                Deck n  Discard n | 12/20, 6/10,  |
| name,       +----------------------------------+ 3/5, 1/4      |
| Credits     |                                  +---------------+
| n/20,       |  The Base in focus: yours, or an | Influences in |
| colonists   |  opponent's when you click it.   | this game     |
| n/10,       |  Pan and zoom.                   +---------------+
| hand size,  |                                  | Log           |
| achievements+----------------------------------+               |
| n/5, a small| What is asked of you now, with   |               |
| picture of  | its buttons                      |               |
| its Base    | Your hand, overlapping           |               |
+-------------+----------------------------------+---------------+
```

### Behaviour

`BaseView` draws the Station and Modules from each public Base. Its client-only
`layoutOf` follows R5.3: the top cell is `(x,y)`; the bottom lies below, left,
above or right as `q` turns from 0 to 3. The viewport fits on first display
and after its Base changes. Drag or arrow keys pan; wheel, + and - zoom; Fit
centres every card again. The same view draws a small, static preview under
each opponent's counters. Selecting that preview focuses the opponent's Base;
Your Base returns to the viewer's Base.

A Station lies with one side up, and R2.4 lets its owner know the other. While
the Terran Outpost side is up and the view carries `base.station.named`, the
full-size view puts a button on the Station, named "Look at the other side of
your Station", or "Look at the other side of Bea's Station" on another
player's Base. It opens the zoom view of the named side as a modal dialog with
a Close button. The grid still draws the side that is up, and Orbs, colonists
and achievements still count that side. There is no button when `named` is
`null` (another player's never-Flipped Station), when the named side is up
(its other side is the Terran Outpost every Station shares), or in the small
previews. Looking sends nothing to the server, so no one can tell who looked.

- The view decides everything. The client renders `view` and offers the
  `options` of the pending decision; it holds no rules. A thing is
  clickable exactly when an option points at it.
- The table lists `influencesInGame` after the game starts, above the log.
  The open-game Lobby and Waiting screens have no selected list yet: it is
  picked at setup.
  The Kickstarter checkbox is enabled and defaults off.
- The Deck shows `deckTop` when public, otherwise a back. The Discard pile
  shows its last public card and opens the complete public pile in a dialog;
  when the list is hidden it shows a back. Public pile cards use the same zoom
  view as other cards. A hidden pile closes its dialog. The two piles share
  Supply's row, drawn smaller than its cards, so they do not push the Base
  down. Both counts come from the view in picture and plain tables.
- Kafka (D14) marks each other Station as a button in the opponents rail;
  pressing it sends the option id. An Exchange redraws each Base from the
  next view. A priced Draft uses the option's label on its card button.
- Each decision kind has one fixed interaction. Build (D6): pick a Module
  in hand, the legal places appear as outlines on the Base, pick one, turn
  it through the legal turns, confirm; the price and the Orbs it forms are
  shown before confirming. Choices of a target (D9 to D11) highlight
  Stations, Modules or players. Defence (D12) is a dialog over the table.
- Target decisions (D9) mark only the players named by options, including
  your own seat when offered, first in the rail. Their rail buttons use the
  option labels.
  Flip (D10) offers a Station button for each seat named by an option. One
  Station sends its option immediately; two or any number can be toggled and
  confirmed, with the selected seat set matched to an engine option. Steal
  Module (D11) marks candidate Bases, focuses the first one, and puts each
  candidate Module's named option button on its card.
- Cards are small on the table (the hand about 110 px wide, Supply 44 px).
  Hover, long press or the space bar opens the `w591` image, with the card's
  name and rules text from `cards.json` as real text beside it.
- Progress toward the three public victory conditions (Credits, colonists,
  achievements) is always visible for every player, since that is what
  players watch. The targets come from the view, because Welfare and
  Longevity move them (R12.7).
- Credits use a value ring with a marker that turns to the current value in
  250 ms. The current number and target remain real text and the group names
  both for screen readers. Reduced motion removes the marker transition.
- Influence progress is private. A player sees their own count of 4 when
  the Influence option is on. For an opponent the interface shows the hand
  size and nothing about Influences: no count and no marker (R2.3). An
  opponent's Influences appear only when the end-of-turn win reveals them
  (R11.4), on the result screen. The interface never works a count out
  from the log.
- A Supply Influence shows its card and the printed text of its active Supply
  effect. D12 and D13 use dialogs over the table. D12 names the Agent in the
  public play area and shows its printed actions from `cards.json`. Each D12
  option also carries the pending public action and its acting seat for decision
  makers. D13 lists each
  offered order without presenting one source card as the subject. The result
  screen uses the public `influences_revealed` event to draw the winner's
  revealed cards.
- Events drive motion (`src/client/table/motion.ts`): a card moves from where
  it was to where it is in about 250 ms. `prefers-reduced-motion` turns motion
  off. No motion blocks input.

  | Event | Motion |
  | --- | --- |
  | `card_drafted` | Supply to the hand, or to the drafting opponent's counters |
  | `card_drawn` | Deck pile to the hand, or to the opponent's counters |
  | `card_discarded`, `card_resold`, `agent_discarded`, `agent_played` | Hand or opponent's counters to the Discard pile |
  | `module_built` | Hand or opponent's counters to its place in the Base shown |
  | `station_flipped` | The Station turns over in place |

  The first render and a restored history do not move. A card that lands
  in the hand moves itself by an inline `transform`. A card that lands in a
  scaled or clipped region (a Base), or that has no box of its own at its end
  (a Discard, an opponent's hand), moves as a `pointer-events: none` ghost
  image fixed to the page: it starts on the card's old box, or on its seat's
  panel when the card was a hidden hand card, and it reads its destination
  every frame, so layout that settles during the move cannot leave it behind.
  The real card waits, hidden, until the ghost arrives. The boxes used as
  "where it was" are re-measured whenever the layout settles. A newer update
  ends the running motion and removes every inline style it set before it
  measures.
- The table log keeps seat-projected events in arrival order and announces new
  lines politely. It separates turns, follows the newest line until the reader
  scrolls up, and opens a named card in the zoom view. A private `hand_seen`
  event that arrives while the table is open opens one dialog of the seen cards;
  a look already in restored history stays in the log without reopening it.
  Closing the dialog leaves its sentence in the log. A public `hand_seen`
  event has no card list or dialog.
- Every option is a real button with the engine's label as its accessible
  name. The game can be played with the keyboard, and tests find controls
  by role and name. Colour is never the only sign: Orb colours are named
  in labels and in the Build bar's text; a card that answers the decision
  carries a "Pick" tag ("✓ Picked" once chosen, "Placing" on the preview of a
  Build), a place is a dashed outline, and a chosen Station has a double
  border.
- Designed for a desktop window of 1280 x 720 or larger and usable down to
  1024 wide. The picture table uses the whole width of a wider window. No
  phone layout.
- A plain table at `?plain=1` draws the same view as text, with one button
  per option and no images. It stays as a
  debugging aid; it needs no change when the engine gains a decision kind.

## Tests

Engine and protocol behaviour is written test first. The
weight is on the engine, where a test runs in milliseconds with no browser.

| Layer | Tool | What it proves |
| --- | --- | --- |
| Rule tests | Vitest | One or more tests per rule, named by rule number ("R7.9 Resell …"). Small hand-built states |
| Rulebook examples | Vitest | The pictured examples of the rulebook, the sample turn of pp. 27 to 30, examples E1 to E4 and the victory cases of section 11. `src/engine/rulebook.test.ts` holds p. 12, 18, 20, 32 and the sample turn, in tests named by printed page; `placement.test.ts` holds p. 23 and 24. A case where the engine and the book disagree is a `test.fails` named with its question number |
| Scenario replays | Vitest | Whole games as `(config, seed, choices)` files with the expected result |
| Properties | Vitest + fast-check | Random legal games for 2 to 6 seats and both options: no error; cards are conserved; Credits never negative; no two cards share a cell; every joint is legal (R5.11); the game ends, or reaches the turn limit or the step budget; replay gives the same states and events. `src/engine/properties.test.ts` plays 20 games in each of the four Influences/Kickstarter combinations with a fixed fast-check seed, checks every state a game stops in, and prints the largest `turn.work` for each configuration. Every combination verifies that all seat counts from 2 to 6 are exercised |
| Termination | Vitest | The Entropic Cascade cycle ends in `step_limit` with no winner and replays to the same result; a long finite chain of forced steps (nested Entropic Cascade and Discard all) finishes below the budget; `src/server/room.test.ts` starts two rooms through one session router: building Bacon Printer with only Cascade left in hand starts the forced cycle, both seats receive `step_limit` with no winners, and a decision sent immediately afterward to the other room receives its update within one second (real elapsed time) |
| Hidden information | Vitest + fast-check | The tests in [Hidden information](#hidden-information) |
| Protocol | Vitest | Every message schema accepts its examples and rejects malformed input |
| Server | Vitest | Lobby, start, decide, errors, disconnect, takeover and resume through the in-memory `Connection`; one test over a real socket on `127.0.0.1` |
| Bots | Vitest | Built-in maker: total, deterministic, beats random. Every maker gets the seat's events: Spybot.py with the defence declined and accepted, Blood Moon, and no other seat gets the cards. Jev adapter: prompt snapshots; six-seat Flip any number and a large hand; every failure row of the table above, with a stub `fetch` and fake timers |
| Client | Vitest, Testing Library, jsdom | Each decision kind renders its options and sends the right choice, from view fixtures |
| Browser | Playwright, headless Chromium | A few whole flows against the real server with seeded bots: name, create, join from a second tab, Draft from Supply, Build by Module, place and Confirm, play to Result, reload and resume. One short flow keeps the plain table. Budget: under 60 s |
| Assets | `assets:verify` | Images and manifest agree with `cards.json` |

`src/engine/scenarios/` pins eight complete built-in maker games: three base
games at 2, 4 and 6 seats, two with Influences, one with Kickstarter Stations,
and two with both options. Each JSON file stores the config, seed, every
choice, result, final turn number, SHA-256 of `JSON.stringify` of the final
engine state, and the victory conditions met by the winners. The test replays
the choices without consulting the maker, checks every expected field, and
prints each file's ending. A changed rule must be named in the commit that
updates a scenario. To record or update one file, run
`npm run scenario:record -- '{"seats":2,"influences":false,"kickstarter":false}' '<seed>'`.
The recorder gives each seat only its view and last 200 projected events, as
the room does, and stops at the server's 300-turn limit if no result occurs.

No test uses the network. A Vitest setup file (`test/setup.ts`) removes
`TYPESAFE_API_KEY` from the environment and replaces `fetch` and socket
connects with guards that fail the test for any host other than the local
loopback. The loopback is allowed only to reach the server under test.
That guard lives in the Vitest process. The browser tests start their own
server and browser, so they have their own: the server is started with an
empty `TYPESAFE_API_KEY`, which counts as none, and every page refuses an
HTTP request or a WebSocket to a host other than the loopback and fails its
test, and no page can register a service worker.

### The check commands

```
bash scripts/validate
npm run check
```

`scripts/validate` is the gate. It needs no browser and no network. It
prints the elapsed time of every step and the total, and stops at the first
failure. `npm run check` runs `scripts/check.sh`, which runs the gate with
`--browser`: the same steps, then the browser tests.

| Step | Command |
| --- | --- |
| Format | `prettier --check . --cache --cache-location .cache/prettier` |
| Shell | `shellcheck` on every tracked shell file |
| Lint | `eslint .` |
| Types | `tsc -p` for each `tsconfig.json` |
| Data | `scripts/validate-cards.sh`, `npm run assets:verify` |
| Tests | `vitest run` |
| Build | `vite build` |
| Browser (`npm run check` only) | `scripts/start.sh --prepare`, then `playwright test` |

`start.sh --prepare` installs dependencies and stops, so the
`npm start` that Playwright runs never reinstalls under a running test.
`playwright.config.ts` starts the game on port 4791 with `LUNAR_SEED`,
`LUNAR_BOT_DELAY_MS=0`, `LUNAR_TAKEOVER_DELAY_MS=1000` and an empty
`TYPESAFE_API_KEY`, and uses the Chromium Playwright already has in its
cache. If that Chromium is missing the browser step fails with a message
that names it; the tests never download a browser. Install it with
`npx playwright install chromium`. Run one check at a time: the browser
tests own port 4791. Longer random runs are `npm run soak`, outside both
commands.

The suite runs at `/`. `e2e/base-path.spec.ts` starts a second server in its
own process under `/play/lunar-base` and loads the page, its files and its
socket there. `LUNAR_BASE_PATH=/play/lunar-base npx playwright test` runs the
whole suite under that path.

`npm run soak` plays 2,000 base games through the engine, rotating through
2 to 6 seats. `npm run soak -- --influences` enables Influences for all games.
`--kickstarter` enables Kickstarter independently; combine both flags for all cards.
`--games N --seed S` changes the count and seed. It reports
endings, mean and largest turns, largest `turn.work`, and elapsed time. If a
game throws, it prints its `(config, seed, choices)` replay tuple.

## Start

```
npm start
```

`scripts/start.sh` does this:

| Step | Detail |
| --- | --- |
| Check Node | Stops with a clear message below 24.15 |
| Install | Runs `npm ci` if `node_modules` is missing or the SHA-256 of `package-lock.json` differs from the one stored in `node_modules/.lock-sha256` after the last install |
| Build | Always runs `vite build`. It takes about a second, and no freshness test can then miss an input (a nested component, `cards.json`, the Vite configuration) |
| Serve | `node src/server/main.ts`: one process, one port, client and WebSocket together |
| Tell | Prints `Lunar Base is running at http://localhost:4780`, with `<base>/` appended when the base path is not `/`, and whether Jev is on |

- Nothing else is needed: no database, no container, no print files, no
  credential. With no credential every non-human player uses the built-in
  maker.
- To play with Jev: `TYPESAFE_API_KEY=… npm start`.
- To play alone: create a game with non-human players. To play together on
  one machine: open one tab per player. To let others on the network in:
  `HOST=0.0.0.0 npm start`.
- Development: `npm run dev` runs the Vite dev server, which proxies `/ws`
  to a game server on `PORT` (default 4780). Start that server separately
  with `node src/server/main.ts`.

## Image

The `Dockerfile` builds one image, `ghcr.io/plepicgames/lunar-base`, in three
stages on one Node.js base image pinned by digest.

| Stage | Does |
| --- | --- |
| `build` | `npm ci`, then `vite build` with `LUNAR_BUILD` from the build argument |
| `runtime-dependencies` | `npm ci --omit=dev` |
| `runtime` | Holds only what the server reads, and removes npm, corepack and yarn |

`/app` in the image holds `package.json` (for `"type": "module"`),
`node_modules` without development packages, `docs/design/cards.json`,
`src/engine`, `src/protocol`, `src/bots`, `src/server` and `dist/client`.
Tests, fixtures, `src/client` and `tools/` are not in it; `assets/` is there
only as the copy Vite put into `dist/client`. Node runs the `.ts` files by
type stripping, so there is no compile step for the server.

The contract with the Deployment in `hannosirkel/deploys`:

| Point | Image |
| --- | --- |
| User | Numeric UID and GID 10001 |
| File system | Read-only root. The server writes only below `LUNAR_LOG_DIR`; the Deployment mounts a volume at `/var/lib/lunar-base/games`, which exists in the image and belongs to 10001. There is no `/tmp` volume and the server needs none |
| Process | `node src/server/main.ts` in exec form with an empty entrypoint: Node is process 1 and handles `SIGTERM` itself, as in [Health and shutdown](#health-and-shutdown). No init wrapper, because the server starts no child process |
| Port | 4780, when `PORT` says so |
| Settings | None is baked in. `HOST`, `PORT`, `LUNAR_BASE_PATH`, `LUNAR_LOG_DIR` and the others come from the Deployment. Without `HOST=0.0.0.0` the server listens on loopback only, and without `LUNAR_LOG_DIR` it cannot write a game log in the image |
| Base path | Any: the client is built with relative addresses |
| Build | `LUNAR_BUILD` is the Git commit, set once as a build argument. The client shows it and the server writes it into each game log |
| Labels | `org.opencontainers.image.source` (links the package to this repository), `revision` (the commit) and `licenses` (`LicenseRef-Proprietary`) |

`scripts/smoke-image.sh <image> [<build>]` runs an image under that contract:
user 10001, read-only root, no capabilities, a volume at the log directory,
`LUNAR_BASE_PATH=/play/lunar-base` and no Jev key. It requires `200` from
`/play/lunar-base/healthz` and from the index, exit code 0 within 15 seconds
of `SIGTERM`, no `EROFS` or `EACCES` in the output and, when a build is named,
that build in the start lines. The `image` job of `validate.yml` runs it on
each pull request and the `build` job of `release.yml` on the pushed digest.

### Release

`.github/workflows/release.yml` runs on a push to `main` that changes a file
the image is built from, and on a manual run from `main`. Its `paths` list is
a superset of the allow-list in `.dockerignore`: it holds every file the build
context admits, and also `Dockerfile`, `.dockerignore`, the two release
scripts and the workflow itself, which decide how a release runs. A promotion restarts
the single replica and ends the games in progress
([decision 0005](../decisions/0005-run-one-replica-with-recreate.md)), so a
merge of documents or tests alone does not run it.

| Job | Permissions | Does |
| --- | --- | --- |
| `validate` | `contents: read` | The gate and the browser tests |
| `gate` | `contents: read` | Refuses a ref other than `main`. Reads `scripts/update-gitops-digest.sh` from the pushed commit through the API and hands it on |
| `build` | `contents: read`, `packages: write` | Builds and pushes `sha-<commit>` with provenance and an SBOM, runs the smoke script on the pushed digest, scans the digest and fails on a critical vulnerability that has a fix |
| `promote` | none; environment `live` | Mints a GitHub App token for `hannosirkel/deploys` alone, checks out only that repository, runs the guard, runs `lunar-base/tests/manifests.sh`, schema-checks the rendered overlay with a checksum-pinned `kubeconform -strict`, pushes one commit that changes one file, and revokes the token, also after a failure. The token is asked for with `contents: write` only |

`scripts/update-gitops-digest.sh <digest> <overlay>` is the guard. It accepts
`sha256:` and 64 lower-case hexadecimal digits, not all zero. The overlay must
be `lunar-base/overlays/live` of a clean Git checkout. The file must hold one
`images:` block with exactly the lines `name`, `newName` and `digest` for
`ghcr.io/plepicgames/lunar-base`, followed by a top-level key. It rewrites the
`digest:` line and nothing else, and changes nothing when the digest is
already there. `test/update-gitops-digest.test.ts` covers each refusal.

The workflow-level `concurrency` group lets one release run at a time. The
promotion job holds no code of this repository except the guard, and the
build job holds no credential for `deploys`.

## Limits and non-goals

| Not built | Why |
| --- | --- |
| Login, accounts, saved profiles | The product brief asks for no login yet |
| Games that survive a server restart | The game log makes it possible later |
| Spectators, chat, rematch button | Not asked for. The engine already takes `startingSeat` for a rematch (R3.2) |
| Timers for human players | Friends at one table. Only disconnects have a limit |
| Phone layout | A Base of tall cards needs room |
| Hidden timing | See [Hidden information](#hidden-information) |
| The all-16-Influences variant | A game uses exactly 8 Influences (Q23) |
