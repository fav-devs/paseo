import type { TerminalState } from "@server/shared/messages";

export type ParsedSpotifyTerminalState = {
  title: string | null;
  artist: string | null;
  isPlaying: boolean | null;
  isLiked: boolean | null;
  repeatMode: "off" | "context" | "track" | null;
  shuffleEnabled: boolean | null;
  elapsedMs: number | null;
  durationMs: number | null;
  volumePercent: number | null;
  deviceName: string | null;
  noPlayback: boolean;
};

export type ParsedSpotifyPlaybackProbe = {
  title: string | null;
  artist: string | null;
  albumImageUrl: string | null;
  isPlaying: boolean | null;
  repeatMode: "off" | "context" | "track" | null;
  shuffleEnabled: boolean | null;
  elapsedMs: number | null;
  durationMs: number | null;
  deviceId: string | null;
  deviceName: string | null;
  noPlayback: boolean;
};

export type ParsedSpotifyDevice = {
  id: string;
  name: string;
  type: string | null;
  isActive: boolean;
};

const BOX_CHARS_REGEX = /[│┌┐└┘├┤┬┴┼─╭╮╰╯]/g;
const TIME_PAIR_REGEX = /(\d{1,2}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,2}:\d{2}(?::\d{2})?)/;
const TRACK_LINE_REGEX = /^(?:(▶|▌▌)\s+)?(.+?)\s+•\s+(.+?)(?:\s+♥)?$/;

export function parseSpotifyTerminalSnapshot(state: TerminalState): ParsedSpotifyTerminalState {
  const lines = snapshotToCleanLines(state);
  return parseSpotifyTerminalLines(lines);
}

export function parseSpotifyTerminalLines(lines: string[]): ParsedSpotifyTerminalState {
  const parsed: ParsedSpotifyTerminalState = {
    title: null,
    artist: null,
    isPlaying: null,
    isLiked: null,
    repeatMode: null,
    shuffleEnabled: null,
    elapsedMs: null,
    durationMs: null,
    volumePercent: null,
    deviceName: null,
    noPlayback: false,
  };

  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (normalized.length === 0) {
      continue;
    }

    if (normalized.toLowerCase().includes("no playback found")) {
      parsed.noPlayback = true;
    }

    if (
      parsed.title === null &&
      normalized.includes("•") &&
      !normalized.includes("repeat:") &&
      !normalized.includes("shuffle:") &&
      !normalized.includes("volume:") &&
      !normalized.includes("device:")
    ) {
      const match = normalized.match(TRACK_LINE_REGEX);
      if (match) {
        const statusIcon = match[1] ?? null;
        parsed.title = match[2]?.trim() ?? null;
        parsed.artist = match[3]?.trim() ?? null;
        parsed.isLiked = normalized.includes("♥");
        if (statusIcon === "▶") {
          parsed.isPlaying = true;
        } else if (statusIcon === "▌▌") {
          parsed.isPlaying = false;
        }
      }
    }

    if (parsed.elapsedMs === null || parsed.durationMs === null) {
      const timePair = normalized.match(TIME_PAIR_REGEX);
      if (timePair) {
        parsed.elapsedMs = parseDurationToMs(timePair[1]);
        parsed.durationMs = parseDurationToMs(timePair[2]);
      }
    }

    if (normalized.includes("repeat:")) {
      const repeatMatch = normalized.match(/repeat:\s*(off|context|track)/i);
      if (repeatMatch?.[1]) {
        const value = repeatMatch[1].toLowerCase();
        if (value === "off" || value === "context" || value === "track") {
          parsed.repeatMode = value;
        }
      }
    }

    if (normalized.includes("shuffle:")) {
      const shuffleMatch = normalized.match(/shuffle:\s*(true|false)/i);
      if (shuffleMatch?.[1]) {
        parsed.shuffleEnabled = shuffleMatch[1].toLowerCase() === "true";
      }
    }

    if (normalized.includes("volume:")) {
      const volumeMatch = normalized.match(/volume:\s*(\d{1,3})%/i);
      if (volumeMatch?.[1]) {
        const volume = Number.parseInt(volumeMatch[1], 10);
        if (Number.isFinite(volume)) {
          parsed.volumePercent = volume;
        }
      }
    }

    if (normalized.includes("device:")) {
      const deviceMatch = normalized.match(/device:\s*(.+?)(?:\s+\|\s+|$)/i);
      if (deviceMatch?.[1]) {
        parsed.deviceName = deviceMatch[1].trim();
      }
    }
  }

  return parsed;
}

export function parseSpotifyPlaybackProbeFromCapture(
  lines: string[],
): ParsedSpotifyPlaybackProbe | null {
  const json = extractLastJsonValue(lines);
  if (json === undefined) {
    return null;
  }
  if (json === null || typeof json !== "object") {
    return {
      title: null,
      artist: null,
      albumImageUrl: null,
      isPlaying: null,
      repeatMode: null,
      shuffleEnabled: null,
      elapsedMs: null,
      durationMs: null,
      deviceId: null,
      deviceName: null,
      noPlayback: true,
    };
  }

  const playback = json as Record<string, unknown>;
  const item = extractPlayableItem(playback["item"]);
  const artists = extractArtistNames(item);
  const repeatMode = extractRepeatMode(playback["repeat_state"]);

  return {
    title: typeof item?.name === "string" ? item.name : null,
    artist: artists.length > 0 ? artists.join(", ") : null,
    albumImageUrl: extractAlbumImageUrl(item),
    isPlaying: typeof playback["is_playing"] === "boolean" ? playback["is_playing"] : null,
    repeatMode,
    shuffleEnabled:
      typeof playback["shuffle_state"] === "boolean" ? playback["shuffle_state"] : null,
    elapsedMs: parseDurationLikeToMs(playback["progress"]),
    durationMs: parseDurationLikeToMs(item?.duration ?? null),
    deviceId:
      typeof (playback["device"] as Record<string, unknown> | undefined)?.["id"] === "string"
        ? ((playback["device"] as Record<string, unknown>)["id"] as string)
        : null,
    deviceName:
      typeof (playback["device"] as Record<string, unknown> | undefined)?.["name"] === "string"
        ? ((playback["device"] as Record<string, unknown>)["name"] as string)
        : null,
    noPlayback: false,
  };
}

export function parseSpotifyDevicesProbeFromCapture(lines: string[]): ParsedSpotifyDevice[] | null {
  const json = extractLastJsonValue(lines);
  if (json === undefined) {
    return null;
  }
  if (!Array.isArray(json)) {
    return [];
  }

  const devices: ParsedSpotifyDevice[] = [];
  for (const entry of json) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const value = entry as Record<string, unknown>;
    const id = typeof value["id"] === "string" ? value["id"] : null;
    const name = typeof value["name"] === "string" ? value["name"] : null;
    if (!id || !name) {
      continue;
    }
    devices.push({
      id,
      name,
      type: typeof value["type"] === "string" ? value["type"] : null,
      isActive: Boolean(value["is_active"]),
    });
  }

  return devices;
}

function snapshotToCleanLines(state: TerminalState): string[] {
  const rows = [...state.scrollback, ...state.grid];
  return rows
    .map((row) => row.map((cell) => cell?.char ?? " ").join(""))
    .map((row) => row.replace(/\s+$/g, ""))
    .filter((row) => row.trim().length > 0);
}

function normalizeLine(line: string): string {
  return line.replace(BOX_CHARS_REGEX, " ").replace(/\s+/g, " ").trim();
}

function parseDurationToMs(input: string): number {
  const parts = input.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  if (parts.length === 3) {
    return (parts[0] * 60 * 60 + parts[1] * 60 + parts[2]) * 1000;
  }
  return 0;
}

function extractLastJsonValue(lines: string[]): unknown | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    if (!(line.startsWith("{") || line.startsWith("[") || line === "null")) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch {
      // keep scanning older lines
    }
  }
  return undefined;
}

function parseDurationLikeToMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const durationLike = value as Record<string, unknown>;
  const secs = durationLike["secs"];
  const nanos = durationLike["nanos"];
  if (typeof secs === "number" && Number.isFinite(secs)) {
    const millisFromSeconds = secs * 1000;
    const millisFromNanos =
      typeof nanos === "number" && Number.isFinite(nanos) ? nanos / 1_000_000 : 0;
    return Math.max(0, Math.round(millisFromSeconds + millisFromNanos));
  }
  return null;
}

function extractPlayableItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const item = value as Record<string, unknown>;

  if ("Track" in item && item["Track"] && typeof item["Track"] === "object") {
    return item["Track"] as Record<string, unknown>;
  }
  if ("Episode" in item && item["Episode"] && typeof item["Episode"] === "object") {
    return item["Episode"] as Record<string, unknown>;
  }
  return item;
}

function extractArtistNames(item: Record<string, unknown> | null): string[] {
  if (!item) {
    return [];
  }
  const artists = item["artists"];
  if (Array.isArray(artists)) {
    return artists
      .map((artist) =>
        artist &&
        typeof artist === "object" &&
        typeof (artist as Record<string, unknown>)["name"] === "string"
          ? ((artist as Record<string, unknown>)["name"] as string)
          : null,
      )
      .filter((name): name is string => Boolean(name));
  }
  const show = item["show"];
  if (show && typeof show === "object") {
    const publisher = (show as Record<string, unknown>)["publisher"];
    if (typeof publisher === "string" && publisher.length > 0) {
      return [publisher];
    }
  }
  return [];
}

function extractAlbumImageUrl(item: Record<string, unknown> | null): string | null {
  if (!item) {
    return null;
  }
  const album = item["album"];
  if (album && typeof album === "object") {
    const images = (album as Record<string, unknown>)["images"];
    const url = firstImageUrl(images);
    if (url) {
      return url;
    }
  }
  const show = item["show"];
  if (show && typeof show === "object") {
    const images = (show as Record<string, unknown>)["images"];
    return firstImageUrl(images);
  }
  return null;
}

function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }
  for (const image of images) {
    if (!image || typeof image !== "object") {
      continue;
    }
    const url = (image as Record<string, unknown>)["url"];
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  }
  return null;
}

function extractRepeatMode(value: unknown): "off" | "context" | "track" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized === "off" || normalized === "context" || normalized === "track") {
    return normalized;
  }
  return null;
}
