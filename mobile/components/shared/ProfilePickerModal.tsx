import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from './Icon';
import { font, radius } from '../../lib/tokens';
import { setSongProfile } from '../../lib/api';
import { useStore } from '../../lib/store';
import * as haptics from '../../lib/haptics';

interface Props {
  visible: boolean;
  songId?: string;
  songTitle: string;
  currentProfileId?: string | null;
  onClose: () => void;
  onAssigned?: (profileName: string | null) => void;
  /** If provided, skip the API call — just return the picked profile ID. */
  onPick?: (profileId: string | null, profileName: string | null) => void;
  /** Label for the bottom null-choice row (default: "All Music only"). */
  noneLabel?: string;
}

export function ProfilePickerModal({ visible, songId, songTitle, currentProfileId, onClose, onAssigned, onPick, noneLabel }: Props) {
  const theme = useTheme();
  const { profiles } = useStore();
  const [saving, setSaving] = useState<string | 'none' | null>(null);

  const nonCatchall = profiles.filter(p => !p.is_catchall);

  const handlePick = async (profileId: string | null, profileName: string | null) => {
    if (onPick) {
      onPick(profileId, profileName);
      onClose();
      return;
    }
    if (!songId) return;
    setSaving(profileId ?? 'none');
    try {
      await setSongProfile(songId, profileId);
      haptics.success();
      onAssigned?.(profileName);
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not assign profile');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.heading, { color: theme.fgStrong }]}>{onPick ? 'Add to profile' : 'Assign profile'}</Text>
          <Text style={[styles.sub, { color: theme.fgMuted }]} numberOfLines={1}>{songTitle}</Text>

          <FlatList
            data={nonCatchall}
            keyExtractor={p => p.id}
            style={{ maxHeight: 320 }}
            renderItem={({ item }) => {
              const active = item.id === currentProfileId;
              const isSaving = saving === item.id;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => handlePick(item.id, item.name)}
                  disabled={saving !== null}
                >
                  <View style={[styles.glyph, { backgroundColor: theme.bgElev }]}>
                    <Text style={styles.glyphText}>{item.glyph ?? '🎵'}</Text>
                  </View>
                  <Text style={[styles.rowName, { color: theme.fgStrong }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {isSaving
                    ? <ActivityIndicator size="small" color={theme.accent} />
                    : active
                      ? <Icon name="check" color={theme.accent} size={18} />
                      : null}
                </Pressable>
              );
            }}
          />

          {/* None / unassign */}
          <Pressable
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: 'transparent', opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => handlePick(null, null)}
            disabled={saving !== null}
          >
            <View style={[styles.glyph, { backgroundColor: theme.bgElev }]}>
              <Text style={styles.glyphText}>🎶</Text>
            </View>
            <Text style={[styles.rowName, { color: theme.fgMuted }]}>{noneLabel ?? 'All Music only'}</Text>
            {saving === 'none'
              ? <ActivityIndicator size="small" color={theme.accent} />
              : !currentProfileId
                ? <Icon name="check" color={theme.accent} size={18} />
                : null}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  heading: { fontSize: 16, fontWeight: '600', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 2 },
  sub: { fontSize: 13, paddingHorizontal: 20, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  glyph: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontSize: 18 },
  rowName: { flex: 1, fontSize: 15, fontWeight: '500' },
});
