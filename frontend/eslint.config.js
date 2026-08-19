import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const layerZones = [
  { target: 'shared', forbid: ['entities', 'features', 'widgets', 'pages', 'app'] },
  { target: 'entities', forbid: ['features', 'widgets', 'pages', 'app'] },
  { target: 'features', forbid: ['widgets', 'pages', 'app'] },
  { target: 'widgets', forbid: ['pages', 'app'] },
  { target: 'pages', forbid: ['app'] },
]

const buildZones = () =>
  layerZones.flatMap(({ target, forbid }) =>
    forbid.map((from) => ({
      target: `./src/${target}`,
      from: `./src/${from}`,
      message: `Layer "${target}" may not import from "${from}".`,
    })),
  )

export default tseslint.config(
  { ignores: ['coverage', 'dist', 'node_modules', 'src/graphql/generated/**', 'public/mockServiceWorker.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'import/no-restricted-paths': ['error', { zones: buildZones() }],
    },
  },
)
