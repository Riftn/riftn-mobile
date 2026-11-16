/**
 * The quiet beat between signing in and the signed-in app.
 *
 * `SignInWaitVeil` replaces the old loader and its caption: the sign-in screen
 * dims and an empty picture frame, in the shape of a profile picture, breathes
 * in the middle. No words.
 *
 * `SignInArrival` sits at the app root. When the account lands it fills the
 * same frame with the account's picture and name, then sends the picture to
 * where it lives in the header. It never takes a touch.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useAuthState, useUser } from '../../context/AuthContext';
import { getAvatarUrl } from '../../libs/misc';
import { measureOwnAvatar, noteSignInWaiting, signInWasWaiting } from '../../libs/signInHandoff';

const FRAME = 120;
/** The profile picture's curve (96pt with a 12pt corner), scaled to the frame. */
const RADIUS = 15;
const HOLD_MS = 650;
const FLY_MS = 520;

const styles = StyleSheet.create({
  veilHost: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  veil: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,7,9,0.86)' },
  frame: {
    width: FRAME, height: FRAME, borderRadius: RADIUS, backgroundColor: '#1b1d22', overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.16)',
  },
  pulse: {
    position: 'absolute', width: FRAME, height: FRAME, borderRadius: RADIUS,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
  },
  arrival: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999, alignItems: 'center', justifyContent: 'center' },
  // Its own dark chip: the sign-in screen is gone by now and the screen under
  // it can be any theme, light ones included.
  nameChip: {
    position: 'absolute', alignSelf: 'center', maxWidth: 300, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, backgroundColor: 'rgba(10,10,12,0.72)',
  },
  name: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
});

export const SignInWaitVeil: React.FC<{ label?: string }> = ({ label }) => {
  const fade = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    noteSignInWaiting();
    const tick = setInterval(noteSignInWaiting, 250);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => {
      clearInterval(tick);
      noteSignInWaiting();
      loop.stop();
    };
  }, [fade, pulse]);
  return (
    // dark-surface: the sign-in screen is dark on every theme, so System Light
    // must not flip these greys.
    <View className="dark-surface" style={styles.veilHost}>
    <Animated.View
      style={[styles.veil, { opacity: fade }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      testID="signin-wait-veil"
    >
      <Animated.View
        style={[styles.pulse, {
          opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.8, 0, 0] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1.5, 1.5] }) }],
        }]}
      />
      <View style={styles.frame} />
    </Animated.View>
    </View>
  );
};

export const SignInArrival: React.FC = () => {
  const { isSignedIn, needsUsername } = useAuthState();
  const user = useUser();
  const { width, height } = useWindowDimensions();
  const [shown, setShown] = useState<{ uri: string; name: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wasIn = useRef(isSignedIn && !needsUsername);
  const opacity = useRef(new Animated.Value(0)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;

  const signedIn = isSignedIn && !needsUsername;
  useEffect(() => {
    const arrived = signedIn && !wasIn.current;
    wasIn.current = signedIn;
    // Only a sign-in the person just watched: a session restored at launch
    // never showed the waiting frame, so there is nothing to hand over from.
    if (!arrived || !signInWasWaiting(1500)) return;
    if (!user?.avatarImageUrl) return;
    opacity.setValue(1);
    nameOpacity.setValue(0);
    move.setValue({ x: 0, y: 0 });
    scale.setValue(1);
    setLoaded(false);
    setShown({ uri: getAvatarUrl(user.avatarImageUrl, FRAME), name: user.displayName || user.username || '' });
  }, [signedIn, user, opacity, nameOpacity, move, scale]);

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    const end = () => { if (!cancelled) setShown(null); };
    if (!loaded) {
      // A picture that never loads must not strand the frame on screen.
      const giveUp = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(end);
      }, 2500);
      return () => { cancelled = true; clearTimeout(giveUp); };
    }
    Animated.timing(nameOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    const timer = setTimeout(async () => {
      const to = await measureOwnAvatar();
      if (cancelled) return;
      Animated.timing(nameOpacity, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      if (!to) {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.92, duration: 240, useNativeDriver: true }),
        ]).start(end);
        return;
      }
      const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
      Animated.parallel([
        Animated.timing(move, {
          toValue: { x: to.x + to.width / 2 - width / 2, y: to.y + to.height / 2 - height / 2 },
          duration: FLY_MS, easing: ease, useNativeDriver: true,
        }),
        Animated.timing(scale, { toValue: to.width / FRAME, duration: FLY_MS, easing: ease, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 160, delay: FLY_MS - 80, useNativeDriver: true }),
      ]).start(end);
    }, HOLD_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [shown, loaded, width, height, opacity, nameOpacity, move, scale]);

  if (!shown) return null;
  return (
    <View className="dark-surface" style={styles.arrival} pointerEvents="none" testID="signin-arrival">
      <Animated.View style={[styles.frame, { opacity, transform: [...move.getTranslateTransform(), { scale }] }]}>
        <Image
          source={{ uri: shown.uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={200}
          onLoad={() => setLoaded(true)}
          onError={() => setShown(null)}
          accessible={false}
        />
      </Animated.View>
      {shown.name ? (
        <Animated.View style={[styles.nameChip, { opacity: nameOpacity, top: height / 2 + FRAME / 2 + 16 }]}>
          <Text numberOfLines={1} style={styles.name}>{shown.name}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
};

export default SignInWaitVeil;
