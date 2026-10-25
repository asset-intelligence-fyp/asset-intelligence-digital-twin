// Persistent, accessible light/dark/system appearance for the Asset Intelligence UI.
// Only the presentation layer changes; BIM geometry and telemetry remain untouched.
export const THEME_KEY = "assetIntelligenceTheme";

export function getSavedTheme(storage = window.localStorage) {
  try {
    const value = storage.getItem(THEME_KEY);
    return ["light", "dark", "system"].includes(value) ? value : "system";
  } catch { return "system"; }
}

export function applyTheme(theme = getSavedTheme(), { persist = false } = {}) {
  const selected = ["light", "dark", "system"].includes(theme) ? theme : "system";
  if (persist) {
    try { window.localStorage.setItem(THEME_KEY, selected); } catch { /* storage may be restricted */ }
  }
  const isDark = selected === "dark" ||
    (selected === "system" && window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.documentElement.dataset.themePreference = selected;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark ? "#171b20" : "#f8f9fa";
  document.querySelectorAll("[data-appearance-option]").forEach(option => {
    const checked = option.dataset.appearanceOption === selected;
    option.setAttribute("aria-pressed", String(checked));
    option.classList.toggle("is-selected", checked);
  });
  const button = document.querySelector("[data-theme-toggle]");
  if (button) {
    button.textContent = isDark ? "☀" : "☾";
    button.setAttribute("aria-label", isDark ? "Use light appearance" : "Use dark appearance");
    button.title = isDark ? "Switch to light appearance" : "Switch to dark appearance";
  }
  return selected;
}

export function initAppearance() {
  applyTheme(getSavedTheme());
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  const refresh = () => {
    if (getSavedTheme() === "system") applyTheme("system");
  };
  query?.addEventListener?.("change", refresh);
  return () => query?.removeEventListener?.("change", refresh);
}
