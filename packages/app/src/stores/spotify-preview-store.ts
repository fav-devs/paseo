import { create } from "zustand";

export type SpotifyPreviewState = {
  title: string;
  artist: string;
  albumImageUrl: string | null;
  isPlaying: boolean;
  updatedAt: number;
};

type SpotifyPreviewStoreState = {
  previewByServer: Record<string, SpotifyPreviewState>;
  setPreview: (input: {
    serverId: string;
    preview: Omit<SpotifyPreviewState, "updatedAt">;
  }) => void;
  clearPreview: (input: { serverId: string }) => void;
};

export function buildSpotifyPreviewServerKey(input: { serverId: string }): string {
  return input.serverId;
}

export const useSpotifyPreviewStore = create<SpotifyPreviewStoreState>((set) => ({
  previewByServer: {},
  setPreview: ({ serverId, preview }) => {
    const key = buildSpotifyPreviewServerKey({ serverId });
    set((state) => ({
      previewByServer: {
        ...state.previewByServer,
        [key]: {
          ...preview,
          updatedAt: Date.now(),
        },
      },
    }));
  },
  clearPreview: ({ serverId }) => {
    const key = buildSpotifyPreviewServerKey({ serverId });
    set((state) => {
      if (!(key in state.previewByServer)) {
        return state;
      }
      const next = { ...state.previewByServer };
      delete next[key];
      return { previewByServer: next };
    });
  },
}));
