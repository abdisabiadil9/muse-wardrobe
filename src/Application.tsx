import { useEffect, useState } from 'react';
import { Button } from '@lenso/ui/button';
import App from './App';
import LiveApp from './LiveApp';
import {
  ApiError,
  createApi,
  errorMessage,
  type Capabilities,
  type Me,
} from './api/client';
import './live.css';
export default function Application() {
  const [api] = useState(() => createApi());
  const [state, setState] = useState<'loading' | 'demo' | 'live' | 'error'>(
    'loading',
  );
  const [caps, setCaps] = useState<Capabilities | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [error, setError] = useState(''),
    [showDemo, setShowDemo] = useState(false);
  const connect = async () => {
    setState('loading');
    setError('');
    let capabilities: Capabilities;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      capabilities = await api.get<Capabilities>(
        '/capabilities',
        controller.signal,
      );
      if (!['live', 'demo'].includes(capabilities.mode))
        throw new Error('没有业务服务');
      setCaps(capabilities);
    } catch {
      setState('demo');
      return;
    } finally {
      clearTimeout(timeout);
    }
    try {
      const user = await api.get<Me>('/me');
      api.setCsrf(user.csrf_token);
      setMe(user);
      setState('live');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? '请登录后使用你的云端衣橱。'
          : errorMessage(e),
      );
      setState('error');
    }
  };
  useEffect(() => {
    void connect();
  }, [api]);
  if (state === 'loading')
    return (
      <div className="live-connection">
        <h1>muse.</h1>
        <p>正在打开你的衣橱…</p>
      </div>
    );
  if (state === 'error')
    return (
      <div className="live-connection">
        <h1>你的衣橱</h1>
        <p role="alert">{error}</p>
        <a href="/api/v1/auth/login?return_to=/">登录并继续</a>
        <Button variant="bordered" onClick={() => void connect()}>
          重新连接
        </Button>
        <Button variant="borderless" onClick={() => setState('demo')}>
          先看看演示
        </Button>
      </div>
    );
  if (state === 'demo' || showDemo)
    return (
      <>
        <App />
        <button
          className="live-demo-switch"
          onClick={() =>
            state === 'live' ? setShowDemo(false) : void connect()
          }
        >
          {state === 'live'
            ? '演示内容 · 返回我的云端衣橱'
            : '演示模式 · 点击重新连接服务'}
        </button>
      </>
    );
  return (
    <LiveApp
      api={api}
      me={me!}
      capabilities={caps!}
      onDemo={() => setShowDemo(true)}
    />
  );
}
