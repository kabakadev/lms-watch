import DOMPurify from 'dompurify';

export default function ResourceView({ mod }) {
  const files = mod.contents || [];
  return (
    <div className="bg-white rounded-2xl shadow-sm p-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{mod.name}</h1>
      {mod.description && (
        <div className="mb-6" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }} />
      )}
      {files.length === 0 && <p className="text-slate-400">No downloadable files in this item.</p>}
      <ul className="divide-y divide-slate-100">
        {files.map((f) => f.fileurl && (
          <li key={f.filename} className="py-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-700">{f.filename}</p>
              <p className="text-sm text-slate-400">{(f.filesize / 1024).toFixed(1)} KB</p>
            </div>
            <a href={f.fileurl} target="_blank" rel="noopener noreferrer"
               className="px-4 py-2 bg-[#0b1f4b] text-white rounded-lg font-medium hover:bg-[#13306e]">
              Download
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}