import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from './Icon';
import { font, radius } from '../../lib/tokens';
import { deleteSong } from '../../lib/api';
import * as haptics from '../../lib/haptics';

export interface SongAction {
  id: string;
  title: string;
}

interface Props {
  visible: boolean;
  song: SongAction | null;
  onClose: () => void;
  onAddToPlaylist: () => void;
  onAssignProfile: () => void;
  onDeleted: () => void;
  /** Optional — when provided, shows a "Play next" row (hidden for the currently playing song). */
  onPlayNext?: () => void;
}

export function SongActionSheet({ visible, song, onClose, onAddToPlaylist, onAssignProfile, onDeleted, onPlayNext }: Props) {
  const theme = useTheme();
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = () => {
    if (!song) return;
    haptics.warn();
    Alert.alert(
      'Delete song',
      `Permanently delete "${song.title}"? This removes the file and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteSong(song.id);
              onClose();
              onDeleted();
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not delete song');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.handle, { backgroundColor: theme.border }]} />

        <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
          {song?.title ?? ''}
        </Text>

        {onPlayNext && (
          <Pressable
            style={({ pressed }) => [styles.row, { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.6 : 1 }]}
            onPress={() => { onClose(); setTimeout(onPlayNext, 120); }}
          >
            <Icon name="skip" color={theme.fgMuted} size={20} />
            <Text style={[styles.rowLabel, { color: theme.fgStrong }]}>Play next</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.row, { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.6 : 1 }]}
          onPress={() => { onClose(); setTimeout(onAddToPlaylist, 120); }}
        >
          <Icon name="plus" color={theme.fgMuted} size={20} />
          <Text style={[styles.rowLabel, { color: theme.fgStrong }]}>Add to playlist</Text>
          <Icon name="chevronRight" color={theme.fgFaint} size={18} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.row, { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.6 : 1 }]}
          onPress={() => { onClose(); setTimeout(onAssignProfile, 120); }}
        >
          <Icon name="filter" color={theme.fgMuted} size={20} />
          <Text style={[styles.rowLabel, { color: theme.fgStrong }]}>Assign profile</Text>
          <Icon name="chevronRight" color={theme.fgFaint} size={18} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.row, { borderBottomColor: 'transparent', opacity: pressed ? 0.6 : 1 }]}
          onPress={handleDelete}
          disabled={deleting}
        >
          {deleting
            ? <ActivityIndicator size="small" color={theme.danger} />
            : <Icon name="trash" color={theme.danger} size={20} />}
          <Text style={[styles.rowLabel, { color: theme.danger }]}>Delete song</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.cancelBtn, { backgroundColor: theme.bgElev, opacity: pressed ? 0.7 : 1 }]}
          onPress={onClose}
        >
          <Text style={[styles.cancelLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>CANCEL</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: radius.petal,
    borderTopRightRadius: radius.petal,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    paddingHorizontal: 20,
    paddingVertical: 12,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  cancelBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: radius.card,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
