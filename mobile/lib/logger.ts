import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@debug_log/v1';
const MAX_LINES = 500;

const _buf: string[] = [];
let _timer: ReturnType<typeof setTimeout> | null = null;

function ts() {
  return new Date().toISOString();
}

export function appendLog(msg: string) {
  _buf.push(`${ts()} ${msg}`);
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_flush, 2000);
}

async function _flush() {
  if (!_buf.length) return;
  const lines = _buf.splice(0).join('\n') + '\n';
  try {
    const existing = (await AsyncStorage.getItem(KEY)) ?? '';
    const all = (existing + lines).split('\n');
    const trimmed = all.length > MAX_LINES ? all.slice(all.length - MAX_LINES) : all;
    await AsyncStorage.setItem(KEY, trimmed.join('\n'));
  } catch {}
}

// Call immediately — used from error handlers where process may die soon
export function flushNow() {
  _flush();
}

export async function readLogs(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(KEY)) ?? '(no logs yet)';
  } catch {
    return '(error reading logs)';
  }
}

export async function clearLogs() {
  _buf.length = 0;
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

// Set up global JS error handler + console.error capture.
// Call once from index.js before the React root mounts.
export function initLogger() {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    appendLog(`[${isFatal ? 'FATAL' : 'JSERR'}] ${error?.message}\n${error?.stack ?? ''}`);
    flushNow();
    prev?.(error, isFatal);
  });

  const _origErr = console.error;
  console.error = (...args: any[]) => {
    appendLog(`[console.error] ${args.map(String).join(' ')}`);
    _origErr(...args);
  };

  appendLog('[INIT] Logger started');
}
