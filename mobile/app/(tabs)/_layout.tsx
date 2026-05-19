import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { RadialSwitcher } from '../../components/profile/RadialSwitcher';
import { ProfileMenu } from '../../components/profile/ProfileMenu';

const TABS = [
  { name: 'search', label: 'Search', icon: '⌕' },
  { name: 'index', label: 'Home', icon: '⌂' },
  { name: 'library', label: 'Library', icon: '♫' },
];

export default function TabLayout() {
  const theme = useTheme();
  const { setActiveProfile, profileMenuOpen, setProfileMenuOpen } = useStore();
  const [radialOpen, setRadialOpen] = useState(false);
  const [radialAnchor, setRadialAnchor] = useState({ x: 0, y: 0 });
  const homeRef = useRef<View>(null);

  const openRadial = () => {
    homeRef.current?.measure((fx, fy, w, h, px, py) => {
      setRadialAnchor({ x: px + w / 2, y: py + h / 2 });
      setRadialOpen(true);
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={({ state, navigation }) => (
          <View style={[styles.nav, { backgroundColor: theme.bgElev, borderTopColor: theme.borderSoft }]}>
            {TABS.map((tab, i) => {
              const active = state.index === i;
              if (tab.name === 'index') {
                return (
                  <View ref={homeRef} collapsable={false} style={styles.homeShell} key={tab.name}>
                    <TouchableOpacity
                      onPress={() => navigation.navigate(tab.name)}
                      onLongPress={openRadial}
                      delayLongPress={280}
                    >
                      <View style={[styles.homeBtn, { backgroundColor: theme.accent }]}>
                        <Text style={{ fontSize: 22, color: theme.onAccent }}>{tab.icon}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  key={tab.name}
                  onPress={() => navigation.navigate(tab.name)}
                  style={[styles.navBtn, active && styles.navBtnActive]}
                >
                  <Text style={{ fontSize: 20, color: active ? theme.accent : theme.fgMuted }}>
                    {tab.icon}
                  </Text>
                  <Text style={[styles.navLabel, { color: active ? theme.accent : theme.fgMuted }]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      >
        <Tabs.Screen name="search" />
        <Tabs.Screen name="index" />
        <Tabs.Screen name="library" />
      </Tabs>

      {radialOpen && (
        <RadialSwitcher
          anchorX={radialAnchor.x}
          anchorY={radialAnchor.y}
          onSelect={(p) => { setActiveProfile(p.id); setRadialOpen(false); }}
          onDismiss={() => setRadialOpen(false)}
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
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  navBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8 },
  navBtnActive: {},
  navLabel: { fontSize: 10.5, fontWeight: '500', letterSpacing: 0.02 },
  homeShell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  homeBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
});
