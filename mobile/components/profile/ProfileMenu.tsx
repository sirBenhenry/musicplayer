import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { Icon, IconName } from '../shared/Icon';
import { font, radius } from '../../lib/tokens';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function profileHue(hue: number): string {
  return `hsl(${hue}, 35%, 60%)`;
}

export function ProfileMenu({ open, onClose }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const { profiles, activeProfileId } = useStore();
  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const [visible, setVisible] = useState(open);
  const translateY = useRef(new Animated.Value(open ? 0 : 400)).current;
  const backdropOpacity = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (open) {
      setVisible(true);
      translateY.setValue(400);
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(translateY, {
          toValue: 0, useNativeDriver: true,
          damping: 22, stiffness: 280, mass: 0.9,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 400, duration: 220, useNativeDriver: true }),
      ]).start(() => setVisible(false));
    }
  }, [open]);

  if (!visible) return null;

  const goto = (screen: string) => {
    onClose();
    setTimeout(() => router.push(`/${screen}` as any), 220);
  };

  const items: { label: string; hint: string; icon: IconName; screen: string }[] = [
    {
      label: 'Discovery history',
      hint: 'Last 30 days of daily playlists',
      icon: 'history',
      screen: 'history',
    },
    {
      label: 'Pending deletions',
      hint: 'Skipped songs — rescue before midnight',
      icon: 'trash',
      screen: 'deletion',
    },
    {
      label: 'Manage taste profiles',
      hint: `${profiles.length} profile${profiles.length !== 1 ? 's' : ''} · ${profile?.name ?? ''} is active`,
      icon: 'artist',
      screen: 'profiles',
    },
    {
      label: 'Settings',
      hint: 'Theme, server, imports, system status',
      icon: 'settings',
      screen: 'settings',
    },
  ];

  const hue = profile?.hue ?? 30;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* Scrim */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.scrim, { opacity: backdropOpacity }]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.bgElev, transform: [{ translateY }] },
        ]}
        pointerEvents="auto"
      >
        {/* Grabber */}
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />

        {/* Profile header */}
        <View style={styles.profileHeader}>
          <View style={[styles.avatar, { backgroundColor: profileHue(hue) }]}>
            <Text style={styles.avatarGlyph}>{profile?.glyph ?? '♪'}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.listeningAs, { color: theme.fgMuted, fontFamily: font.mono }]}>
              LISTENING AS
            </Text>
            <Text style={[styles.profileName, { color: theme.fgStrong, fontFamily: font.display }]}
              numberOfLines={1}>
              {profile?.name ?? 'Profile'}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { borderColor: theme.borderSoft, backgroundColor: theme.surface, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Icon name="close" color={theme.fgMuted} size={16} />
          </Pressable>
        </View>

        {/* Long-press hint */}
        <View style={[styles.hint, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
          <View style={[styles.hintIcon, { backgroundColor: theme.accent }]}>
            <Icon name="home" color={theme.onAccent} size={13} strokeWidth={1.8} />
          </View>
          <Text style={[styles.hintText, { color: theme.fgMuted }]}>
            Hold the home button to switch profiles. Drag to a profile and release.
          </Text>
        </View>

        {/* Menu items */}
        <View style={[styles.menuCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
          {items.map((item, i) => (
            <React.Fragment key={item.screen + item.label}>
              <Pressable
                style={({ pressed }) => [styles.menuRow, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => goto(item.screen)}
              >
                <View style={styles.menuIconWrap}>
                  <Icon name={item.icon} color={theme.fgMuted} size={19} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.menuLabel, { color: theme.fgStrong }]}>{item.label}</Text>
                  <Text style={[styles.menuHint, { color: theme.fgMuted }]}>{item.hint}</Text>
                </View>
                <Icon name="chevronRight" color={theme.fgMuted} size={16} />
              </Pressable>
              {i < items.length - 1 && (
                <View style={[styles.divider, { backgroundColor: theme.borderSoft, marginLeft: 52 }]} />
              )}
            </React.Fragment>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 20,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 18,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarGlyph: { fontSize: 22, color: '#fffdf8' },
  listeningAs: { fontSize: 9.5, letterSpacing: 0.12, marginBottom: 3 },
  profileName: { fontSize: 22, lineHeight: 26 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 4,
    marginBottom: 14,
  },
  hintIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  hintText: { flex: 1, fontSize: 12, lineHeight: 17 },
  menuCard: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  menuIconWrap: { width: 22, alignItems: 'center' },
  menuLabel: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  menuHint: { fontSize: 12 },
  divider: { height: StyleSheet.hairlineWidth },
});
