import { backendEndpoints } from './contracts';

/** The prototype intentionally never opens a paid cloud connection. */
export const decartIntegration = {
  mode: 'demo' as 'demo' | 'live',
  model: 'lucy-vton-3.6',
  tokenEndpoint: backendEndpoints.decartToken,
  documentation: 'https://platform.decart.ai/models/lucy-vton',
} as const;

export interface GarmentCondition {
  garmentId: string;
  prompt: string;
  image: string | Blob;
}

export interface DecartRealtimePort {
  set(condition: { prompt: string; image: string | Blob }): Promise<void>;
  disconnect(): void;
}

/** Inject an adapter wrapping @decartai/sdk after backend capability is enabled. */
export interface DecartSdkPort {
  connect(
    stream: MediaStream,
    options: {
      modelId: string;
      apiKeyProvider: () => Promise<string>;
      onRemoteStream: (stream: MediaStream) => void;
      initialState: { prompt: string; image: string | Blob };
    },
  ): Promise<DecartRealtimePort>;
}

export interface StartTryOnOptions {
  enabled: boolean;
  draftId: string;
  garment: GarmentCondition;
  sdk: DecartSdkPort;
  onRemoteStream: (stream: MediaStream) => void;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  capture?: () => Promise<MediaStream>;
}

/** Call only following the user's explicit Start action and backend readiness. */
export async function startDecartTryOn(options: StartTryOnOptions) {
  if (!options.enabled) throw new Error('DECART_NOT_CONFIGURED');
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const request = options.fetcher ?? fetch;
  let selectedGarment = options.garment;
  let local: MediaStream | undefined;
  let remote: DecartRealtimePort | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    options.signal?.removeEventListener('abort', stop);
    try { remote?.disconnect(); }
    finally { local?.getTracks().forEach(track => track.stop()); }
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    // Audio is unnecessary for garment try-on. Never request a microphone here.
    local = await (options.capture?.() ?? navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }));
    if (stopped || options.signal?.aborted) {
      local.getTracks().forEach(track => track.stop());
      throw new DOMException('Aborted', 'AbortError');
    }
    remote = await options.sdk.connect(local, {
      modelId: decartIntegration.model,
      apiKeyProvider: async () => {
        if (stopped) throw new DOMException('Aborted', 'AbortError');
        // The server authenticates the app user, checks quotas, and mints a scoped
        // short-lived token. The SDK invokes this provider on each reconnect.
        const response = await request(backendEndpoints.decartToken, {
          method: 'POST', credentials: 'same-origin', signal: options.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftId: options.draftId, garmentId: selectedGarment.garmentId }),
        });
        if (!response.ok) throw new Error(`DECART_TOKEN_${response.status}`);
        const token: unknown = await response.json();
        if (!token || typeof token !== 'object' || !('apiKey' in token)
          || typeof token.apiKey !== 'string' || !token.apiKey.startsWith('ek_')) {
          throw new Error('DECART_INVALID_CLIENT_TOKEN');
        }
        return token.apiKey;
      },
      onRemoteStream: stream => { if (!stopped) options.onRemoteStream(stream); },
      initialState: { prompt: selectedGarment.prompt, image: selectedGarment.image },
    });
    if (stopped) { remote.disconnect(); throw new DOMException('Aborted', 'AbortError'); }
    return {
      stop,
      async setGarment(next: GarmentCondition) {
        if (stopped || !remote) throw new Error('DECART_SESSION_CLOSED');
        // set() replaces full state: always send BOTH prompt and garment image.
        await remote.set({ prompt: next.prompt, image: next.image });
        selectedGarment = next;
      },
    };
  } catch (error) { stop(); throw error; }
}
