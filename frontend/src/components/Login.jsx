import { useState } from 'react';

const NOTICE_ACCEPTED_KEY = 'lms-watch-notice-accepted';

function Notice({ onAccept }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm p-8 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Private project: read before continuing</h1>
        <p className="text-sm font-semibold text-slate-700">
          You must click “Accept and continue to sign in” to dismiss this notice. No futher notices will be issues, proceed at your own risk!!!!.
        </p>

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-slate-800 space-y-3">
          <p>
            <strong>This is an unofficial, invite-only project.</strong> It is not run by or affiliated with
            Zetech University. If you were not invited, please close this page.
          </p>
          <p>
            To work, it asks for your <strong>eLearning username and password</strong>. They are sent over HTTPS
            to this server (hosted on Render), used once to get an access token from Zetech's eLearning site, and
            then discarded. This app does not store or log your password.
          </p>
          <p>
            The access token stays only inside an encrypted cookie in your browser. It can read your courses and
            grades and submit work as you, so treat this browser like your password.
          </p>
          <p>
            If you stop trusting this app, sign out here and change your eLearning password, which should
            invalidate the token. To have your invite removed, tell whoever sent you this link.
          </p>
          <p>
            Zetech may have rules about third-party access to its systems. You use this at your own risk, and
            availability is not guaranteed.
          </p>
          <p>Do not use it on a shared or public computer.</p>
        </div>

        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I was invited, I have read this, and I accept the risks.</span>
        </label>

        <button
          disabled={!checked}
          onClick={onAccept}
          className="w-full bg-[#0b1f4b] hover:bg-[#13306e] disabled:opacity-40 text-white font-semibold rounded-lg py-3"
        >
          Accept and continue to sign in
        </button>
      </div>
    </div>
  );
}

export default function Login({ onLogin }) {
  const [noticeAccepted, setNoticeAccepted] = useState(
    () => localStorage.getItem(NOTICE_ACCEPTED_KEY) === 'true',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const acceptNotice = () => {
    localStorage.setItem(NOTICE_ACCEPTED_KEY, 'true');
    setNoticeAccepted(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        body: new URLSearchParams({ username, password }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof j?.detail === 'string' ? j.detail : 'Login failed');
      setPassword('');
      onLogin({ fullname: j.fullname });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#0b1f4b] focus:outline-none';

  if (!noticeAccepted) return <Notice onAccept={acceptNotice} />;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Zetech LMS</h1>
        <p className="text-sm text-slate-500">Sign in with your eLearning username and password.</p>

        <input className={field} placeholder="Username" value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        <input className={field} type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" required />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy}
          className="w-full bg-[#0b1f4b] hover:bg-[#13306e] disabled:opacity-60 text-white font-semibold rounded-lg py-3">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
        {busy && <p className="text-xs text-slate-400">If the server was asleep this can take up to a minute.</p>}

        <p className="text-xs text-slate-400 pt-2">
          Your password is used once to get an access token and is never stored. The token is kept in an encrypted cookie in this browser.
        </p>
      </form>
    </div>
  );
}
