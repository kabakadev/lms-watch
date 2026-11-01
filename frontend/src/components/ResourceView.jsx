import DOMPurify from 'dompurify';

export default function ResourceView({ mod }) {
  const files = mod.contents || [];
  return (
    <div className="max-w-6xl rounded-2xl bg-white p-4 shadow-sm sm:p-8">
      <h1 className="mb-4 break-words text-xl font-bold text-slate-900 sm:text-2xl">{mod.name}</h1>
      {mod.url && (
        <a href={mod.url} target="_blank" rel="noopener noreferrer"
           className="mb-4 inline-block text-sm text-[#0b1f4b] underline">
          Open in Moodle ↗
        </a>
      )}
      {mod.description && (
        <div
          className="mb-6 break-words [&_img]:h-auto [&_img]:max-w-full"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mod.description) }}
        />
      )}
      {files.length === 0 && <p className="text-slate-400">No downloadable files in this item.</p>}
      <ul className="divide-y divide-slate-100">
        {files.map((f) => f.fileurl && (
          <li key={f.filename} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-all font-semibold text-slate-700">{f.filename}</p>
              <p className="text-sm text-slate-400">{(f.filesize / 1024).toFixed(1)} KB</p>
            </div>
            <a href={f.fileurl} target="_blank" rel="noopener noreferrer"
               className="shrink-0 rounded-lg bg-[#0b1f4b] px-4 py-2 text-center font-medium text-white hover:bg-[#13306e]">
              Download
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
