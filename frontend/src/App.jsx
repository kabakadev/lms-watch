import { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import CourseLayout from './components/CourseLayout';
import Login from './components/Login';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [target, setTarget] = useState(null); // { courseId, cmid }

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
    const onUnauthorized = () => { setUser(null); setTarget(null); };
    window.addEventListener('lms-unauthorized', onUnauthorized);
    return () => window.removeEventListener('lms-unauthorized', onUnauthorized);
  }, []);

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
    setTarget(null);
  };

  if (user === undefined) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!user) return <Login onLogin={setUser} />;

  return target ? (
    <CourseLayout
      courseId={target.courseId}
      initialCmid={target.cmid}
      onBack={() => setTarget(null)}
      onLogout={logout}
    />
  ) : (
    <Dashboard onOpen={(courseId, cmid) => setTarget({ courseId, cmid })} onLogout={logout} />
  );
}
