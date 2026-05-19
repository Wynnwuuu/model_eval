import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { completeFeishuLogin } from '../auth';

export const FeishuCallbackScreen: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const processed = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const code = searchParams.get('code');
    if (!code) {
      setError('飞书回调缺少授权码，请重新登录。');
      return;
    }

    completeFeishuLogin(code)
      .then(() => {
        const redirectTo = sessionStorage.getItem('redirectAfterLogin') || '/';
        sessionStorage.removeItem('redirectAfterLogin');
        navigate(redirectTo, { replace: true });
      })
      .catch(err => {
        console.error('Feishu callback failed', err);
        setError(err instanceof Error ? err.message : '登录失败，请重试。');
        processed.current = false;
      });
  }, [navigate, searchParams]);

  return (
    <div className="ark-shell flex min-h-screen items-center justify-center px-4 text-[var(--text-primary)]">
      <div className="ark-panel w-full max-w-md p-8 text-center">
        {error ? (
          <>
            <h1 className="text-2xl font-semibold text-white">登录失败</h1>
            <p className="mt-3 text-sm leading-6 text-red-200">{error}</p>
            <button type="button" onClick={() => navigate('/login')} className="btn-primary mt-6 w-full">
              重新登录
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <h1 className="text-2xl font-semibold text-white">正在登录</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">正在验证飞书身份，请稍候。</p>
          </>
        )}
      </div>
    </div>
  );
};
