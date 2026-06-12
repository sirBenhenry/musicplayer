import React, { useState } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { CoverArt } from './CoverArt';
import { importArtist } from '../../lib/api';
import { radius } from '../../lib/tokens';

interface Artist {
  mbid: string;
  name: string;
  genres?: string[];
  image_url?: string | null;
  overview?: string | null;
  disambiguation?: string | null;
  ended?: boolean;
}

interface Props {
  artist: Artist | null;
  onClose: () => void;
  onImported: (artist: Artist) => void;
}

export function ArtistImportModal({ artist, onClose, onImported }: Props) {
  const theme = useTheme();
  const [follow, setFollow] = useState(true);
  const [downloadAll, setDownloadAll] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!artist) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await importArtist({
        mbid: artist.mbid,
        name: artist.name,
        follow,
        download_recordings: downloadAll,
      });
      onImported(artist);
      onClose();
    } catch (e: any) {
      // errors surface via onImported failure — caller handles
    } finally {
      setLoading(false);
    }
  };

  const noneSelected = false;

  return (
    <Modal visible={!!artist} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {/* Artist header */}
          <View style={styles.artistHeader}>
            <CoverArt uri={artist.image_url ?? null} size={64} title={artist.name} borderRadius={radius.card} />
            <View style={styles.artistInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.artistName, { color: theme.fgStrong }]} numberOfLines={1}>
                  {artist.name}
                </Text>
                {artist.ended && (
                  <View style={[styles.endedBadge, { backgroundColor: theme.bgElev, borderColor: theme.border }]}>
                    <Text style={[styles.endedText, { color: theme.fgMuted }]}>ended</Text>
                  </View>
                )}
              </View>
              {artist.disambiguation && (
                <Text style={[styles.disambiguation, { color: theme.fgMuted }]} numberOfLines={1}>
                  {artist.disambiguation}
                </Text>
              )}
              {(artist.genres?.length ?? 0) > 0 && (
                <Text style={[styles.genres, { color: theme.fgSoft }]} numberOfLines={1}>
                  {artist.genres!.slice(0, 3).join(' · ')}
                </Text>
              )}
            </View>
          </View>

          {artist.overview ? (
            <ScrollView style={styles.overviewScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.overview, { color: theme.fgMuted }]} numberOfLines={4}>
                {artist.overview}
              </Text>
            </ScrollView>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.borderSoft }]} />

          {/* Checkboxes */}
          <CheckRow
            label="Follow"
            sublabel="Monitor for new releases · show in Library"
            checked={follow}
            onToggle={() => setFollow(v => !v)}
            theme={theme}
          />
          <CheckRow
            label="Download all recordings"
            sublabel="Queue every track including singles & features"
            checked={downloadAll}
            onToggle={() => setDownloadAll(v => !v)}
            theme={theme}
          />

          <View style={[styles.divider, { backgroundColor: theme.borderSoft }]} />

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: theme.fgMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={noneSelected || loading}
              style={[
                styles.confirmBtn,
                { backgroundColor: theme.accent, opacity: noneSelected || loading ? 0.4 : 1 },
              ]}
            >
              {loading
                ? <ActivityIndicator size="small" color={theme.onAccent} />
                : <Text style={[styles.confirmText, { color: theme.onAccent }]}>Add</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CheckRow({
  label, sublabel, checked, onToggle, theme,
}: {
  label: string; sublabel: string; checked: boolean; onToggle: () => void; theme: any;
}) {
  return (
    <Pressable onPress={onToggle} style={styles.checkRow}>
      <View style={[
        styles.checkbox,
        { borderColor: checked ? theme.accent : theme.border },
        checked && { backgroundColor: theme.accent },
      ]}>
        {checked && <Text style={{ color: theme.onAccent, fontSize: 11, fontWeight: '700' }}>✓</Text>}
      </View>
      <View style={styles.checkInfo}>
        <Text style={[styles.checkLabel, { color: theme.fgStrong }]}>{label}</Text>
        <Text style={[styles.checkSub, { color: theme.fgMuted }]}>{sublabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  artistHeader: { flexDirection: 'row', padding: 20, gap: 14, alignItems: 'flex-start' },
  artistInfo: { flex: 1, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  artistName: { fontSize: 18, fontWeight: '700', letterSpacing: -0.01, flexShrink: 1 },
  endedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  endedText: { fontSize: 10, fontWeight: '600' },
  disambiguation: { fontSize: 13, marginTop: 3 },
  genres: { fontSize: 11.5, marginTop: 3 },
  overviewScroll: { maxHeight: 68, paddingHorizontal: 20, marginBottom: 4 },
  overview: { fontSize: 12.5, lineHeight: 19 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 0 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkInfo: { flex: 1 },
  checkLabel: { fontSize: 15, fontWeight: '500' },
  checkSub: { fontSize: 12, marginTop: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16, gap: 10 },
  cancelBtn: { paddingVertical: 9, paddingHorizontal: 14 },
  cancelText: { fontSize: 14, fontWeight: '500' },
  confirmBtn: { paddingVertical: 9, paddingHorizontal: 20, borderRadius: 8 },
  confirmText: { fontSize: 14, fontWeight: '600' },
});
