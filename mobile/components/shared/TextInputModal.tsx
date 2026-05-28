import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { radius } from '../../lib/tokens';

interface Props {
  visible: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function TextInputModal({ visible, title, placeholder, defaultValue = '', confirmLabel = 'OK', onConfirm, onCancel }: Props) {
  const theme = useTheme();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [visible, defaultValue]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
        pointerEvents="box-none"
      >
        <View style={[styles.dialog, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.fgStrong }]}>{title}</Text>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder ?? ''}
            placeholderTextColor={theme.fgSoft}
            style={[styles.input, { color: theme.fg, borderColor: theme.border, backgroundColor: theme.bg }]}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: theme.fgMuted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={!value.trim()}
              style={[styles.confirmBtn, { backgroundColor: theme.accent, opacity: value.trim() ? 1 : 0.4 }]}
            >
              <Text style={[styles.confirmText, { color: theme.onAccent }]}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  dialog: { borderRadius: radius.card, borderWidth: 1, padding: 20, gap: 16 },
  title: { fontSize: 16, fontWeight: '600' },
  input: {
    fontSize: 15, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 9, paddingHorizontal: 14 },
  cancelText: { fontSize: 14, fontWeight: '500' },
  confirmBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8 },
  confirmText: { fontSize: 14, fontWeight: '600' },
});
