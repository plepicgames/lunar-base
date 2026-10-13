// The table as pictures (architecture, Screens): opponents strip, Supply with
// the Deck and Discard counts, the Base area, the log, the decision bar, your
// hand and your counters. It draws `view` and holds no rules. The elements are
// in tab order, the grid places them: decision, hand, Base, Supply, opponents,
// log.

import type { GameView } from "../../protocol/messages.ts";
import { useId, useRef, useState } from "react";
import { Card, DECK_BACK } from "../cards/Card.tsx";
import { supplyInfluenceText } from "../cards.ts";
import { ZoomCard } from "../cards/Zoom.tsx";
import { useModalFocus } from "../cards/modal-focus.ts";
import { BaseView } from "./BaseView.tsx";
import { BUILD, BuildBar, useBuild, type Build } from "./build/Build.tsx";
import { cardOptions, optionCard, strandedOptions, yourDecision } from "./card-options.ts";
import { Counters } from "./Counters.tsx";
import {
  ChoiceDialog,
  DIALOG_KINDS,
  MAIN_ACTION,
  MainActionBoxes,
  boxCards,
} from "./Decisions.tsx";
import { Hand, useCardWidths, type HandAction } from "./Hand.tsx";
import { Log, type LogEvent } from "./Log.tsx";
import { useCardMotion } from "./motion.ts";
import styles from "./PictureTable.module.css";

interface PictureTableProps {
  readonly view: GameView;
  /** One sentence per event, oldest first. */
  readonly log: readonly string[];
  readonly history?: readonly LogEvent[];
  /** The events of the latest update only: they decide which cards move. */
  readonly events?: readonly LogEvent[];
  readonly onDecide: (decision: string, option: string) => void;
}

type Asked = NonNullable<ReturnType<typeof yourDecision>>;
type Option = Asked["options"][number];
function optionSeats(option: Option): readonly number[] {
  return Array.isArray(option.seats) ? (option.seats as number[]) : [];
}

interface DecisionProps extends Pick<PictureTableProps, "view" | "onDecide"> {
  /** Your Build decision, when that is what is pending. */
  readonly build: Build | null;
  readonly selectedStations: ReadonlySet<number>;
}

function Decision({ view, build, onDecide, selectedStations }: DecisionProps) {
  const { pending } = view;
  const yours = yourDecision(view) !== null;
  let body;
  if (pending === null) {
    body = <p role="status">Nothing is pending.</p>;
  } else if ("options" in pending && pending.seat === view.you) {
    // Options that name a card are buttons on the card, not here.
    const stranded = strandedOptions(view);
    // Targets and Modules are buttons on their players and cards; only what
    // those cannot carry comes here.
    const onTable =
      pending.kind === "target" ||
      pending.kind === "steal_module" ||
      pending.kind === "exchange_station";
    const inBar = pending.options.filter((option) =>
      onTable
        ? stranded.has(option.id)
        : optionCard(pending.kind, option) === null || stranded.has(option.id),
    );
    const optionButtons = (
      <ul className={styles.options}>
        {inBar.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className={styles.option}
              onClick={() => {
                onDecide(pending.id, option.id);
              }}
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>
    );
    const dialog = DIALOG_KINDS.has(pending.kind);
    const lead = (
      <>
        You decide: <span data-decision-kind>{pending.kind}</span>
      </>
    );
    body =
      build !== null ? (
        <BuildBar build={build} lead={lead} onDecide={onDecide} />
      ) : (
        <>
          <p>{lead}</p>
          {dialog ? (
            <ChoiceDialog
              view={view}
              pending={pending}
              onDecide={onDecide}
              agentCardId={view.play.at(-1)?.cardId}
            />
          ) : pending.kind === MAIN_ACTION ? (
            <MainActionBoxes view={view} pending={pending} onDecide={onDecide} />
          ) : pending.kind === "target" ||
            pending.kind === "steal_module" ||
            pending.kind === "exchange_station" ? (
            inBar.length === 0 ? null : (
              optionButtons
            )
          ) : pending.kind === "flip" ? (
            <button
              type="button"
              className={styles.option}
              disabled={
                !pending.options.some(
                  (option) =>
                    optionSeats(option).length === selectedStations.size &&
                    optionSeats(option).every((seat) => selectedStations.has(seat)),
                )
              }
              onClick={() => {
                const option = pending.options.find(
                  (candidate) =>
                    optionSeats(candidate).length === selectedStations.size &&
                    optionSeats(candidate).every((seat) => selectedStations.has(seat)),
                );
                if (option) onDecide(pending.id, option.id);
              }}
            >
              Confirm Stations
            </button>
          ) : (
            optionButtons
          )}
        </>
      );
  } else {
    const who = view.players.find((player) => player.seat === pending.seat)?.name;
    body = (
      <p role="status">
        {who ?? `Seat ${String(pending.seat + 1)}`} decides: {pending.kind}
      </p>
    );
  }
  return (
    <section
      aria-label={yours ? "Your decision" : "Decision"}
      className={styles.decision}
      data-kind={pending?.kind}
    >
      {body}
    </section>
  );
}

const NO_EVENTS: readonly LogEvent[] = [];

function DiscardDialog({
  cards,
  onClose,
}: {
  readonly cards: GameView["discard"];
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  useModalFocus(ref);
  return (
    <div className={styles.discardBackdrop}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        className={styles.discardDialog}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 id={title}>Discard pile</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
        <div className={styles.discardCards}>
          {cards.map((card) => (
            <ZoomCard key={card.instance} cardId={card.cardId} width={90} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PublicDiscard({
  cards,
  width,
}: {
  readonly cards: GameView["discard"];
  readonly width: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ZoomCard
        cardId={cards.at(-1)?.cardId ?? DECK_BACK}
        width={width}
        pressLabel="View Discard pile"
        onPress={() => {
          setOpen(true);
        }}
      />
      {open && (
        <DiscardDialog
          cards={cards}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

export function PictureTable({
  view,
  log,
  history = [],
  events = NO_EVENTS,
  onDecide,
}: PictureTableProps) {
  const root = useRef<HTMLElement>(null);
  const widths = useCardWidths();
  useCardMotion(root, events);
  const [focus, setFocus] = useState<{ decision: string | undefined; seat: number | null }>({
    decision: undefined,
    seat: null,
  });
  const [selection, setSelection] = useState<{
    decision: string | undefined;
    seats: ReadonlySet<number>;
  }>({ decision: undefined, seats: new Set() });
  const me = view.players.find((player) => player.seat === view.you);
  const opponents = view.players.filter((player) => player.seat !== view.you);
  const options = cardOptions(view);
  const asked = yourDecision(view);
  const targetOptions =
    asked?.kind === "target"
      ? new Map(
          asked.options
            .filter((option) => typeof option.target === "number")
            .map((option) => [option.target as number, option]),
        )
      : new Map<number, Option>();
  const exchangeOptions =
    asked?.kind === "exchange_station"
      ? new Map(
          asked.options
            .filter((option) => typeof option.target === "number")
            .map((option) => [option.target as number, option]),
        )
      : new Map<number, Option>();
  const flipOptions = asked?.kind === "flip" ? asked.options : [];
  const stationSeats = new Set(flipOptions.flatMap(optionSeats));
  const singleStation =
    flipOptions.length > 0 && flipOptions.every((option) => optionSeats(option).length === 1);
  const twoStations =
    flipOptions.length > 0 && flipOptions.every((option) => optionSeats(option).length === 2);
  const moduleOptions = asked?.kind === "steal_module" ? asked.options : [];
  const candidateSeats = new Set(
    moduleOptions
      .map((option) => option.target)
      .filter((seat): seat is number => typeof seat === "number"),
  );
  const firstCandidate = view.players.find((player) => candidateSeats.has(player.seat))?.seat;
  const selectedStations = selection.decision === asked?.id ? selection.seats : new Set<number>();
  const focusedSeat = focus.decision === asked?.id ? focus.seat : null;
  const effectiveFocus = focusedSeat ?? firstCandidate;
  const shown = view.players.find((player) => player.seat === effectiveFocus) ?? me;
  const highlighted =
    asked?.kind === MAIN_ACTION
      ? boxCards(asked)
      : new Set(
          moduleOptions
            .map((option) => option.card)
            .filter((card): card is string => typeof card === "string"),
        );
  const stationPress = (seat: number) => {
    if (singleStation) {
      const option = flipOptions.find(
        (candidate) => optionSeats(candidate).length === 1 && optionSeats(candidate)[0] === seat,
      );
      if (option && asked) onDecide(asked.id, option.id);
      return;
    }
    setSelection(() => {
      const next = new Set(selectedStations);
      if (next.has(seat)) next.delete(seat);
      else if (!twoStations || next.size < 2) next.add(seat);
      return { decision: asked?.id, seats: next };
    });
  };
  const stationLabel = (seat: number) =>
    singleStation
      ? flipOptions.find(
          (option) => optionSeats(option).length === 1 && optionSeats(option)[0] === seat,
        )?.label
      : `Player ${String(seat + 1)}'s Station`;
  const decide = (card: string) => {
    const option = options.get(card);
    if (option !== undefined) onDecide(option.decision, option.option);
  };
  // A Module is placed on your own Base: picking one brings it back into focus.
  const build = useBuild(view, asked?.kind === BUILD ? asked : null, () => {
    setFocus({ decision: asked?.id, seat: null });
  });
  const handActions =
    build?.modules ??
    new Map(
      [...options].map(([card, { label }]): [string, HandAction] => [
        card,
        {
          label,
          onPress: () => {
            decide(card);
          },
        },
      ]),
    );
  return (
    <section ref={root} aria-label="Table" className={styles.table} data-layout="picture">
      <Decision view={view} build={build} onDecide={onDecide} selectedStations={selectedStations} />
      <div className={styles.mine}>
        <Hand cards={view.hand} actions={handActions} cardWidth={widths.hand} />
        {me === undefined ? null : (
          <Counters
            player={me}
            targets={view.targets}
            label={`${me.name} (you)`}
            influenceCount={
              view.config.influences
                ? view.hand.filter(
                    (card) => card.cardId.startsWith("inf-") || card.cardId.startsWith("ks-inf-"),
                  ).length
                : undefined
            }
          />
        )}
      </div>
      <div className={styles.board}>
        <section aria-label="Base" className={styles.base}>
          {shown === undefined ? null : (
            <>
              <div className={styles.baseHeading}>
                <h3 className={styles.heading}>
                  {shown.seat === view.you ? "Your Base" : `${shown.name}'s Base`}
                </h3>
                {shown.seat !== view.you && (
                  <button
                    type="button"
                    onClick={() => {
                      setFocus({ decision: asked?.id, seat: view.you });
                    }}
                  >
                    Your Base
                  </button>
                )}
              </div>
              <BaseView
                key={JSON.stringify(shown.base)}
                base={shown.base}
                highlighted={
                  shown.seat === view.you || candidateSeats.has(shown.seat)
                    ? highlighted
                    : undefined
                }
                offer={shown.seat === view.you ? build?.offer : undefined}
                lookLabel={
                  shown.seat === view.you
                    ? "Look at the other side of your Station"
                    : `Look at the other side of ${shown.name}'s Station`
                }
                targets={
                  new Map(
                    moduleOptions
                      .filter(
                        (option) => option.target === shown.seat && typeof option.card === "string",
                      )
                      .map((option) => [
                        option.card as string,
                        {
                          label: option.label,
                          onPress: () => {
                            if (asked) onDecide(asked.id, option.id);
                          },
                        },
                      ]),
                  )
                }
              />
            </>
          )}
        </section>
        <section aria-label="Supply" className={styles.supply}>
          {view.supply.map((card) => (
            <div key={card.instance} className={styles.supplyCard}>
              <ZoomCard
                cardId={card.cardId}
                instance={card.instance}
                width={widths.supply}
                actionLabel={options.get(card.instance)?.label}
                onPress={
                  options.has(card.instance)
                    ? () => {
                        decide(card.instance);
                      }
                    : undefined
                }
              />
              {supplyInfluenceText(card.cardId) === null ? null : (
                <p className={styles.influenceEffect}>{supplyInfluenceText(card.cardId)}</p>
              )}
            </div>
          ))}
          <div className={styles.piles}>
            <span data-pile="deck" aria-label={`Deck ${String(view.deck)} cards`}>
              <ZoomCard
                cardId={view.deckTop?.cardId ?? DECK_BACK}
                width={Math.min(56, Math.round(widths.supply * 0.7))}
              />
              <span>Deck {view.deck}</span>
            </span>
            <span data-pile="discard" aria-label={`Discard ${String(view.discardCount)} cards`}>
              {view.discard.length > 0 ? (
                <PublicDiscard
                  cards={view.discard}
                  width={Math.min(56, Math.round(widths.supply * 0.7))}
                />
              ) : (
                <Card cardId={DECK_BACK} width={Math.min(56, Math.round(widths.supply * 0.7))} />
              )}
              <span>Discard {view.discardCount}</span>
            </span>
          </div>
        </section>
        {view.influencesInGame.length > 0 && (
          <section aria-label="Influences in this game" className={styles.influences}>
            <h3 className={styles.heading}>Influences in this game</h3>
            <ul>
              {view.influencesInGame.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <section aria-label="Opponents" className={styles.opponents}>
        {me &&
          (targetOptions.has(me.seat) ||
            stationSeats.has(me.seat) ||
            exchangeOptions.has(me.seat)) && (
            <div className={styles.opponent} data-targeted="">
              <span>{me.name} (you)</span>
              {targetOptions.has(me.seat) && (
                <button
                  type="button"
                  className={styles.option}
                  onClick={() => {
                    const option = targetOptions.get(me.seat);
                    if (asked && option) onDecide(asked.id, option.id);
                  }}
                >
                  {targetOptions.get(me.seat)?.label}
                </button>
              )}
              {stationSeats.has(me.seat) && (
                <button
                  type="button"
                  className={styles.option}
                  aria-pressed={selectedStations.has(me.seat)}
                  onClick={() => {
                    stationPress(me.seat);
                  }}
                >
                  {stationLabel(me.seat)}
                </button>
              )}
              {exchangeOptions.has(me.seat) && (
                <button
                  type="button"
                  className={styles.option}
                  onClick={() => {
                    const option = exchangeOptions.get(me.seat);
                    if (asked && option) onDecide(asked.id, option.id);
                  }}
                >
                  {exchangeOptions.get(me.seat)?.label}
                </button>
              )}
            </div>
          )}
        {opponents.map((player) => (
          <div
            key={player.seat}
            className={styles.opponent}
            data-targeted={
              targetOptions.has(player.seat) ||
              candidateSeats.has(player.seat) ||
              stationSeats.has(player.seat) ||
              exchangeOptions.has(player.seat)
                ? ""
                : undefined
            }
          >
            <Counters player={player} targets={view.targets} />
            {targetOptions.has(player.seat) && (
              <button
                type="button"
                className={styles.option}
                onClick={() => {
                  const option = targetOptions.get(player.seat);
                  if (asked && option) onDecide(asked.id, option.id);
                }}
              >
                {targetOptions.get(player.seat)?.label}
              </button>
            )}
            {stationSeats.has(player.seat) && (
              <button
                type="button"
                className={styles.option}
                aria-pressed={selectedStations.has(player.seat)}
                onClick={() => {
                  stationPress(player.seat);
                }}
              >
                {stationLabel(player.seat)}
              </button>
            )}
            {exchangeOptions.has(player.seat) && (
              <button
                type="button"
                className={styles.option}
                onClick={() => {
                  const option = exchangeOptions.get(player.seat);
                  if (asked && option) onDecide(asked.id, option.id);
                }}
              >
                {exchangeOptions.get(player.seat)?.label}
              </button>
            )}
            <button
              type="button"
              className={styles.preview}
              aria-label={`View ${player.name}'s Base`}
              onClick={() => {
                setFocus({ decision: asked?.id, seat: player.seat });
              }}
            >
              <BaseView base={player.base} small />
            </button>
          </div>
        ))}
      </section>
      <Log lines={log} events={history} players={view.players} />
    </section>
  );
}
