import React, { useState } from 'react';
import { signInWithFeishu } from '../auth';

export const LoginScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithFeishu();
    } catch (err) {
      console.error('Failed to start Feishu login', err);
      setError(err instanceof Error ? err.message : '获取飞书登录链接失败');
      setLoading(false);
    }
  };

  return (
    <div className="ark-shell flex min-h-screen items-center justify-center px-4 text-[var(--text-primary)]">
      <div className="ark-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center border border-[var(--accent)] bg-[var(--accent)] font-black text-black">
          ME
        </div>
        <h1 className="text-2xl font-semibold text-white">登录 ManuEval</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          使用飞书账号进入协作评测工作台。
        </p>
        {error && (
          <div className="mt-5 border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={handleLogin}
          disabled={loading}
          className="btn-primary mt-6 w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? '正在跳转...' : '使用飞书登录'}
        </button>
      </div>
    </div>
  );
};
