import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import AssignmentView from './AssignmentView';
import ResourceView from './ResourceView';

const API = '';

export default function CourseLayout({ courseId,initialCmid, onBack }) {
  const [sections, setSections] = useState([]);
  const [active, setActive] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
            modules: (s.modules || []).filter(
              (m) => m.modname !== 'label' && m.uservisible !== false
            ),
          }))
          .filter((s) => s.modules.length);
        setSections(secs);
        const all = secs.flatMap((s) => s.modules);
        setActive(all.find((m) => m.id === initialCmid) ?? all[0] ?? null);
      })
      .catch((e) => setError(e.message));
  }, [courseId]);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="h-16 bg-[#0b1f4b] text-white flex items-center gap-6 px-6 sticky top-0 z-20">
        <button onClick={() => setSidebarOpen((o) => !o)} className="text-xl" title="Toggle course index">☰</button>
        <button onClick={onBack} className="text-sm hover:underline">← Dashboard</button>
        <span className="font-semibold tracking-wide">ZETECH · Headless LMS</span>
      </header>

      <div className="flex flex-1">
        {sidebarOpen && (
          <Sidebar sections={sections} activeId={active?.id} onSelect={setActive} />
        )}

        <main className="flex-1 p-8 min-w-0">
          {error && <p className="text-red-500">{error}</p>}
          {!error && !active && <p className="text-slate-400">Loading course materials...</p>}
          {active?.modname === 'assign' && (
            <AssignmentView key={active.id} courseId={courseId} mod={active} />
          )}
          {active && active.modname !== 'assign' && (
            <ResourceView key={active.id} mod={active} />
          )}
        </main>
      </div>

      <footer className="h-24 bg-[#c8622a]" />
    </div>
  );
}