import type { ReactNode } from "react";
import { assetUrl } from "./base.ts";
import { ReportLink, type ReportContext } from "./ReportLink.tsx";

interface ShellProps {
  readonly screen: "name" | "lobby" | "waiting" | "table";
  readonly children: ReactNode;
  readonly interruption?: "none" | "reconnecting" | "other-tab" | "restarted";
  /** With `restarted`: whether the player was in a game, open or started. */
  readonly gameEnded?: boolean;
  /** With `restarted`: forget the session and connect afresh. */
  readonly onStartAgain?: () => void;
  readonly notice?: string | null;
  /** What a problem report says about the game. Outside a game the screen is enough. */
  readonly report?: ReportContext;
}

export function Shell({
  screen,
  children,
  interruption = "none",
  gameEnded = false,
  onStartAgain,
  notice = null,
  report = { screen },
}: ShellProps) {
  const isTable = screen === "table";
  const locked = interruption !== "none";
  return (
    <div className={`shell ${isTable ? "table" : "hero"}`}>
      {!isTable && (
        <header className={`header ${screen === "name" ? "" : "headerCompact"}`}>
          <img
            className="logo"
            src={assetUrl("brand/lunar-base-logo-color.png")}
            alt="Lunar Base"
          />
        </header>
      )}
      <main className="main">
        <fieldset className="screenLock" disabled={locked} inert={locked}>
          {children}
        </fieldset>
      </main>
      {interruption === "restarted" && (
        <div className="restartNotice" role="alert">
          <p>
            The server restarted.{gameEnded ? " This game has ended." : ""} Start a new game from
            the lobby.
          </p>
          <button type="button" autoFocus onClick={onStartAgain}>
            Start again
          </button>
        </div>
      )}
      {locked && interruption !== "restarted" && (
        <div className="connectionBanner" role="status">
          {interruption === "other-tab" ? "This game is open in another tab" : "Reconnecting"}
        </div>
      )}
      {!locked && notice !== null && (
        <p className="serverNotice" role="alert">
          {notice}
        </p>
      )}
      <footer className="footer">
        <img src={assetUrl("brand/plepic-games-wordmark.svg")} alt="Plepic Games" width="160" />
        <ReportLink {...report} />
      </footer>
    </div>
  );
}
