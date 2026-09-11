/* Resolve appearance before styles paint, including native form controls. */
(() => {
  const revision = 'premium-light-1';
  let preference = 'light';
  try {
    // Introduce the requested light default once; subsequent choices persist.
    if (localStorage.getItem('sql-studio-theme-revision') === revision) {
      preference = localStorage.getItem('sql-studio-theme') || 'light';
    }
    if (!['light', 'dark', 'midnight', 'system'].includes(preference)) preference = 'light';
    localStorage.setItem('sql-studio-theme', preference);
    localStorage.setItem('sql_studio_theme', preference);
    localStorage.setItem('sql-studio-theme-revision', revision);
  } catch (_) { /* Keep the light default when browser storage is unavailable. */ }
  const effective = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective === 'light' ? 'light' : 'dark';
})();
