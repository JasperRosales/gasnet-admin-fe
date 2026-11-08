import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The pages load their data with `useEffect(() => { load() }, [...])`. This rule flags every
      // such call, even when load() only sets state after an await (checked: it errors on that too).
      // New code should still load inside the effect with .then() and a cleanup flag (see App.jsx).
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
