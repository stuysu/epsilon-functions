/** @type {import("xo").FlatXoConfig} */
const xoConfig = [
	{
		ignores: ['**/*.md', 'clean-images/**', '_shared/google/**'],
	},
	{
		prettier: 'compat',
		semicolon: true,
		languageOptions: {
			globals: {
				Deno: 'readonly',
			},
			parserOptions: {
				projectService: true,
			},
		},
		rules: {
			'import-x/order': 'off',
			'import-x/newline-after-import': 'off',
			'import-x/no-duplicates': 'off',
			'import-x/extensions': 'off',
			'new-cap': 'off',
			'@typescript-eslint/triple-slash-reference': 'off',
			'@typescript-eslint/naming-convention': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-restricted-types': 'off',
			'unicorn/filename-case': 'off',
			'unicorn/prefer-node-protocol': 'off',
			'n/prefer-global/process': 'off',
			'capitalized-comments': 'off',
		},
	},
];

export default xoConfig;
