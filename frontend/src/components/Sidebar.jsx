import { useState } from 'react';

export default function Sidebar({ sections, activeId, onSelect }) {
  const [collapsed, setCollapsed] = useState({});

  return (
    <nav className="p-2">
      {sections.map((sec) => (
        <div key={sec.id} className="mb-1">
          <button
            onClick={() => setCollapsed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
            className="flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left text-sm font-bold uppercase text-slate-800 hover:bg-slate-50"
          >
            <span className={`mt-0.5 transition-transform ${collapsed[sec.id] ? '-rotate-90' : ''}`}>▾</span>
            <span className="break-words leading-snug">{sec.name}</span>
          </button>

          {!collapsed[sec.id] &&
            sec.modules.map((mod) => (
              <button
                key={mod.id}
                onClick={() => onSelect(mod)}
                className={`block w-full break-words rounded-lg py-3 pl-9 pr-3 text-left text-sm leading-snug ${
                  activeId === mod.id ? 'bg-[#0b1f4b] text-white' : 'text-slate-600 hover:bg-slate-50'
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
