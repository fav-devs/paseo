import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import {
  Heart,
  House,
  Info,
  Library,
  ListMusic,
  MonitorSpeaker,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { SpotifyCliAction } from "./spotify-cli-controls";
import type { ParsedSpotifyDevice } from "./spotify-terminal-parser";

type MobileTab = "home" | "search" | "library";
type MobilePanel = "queue" | "devices" | "details" | null;

export type SpotifyRepeatMode = "off" | "context" | "track";

export interface SpotifyMobileCliShellProps {
  canControl: boolean;
  isLaunching: boolean;
  isReady: boolean;
  launchError: string | null;
  title: string;
  artist: string;
  albumImageUrl: string | null;
  isPlaying: boolean;
  isLiked: boolean;
  shuffleEnabled: boolean;
  repeatMode: SpotifyRepeatMode;
  progressRatio: number;
  elapsedLabel: string;
  durationLabel: string;
  statusLabel: string;
  devices: ParsedSpotifyDevice[];
  activeDeviceId: string | null;
  isDevicesLoading: boolean;
  audioRoutingHint: string;
  onLaunch: () => void;
  onToggleLike: () => void;
  onConnectDevice: (deviceId: string) => void;
  onRefreshDevices: () => void;
  onAction: (action: SpotifyCliAction) => void;
}

function iconColor(active: boolean, disabled: boolean) {
  if (disabled) return "#6F6F6F";
  if (active) return "#1ED760";
  return "#FFFFFF";
}

function tabLabel(tab: MobileTab) {
  if (tab === "home") return "Home";
  if (tab === "search") return "Search";
  return "Your Library";
}

export function SpotifyMobileCliShell({
  canControl,
  isLaunching,
  isReady,
  launchError,
  title,
  artist,
  albumImageUrl,
  isPlaying,
  isLiked,
  shuffleEnabled,
  repeatMode,
  progressRatio,
  elapsedLabel,
  durationLabel,
  statusLabel,
  devices,
  activeDeviceId,
  isDevicesLoading,
  audioRoutingHint,
  onLaunch,
  onToggleLike,
  onConnectDevice,
  onRefreshDevices,
  onAction,
}: SpotifyMobileCliShellProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>("home");
  const [activePanel, setActivePanel] = useState<MobilePanel>(null);

  const safeProgress = useMemo(() => Math.min(1, Math.max(0, progressRatio)), [progressRatio]);

  const disabled = !canControl || isLaunching;

  const panelMessage =
    activePanel === "queue"
      ? "Queue controls are wired to spotify_player."
      : activePanel === "devices"
        ? "Select an active Spotify Connect target."
        : activePanel === "details"
          ? audioRoutingHint
          : `${tabLabel(activeTab)} view is styled to match the inspo mobile shell.`;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Spotify</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.playerCard}>
        <View style={styles.artRow}>
          {albumImageUrl ? (
            <Image source={{ uri: albumImageUrl }} style={styles.albumArtImage} />
          ) : (
            <View style={styles.albumArt}>
              <ListMusic size={34} color="#8B8B8B" />
            </View>
          )}
          <View style={styles.songMeta}>
            <Text style={styles.songTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.songArtist} numberOfLines={1}>
              {artist}
            </Text>
          </View>
          <Pressable style={styles.likeButton} onPress={onToggleLike} disabled={disabled}>
            <Heart
              size={18}
              color={iconColor(isLiked, disabled)}
              fill={isLiked ? "#1ED760" : "none"}
            />
          </Pressable>
        </View>

        <View style={styles.progressWrap}>
          <Text style={styles.timeLabel}>{elapsedLabel}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${safeProgress * 100}%` }]} />
          </View>
          <Text style={styles.timeLabel}>{durationLabel}</Text>
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            style={styles.controlButton}
            disabled={disabled}
            onPress={() => onAction("shuffle")}
          >
            <Shuffle size={18} color={iconColor(shuffleEnabled, disabled)} />
          </Pressable>

          <Pressable
            style={styles.controlButton}
            disabled={disabled}
            onPress={() => onAction("previous")}
          >
            <SkipBack size={20} color={iconColor(false, disabled)} />
          </Pressable>

          <Pressable
            style={styles.playButton}
            disabled={disabled}
            onPress={() => onAction("playPause")}
          >
            {isPlaying ? <Pause size={20} color="#0A0A0A" /> : <Play size={20} color="#0A0A0A" />}
          </Pressable>

          <Pressable
            style={styles.controlButton}
            disabled={disabled}
            onPress={() => onAction("next")}
          >
            <SkipForward size={20} color={iconColor(false, disabled)} />
          </Pressable>

          <Pressable
            style={styles.controlButton}
            disabled={disabled}
            onPress={() => onAction("repeat")}
          >
            {repeatMode === "track" ? (
              <Repeat1 size={18} color={iconColor(true, disabled)} />
            ) : (
              <Repeat size={18} color={iconColor(repeatMode === "context", disabled)} />
            )}
          </Pressable>
        </View>

        <View style={styles.extraRow}>
          <Pressable
            style={styles.extraButton}
            disabled={disabled}
            onPress={() => {
              setActivePanel((current) => (current === "queue" ? null : "queue"));
              onAction("queue");
            }}
          >
            <ListMusic size={16} color={iconColor(activePanel === "queue", disabled)} />
            <Text style={styles.extraLabel}>Queue</Text>
          </Pressable>

          <Pressable
            style={styles.extraButton}
            disabled={disabled}
            onPress={() => {
              setActivePanel((current) => (current === "devices" ? null : "devices"));
              onAction("devices");
            }}
          >
            <MonitorSpeaker size={16} color={iconColor(activePanel === "devices", disabled)} />
            <Text style={styles.extraLabel}>Devices</Text>
          </Pressable>

          <Pressable
            style={styles.extraButton}
            disabled={disabled}
            onPress={() => {
              setActivePanel((current) => (current === "details" ? null : "details"));
              onAction("details");
            }}
          >
            <Info size={16} color={iconColor(activePanel === "details", disabled)} />
            <Text style={styles.extraLabel}>Details</Text>
          </Pressable>

          <View style={styles.volumeCluster}>
            <Pressable
              style={styles.volumeButton}
              disabled={disabled}
              onPress={() => onAction("volumeDown")}
            >
              <Volume1 size={16} color={iconColor(false, disabled)} />
            </Pressable>
            <Pressable
              style={styles.volumeButton}
              disabled={disabled}
              onPress={() => onAction("volumeUp")}
            >
              <Volume2 size={16} color={iconColor(false, disabled)} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.panelCard}>
        <Text style={styles.panelText}>{panelMessage}</Text>
        {activePanel === "devices" ? (
          <>
            <ScrollView style={styles.deviceList} contentContainerStyle={styles.deviceListContent}>
              {devices.length === 0 ? (
                <Text style={styles.deviceEmptyText}>
                  {isDevicesLoading
                    ? "Loading devices..."
                    : "No Spotify Connect devices found. Open Spotify on any target device first."}
                </Text>
              ) : (
                devices.map((device) => {
                  const isActive =
                    (activeDeviceId && activeDeviceId === device.id) || device.isActive;
                  return (
                    <Pressable
                      key={device.id}
                      style={[styles.deviceRow, isActive ? styles.deviceRowActive : null]}
                      onPress={() => onConnectDevice(device.id)}
                      disabled={disabled}
                    >
                      <View style={styles.deviceTextWrap}>
                        <Text numberOfLines={1} style={styles.deviceNameText}>
                          {device.name}
                        </Text>
                        {device.type ? (
                          <Text numberOfLines={1} style={styles.deviceTypeText}>
                            {device.type}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[styles.deviceStateText, isActive ? styles.deviceStateActive : null]}
                      >
                        {isActive ? "Active" : "Connect"}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Button
              variant="ghost"
              size="sm"
              style={styles.refreshDevicesButton}
              disabled={disabled || isDevicesLoading}
              onPress={onRefreshDevices}
            >
              {isDevicesLoading ? "Refreshing..." : "Refresh devices"}
            </Button>
          </>
        ) : null}
      </View>

      {!isReady ? (
        <Button
          variant="default"
          size="sm"
          style={styles.launchButton}
          disabled={!canControl || isLaunching}
          onPress={onLaunch}
        >
          {isLaunching ? "Starting spotify_player..." : "Launch spotify_player"}
        </Button>
      ) : null}

      {launchError ? <Text style={styles.errorText}>{launchError}</Text> : null}

      <View style={styles.mobileMenu}>
        <Pressable style={styles.menuButton} onPress={() => setActiveTab("home")}>
          <House size={17} color={iconColor(activeTab === "home", false)} />
          <Text style={styles.menuLabel}>Home</Text>
        </Pressable>
        <Pressable style={styles.menuButton} onPress={() => setActiveTab("search")}>
          <Search size={17} color={iconColor(activeTab === "search", false)} />
          <Text style={styles.menuLabel}>Search</Text>
        </Pressable>
        <Pressable style={styles.menuButton} onPress={() => setActiveTab("library")}>
          <Library size={17} color={iconColor(activeTab === "library", false)} />
          <Text style={styles.menuLabel}>Your Library</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#000000",
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  statusBadge: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: "#121212",
    borderWidth: 1,
    borderColor: "#2B2B2B",
  },
  statusText: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
  },
  playerCard: {
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#121212",
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
  artRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  albumArt: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1D1D1D",
  },
  albumArtImage: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#1D1D1D",
  },
  songMeta: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  songArtist: {
    marginTop: theme.spacing[1],
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
  },
  likeButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#2D2D2D",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#FFFFFF",
  },
  timeLabel: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
    width: 34,
    textAlign: "center",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controlButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  playButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#FFFFFF",
  },
  extraRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
  },
  extraButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    backgroundColor: "#1A1A1A",
  },
  extraLabel: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
  },
  volumeCluster: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1A1A",
    borderRadius: theme.borderRadius.full,
  },
  volumeButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  panelCard: {
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#121212",
    borderWidth: 1,
    borderColor: "#2A2A2A",
    padding: theme.spacing[3],
  },
  deviceList: {
    marginTop: theme.spacing[2],
    maxHeight: 180,
  },
  deviceListContent: {
    gap: theme.spacing[1],
  },
  deviceEmptyText: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.45),
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: "#2D2D2D",
    backgroundColor: "#161616",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  deviceRowActive: {
    borderColor: "#1ED760",
    backgroundColor: "#122218",
  },
  deviceTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  deviceNameText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  deviceTypeText: {
    marginTop: theme.spacing[1],
    color: "#8C8C8C",
    fontSize: theme.fontSize.xs,
  },
  deviceStateText: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  deviceStateActive: {
    color: "#1ED760",
  },
  refreshDevicesButton: {
    alignSelf: "flex-start",
    marginTop: theme.spacing[2],
  },
  panelText: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.45),
  },
  launchButton: {
    alignSelf: "flex-start",
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  mobileMenu: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#212121",
    paddingTop: theme.spacing[2],
  },
  menuButton: {
    flex: 1,
    alignItems: "center",
    gap: theme.spacing[1],
  },
  menuLabel: {
    color: "#B3B3B3",
    fontSize: theme.fontSize.xs,
  },
}));
