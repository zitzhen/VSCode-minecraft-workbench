/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//
// Build script for the Minecraft Workbench extension when it is bundled as a
// built-in extension of BlockIDE (https://github.com/zitzhen/BlockIDE).
// Upstream: https://github.com/lopleec/VSCode-minecraft-workbench
//
// Bundles two entry points:
//   - src/extension.ts   -> dist/extension.js  (Node.js / CJS, the extension host entry)
//   - src/webview/app.ts -> dist/workbench.js  (browser / IIFE, the webview renderer)
//

import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const production = !process.argv.includes('--watch');
const output = { minify: production, sourcemap: !production, sourcesContent: false };

// XMCL 6.3.6 references an unpublished utils entry; unzip 2.2.0 points main at an omitted source file.
const alias: Record<string, string> = {
	'@xmcl/unzip': path.resolve(import.meta.dirname, 'node_modules/@xmcl/unzip/dist/index.js'),
	'@xmcl/core/utils': path.resolve(import.meta.dirname, 'src/compat/xmcl-utils.ts'),
};

const runtimeManifestPlugin: esbuild.Plugin = {
	name: 'runtime-manifest',
	setup(build) {
		build.onLoad({ filter: /[\\/]package\.json$/ }, async ({ path: file }) => {
			if (file !== path.resolve(import.meta.dirname, 'package.json')) {
				return;
			}
			// Commands, menus and build metadata belong in the VSIX manifest, not the JS bundle.
			const { name, version, publisher, repository } = JSON.parse(await readFile(file, 'utf8'));
			return {
				contents: JSON.stringify({ name, version, publisher, repository }),
				loader: 'json',
			};
		});
	},
};

const nodeBuild: esbuild.BuildOptions = {
	entryPoints: [path.join(import.meta.dirname, 'src/extension.ts')],
	bundle: true,
	platform: 'node',
	target: ['node20.18'],
	format: 'cjs',
	outfile: path.join(import.meta.dirname, 'dist/extension.js'),
	external: ['vscode'],
	alias,
	mainFields: ['module', 'main'],
	plugins: [runtimeManifestPlugin],
	metafile: production,
	logLevel: 'info',
	...output,
};

const browserBuild: esbuild.BuildOptions = {
	entryPoints: [path.join(import.meta.dirname, 'src/webview/app.ts')],
	bundle: true,
	platform: 'browser',
	target: ['es2022'],
	format: 'iife',
	outfile: path.join(import.meta.dirname, 'dist/workbench.js'),
	metafile: production,
	logLevel: 'info',
	...output,
};

async function main() {
	if (process.argv.includes('--watch')) {
		const nodeCtx = await esbuild.context(nodeBuild);
		const browserCtx = await esbuild.context(browserBuild);
		await nodeCtx.watch();
		await browserCtx.watch();
		return;
	}

	const nodeResult = await esbuild.build(nodeBuild);
	const browserResult = await esbuild.build(browserBuild);
	if (production && nodeResult.metafile && browserResult.metafile) {
		await writeFile(
			path.join(import.meta.dirname, 'dist/bundle-meta.json'),
			JSON.stringify({
				inputs: { ...nodeResult.metafile.inputs, ...browserResult.metafile.inputs },
				outputs: { ...nodeResult.metafile.outputs, ...browserResult.metafile.outputs },
			}),
		);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
