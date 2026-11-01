import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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
