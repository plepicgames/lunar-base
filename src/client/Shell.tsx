import type { ReactNode } from "react";

interface ShellProps {
  readonly screen: "name" | "lobby" | "waiting" | "table";
  readonly children: ReactNode;
  readonly interruption?: "none" | "reconnecting" | "other-tab";
  readonly notice?: string | null;
}

export function Shell({ screen, children, interruption = "none", notice = null }: ShellProps) {
  const isTable = screen === "table";
  const locked = interruption !== "none";
  return (
    <div className={`shell ${isTable ? "table" : "hero"}`}>
      {!isTable && (
        <header className={`header ${screen === "name" ? "" : "headerCompact"}`}>
          <img className="logo" src="/brand/lunar-base-logo-color.png" alt="Lunar Base" />
        </header>
      )}
      <main className="main">
        <fieldset className="screenLock" disabled={locked} inert={locked}>
          {children}
        </fieldset>
      </main>
      {locked && (
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
        <img src="/brand/plepic-games-wordmark.svg" alt="Plepic Games" width="160" />
      </footer>
    </div>
  );
}
