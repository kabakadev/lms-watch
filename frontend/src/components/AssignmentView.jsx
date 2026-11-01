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
  <a href={f.fileurl} className="flex items-center gap-3 py-1 text-slate-700 hover:text-[#0b1f4b]">
    <span>📄</span>
    <span>{f.filename}</span>
    {f.timemodified && <span className="ml-6 text-slate-500">{fmtDate(f.timemodified)}</span>}
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

  if (!data) return error ? <p className="text-red-500">{error}</p> : <p className="text-slate-400">Loading assignment...</p>;

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
    <div className="bg-white rounded-2xl shadow-sm p-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{a.name}</h1>
      {a.duedate > 0 && <p className="text-sm text-slate-500 mb-6">Due: {fmtDate(a.duedate)}</p>}

      <div className="bg-slate-50 rounded-xl p-5 mb-6">
        <div
          className="max-w-none text-slate-800"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(a.intro || '') }}
        />
        {a.introattachments?.map((f) => <FileRow key={f.filename} f={f} />)}
      </div>

      {/* Submission area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!locked) addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed p-6 mb-4 text-center transition ${
          dragOver ? 'border-[#0b1f4b] bg-slate-50' : 'border-slate-300'
        }`}
      >
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <p className="text-slate-600 mb-3">
          {locked ? 'Submissions are locked for this assignment.' : 'Drag files here, or'}
        </p>
        {!locked && (
          <button
            onClick={() => fileInput.current.click()}
            className="bg-[#0b1f4b] hover:bg-[#13306e] text-white font-semibold px-6 py-3 rounded-lg"
          >
            {subStatus === 'new' ? 'Add submission' : 'Add or replace files'}
          </button>
        )}
      </div>

      {staged.length > 0 && (
        <div className="mb-4">
          <p className="font-semibold text-slate-800 mb-2">Ready to send</p>
          <ul className="space-y-1">
            {staged.map((f) => (
              <li key={f.name} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-2 text-sm">
                <span>📎 {f.name} <span className="text-slate-400 ml-2">{(f.size / 1024).toFixed(1)} KB</span></span>
                <button onClick={() => { setStaged(staged.filter((x) => x !== f)); setPlan(null); }} className="text-slate-400 hover:text-red-500">✕</button>
              </li>
            ))}
          </ul>
          {!plan && (
            <button onClick={review} disabled={busy} className="mt-3 border border-[#0b1f4b] text-[#0b1f4b] font-semibold px-5 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">
              {busy ? 'Checking...' : 'Review changes'}
            </button>
          )}
        </div>
      )}

      {plan && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm">
          <p className="font-bold text-slate-900 mb-2">
            After this, the submission will contain {plan.total} of {plan.max} files:
          </p>
          <ul className="space-y-1 mb-3">
            {plan.keep.map((n) => <li key={n}>✔ {n} <span className="text-slate-500">(kept as is)</span></li>)}
            {plan.replace.map((n) => <li key={n}>↻ {n} <span className="text-slate-500">(replaces the existing file)</span></li>)}
            {plan.add.map((n) => <li key={n}>＋ {n} <span className="text-slate-500">(new)</span></li>)}
          </ul>
          {diff !== null && diff < 0 && subStatus !== 'submitted' && (
            <p className="text-red-700 mb-3">This assignment is past its due date. Moodle may mark it late or refuse it.</p>
          )}
          <div className="flex gap-3">
            <button onClick={confirm} disabled={busy} className="bg-[#0b1f4b] hover:bg-[#13306e] text-white font-semibold px-6 py-2 rounded-lg disabled:opacity-50">
              {busy ? 'Submitting...' : 'Confirm and submit'}
            </button>
            <button onClick={() => setPlan(null)} disabled={busy} className="px-4 py-2 text-slate-600 hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="text-red-600 mb-4">{error}</p>}
      {done && <p className="text-emerald-700 font-semibold mb-4">Submitted. The status table below has been refreshed from Moodle.</p>}

      <h2 className="text-xl font-bold text-slate-900 mt-8 mb-4">Submission status</h2>
      <table className="w-full border border-slate-200 text-sm">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={k} className="border-b border-slate-200 last:border-0">
              <th className="w-1/3 text-left font-bold bg-slate-100 px-4 py-4">{k}</th>
              <td className={`px-4 py-4 ${i % 2 ? 'bg-white' : 'bg-slate-50'}`}>{v}</td>
            </tr>
          ))}
          {subFiles.length > 0 && (
            <tr>
              <th className="text-left font-bold bg-slate-100 px-4 py-4">File submissions</th>
              <td className="px-4 py-4">{subFiles.map((f) => <FileRow key={f.filename} f={f} />)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}