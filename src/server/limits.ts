/** One source for the server limits in the Lobby and Reconnect contracts. */
export const MAX_GAMES = 20;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_HISTORY_EVENTS = 200;
export const MAX_TURNS = 300;
export const TAKEOVER_DELAY_MS = 60_000;
export const PING_INTERVAL_MS = 15_000;
export const FINISHED_GAME_TTL_MS = 10 * 60_000;
export const IDLE_SESSION_TTL_MS = 30 * 60_000;
