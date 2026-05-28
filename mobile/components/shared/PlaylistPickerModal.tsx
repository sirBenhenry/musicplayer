import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { getUserPlaylists, createUserPlaylist, addSongToPlaylist } from '../../lib/api';
import { radius } from '../../lib/tokens';

interface Props {
  visible: boolean;
  songId: string;
  songTitle: string;
  onClose: () => void;
  onAdded?: (playlistName: string) => void;
}

export function PlaylistPickerModal({ visible, songId, songTitle, onClose, onAdded }: Props) {
  const theme = useTheme();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setCreating(false);
    setNewName('');
    setLoading(true);
    getUserPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const handleAdd = async (playlistId: string, playlistName: string) => {
    setAdding(playlistId);
    try {
      await addSongToPlaylist(playlistId, songId);
      onAdded?.(playlistName);
      onClose();
    } catch {
      // swallow — song may already be in playlist
      onClose();
    } finally {
      setAdding(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding('new');
    try {
      const pl = await createUserPlaylist(name);
      await addSongToPlaylist(pl.id, songId);
      onAdded?.(name);
      onClose();
    } catch {
      onClose();
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.heading, { color: theme.fgStrong }]} numberOfLines={1}>
            Add to playlist
          </Text>
          <Text style={[styles.sub, { color: theme.fgMuted }]} numberOfLines={1}>{songTitle}</Text>

          {loading ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 24 }} />
          ) : (
            <FlatList
              data={playlists}
              keyExtractor={(p) => p.id}
              style={{ maxHeight: 260 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => handleAdd(item.id, item.name)}
                  disabled={adding !== null}
                  style={[styles.row, { borderBottomColor: theme.borderSoft }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.rowName, { color: theme.fg }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.rowCount, { color: theme.fgMuted }]}>{item.song_count} songs</Text>
                  {adding === item.id && <ActivityIndicator size="small" color={theme.accent} />}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: theme.fgMuted }]}>No playlists yet</Text>
              }
            />
          )}

          {creating ? (
            <View style={[styles.newRow, { borderTopColor: theme.border }]}>
              <TextInput
                ref={inputRef}
                value={newName}
                onChangeText={setNewName}
                placeholder="Playlist name…"
                placeholderTextColor={theme.fgSoft}
                style={[styles.input, { color: theme.fg, borderColor: theme.border, backgroundColor: theme.bg }]}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreate}
              />
              <TouchableOpacity
                onPress={handleCreate}
                disabled={!newName.trim() || adding !== null}
                style={[styles.createBtn, { backgroundColor: theme.accent, opacity: newName.trim() ? 1 : 0.4 }]}
              >
                {adding === 'new'
                  ? <ActivityIndicator size="small" color={theme.onAccent} />
                  : <Text style={[styles.createBtnText, { color: theme.onAccent }]}>Create</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setCreating(true)}
              style={[styles.newPlaylistBtn, { borderTopColor: theme.border }]}
            >
              <Text style={[styles.newPlaylistText, { color: theme.accent }]}>+ New playlist</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 2,
  },
  sub: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowName: { flex: 1, fontSize: 15, fontWeight: '500' },
  rowCount: { fontSize: 12 },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  newPlaylistBtn: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  newPlaylistText: { fontSize: 15, fontWeight: '600' },
  newRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  createBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  createBtnText: { fontSize: 14, fontWeight: '600' },
});
