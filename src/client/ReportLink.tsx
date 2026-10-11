import { BUILD, reportUrl, type ReportFacts } from "./report.ts";
import styles from "./ReportLink.module.css";

export type ReportContext = Pick<ReportFacts, "screen" | "game" | "turn">;

/** Opens the pre-filled problem-report form in a new tab, with the build version beside it. */
export function ReportLink({ screen, game, turn }: ReportContext) {
  const href = reportUrl({ screen, game, turn, build: BUILD, userAgent: navigator.userAgent });
  return (
    <p className={styles.report}>
      <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
        Report a problem
      </a>
      <span className={styles.build} data-build={BUILD}>
        Version {BUILD}
      </span>
    </p>
  );
}
