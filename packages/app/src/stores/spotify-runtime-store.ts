import { create } from "zustand";

type SpotifyRuntimeState = {
  managedByServer: Record<string, boolean>;
  terminalIdsByServer: Record<
    string,
    { mainTerminalId: string | null; probeTerminalId: string | null }
  >;
  setManaged: (input: { serverId: string; managed: boolean }) => void;
  setTerminalIds: (input: {
    serverId: string;
    mainTerminalId: string | null;
    probeTerminalId: string | null;
  }) => void;
};

export const useSpotifyRuntimeStore = create<SpotifyRuntimeState>((set) => ({
  managedByServer: {},
  terminalIdsByServer: {},
  setManaged: ({ serverId, managed }) => {
    set((state) => ({
      managedByServer: {
        ...state.managedByServer,
        [serverId]: managed,
      },
    }));
  },
  setTerminalIds: ({ serverId, mainTerminalId, probeTerminalId }) => {
    set((state) => ({
      terminalIdsByServer: {
        ...state.terminalIdsByServer,
        [serverId]: { mainTerminalId, probeTerminalId },
      },
    }));
  },
}));
