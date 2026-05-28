import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { Icon } from '../../components/shared/Icon';
import {
  RadialSwitcher,
  computeNodePositions,
  HOVER_THRESHOLD,
} from '../../components/profile/RadialSwitcher';
import { ProfileMenu } from '../../components/profile/ProfileMenu';
import { MiniPlayer } from '../../components/chrome/MiniPlayer';

export default function TabLayout() {
  const theme = useTheme();
  const { setActiveProfile, profiles, activeProfileId, profileMenuOpen, setProfileMenuOpen, setPlayerOpen } = useStore();

  const [radialOpen, setRadialOpen] = useState(false);
  const [radialAnchor, setRadialAnchor] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const homeRef = useRef<View>(null);
  const navigationRef = useRef<any>(null);

  // UI-thread flags
  const isOpen = useSharedValue(false);
  const didLongPress = useSharedValue(false);

  // JS-thread refs (not accessible from worklets directly)
  const hoveredIdRef = useRef<string | null>(null);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const positionsRef = useRef<Array<{ x: number; y: number }>>([]);
  const anchorRef = useRef({ x: 0, y: 0 });

  const openRadial = useCallback(() => {
    homeRef.current?.measure((_fx, _fy, w, h, px, py) => {
      const ax = px + w / 2;
      const ay = py + h / 2;
      anchorRef.current = { x: ax, y: ay };
      positionsRef.current = computeNodePositions(profilesRef.current.length, ax, ay);
      setRadialAnchor({ x: ax, y: ay });
      hoveredIdRef.current = null;
      setHoveredId(null);
      setRadialOpen(true);
      isOpen.value = true;
    });
  }, [isOpen]);

  const closeRadial = useCallback(() => {
    isOpen.value = false;
    setRadialOpen(false);
    setHoveredId(null);
    hoveredIdRef.current = null;
  }, [isOpen]);

  const updateHover = useCallback((fx: number, fy: number) => {
    const positions = positionsRef.current;
    const profs = profilesRef.current;
    let bestId: string | null = null;
    let bestDist = HOVER_THRESHOLD;
    for (let i = 0; i < positions.length; i++) {
      const dx = fx - positions[i].x;
      const dy = fy - positions[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = profs[i].id;
      }
    }
    if (bestId !== hoveredIdRef.current) {
      hoveredIdRef.current = bestId;
      setHoveredId(bestId);
    }
  }, []);

  const finalizeSelection = useCallback(() => {
    const selected = hoveredIdRef.current;
    closeRadial();
    if (selected) setActiveProfile(selected);
  }, [closeRadial, setActiveProfile]);

  const navigateHome = useCallback(() => {
    navigationRef.current?.navigate('index');
  }, []);

  // ── Gestures ────────────────────────────────────────────────────────────────

  const longPress = Gesture.LongPress()
    .minDuration(280)
    .maxDistance(200)
    .onStart(() => {
      didLongPress.value = true;
      runOnJS(openRadial)();
    });

  const pan = Gesture.Pan()
    .minDistance(0)
    .onUpdate((e) => {
      if (isOpen.value) {
        runOnJS(updateHover)(e.absoluteX, e.absoluteY);
      }
    })
    .onFinalize(() => {
      const wasLP = didLongPress.value;
      didLongPress.value = false;
      if (isOpen.value) {
        runOnJS(finalizeSelection)();
      } else if (!wasLP) {
        runOnJS(navigateHome)();
      }
    });

  const homeGesture = Gesture.Simultaneous(longPress, pan);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={({ state, navigation }) => {
          navigationRef.current = navigation;
          return (
            <View style={[styles.nav, { backgroundColor: theme.bgElev, borderTopColor: theme.borderSoft }]}>

              {/* Search */}
              <Pressable onPress={() => navigation.navigate('search')} style={styles.navBtn}>
                <Icon
                  name="search"
                  color={state.index === 0 ? theme.accent : theme.fgMuted}
                  size={22}
                  strokeWidth={state.index === 0 ? 1.9 : 1.6}
                />
                <Text style={[styles.navLabel, { color: state.index === 0 ? theme.accent : theme.fgMuted }]}>
                  Search
                </Text>
              </Pressable>

              {/* Home — drag-to-select profile switcher */}
              <View style={styles.homeShell}>
                <GestureDetector gesture={homeGesture}>
                  <View
                    ref={homeRef}
                    collapsable={false}
                    style={[
                      styles.homeBtn,
                      { backgroundColor: theme.accent },
                    ]}
                  >
                    <Icon
                      name="home"
                      color={theme.onAccent}
                      size={26}
                      strokeWidth={state.index === 1 ? 2 : 1.8}
                    />
                  </View>
                </GestureDetector>
              </View>

              {/* Library */}
              <Pressable onPress={() => navigation.navigate('library')} style={styles.navBtn}>
                <Icon
                  name="library"
                  color={state.index === 2 ? theme.accent : theme.fgMuted}
                  size={22}
                  strokeWidth={state.index === 2 ? 1.9 : 1.6}
                />
                <Text style={[styles.navLabel, { color: state.index === 2 ? theme.accent : theme.fgMuted }]}>
                  Library
                </Text>
              </Pressable>

            </View>
          );
        }}
      >
        <Tabs.Screen name="search" />
        <Tabs.Screen name="index" />
        <Tabs.Screen name="library" />
      </Tabs>

      <MiniPlayer onPress={() => setPlayerOpen(true)} />

      {radialOpen && (
        <RadialSwitcher
          anchorX={radialAnchor.x}
          anchorY={radialAnchor.y}
          profiles={profiles}
          activeProfileId={activeProfileId}
          hoveredId={hoveredId}
        />
      )}

      <ProfileMenu
        open={profileMenuOpen}
        onClose={() => setProfileMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  navLabel: { fontSize: 10.5, fontWeight: '500', letterSpacing: 0.02 },
  homeShell: { flex: 1.2, alignItems: 'center', justifyContent: 'center' },
  homeBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -8,
    shadowColor: '#28190f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
});
