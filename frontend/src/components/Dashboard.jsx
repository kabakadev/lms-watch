import { useEffect, useState } from 'react';

const API = '';

const fmtDue = (ts) =>
  new Date(ts * 1000).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });

function countdown(due, now) {
  const diff = due - Math.floor(now / 1000);
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400);
  const h = Math.floor((abs % 86400) / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const txt = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return { overdue: diff < 0, urgent: diff >= 0 && diff < 86400, label: diff < 0 ? `${txt} overdue` : `${txt} left` };
}

// "BSD 221 BCS YR1S2 Assembly Language Programming (Sep - Dec 2026)" -> "Assembly Language Programming"
function cleanName(full) {
  const n = full.replace(/\(.*?\)/g, '').trim();
  const parts = n.split(/YR\dS\d,?\s*/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  return n.replace(/^[A-Z]{3}\s?\d{3}\s*/, '').trim();
}

function Row({ item, now, onOpen }) {
  const done = item.status === 'submitted';
  const cd = item.duedate ? countdown(item.duedate, now) : null;
  let chip = ['bg-slate-100 text-slate-600', item.kind === 'assign' ? 'Not submitted' : 'To do'];
  if (done) chip = ['bg-emerald-100 text-emerald-700', item.graded ? 'Graded' : 'Submitted'];
  else if (cd?.overdue) chip = ['bg-red-100 text-red-700', 'Overdue'];
  else if (cd?.urgent) chip = ['bg-amber-100 text-amber-800', 'Due soon'];

  return (
    <button
      onClick={() => onOpen(item.course_id, item.cmid)}
      className="w-full border-b border-slate-100 bg-white px-4 py-3 text-left last:border-0 hover:bg-slate-50 sm:px-5 sm:py-4"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-slate-500" title={item.course_name}>{item.course_code}</span>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${chip[0]}`}>{chip[1]}</span>
      </span>
      <span className="mt-1 block break-words font-semibold text-slate-800">
        {item.kind !== 'assign' && (
          <span className="mr-2 text-xs font-bold uppercase text-slate-400">{item.kind}</span>
        )}
        {item.name}
      </span>
      {item.duedate > 0 && (
        <span className="mt-0.5 block text-sm text-slate-500">
          {fmtDue(item.duedate)}{!done && cd && ` · ${cd.label}`}
        </span>
      )}
    </button>
  );
}

export default function Dashboard({ onOpen, onLogout }) {
  const [items, setItems] = useState(null);
  const [courses, setCourses] = useState([]);
  const [activeUsers, setActiveUsers] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  const load = (refresh = false) => {
    setItems(null);
    Promise.all([
      fetch(`${API}/api/deadlines${refresh ? '?refresh=true' : ''}`).then((r) => {
        if (!r.ok) throw new Error('Failed to load deadlines');
        return r.json();
      }),
      fetch(`${API}/api/my-courses`).then((r) => r.json()),
    ])
      .then(([d, c]) => { setItems(d.items); setCourses(c.courses || []); })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);
  useEffect(() => {
    let cancelled = false;

    const loadActiveUsers = () => {
      fetch('/api/active-users')
        .then((r) => {
          if (!r.ok) throw new Error('Failed to load active users');
          return r.json();
        })
        .then((data) => {
          if (!cancelled) setActiveUsers(data.active_users);
        })
        .catch(() => {
          if (!cancelled) setActiveUsers(null);
        });
    };

    loadActiveUsers();
    const interval = setInterval(loadActiveUsers, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="p-8 text-red-500">{error}</div>;
  if (!items) return <div className="p-8 text-slate-400">Loading your deadlines...</div>;

  const nowSec = Math.floor(now / 1000);
  const open = items.filter((i) => i.status !== 'submitted');
  const upcoming = open.filter((i) => i.duedate === 0 || i.duedate >= nowSec);
  const overdue = open.filter((i) => i.duedate > 0 && i.duedate < nowSec).reverse();
  const submitted = items.filter((i) => i.status === 'submitted');

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex h-14 items-center justify-between gap-3 bg-[#0b1f4b] px-4 text-white sm:h-16 sm:px-8">
        <span className="min-w-0 truncate font-semibold tracking-wide">ZETECH · LMS</span>
        <div className="flex shrink-0 items-center gap-4 text-sm">
          <button onClick={() => load(true)} className="hover:underline">↻ Refresh</button>
          <button onClick={onLogout} className="hover:underline">Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 p-4 sm:space-y-10 sm:p-8">
        {activeUsers !== null && (
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-500">Active users</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{activeUsers}</p>
            <p className="mt-1 text-xs text-slate-400">Signed-in sessions seen in the last 5 minutes</p>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-900">
            Due soon <span className="font-normal text-slate-400">({upcoming.length})</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            {upcoming.length
              ? upcoming.map((i) => <Row key={i.key} item={i} now={now} onOpen={onOpen} />)
              : <p className="bg-white p-5 text-slate-500">Nothing pending. 🎉</p>}
          </div>
        </section>

        {overdue.length > 0 && (
          <details>
            <summary className="cursor-pointer text-lg font-bold text-slate-900">
              Overdue, not submitted <span className="font-normal text-slate-400">({overdue.length})</span>
            </summary>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              {overdue.map((i) => <Row key={i.key} item={i} now={now} onOpen={onOpen} />)}
            </div>
          </details>
        )}

        <details>
          <summary className="cursor-pointer text-lg font-bold text-slate-900">
            Submitted <span className="font-normal text-slate-400">({submitted.length})</span>
          </summary>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            {submitted.map((i) => <Row key={i.key} item={i} now={now} onOpen={onOpen} />)}
          </div>
        </details>

        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-900">My units</h2>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpen(c.id, null)}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#0b1f4b] hover:shadow sm:p-5"
              >
                <span className="text-xs font-bold text-slate-400">{c.fullname.match(/^[A-Z]{3}\s?\d{3}/)?.[0]}</span>
                <span className="mt-1 block break-words font-semibold text-slate-800">{cleanName(c.fullname)}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
