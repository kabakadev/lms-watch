import { useState } from 'react';

export default function Sidebar({ sections, activeId, onSelect }) {
  const [collapsed, setCollapsed] = useState({});

  return (
    <nav className="w-80 shrink-0 bg-white border-r border-slate-200 overflow-y-auto sticky top-16 h-[calc(100vh-4rem)] p-2">
      {sections.map((sec) => (
        <div key={sec.id} className="mb-1">
          <button
            onClick={() => setCollapsed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
            className="w-full flex items-center gap-2 px-3 py-3 text-left text-sm font-bold uppercase text-slate-800 hover:bg-slate-50 rounded-lg"
          >
            <span className={`transition-transform ${collapsed[sec.id] ? '-rotate-90' : ''}`}>▾</span>
            <span className="truncate">{sec.name}</span>
          </button>

          {!collapsed[sec.id] &&
            sec.modules.map((mod) => (
              <button
                key={mod.id}
                title={mod.name}
                onClick={() => onSelect(mod)}
                className={`block w-full truncate text-left pl-9 pr-3 py-3 text-sm rounded-lg ${
                  activeId === mod.id
                    ? 'bg-[#0b1f4b] text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {mod.name}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}