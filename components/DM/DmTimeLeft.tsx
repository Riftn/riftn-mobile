/**
 * A photo with a time limit ("Gone for both of you 1 min after you send it")
 * wears the time it has left, so whoever looks at it can see it running out:
 * "42s", then "12m", "5h", "3d". Ticks every second in the last minute.
 * Same as web's DmTimeLeft.
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Icon from "../ui/Icon";
import { destructLeft, type DmDestruct } from "../../libs/dm-destruct";

const DmTimeLeft: React.FC<{ destruct?: DmDestruct | null; children: React.ReactNode }> = ({ destruct, children }) => {
  const timed = destruct?.mode === "time" && !!destruct.expiresAt;
  const end = timed ? new Date(destruct!.expiresAt!).getTime() : 0;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timed) return;
    let id: ReturnType<typeof setTimeout>;
    const next = () => (end - Date.now() <= 61_000 ? 1000 : 30_000);
    const step = () => {
      tick((n) => n + 1);
      if (end - Date.now() > 0) id = setTimeout(step, next());
    };
    id = setTimeout(step, next());
    return () => clearTimeout(id);
  }, [timed, end]);
  const left = timed ? destructLeft(destruct) : null;
  if (!left) return <>{children}</>;
  return (
    <View>
      {children}
      <View
        pointerEvents="none"
        className="dark-surface"
        accessibilityRole="timer"
        style={{ position: "absolute", left: 8, top: 8, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: "hsla(0,0%,0%,0.6)" }}
      >
        <Icon name="Timer" size={12} color="#FFFFFF" />
        <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{left}</Text>
      </View>
    </View>
  );
};

export default DmTimeLeft;
