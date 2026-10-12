import "./styles/global.css";
import { PROTOCOL_VERSION } from "../protocol/messages.ts";
import { useConnection } from "./connection.ts";
import type { ReportContext } from "./ReportLink.tsx";
import { Shell } from "./Shell.tsx";
import { Lobby } from "./screens/Lobby.tsx";
import { Name } from "./screens/Name.tsx";
import { Waiting } from "./screens/Waiting.tsx";
import { Table } from "./table/Table.tsx";

export function App() {
  const connection = useConnection();
  const { session } = connection;

  if (session === null) {
    return (
      <Shell screen="name">
        {connection.lostGame && (
          <p role="status">
            Your game was lost when the server restarted. Choose a name to play again.
          </p>
        )}
        <Name
          ready={connection.status === "open"}
          error={connection.error}
          onSubmit={(name) => {
            connection.send({ type: "hello", protocol: PROTOCOL_VERSION, name });
          }}
        />
      </Shell>
    );
  }

  const open = connection.lobby?.find((game) => game.humans.includes(session.name));
  let screen;
  let report: ReportContext | undefined;
  if (connection.game !== null) {
    const { game, view } = connection.game;
    // Both are public: every seat gets the game ID and the turn number.
    report = { screen: view.result === null ? "table" : "result", game, turn: view.turn.number };
    screen = (
      <Table
        game={connection.game}
        onDecide={(decision, option) => {
          connection.send({ type: "game.decide", game, decision, option });
        }}
        onLeave={() => {
          connection.send({ type: "game.leave" });
        }}
        interrupted={connection.interruption !== "none"}
      />
    );
  } else if (open !== undefined) {
    screen = (
      <Waiting
        game={open}
        onLeave={() => {
          connection.send({ type: "game.leave" });
        }}
      />
    );
  } else {
    screen = (
      <Lobby
        jev={session.jev}
        games={connection.lobby ?? []}
        error={connection.error}
        onCreate={({ seats, bots, influences, kickstarter, botBrain }) => {
          connection.send({
            type: "lobby.create",
            seats,
            bots,
            ...(botBrain ? { botBrain } : {}),
            influences,
            kickstarter,
          });
        }}
        onJoin={(game) => {
          connection.send({ type: "lobby.join", game });
        }}
      />
    );
  }

  return (
    <Shell
      screen={connection.game !== null ? "table" : open ? "waiting" : "lobby"}
      interruption={connection.interruption}
      gameEnded={connection.game !== null || open !== undefined}
      onStartAgain={connection.reset}
      notice={
        connection.game !== null || open !== undefined ? (connection.error?.message ?? null) : null
      }
      report={report}
    >
      {screen}
    </Shell>
  );
}
