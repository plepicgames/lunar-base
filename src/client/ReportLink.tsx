import { BUILD, reportUrl, type ReportFacts } from "./report.ts";
import styles from "./ReportLink.module.css";

export type ReportContext = Pick<ReportFacts, "screen" | "game" | "turn">;

/** Opens a pre-filled issue form in a new tab: a problem or an idea. The build version is beside them. */
export function ReportLink({ screen, game, turn }: ReportContext) {
  const facts = { screen, game, turn, build: BUILD, userAgent: navigator.userAgent };
  return (
    <p className={styles.report}>
      <a
        className={styles.link}
        href={reportUrl(facts, "problem")}
        target="_blank"
        rel="noopener noreferrer"
      >
        Report a problem
      </a>
      <a
        className={styles.link}
        href={reportUrl(facts, "idea")}
        target="_blank"
        rel="noopener noreferrer"
      >
        Suggest a change
      </a>
      <span className={styles.build} data-build={BUILD}>
        Version {BUILD}
      </span>
    </p>
  );
}
