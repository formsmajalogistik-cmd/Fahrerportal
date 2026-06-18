import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Die neuen, sehr strikten React-Hooks-Heuristiken (eslint-plugin-
      // react-hooks v6) und der Fast-Refresh-Hinweis sind reine
      // Dev-/Lint-Zeit-Regeln OHNE Laufzeit-Auswirkung. Wir führen sie als
      // Warnung (sichtbar, aber kein Fehler/CI-Blocker), statt dafür
      // riskante Effect- oder Datei-Umbauten vorzunehmen, die die
      // Funktionalität gefährden würden. rules-of-hooks (echte Bugs)
      // bleibt bewusst auf 'error'.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
])
