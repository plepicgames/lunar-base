import type { GameState } from "../connection.ts";
import { Result } from "../screens/Result.tsx";
import { PictureTable } from "./PictureTable.tsx";
import { PlainTable } from "./PlainTable.tsx";
import { Help } from "./Help.tsx";
import { Leave } from "./Leave.tsx";

interface TableProps {
  readonly game: GameState;
  readonly onDecide: (decision: string, option: string) => void;
  readonly onLeave: () => void;
  /** The connection is down. Leave game may be confirmed again after it. */
  readonly interrupted?: boolean;
}

/** The picture table, the plain table at `?plain=1`, or the result once the game has one. */
export function Table({ game, onDecide, onLeave, interrupted = false }: TableProps) {
  if (game.view.result !== null)
    return <Result view={game.view} history={game.history ?? game.events} onBack={onLeave} />;
  const plain = new URLSearchParams(window.location.search).get("plain") === "1";
  const Chosen = plain ? PlainTable : PictureTable;
  return (
    <>
      <Chosen
        view={game.view}
        log={game.log}
        history={game.history ?? game.events}
        events={game.events}
        onDecide={onDecide}
      />
      {game.view.you !== null && (
        <Leave onLeave={onLeave} below={!plain} interrupted={interrupted} />
      )}
      <Help />
    </>
  );
}
