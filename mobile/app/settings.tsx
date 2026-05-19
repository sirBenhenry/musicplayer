import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { useStore } from '../lib/store';
import { font, radius } from '../lib/tokens';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark, isSage, toggleDark, toggleSage, clearAuth, serverUrl } = useStore();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: theme.fgStrong }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Settings</Text>
      </View>

      <Section label="APPEARANCE" theme={theme}>
        <Row label="Dark mode" theme={theme}>
          <Switch value={isDark} onValueChange={toggleDark} trackColor={{ true: theme.accent }} />
        </Row>
        <Row label="Sage accent" theme={theme} last>
          <Switch value={isSage} onValueChange={toggleSage} trackColor={{ true: theme.accent }} />
        </Row>
      </Section>

      <Section label="SERVER" theme={theme}>
        <Row label="URL" theme={theme} last>
          <Text style={[styles.value, { color: theme.fgMuted }]} numberOfLines={1}>
            {serverUrl || '—'}
          </Text>
        </Row>
      </Section>

      <Section label="DATA" theme={theme}>
        <TouchableOpacity onPress={() => router.push('/downloads')} style={styles.logoutRow}>
          <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Downloads</Text>
        </TouchableOpacity>
      </Section>

      <Section label="ACCOUNT" theme={theme}>
        <TouchableOpacity
          onPress={() => { clearAuth(); router.replace('/login'); }}
          style={styles.logoutRow}
        >
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '500' }}>Sign out</Text>
        </TouchableOpacity>
      </Section>
    </ScrollView>
  );
}

function Section({ label, children, theme }: { label: string; children: React.ReactNode; theme: any }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
        {label}
      </Text>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
        {children}
      </View>
    </View>
  );
}

function Row({ label, children, last, theme }: { label: string; children: React.ReactNode; last?: boolean; theme: any }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}>
      <Text style={[styles.rowLabel, { color: theme.fgStrong }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 16, paddingBottom: 24 },
  back: { fontSize: 24 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.02 },
  sectionLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', paddingHorizontal: 20, marginBottom: 8 },
  card: { marginHorizontal: 20, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel: { fontSize: 15 },
  value: { fontSize: 14, maxWidth: 180 },
  logoutRow: { paddingHorizontal: 16, paddingVertical: 14 },
});
