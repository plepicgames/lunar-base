import type { GameState } from "../connection.ts";
import { Result } from "../screens/Result.tsx";
import { PictureTable } from "./PictureTable.tsx";
import { PlainTable } from "./PlainTable.tsx";
import { Help } from "./Help.tsx";

interface TableProps {
  readonly game: GameState;
  readonly onDecide: (decision: string, option: string) => void;
  readonly onLeave: () => void;
}

/** The picture table, the plain table at `?plain=1`, or the result once the game has one. */
export function Table({ game, onDecide, onLeave }: TableProps) {
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
      <Help />
    </>
  );
}
