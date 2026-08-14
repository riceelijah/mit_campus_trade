import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'src/data/supercards.json'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            // Underscore-prefixed params/vars are this codebase's existing convention for
            // "intentionally unused" (e.g. Express error handlers, which need to declare
            // `next` for their 4-arg arity even when they don't call it).
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            // Only the two long-standing, universally-applicable hooks rules -- v7's full
            // "recommended" bundles the newer React Compiler-oriented rule set (purity,
            // immutability, set-state-in-effect, etc.), which flags idiomatic pre-compiler
            // patterns this plain React 18 app uses throughout (e.g. calling a memoized
            // async fetcher from a mount effect) as errors. Not adopting the Compiler here.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },
    {
        files: ['server/**/*.ts', 'scripts/**/*.ts'],
        languageOptions: {
            globals: globals.node,
        },
    },
    prettierConfig,
);
