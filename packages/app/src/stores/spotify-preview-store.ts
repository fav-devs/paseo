import { create } from "zustand";

export type SpotifyPreviewState = {
  title: string;
  artist: string;
  albumImageUrl: string | null;
  isPlaying: boolean;
  updatedAt: number;
};

type SpotifyPreviewStoreState = {
  previewByWorkspace: Record<string, SpotifyPreviewState>;
  setPreview: (input: {
    serverId: string;
    workspaceRoot: string;
    preview: Omit<SpotifyPreviewState, "updatedAt">;
  }) => void;
  clearPreview: (input: { serverId: string; workspaceRoot: string }) => void;
};

export function buildSpotifyPreviewWorkspaceKey(input: {
  serverId: string;
  workspaceRoot: string;
}): string {
  return `${input.serverId}:${input.workspaceRoot}`;
}

export const useSpotifyPreviewStore = create<SpotifyPreviewStoreState>((set) => ({
  previewByWorkspace: {},
  setPreview: ({ serverId, workspaceRoot, preview }) => {
    const key = buildSpotifyPreviewWorkspaceKey({ serverId, workspaceRoot });
    set((state) => ({
      previewByWorkspace: {
        ...state.previewByWorkspace,
        [key]: {
          ...preview,
          updatedAt: Date.now(),
        },
      },
    }));
  },
  clearPreview: ({ serverId, workspaceRoot }) => {
    const key = buildSpotifyPreviewWorkspaceKey({ serverId, workspaceRoot });
    set((state) => {
      if (!(key in state.previewByWorkspace)) {
        return state;
      }
      const next = { ...state.previewByWorkspace };
      delete next[key];
      return { previewByWorkspace: next };
    });
  },
}));
