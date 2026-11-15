/**
 * How this browser looks. `system` follows the device's own appearance; `light` and `dark` are explicit choices that
 * never move on their own. The preference is this browser's, kept in `localStorage`, and applies as the `dark` class on
 * the page (the script in web/index.html paints a load from it before modules run).
 */
export type ThemePreference = 'system' | 'light' | 'dark'

const preferenceKey = 'ultimate.theme'
const pageBackground = { light: '#f9fafb', dark: '#111112' }

export function storedTheme(): ThemePreference {
  const stored = localStorage.getItem(preferenceKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export const resolveTheme = (preference: ThemePreference): 'light' | 'dark' =>
  preference === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : preference

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference)
  localStorage.setItem(preferenceKey, preference)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', pageBackground[theme])
}

export function watchSystemTheme(change: () => void): () => void {
  const query = matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}
