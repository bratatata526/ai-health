import { SecureStorage } from '../utils/secureStorage';

const KEY_PREFIX = '@ai_chat_history';
const MAX_MESSAGES = 100;

function buildKey(userId = 'guest') {
  return `${KEY_PREFIX}:${userId || 'guest'}`;
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
}

export class AIChatHistoryService {
  static async get(userId) {
    const key = buildKey(userId);
    const value = await SecureStorage.getItem(key);
    return normalizeMessages(value);
  }

  static async set(userId, messages) {
    const key = buildKey(userId);
    const normalized = normalizeMessages(messages);
    const trimmed = normalized.slice(-MAX_MESSAGES);
    await SecureStorage.setItem(key, trimmed, { silent: true });
    return trimmed;
  }

  static async clear(userId) {
    const key = buildKey(userId);
    await SecureStorage.removeItem(key, { silent: true });
  }
}

