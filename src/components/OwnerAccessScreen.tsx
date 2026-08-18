import React, { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  AuthRequestError,
  refreshCurrentUser,
  signInWithOwnerAccess,
} from '../auth';

interface OwnerAccessScreenProps {
  fingerprint: string;
}

type AccessState = 'loading' | 'setup-required' | 'invalid';

const upsertMeta = (name: string, content: string) => {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
};

export const OwnerAccessScreen: React.FC<OwnerAccessScreenProps> = ({ fingerprint }) => {
  const navigate = useNavigate();
  const processed = useRef(false);
  const [state, setState] = useState<AccessState>('loading');

  useLayoutEffect(() => {
    upsertMeta('robots', 'noindex,nofollow,noarchive');
    upsertMeta('referrer', 'no-referrer');
    if (processed.current) return;
    processed.current = true;

    const accessKey = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : '';
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );

    const finish = () => navigate('/', { replace: true });
    if (!accessKey) {
      refreshCurrentUser()
        .then(user => user ? finish() : setState('invalid'))
        .catch(() => setState('invalid'));
      return;
    }

    signInWithOwnerAccess(fingerprint, accessKey)
      .then(finish)
      .catch(error => {
        setState(
          error instanceof AuthRequestError && error.code === 'OWNER_SETUP_REQUIRED'
            ? 'setup-required'
            : 'invalid',
        );
      });
  }, [fingerprint, navigate]);

  return (
    <div className="ark-shell flex min-h-screen items-center justify-center px-4 text-[var(--text-primary)]">
      <div className="ark-panel w-full max-w-md p-8 text-center">
        {state === 'loading' && (
          <>
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <h1 className="text-2xl font-semibold text-white">正在验证安全访问</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">验证完成后将自动进入 ManuEval。</p>
          </>
        )}
        {state === 'setup-required' && (
          <>
            <h1 className="text-2xl font-semibold text-white">需要首次绑定</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              请先从普通登录页完成一次飞书登录，再重新打开你保存在可信位置的完整访问链接。
            </p>
            <button type="button" onClick={() => navigate('/login')} className="btn-primary mt-6 w-full">
              前往飞书登录
            </button>
          </>
        )}
        {state === 'invalid' && (
          <>
            <h1 className="text-2xl font-semibold text-white">访问链接无效</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              请重新打开保存在可信位置的完整链接；出于安全考虑，本页不会保留访问密钥。
            </p>
          </>
        )}
      </div>
    </div>
  );
};
