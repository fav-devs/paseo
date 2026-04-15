export type SpotifyCliAction =
  | "playPause"
  | "previous"
  | "next"
  | "shuffle"
  | "repeat"
  | "queue"
  | "devices"
  | "details"
  | "volumeDown"
  | "volumeUp";

export const SPOTIFY_TERMINAL_NAME = "spotify-player";
export const SPOTIFY_PROBE_TERMINAL_NAME = "spotify-player-probe";
export const SPOTIFY_PLAYBACK_PROBE_COMMAND = "spotify_player get key playback 2>/dev/null || true";
export const SPOTIFY_DEVICES_PROBE_COMMAND = "spotify_player get key devices 2>/dev/null || true";

export const SPOTIFY_LAUNCH_COMMAND = [
  "clear",
  "if command -v spotify_player >/dev/null 2>&1; then",
  "  spotify_player",
  "elif [ -f inspo/spotify-player/Cargo.toml ]; then",
  "  cargo run --manifest-path inspo/spotify-player/Cargo.toml --bin spotify_player",
  "else",
  '  echo "spotify_player was not found in PATH and inspo/spotify-player/Cargo.toml is missing relative to this workspace."',
  '  echo "Install spotify_player globally or open the Paseo repo root to launch the local inspiration build."',
  "fi",
].join("\n");

export const SPOTIFY_ACTION_KEYMAP: Record<SpotifyCliAction, string> = {
  playPause: " ",
  previous: "p",
  next: "n",
  shuffle: "\u0013", // Ctrl+S
  repeat: "\u0012", // Ctrl+R
  queue: "z",
  devices: "D",
  details: "g ",
  volumeDown: "-",
  volumeUp: "+",
};
