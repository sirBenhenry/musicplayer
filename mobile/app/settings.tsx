import React, { useCallback, useState, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Switch, ScrollView, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Icon } from '../components/shared/Icon';
import { useTheme } from '../hooks/useTheme';
import { useStore } from '../lib/store';
import { font, radius } from '../lib/tokens';
import { getNotificationCount, importSongs, importSetup, getImportGuideUrl, exportLibrary, applyLibraryChanges, getSystemStatus, sendDeviceLogs } from '../lib/api';
import { readLogs, clearLogs } from '../lib/logger';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDark, isSage, toggleDark, toggleSage, clearAuth, serverUrl, setServerUrl, notificationCount, setNotificationCount } = useStore();
  const [editingUrl, setEditingUrl] = useState(serverUrl);

  useFocusEffect(useCallback(() => {
    getNotificationCount()
      .then(d => setNotificationCount(d.count))
      .catch(() => {});
    const interval = setInterval(() => {
      getNotificationCount()
        .then(d => setNotificationCount(d.count))
        .catch(() => {});
    }, 60_000);

    const fetchSysStatus = () => {
      setSysLoading(true);
      getSystemStatus()
        .then(d => { setSysStatus(d); setSysLoading(false); })
        .catch(() => setSysLoading(false));
    };
    fetchSysStatus();
    sysIntervalRef.current = setInterval(fetchSysStatus, 120_000);

    return () => {
      clearInterval(interval);
      if (sysIntervalRef.current) clearInterval(sysIntervalRef.current);
    };
  }, [setNotificationCount]));
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'none'>('idle');
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [latestTag, setLatestTag] = useState<string | null>(null);
  const [importingFile, setImportingFile] = useState<'songs' | 'setup' | 'apply' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sysStatus, setSysStatus] = useState<any>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const sysIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sendingLogs, setSendingLogs] = useState(false);

  const checkForUpdate = async () => {
    setUpdateState('checking');
    try {
      const res = await fetch('https://api.github.com/repos/sirBenhenry/musicplayer/releases/latest');
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const tag: string = data.tag_name ?? '';
      const current = `v${Constants.expoConfig?.version ?? '0.0.0'}`;
      if (!tag || tag === current) {
        setUpdateState('none');
        setTimeout(() => setUpdateState('idle'), 4000);
        return;
      }
      const apkAsset = (data.assets ?? []).find((a: any) => a.name?.endsWith('.apk'));
      setLatestTag(tag);
      setLatestUrl(apkAsset?.browser_download_url ?? data.html_url);
      setUpdateState('available');
    } catch (e: any) {
      setUpdateState('idle');
      Alert.alert('Update check failed', e.message ?? String(e));
    }
  };

  const saveUrl = () => {
    const trimmed = editingUrl.trim().replace(/\/$/, '');
    if (!trimmed) return;
    setServerUrl(trimmed);
    Alert.alert('Saved', 'Server URL updated. Restart the app if needed.');
  };

  const handleExportLibrary = async () => {
    setExporting(true);
    try {
      const data = await exportLibrary();
      const json = JSON.stringify(data, null, 2);
      const filename = `musicapp_library_${new Date().toISOString().slice(0, 10)}.json`;
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return;
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        permissions.directoryUri, filename, 'application/json'
      );
      await FileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, json);
      Alert.alert('Exported', `${data.songs.length} songs saved to ${filename}`);
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleApplyChanges = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setImportingFile('apply');
    try {
      const text = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const data = JSON.parse(text);
      const songs: any[] = Array.isArray(data) ? data : (data.songs ?? []);
      if (!songs.length) throw new Error('No songs found in file');
      const res = await applyLibraryChanges(songs);
      const msg = `${res.assigned} reassigned · ${res.deleted} deleted` +
        (res.errors.length ? `\n\nWarnings:\n${res.errors.slice(0, 5).join('\n')}` : '');
      Alert.alert('Applied', msg);
    } catch (e: any) {
      Alert.alert('Apply failed', e.message ?? String(e));
    } finally {
      setImportingFile(null);
    }
  };

  const pickAndImport = async (type: 'songs' | 'setup') => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setImportingFile(type);
    try {
      const text = await FileSystem.readAsStringAsync(asset.uri);
      const data = JSON.parse(text);
      if (type === 'songs') {
        if (!Array.isArray(data)) throw new Error('File must be a JSON array of {artist, title} objects');
        const res = await importSongs(data);
        Alert.alert('Done', `Queued ${res.total} tracks for download.`);
      } else {
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('File must be a JSON object with profiles/songs/playlists keys');
        const res = await importSetup(data);
        Alert.alert(
          'Setup imported',
          `${res.profiles_created} profiles · ${res.songs_queued} songs · ${res.playlists_created} playlists (${res.playlist_songs_queued} playlist tracks) queued.`
        );
      }
    } catch (e: any) {
      Alert.alert('Import failed', e.message ?? String(e));
    } finally {
      setImportingFile(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </Pressable>
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
          <Pressable onPress={saveUrl} style={[styles.saveBtn, { backgroundColor: theme.accentBg }]}>
            <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '600' }}>Save</Text>
          </Pressable>
        </Row>
      </Section>

      <Section label="DATA" theme={theme}>
        <Pressable
          onPress={() => router.push('/notifications')}
          style={[styles.logoutRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
        >
          <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Notifications</Text>
          {notificationCount > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
              <Text style={{ color: theme.onAccent, fontSize: 11, fontWeight: '700' }}>{notificationCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push('/downloads')} style={[styles.logoutRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}>
          <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Pipeline Activity</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/analysis')} style={[styles.logoutRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}>
          <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Audio Analysis</Text>
        </Pressable>
        <Pressable
          onPress={updateState === 'available' && latestUrl
            ? () => Linking.openURL(latestUrl)
            : checkForUpdate}
          disabled={updateState === 'checking'}
          style={[styles.logoutRow, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
        >
          <Text style={{ color: updateState === 'available' ? theme.accent : theme.fgStrong, fontSize: 15 }}>
            {updateState === 'available' ? `Download ${latestTag}` : 'Check for update'}
          </Text>
          {updateState === 'checking' && <ActivityIndicator size="small" color={theme.accent} />}
          {updateState === 'none' && <Text style={{ color: theme.fgMuted, fontSize: 13 }}>Up to date</Text>}
          {updateState === 'available' && <Icon name="download" color={theme.accent} size={16} />}
        </Pressable>
      </Section>

      <Section label="IMPORT" theme={theme}>
        <Pressable
          onPress={() => pickAndImport('songs')}
          disabled={importingFile !== null}
          style={[styles.logoutRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}
        >
          <View>
            <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Import songs</Text>
            <Text style={{ color: theme.fgMuted, fontSize: 12, marginTop: 2 }}>JSON: [&#123;"artist":"...","title":"..."&#125;]</Text>
          </View>
          {importingFile === 'songs'
            ? <ActivityIndicator size="small" color={theme.accent} />
            : <Icon name="download" color={theme.fgSoft} size={16} />}
        </Pressable>
        <Pressable
          onPress={() => pickAndImport('setup')}
          disabled={importingFile !== null}
          style={[styles.logoutRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}
        >
          <View>
            <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Import setup file</Text>
            <Text style={{ color: theme.fgMuted, fontSize: 12, marginTop: 2 }}>JSON: profiles, songs, playlists</Text>
          </View>
          {importingFile === 'setup'
            ? <ActivityIndicator size="small" color={theme.accent} />
            : <Icon name="download" color={theme.fgSoft} size={16} />}
        </Pressable>
        <Pressable
          onPress={handleExportLibrary}
          disabled={exporting || importingFile !== null}
          style={[styles.logoutRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}
        >
          <View>
            <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Export library</Text>
            <Text style={{ color: theme.fgMuted, fontSize: 12, marginTop: 2 }}>Download all songs + profiles as JSON</Text>
          </View>
          {exporting
            ? <ActivityIndicator size="small" color={theme.accent} />
            : <Icon name="download" color={theme.accent} size={16} />}
        </Pressable>
        <Pressable
          onPress={handleApplyChanges}
          disabled={importingFile !== null || exporting}
          style={[styles.logoutRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}
        >
          <View>
            <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Apply library changes</Text>
            <Text style={{ color: theme.fgMuted, fontSize: 12, marginTop: 2 }}>Upload Claude-edited export to reassign/delete</Text>
          </View>
          {importingFile === 'apply'
            ? <ActivityIndicator size="small" color={theme.accent} />
            : <Icon name="refresh" color={theme.fgSoft} size={16} />}
        </Pressable>
        <Pressable
          onPress={() => Linking.openURL(getImportGuideUrl())}
          style={[styles.logoutRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
        >
          <View>
            <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Download import guide</Text>
            <Text style={{ color: theme.fgMuted, fontSize: 12, marginTop: 2 }}>Format reference — musicapp_import_guide.md</Text>
          </View>
          <Icon name="download" color={theme.accent} size={16} />
        </Pressable>
      </Section>

      <Section label="SYSTEM" theme={theme}>
        {sysLoading && !sysStatus ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={theme.accent} />
          </View>
        ) : sysStatus ? (
          <>
            {/* Service health dots */}
            {(sysStatus.services ?? []).map((svc: any, i: number, arr: any[]) => {
              const isLast = i === arr.length - 1;
              const dot = svc.ok ? '#4CAF50' : '#F44336';
              let detail = '';
              if (svc.name === 'qbittorrent' && svc.ok) {
                const dlMB = ((svc.dl_speed ?? 0) / 1024 / 1024).toFixed(1);
                detail = `↓${dlMB} MB/s · ${svc.active_torrents ?? 0} active`;
              } else if (svc.name === 'soulseek' && svc.ok) {
                detail = `${svc.active_searches ?? 0} active searches`;
              } else if (svc.version) {
                detail = `v${svc.version}`;
              } else if (!svc.ok) {
                detail = svc.error ?? 'unreachable';
              }
              return (
                <View
                  key={svc.name}
                  style={[styles.sysRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
                    <Text style={{ color: theme.fgStrong, fontSize: 14, textTransform: 'capitalize' }}>{svc.name}</Text>
                  </View>
                  <Text style={{ color: theme.fgMuted, fontSize: 12, maxWidth: 180, textAlign: 'right' }} numberOfLines={1}>{detail}</Text>
                </View>
              );
            })}

            {/* Storage */}
            {sysStatus.storage && !sysStatus.storage.error && (() => {
              const { music_bytes, music_files, disk_total_bytes: diskTotal, disk_free_bytes: diskFree } = sysStatus.storage;
              const musicGB = music_bytes != null ? (music_bytes / 1073741824).toFixed(2) : null;
              const diskTotalGB = diskTotal != null ? (diskTotal / 1073741824 / 1024).toFixed(1) : null; // TB
              const diskFreeGB = diskFree != null ? (diskFree / 1073741824).toFixed(0) : null; // GB
              const diskPct = diskTotal && diskFree ? (diskTotal - diskFree) / diskTotal : 0;
              const barColor = diskPct > 0.9 ? '#F44336' : diskPct > 0.75 ? '#FF9800' : theme.accent;
              return (
                <View style={{ padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSoft, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.fgStrong, fontSize: 14 }}>Music library</Text>
                    <Text style={{ color: theme.fgMuted, fontSize: 12, fontFamily: font.mono }}>
                      {musicGB != null ? `${musicGB} GB` : '—'}{music_files != null ? ` · ${music_files} files` : ''}
                    </Text>
                  </View>
                  {diskTotal != null && (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: theme.fgMuted, fontSize: 12 }}>NAS free space</Text>
                        <Text style={{ color: diskPct > 0.9 ? '#F44336' : theme.fgMuted, fontSize: 12, fontFamily: font.mono }}>
                          {diskFreeGB} GB free / {diskTotalGB} TB
                        </Text>
                      </View>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.borderSoft, overflow: 'hidden', marginTop: 2 }}>
                        <View style={{ height: 4, borderRadius: 2, backgroundColor: barColor, width: `${Math.round(diskPct * 100)}%` }} />
                      </View>
                    </>
                  )}
                </View>
              );
            })()}

            {/* Library + download stats */}
            <View style={{ padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSoft, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.fgMuted, fontSize: 12 }}>Library</Text>
                <Text style={{ color: theme.fgStrong, fontSize: 12, fontFamily: font.mono }}>
                  {sysStatus.library.songs} songs · {sysStatus.library.artists} artists · {sysStatus.library.albums} albums
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.fgMuted, fontSize: 12 }}>Downloads</Text>
                <Text style={{ color: theme.fgStrong, fontSize: 12, fontFamily: font.mono }}>
                  {sysStatus.downloads.queued}q · {sysStatus.downloads.downloading}↓ · {sysStatus.downloads.failed} failed
                  {sysLoading ? '  ·' : ''}
                </Text>
              </View>
            </View>
          </>
        ) : (
          <View style={{ padding: 16 }}>
            <Text style={{ color: theme.fgMuted, fontSize: 14 }}>Could not load system status</Text>
          </View>
        )}
      </Section>

      <Section label="DEBUG" theme={theme}>
        <Pressable
          onPress={async () => {
            setSendingLogs(true);
            try {
              const logs = await readLogs();
              await sendDeviceLogs(logs);
              Alert.alert('Sent', 'Logs sent to server. Check container stdout or /tmp/device_debug.log.');
            } catch (e: any) {
              Alert.alert('Failed', e.message ?? String(e));
            } finally {
              setSendingLogs(false);
            }
          }}
          disabled={sendingLogs}
          style={[styles.logoutRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft }]}
        >
          <Text style={{ color: theme.fgStrong, fontSize: 15 }}>Send logs to server</Text>
          {sendingLogs
            ? <ActivityIndicator size="small" color={theme.accent} />
            : <Icon name="download" color={theme.fgSoft} size={16} />}
        </Pressable>
        <Pressable
          onPress={async () => {
            await clearLogs();
            Alert.alert('Cleared', 'Log buffer cleared.');
          }}
          style={styles.logoutRow}
        >
          <Text style={{ color: theme.fgMuted, fontSize: 15 }}>Clear logs</Text>
        </Pressable>
      </Section>

      <Section label="ACCOUNT" theme={theme}>
        <Pressable
          onPress={() => { clearAuth(); router.replace('/login'); }}
          style={styles.logoutRow}
        >
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '500' }}>Sign out</Text>
        </Pressable>
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
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  sysRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 11 },
});
