import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform
} from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { useStore } from '../lib/store';
import { login } from '../lib/api';
import { font, radius } from '../lib/tokens';

export default function LoginScreen() {
  const theme = useTheme();
  const { setAuth } = useStore();
  const [serverUrl, setServerUrl] = useState('http://10.1.8.4:8001');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    useStore.setState({ serverUrl });
    try {
      const { access_token } = await login(username, password);
      setAuth(access_token, serverUrl);
    } catch (e: any) {
      setError('Login failed. Check credentials and server URL.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={[styles.logo, { color: theme.fgStrong, fontFamily: font.display }]}>
          Music
        </Text>
        <Text style={[styles.subtitle, { color: theme.fgMuted }]}>
          Connect to your server
        </Text>

        <View style={styles.fields}>
          {[
            { label: 'Server URL', value: serverUrl, set: setServerUrl, placeholder: 'http://10.1.8.4:8001', secure: false },
            { label: 'Username', value: username, set: setUsername, placeholder: 'admin', secure: false },
            { label: 'Password', value: password, set: setPassword, placeholder: '••••••••', secure: true },
          ].map(({ label, value, set, placeholder, secure }) => (
            <View key={label}>
              <Text style={[styles.fieldLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                {label.toUpperCase()}
              </Text>
              <TextInput
                value={value}
                onChangeText={set}
                placeholder={placeholder}
                placeholderTextColor={theme.fgSoft}
                secureTextEntry={secure}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  { backgroundColor: theme.surface, borderColor: theme.border, color: theme.fg },
                ]}
              />
            </View>
          ))}
        </View>

        {error ? <Text style={[styles.error, { color: theme.accent }]}>{error}</Text> : null}

        <TouchableOpacity
          onPress={handleLogin}
          style={[styles.btn, { backgroundColor: theme.accent }]}
          activeOpacity={0.85}
        >
          <Text style={[styles.btnText, { color: theme.onAccent }]}>Connect</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 32, gap: 8 },
  logo: { fontSize: 40, letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 15, marginBottom: 32 },
  fields: { gap: 16, marginBottom: 24 },
  fieldLabel: { fontSize: 10.5, letterSpacing: 0.12, marginBottom: 6, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
  },
  error: { fontSize: 13, marginBottom: 8 },
  btn: {
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { fontSize: 15, fontWeight: '600' },
});
