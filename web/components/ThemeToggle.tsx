'use client';

export default function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('tropa-theme', next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  };
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Switch between light and dark">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </svg>
    </button>
  );
}
