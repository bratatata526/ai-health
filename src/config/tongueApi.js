import appConfig from '../../app.json';

const extraBaseUrl = appConfig?.expo?.extra?.TONGUE_API_BASE_URL;

export const TONGUE_API_CONFIG = {
  BASE_URL:
    process.env.EXPO_PUBLIC_TONGUE_API_BASE_URL ||
    extraBaseUrl ||
    'http://127.0.0.1:5000',
};

