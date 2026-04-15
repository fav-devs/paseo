import { useCallback, useState } from "react";
import * as Updates from "expo-updates";
import { UpdateCheckResultNotAvailableReason } from "expo-updates";
import { isNative } from "@/constants/platform";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function describeNoUpdateReason(reason: UpdateCheckResultNotAvailableReason): string {
  switch (reason) {
    case UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER:
      return "No compatible update on the server for this install.";
    case UpdateCheckResultNotAvailableReason.UPDATE_REJECTED_BY_SELECTION_POLICY:
      return "An update exists but was not selected (runtime version / channel mismatch — see Expo OTA docs).";
    case UpdateCheckResultNotAvailableReason.UPDATE_PREVIOUSLY_FAILED:
      return "A newer update failed to launch previously; OTA may block it until resolved.";
    case UpdateCheckResultNotAvailableReason.ROLLBACK_REJECTED_BY_SELECTION_POLICY:
      return "Rollback update was not applied due to selection policy.";
    case UpdateCheckResultNotAvailableReason.ROLLBACK_NO_EMBEDDED:
      return "Rollback requested but this build has no embedded fallback bundle.";
    default:
      return `No update applied (${reason}).`;
  }
}

export interface UseExpoOtaUpdaterReturn {
  /** Show the Expo OTA section only on iOS/Android (not web or desktop shell). */
  showUi: boolean;
  /** OTA APIs usable in this binary (release-style build with updates enabled). */
  isOtaEnabled: boolean;
  statusLabel: string;
  infoMessage: string | null;
  errorMessage: string | null;
  isBusy: boolean;
  canReload: boolean;
  channelLabel: string | null;
  runtimeVersionLabel: string | null;
  currentUpdateId: string | null;
  checkAndDownload: () => Promise<void>;
  applyReload: () => Promise<void>;
}

export function useExpoOtaUpdater(): UseExpoOtaUpdaterReturn {
  const showUi = isNative;
  const isOtaEnabled = Updates.isEnabled;

  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [canReload, setCanReload] = useState(false);

  const channelLabel = isOtaEnabled ? Updates.channel : null;
  const runtimeVersionLabel = isOtaEnabled ? Updates.runtimeVersion : null;
  const currentUpdateId = isOtaEnabled ? Updates.updateId : null;

  let statusLabel =
    "Check the EAS Update server and download the latest bundle for this app binary.";
  if (!showUi) {
    statusLabel = "";
  } else if (!isOtaEnabled) {
    statusLabel =
      "OTA is off in this environment (e.g. local dev, Expo Go, or missing update URL / runtime).";
  }

  const checkAndDownload = useCallback(async () => {
    if (!isNative || !Updates.isEnabled) {
      return;
    }
    setErrorMessage(null);
    setInfoMessage(null);
    setCanReload(false);
    setIsBusy(true);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        if ("reason" in check && check.reason !== undefined) {
          setInfoMessage(describeNoUpdateReason(check.reason));
        } else {
          setInfoMessage("You're up to date.");
        }
        return;
      }

      const fetched = await Updates.fetchUpdateAsync();
      if (fetched.isRollBackToEmbedded) {
        setCanReload(true);
        setInfoMessage("Rollback to the embedded bundle downloaded. Restart to apply.");
        return;
      }
      if (fetched.isNew) {
        setCanReload(true);
        setInfoMessage("Update downloaded. Restart to apply.");
        return;
      }
      setInfoMessage("Already running this bundle.");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const applyReload = useCallback(async () => {
    if (!isNative || !Updates.isEnabled) {
      return;
    }
    setErrorMessage(null);
    try {
      await Updates.reloadAsync();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, []);

  return {
    showUi,
    isOtaEnabled,
    statusLabel,
    infoMessage,
    errorMessage,
    isBusy,
    canReload,
    channelLabel,
    runtimeVersionLabel,
    currentUpdateId,
    checkAndDownload,
    applyReload,
  };
}
