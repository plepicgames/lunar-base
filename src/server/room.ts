import { withFallback, type DecidedBy, type FallbackMaker } from "../bots/fallback.ts";
import type { DecisionMaker } from "../bots/maker.ts";
import {
  applyChoice,
  eventFor,
  viewFor,
  type Choice,
  type GameEvent,
  type GameState,
  type ViewEvent,
} from "../engine/index.ts";
import type { ClientMessage, ErrorCode, GameViewResult } from "../protocol/messages.ts";
import type { LobbyGameRoom } from "./lobby.ts";
import type { GameLog } from "./gamelog.ts";
import type { Session } from "./sessions.ts";
import {
  FINISHED_GAME_TTL_MS,
  MAX_HISTORY_EVENTS,
  MAX_TURNS,
  TAKEOVER_DELAY_MS,
} from "./limits.ts";

export interface RoomOptions {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  /** The one maker of a non-human seat: `withFallback` over its makers. */
  readonly makeMaker: (seat: number) => FallbackMaker;
  /** Always local, regardless of the game's selected bot brain. */
  readonly makeBuiltinMaker: (seat: number) => DecisionMaker;
  readonly botDelayMs?: number;
  readonly takeoverDelayMs?: number;
  readonly onLeave: (session: Session) => void;
  readonly onEmpty: () => void;
  readonly onFinished?: (session: Session) => void;
  readonly log?: (line: string) => void;
  readonly gameLog?: GameLog;
}

export interface Room {
  /** Server-side snapshot for diagnostics; never send this state to a client. */
  getState(): GameState;
  has(session: Session): boolean;
  isSeated(session: Session): boolean;
  isRunning(): boolean;
  onMessage(session: Session, message: ClientMessage): void;
  onBound(session: Session): void;
  onDisconnect(session: Session): void;
  /** The server is stopping: end the timers and bot work and close the game log. */
  stop(): void;
}

/** The caller routes bound sessions here and removes the room on onEmpty. */
export function createRoom(game: LobbyGameRoom, options: RoomOptions): Room {
  let state = options.state;
  let result: GameViewResult | null = state.result;
  let seq = 0;
  let botRequested: string | null = null;
  let disposed = false;
  let activeBot: { id: string; controller: AbortController } | null = null;
  const disconnectTimers = new Map<Session, ReturnType<typeof setTimeout>>();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const log = options.log ?? console.log;
  const delaySetting = options.botDelayMs ?? Number(process.env.LUNAR_BOT_DELAY_MS ?? 700);
  const delay = Number.isFinite(delaySetting) && delaySetting >= 0 ? delaySetting : 700;
  const takeoverSetting = options.takeoverDelayMs ?? TAKEOVER_DELAY_MS;
  const takeoverDelayMs =
    Number.isFinite(takeoverSetting) && takeoverSetting >= 0 ? takeoverSetting : TAKEOVER_DELAY_MS;
  const seats = game.seats.map((seat) => {
    if (!seat) throw new Error("Cannot start a room with an empty seat");
    return seat;
  });
  const members = new Map<Session, number | null>();
  seats.forEach((seat, index) => {
    if (seat.session) members.set(seat.session, index);
  });
  if (game.creatorSeat === null) members.set(game.creator, null);
  const makers = seats.map((seat, index) =>
    seat.kind === "bot" ? options.makeMaker(index) : null,
  );
  // The final slot belongs to the public audience; no history contains raw events.
  const histories: ViewEvent[][] = Array.from({ length: seats.length + 1 }, () => []);
  const audienceIndex = (seat: number | null) => seat ?? seats.length;
  const queue: (() => void)[] = [];
  let draining = false;

  function enqueue(work: () => void): void {
    queue.push(work);
    if (draining) return;
    draining = true;
    try {
      let next;
      while ((next = queue.shift())) next();
    } finally {
      draining = false;
    }
  }

  function fail(session: Session, code: ErrorCode): void {
    session.send({ type: "error", code, message: code.replaceAll("_", " ") });
  }

  function broadcast(events: readonly GameEvent[] = [], resumed?: Session): void {
    const projected = histories.map((history, index) => {
      const seat = index === seats.length ? null : index;
      const recent = events.map((event) => eventFor(event, seat)).filter((event) => event !== null);
      history.push(...recent);
      if (history.length > MAX_HISTORY_EVENTS)
        history.splice(0, history.length - MAX_HISTORY_EVENTS);
      return recent;
    });
    seq++;
    for (const [session, seat] of members) {
      const view = viewFor(state, seat);
      session.send({
        type: "game.update",
        game: game.id,
        seq,
        view: {
          ...view,
          result,
          pending: result ? null : view.pending,
          players: view.players.map((player, index) => ({
            ...player,
            name: seats[index].name,
            kind: seats[index].kind,
            connected:
              seats[index].kind === "bot" ||
              !!(seats[index].session?.connection && members.has(seats[index].session)),
          })),
        },
        events:
          session === resumed ? histories[audienceIndex(seat)] : projected[audienceIndex(seat)],
      });
    }
  }

  function clearDisconnect(session: Session): void {
    clearTimeout(disconnectTimers.get(session));
    disconnectTimers.delete(session);
  }

  function stopAutomation(): void {
    for (const session of disconnectTimers.keys()) clearDisconnect(session);
    activeBot?.controller.abort();
    activeBot = null;
  }

  function finish(): void {
    stopAutomation();
    if (expiryTimer) return;
    expiryTimer = setTimeout(() => {
      enqueue(() => {
        if (disposed) return;
        disposed = true;
        for (const session of members.keys()) options.onLeave(session);
        members.clear();
        options.gameLog?.close();
        options.onEmpty();
      });
    }, FINISHED_GAME_TTL_MS);
    expiryTimer.unref();
    for (const session of members.keys()) options.onFinished?.(session);
  }

  function useBuiltin(seat: number): void {
    const builtin = options.makeBuiltinMaker(seat);
    makers[seat] = withFallback(builtin, builtin);
  }

  function waitForAbsent(session: Session): void {
    const seat = members.get(session);
    if (result || disposed || seat === null || seat === undefined || disconnectTimers.has(session))
      return;
    const remaining = Math.max(
      0,
      takeoverDelayMs - (Date.now() - (session.disconnectedAt ?? Date.now())),
    );
    const timer = setTimeout(() => {
      enqueue(() => {
        disconnectTimers.delete(session);
        if (disposed || result || session.connection || !members.has(session)) return;
        useBuiltin(seat);
        // The grace period has already paced this decision.
        if (state.pending?.seat === seat) askBot(true);
      });
    }, remaining);
    timer.unref();
    disconnectTimers.set(session, timer);
  }

  function end(reason: "turn_limit" | "engine_error"): void {
    result = { reason, winners: [], scores: seats.map(() => 0) };
    finish();
  }

  function checkLimit(): void {
    if (!result && state.turn.number > MAX_TURNS) end("turn_limit");
  }

  function choose(choice: Choice, by: DecidedBy | "human", session?: Session): void {
    const reject = (code: ErrorCode) => {
      if (session) fail(session, code);
      else log(`game=${game.id} seat=${String(choice.seat)} bot=${code}`);
    };
    if (result || !state.pending || state.pending.id !== choice.decision) {
      reject("stale_decision");
      return;
    }
    const kind = state.pending.kind;
    let applied;
    try {
      applied = applyChoice(state, choice);
    } catch {
      end("engine_error");
      // Never log the thrown payload: it may contain private state or credentials.
      log(`game=${game.id} seat=${String(choice.seat)} decision=${kind} engine_error`);
      if (options.gameLog) log(`game=${game.id} engine_error log=${options.gameLog.path}`);
      broadcast();
      return;
    }
    if (!applied.ok) {
      const codes = {
        stale_decision: "stale_decision",
        wrong_seat: "not_your_decision",
        unknown_option: "bad_option",
      } as const;
      reject(codes[applied.error.code]);
      return;
    }
    state = applied.state;
    result = state.result;
    options.gameLog?.choice(choice, by);
    log(`game=${game.id} seat=${String(choice.seat)} decision=${kind} by=${by}`);
    checkLimit();
    if (result) finish();
    broadcast(applied.events);
    askBot();
  }

  function askBot(graceExpired = false): void {
    const pending = state.pending;
    if (disposed || result || !pending || botRequested === pending.id) return;
    const maker = makers[pending.seat];
    if (!maker) return;
    botRequested = pending.id;
    const view = viewFor(state, pending.seat);
    if (!view.pending || !("id" in view.pending)) return;
    const request = {
      view,
      decision: view.pending,
      seat: pending.seat,
      events: structuredClone(histories[pending.seat]),
    };
    const controller = new AbortController();
    const { signal } = controller;
    activeBot = { id: pending.id, controller };
    // Start the pacing timer with the request, including for immediately resolved makers.
    // It runs beside the decision's budget: a slow answer is not delayed again.
    const pause = graceExpired
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, delay);
          timer.unref();
          signal.addEventListener("abort", finish, { once: true });
        });
    const answer = Promise.resolve()
      .then(() => {
        if (signal.aborted) throw new Error("Room stopped");
        return maker.decideBy(request, signal);
      })
      .then(
        (decided) => ({ ok: true as const, ...decided }),
        () => ({ ok: false as const }),
      );
    void Promise.all([answer, pause]).then(([answer]) => {
      enqueue(() => {
        if (disposed || signal.aborted) return;
        activeBot = null;
        if (!answer.ok) {
          log(`game=${game.id} seat=${String(pending.seat)} bot=maker_error`);
          return;
        }
        choose({ seat: pending.seat, decision: pending.id, option: answer.option }, answer.by);
      });
    });
  }

  const room: Room = {
    getState: () => state,
    has: (session) => members.has(session),
    isSeated: (session) => members.get(session) != null,
    isRunning: () => !result && !disposed,
    onMessage(session, message) {
      enqueue(() => {
        if (disposed || !members.has(session)) return;
        switch (message.type) {
          case "game.decide": {
            if (message.game !== game.id) {
              fail(session, "game_not_found");
              return;
            }
            const seat = members.get(session);
            if (seat === null || seat === undefined || activeBot?.id === message.decision) {
              fail(session, "not_your_decision");
              return;
            }
            choose({ seat, decision: message.decision, option: message.option }, "human", session);
            break;
          }
          case "game.leave": {
            const seat = members.get(session);
            clearDisconnect(session);
            if (!result && seat !== null && seat !== undefined) {
              seats[seat] = { kind: "bot", name: seats[seat].name };
              useBuiltin(seat);
            }
            members.delete(session);
            options.onLeave(session);
            if (members.size === 0) {
              disposed = true;
              stopAutomation();
              clearTimeout(expiryTimer);
              options.gameLog?.close();
              options.onEmpty();
            } else {
              broadcast();
              askBot();
            }
            break;
          }
          case "lobby.create":
          case "lobby.join":
            fail(session, "not_in_lobby");
            break;
          case "hello":
            fail(session, "bad_message");
            break;
        }
      });
    },
    onBound(session) {
      enqueue(() => {
        if (disposed || !members.has(session)) return;
        clearDisconnect(session);
        const seat = members.get(session);
        if (seat !== null && seat !== undefined && seats[seat].kind === "human")
          makers[seat] = null;
        broadcast([], session);
      });
    },
    onDisconnect(session) {
      enqueue(() => {
        if (disposed || !members.has(session)) return;
        waitForAbsent(session);
        broadcast();
      });
    },
    stop() {
      if (disposed) return;
      disposed = true;
      stopAutomation();
      clearTimeout(expiryTimer);
      options.gameLog?.close();
    },
  };
  enqueue(() => {
    checkLimit();
    if (result) finish();
    broadcast(options.events);
    for (const session of members.keys()) if (!session.connection) waitForAbsent(session);
    askBot();
  });
  return room;
}
