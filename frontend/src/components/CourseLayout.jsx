import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import AssignmentView from './AssignmentView';
import ResourceView from './ResourceView';

const API = '';
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

export default function CourseLayout({ courseId, initialCmid, onBack, onLogout }) {
  const [sections, setSections] = useState([]);
  const [active, setActive] = useState(null);
  // Desktop: side column, open. Phone: a drawer, closed when we deep-linked to an item
  // (e.g. from a deadline) and open when the unit was opened from the dashboard.
  const [open, setOpen] = useState(() => isDesktop() || initialCmid == null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/course-content/${courseId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch course content');
        return r.json();
      })
      .then((data) => {
        const secs = data
          .map((s) => ({
            ...s,
            modules: (s.modules || []).filter((m) => m.modname !== 'label' && m.uservisible !== false),
          }))
          .filter((s) => s.modules.length);
        setSections(secs);
        const all = secs.flatMap((s) => s.modules);
        setActive(all.find((m) => m.id === initialCmid) ?? all[0] ?? null);
      })
      .catch((e) => setError(e.message));
  }, [courseId, initialCmid]);

  const pick = (m) => {
    setActive(m);
    if (!isDesktop()) setOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 bg-[#0b1f4b] px-3 text-white sm:px-6">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle course index"
          className="h-10 w-10 shrink-0 rounded-lg text-xl hover:bg-white/10"
        >
          ☰
        </button>
        <button onClick={onBack} className="shrink-0 text-sm hover:underline">← Units</button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {active?.name ?? 'Loading...'}
        </span>
        <button onClick={onLogout} className="shrink-0 text-sm hover:underline">Sign out</button>
      </header>

      <div className="flex flex-1">
        {open && (
          <div
            onClick={() => setOpen(false)}
            className="fixed bottom-0 left-0 right-0 top-14 z-20 bg-black/40 lg:hidden"
          />
        )}

        <aside
          className={`fixed bottom-0 left-0 top-14 z-30 w-[85vw] max-w-sm overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-200 lg:sticky lg:bottom-auto lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:w-80 lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
            open ? 'translate-x-0' : '-translate-x-full lg:hidden'
          }`}
        >
          <Sidebar sections={sections} activeId={active?.id} onSelect={pick} />
        </aside>

        <main className="min-w-0 flex-1 p-3 sm:p-6 lg:p-8">
          {error && <p className="text-red-500">{error}</p>}
          {!error && !active && <p className="text-slate-400">Loading course materials...</p>}
          {active?.modname === 'assign' && (
            <AssignmentView key={active.id} courseId={courseId} mod={active} />
          )}
          {active && active.modname !== 'assign' && <ResourceView key={active.id} mod={active} />}
        </main>
      </div>

      <footer className="h-16 bg-[#c8622a] sm:h-24" />
    </div>
  );
}
