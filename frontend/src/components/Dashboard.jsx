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
  let n = full.replace(/\(.*?\)/g, '').trim();
  const parts = n.split(/YR\dS\d,?\s*/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  return n.replace(/^[A-Z]{3}\s?\d{3}\s*/, '').trim();
}

function Row({ item, now, onOpen }) {
  const done = item.status === 'submitted';
  const cd = item.duedate ? countdown(item.duedate, now) : null;
  let chip = ['bg-slate-100 text-slate-600', 'Not submitted'];
  if (done) chip = ['bg-emerald-100 text-emerald-700', item.graded ? 'Graded' : 'Submitted'];
  else if (cd?.overdue) chip = ['bg-red-100 text-red-700', 'Overdue'];
  else if (cd?.urgent) chip = ['bg-amber-100 text-amber-800', 'Due soon'];

  return (
    <button
      onClick={() => onOpen(item.course_id, item.cmid)}
      className="w-full flex items-center gap-4 px-5 py-4 text-left bg-white hover:bg-slate-50 border-b border-slate-100 last:border-0"
    >
      <span className="w-20 shrink-0 text-xs font-bold text-slate-500" title={item.course_name}>
        {item.course_code}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-slate-800 truncate">{item.name}</span>
        {item.duedate > 0 && (
          <span className="block text-sm text-slate-500">
            {fmtDue(item.duedate)}{!done && cd && ` · ${cd.label}`}
          </span>
        )}
      </span>
      <span className={`shrink-0 text-xs font-semibold px-3 py-1 rounded-full ${chip[0]}`}>{chip[1]}</span>
    </button>
  );
}

export default function Dashboard({ onOpen }) {
  const [items, setItems] = useState(null);
  const [courses, setCourses] = useState([]);
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
      <header className="bg-[#0b1f4b] text-white px-8 h-16 flex items-center justify-between">
        <span className="font-semibold tracking-wide">ZETECH · Headless LMS</span>
        <button onClick={() => load(true)} className="text-sm hover:underline">↻ Refresh</button>
      </header>

      <main className="max-w-5xl mx-auto p-8 space-y-10">
        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-3">
            Due soon <span className="text-slate-400 font-normal">({upcoming.length})</span>
          </h2>
          <div className="rounded-xl overflow-hidden border border-slate-200">
            {upcoming.length
              ? upcoming.map((i) => <Row key={i.assignid} item={i} now={now} onOpen={onOpen} />)
              : <p className="bg-white p-5 text-slate-500">Nothing pending. 🎉</p>}
          </div>
        </section>

        {overdue.length > 0 && (
          <details>
            <summary className="cursor-pointer text-lg font-bold text-slate-900 mb-3">
              Overdue, not submitted <span className="text-slate-400 font-normal">({overdue.length})</span>
            </summary>
            <div className="rounded-xl overflow-hidden border border-slate-200 mt-3">
              {overdue.map((i) => <Row key={i.assignid} item={i} now={now} onOpen={onOpen} />)}
            </div>
          </details>
        )}

        <details>
          <summary className="cursor-pointer text-lg font-bold text-slate-900">
            Submitted <span className="text-slate-400 font-normal">({submitted.length})</span>
          </summary>
          <div className="rounded-xl overflow-hidden border border-slate-200 mt-3">
            {submitted.map((i) => <Row key={i.assignid} item={i} now={now} onOpen={onOpen} />)}
          </div>
        </details>

        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-3">My units</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpen(c.id, null)}
                className="text-left bg-white rounded-xl border border-slate-200 hover:border-[#0b1f4b] hover:shadow p-5 transition"
              >
                <span className="text-xs font-bold text-slate-400">{c.fullname.match(/^[A-Z]{3}\s?\d{3}/)?.[0]}</span>
                <span className="block font-semibold text-slate-800 mt-1">{cleanName(c.fullname)}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}