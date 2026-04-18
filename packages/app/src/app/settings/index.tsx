import { Redirect } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import SettingsScreen from "@/screens/settings-screen";
import { buildSettingsSectionRoute } from "@/utils/host-routes";

export default function SettingsIndexRoute() {
  const isCompactLayout = useIsCompactFormFactor();

  if (!isCompactLayout) {
    return <Redirect href={buildSettingsSectionRoute("general") as never} />;
  }

  return <SettingsScreen view={{ kind: "root" }} />;
}
