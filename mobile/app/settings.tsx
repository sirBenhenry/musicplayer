import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, ScrollView, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { useStore } from '../lib/store';
import { font, radius } from '../lib/tokens';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark, isSage, toggleDark, toggleSage, clearAuth, serverUrl, setServerUrl } = useStore();
  const [editingUrl, setEditingUrl] = useState(serverUrl);

  const saveUrl = () => {
    const trimmed = editingUrl.trim().replace(/\/$/, '');
    if (!trimmed) return;
    setServerUrl(trimmed);
    Alert.alert('Saved', 'Server URL updated. Restart the app if needed.');
  };

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
        <View style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}>
          <Text style={[styles.rowLabel, { color: theme.fgStrong }]}>URL</Text>
          <TextInput
            value={editingUrl}
            onChangeText={setEditingUrl}
            onBlur={saveUrl}
            onSubmitEditing={saveUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            style={[styles.urlInput, { color: theme.fgStrong, borderColor: theme.borderSoft }]}
            placeholder="http://10.x.x.x:8001"
            placeholderTextColor={theme.fgSoft}
          />
        </View>
        <Row label="" theme={theme} last>
          <TouchableOpacity onPress={saveUrl} style={[styles.saveBtn, { backgroundColor: theme.accentBg }]}>
            <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>Save</Text>
          </TouchableOpacity>
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
  urlInput: { flex: 1, fontSize: 13, textAlign: 'right', paddingVertical: 4, paddingHorizontal: 6, borderWidth: 1, borderRadius: 6, marginLeft: 8 },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: radius.pill },
  logoutRow: { paddingHorizontal: 16, paddingVertical: 14 },
});
