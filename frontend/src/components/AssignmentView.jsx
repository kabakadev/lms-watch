import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

const API = '';

const SUBMISSION_LABEL = {
  new: 'No submissions have been made yet',
  draft: 'Draft (not submitted)',
  submitted: 'Submitted for grading',
  reopened: 'Reopened',
};

function fmtDuration(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} hour${h > 1 ? 's' : ''}`, `${m} min${m !== 1 ? 's' : ''}`]
    .filter(Boolean)
    .join(' ');
}

const fmtDate = (ts) =>
  new Date(ts * 1000).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

const FileRow = ({ f }) => (
  <a
    href={f.fileurl}
    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-slate-700 hover:text-[#0b1f4b]"
  >
    <span className="break-all">📄 {f.filename}</span>
    {f.timemodified && <span className="text-sm text-slate-500">{fmtDate(f.timemodified)}</span>}
  </a>
);

export default function AssignmentView({ courseId, mod }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [reload, setReload] = useState(0);
  const [staged, setStaged] = useState([]);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [done, setDone] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/assignment/${courseId}/${mod.id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Could not load assignment');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [courseId, mod.id, reload]);

  const addFiles = (list) => {
    setStaged((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      [...list].forEach((f) => byName.set(f.name, f));
      return [...byName.values()];
    });
    setPlan(null);
    setDone(false);
  };

  const send = async (dryRun) => {
    const form = new FormData();
    staged.forEach((f) => form.append('files', f));
    form.append('dry_run', dryRun ? 'true' : 'false');
    const r = await fetch(`${API}/api/assignment/${courseId}/${mod.id}/files`, {
      method: 'POST',
      body: form,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(typeof j?.detail === 'string' ? j.detail : 'Request failed');
    return j;
  };

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await send(true));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await send(false);
      setStaged([]);
      setPlan(null);
      setDone(true);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return error ? <p className="text-red-500">{error}</p> : <p className="text-slate-400">Loading assignment...</p>;
  }

  const { assignment: a, status } = data;
  const attempt = status.lastattempt || {};
  const sub = attempt.submission || {};
  const subStatus = sub.status || 'new';
  const subFiles = (sub.plugins || []).find((p) => p.type === 'file')?.fileareas?.[0]?.files || [];

  const diff = a.duedate ? a.duedate - Math.floor(now / 1000) : null;
  let remaining = '—';
  if (diff !== null) remaining = diff > 0 ? `${fmtDuration(diff)} remaining` : `Overdue by ${fmtDuration(-diff)}`;
  if (subStatus === 'submitted') remaining = 'Submitted';

  const rows = [
    ['Submission status', SUBMISSION_LABEL[subStatus] || subStatus],
    ['Grading status', attempt.graded ? 'Graded' : 'Not graded'],
    ['Time remaining', remaining],
  ];

  const locked = attempt.canedit === false;

  return (
    <div className="max-w-6xl rounded-2xl bg-white p-4 shadow-sm sm:p-8">
      <h1 className="mb-1 break-words text-xl font-bold text-slate-900 sm:text-2xl">{a.name}</h1>
      {a.duedate > 0 && <p className="mb-6 text-sm text-slate-500">Due: {fmtDate(a.duedate)}</p>}

      <div className="mb-6 rounded-xl bg-slate-50 p-4 text-slate-800 sm:p-5">
        <div
          className="break-words [&_a]:text-[#0b1f4b] [&_a]:underline [&_img]:h-auto [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_table]:block [&_table]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(a.intro || '') }}
        />
        {a.introattachments?.map((f) => <FileRow key={f.filename} f={f} />)}
      </div>

      {/* Submission area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!locked) addFiles(e.dataTransfer.files); }}
        className={`mb-4 rounded-xl border-2 border-dashed p-4 text-center transition sm:p-6 ${
          dragOver ? 'border-[#0b1f4b] bg-slate-50' : 'border-slate-300'
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        {locked ? (
          <p className="text-slate-600">Submissions are locked for this assignment.</p>
        ) : (
          <>
            <p className="mb-3 hidden text-slate-600 sm:block">Drag files here, or</p>
            <button
              onClick={() => fileInput.current.click()}
              className="w-full rounded-lg bg-[#0b1f4b] px-6 py-3 font-semibold text-white hover:bg-[#13306e] sm:w-auto"
            >
              {subStatus === 'new' ? 'Add submission' : 'Add or replace files'}
            </button>
          </>
        )}
      </div>

      {staged.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 font-semibold text-slate-800">Ready to send</p>
          <ul className="space-y-1">
            {staged.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="break-all">📎 {f.name}</span>
                  <span className="ml-2 whitespace-nowrap text-slate-400">{(f.size / 1024).toFixed(1)} KB</span>
                </span>
                <button
                  onClick={() => { setStaged(staged.filter((x) => x !== f)); setPlan(null); }}
                  aria-label={`Remove ${f.name}`}
                  className="shrink-0 px-2 py-1 text-slate-400 hover:text-red-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {!plan && (
            <button
              onClick={review}
              disabled={busy}
              className="mt-3 w-full rounded-lg border border-[#0b1f4b] px-5 py-3 font-semibold text-[#0b1f4b] hover:bg-slate-50 disabled:opacity-50 sm:w-auto sm:py-2"
            >
              {busy ? 'Checking...' : 'Review changes'}
            </button>
          )}
        </div>
      )}

      {plan && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm sm:p-5">
          <p className="mb-2 font-bold text-slate-900">
            After this, the submission will contain {plan.total} of {plan.max} files:
          </p>
          <ul className="mb-3 space-y-1">
            {plan.keep.map((n) => <li key={n} className="break-all">✔ {n} <span className="text-slate-500">(kept as is)</span></li>)}
            {plan.replace.map((n) => <li key={n} className="break-all">↻ {n} <span className="text-slate-500">(replaces the existing file)</span></li>)}
            {plan.add.map((n) => <li key={n} className="break-all">＋ {n} <span className="text-slate-500">(new)</span></li>)}
          </ul>
          {diff !== null && diff < 0 && subStatus !== 'submitted' && (
            <p className="mb-3 text-red-700">This assignment is past its due date. Moodle may mark it late or refuse it.</p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={confirm}
              disabled={busy}
              className="w-full rounded-lg bg-[#0b1f4b] px-6 py-3 font-semibold text-white hover:bg-[#13306e] disabled:opacity-50 sm:w-auto sm:py-2"
            >
              {busy ? 'Submitting...' : 'Confirm and submit'}
            </button>
            <button
              onClick={() => setPlan(null)}
              disabled={busy}
              className="w-full px-4 py-2 text-slate-600 hover:underline sm:w-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-red-600">{error}</p>}
      {done && <p className="mb-4 font-semibold text-emerald-700">Submitted. The status below has been refreshed from Moodle.</p>}

      <h2 className="mb-4 mt-8 text-lg font-bold text-slate-900 sm:text-xl">Submission status</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 text-sm">
        {rows.map(([k, v], i) => (
          <div key={k} className="flex flex-col border-b border-slate-200 last:border-0 sm:flex-row">
            <div className="bg-slate-100 px-4 py-3 font-bold sm:w-1/3 sm:py-4">{k}</div>
            <div className={`px-4 py-3 sm:flex-1 sm:py-4 ${i % 2 ? 'bg-white' : 'bg-slate-50'}`}>{v}</div>
          </div>
        ))}
        {subFiles.length > 0 && (
          <div className="flex flex-col border-t border-slate-200 sm:flex-row">
            <div className="bg-slate-100 px-4 py-3 font-bold sm:w-1/3 sm:py-4">File submissions</div>
            <div className="min-w-0 px-4 py-3 sm:flex-1 sm:py-4">
              {subFiles.map((f) => <FileRow key={f.filename} f={f} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
