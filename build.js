#!/usr/bin/env node

// Build script for nuvio-providers
// - Bundles each provider from src/providers into providers/<name>.js
// - CommonJS output, ES2016 target (for Nuvio's JS sandbox)
// - Optional --transpile pass to strip async/await from providers/*.js

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'providers');
const outDir = path.join(__dirname, 'providers');

// Modules that the Nuvio app provides – don't bundle these
const EXTERNAL_MODULES = [
  'cheerio-without-node-native',
  'react-native-cheerio',
  'cheerio',
  'crypto-js'
];

// Discover which providers to build
function getProvidersToBuild() {
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  if (args.length > 0) {
    // Explicit list passed on CLI: node build.js hianime moviesdrive
    return args;
  }

  if (!fs.existsSync(srcDir)) {
    console.error('src/providers directory not found.');
    console.error('Create providers in src/providers/<name>/index.js OR src/providers/<name>.js');
    process.exit(1);
  }

  // Support both folder-per-provider and single-file providers
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  const folders = entries
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const singleFiles = entries
    .filter(d => d.isFile() && d.name.endsWith('.js'))
    .map(d => path.basename(d.name, '.js'));

  return [...folders, ...singleFiles];
}

// Build a single provider from src/providers into providers/<name>.js
async function buildProvider(providerName) {
  const folderEntry = path.join(srcDir, providerName, 'index.js');
  const fileEntry = path.join(srcDir, providerName + '.js');

  let entryPoint = null;

  if (fs.existsSync(folderEntry)) {
    entryPoint = folderEntry;
  } else if (fs.existsSync(fileEntry)) {
    entryPoint = fileEntry;
  } else {
    console.warn(
      `Skipping "${providerName}": no src/providers/${providerName}/index.js or src/providers/${providerName}.js found`
    );
    return false;
  }

  const outFile = path.join(outDir, providerName + '.js');

  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outFile,
      format: 'cjs',          // CommonJS for module.exports compatibility
      platform: 'neutral',    // Works in both browser- and node-like environments
      target: 'es2016',       // Transpile async/await etc. for Nuvio sandbox
      minify: false,          // Keep readable for debugging
      sourcemap: false,
      external: EXTERNAL_MODULES,
      banner: {
        js: `// ${providerName} - Built from ${entryPoint} - Generated ${new Date().toISOString()}`
      },
      logLevel: 'warning'
    });

    const stats = fs.statSync(outFile);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`✔ ${providerName}.js (${sizeKB} KB)`);
    return true;
  } catch (err) {
    console.error(`✖ Failed to build "${providerName}":`, err.message);
    return false;
  }
}

// Transpile a single file in providers/ to strip async/await if present
async function transpileSingleFile(filename) {
  const inputPath = path.join(outDir, filename);
  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipping transpile: providers/${filename} not found`);
    return false;
  }

  const originalContent = fs.readFileSync(inputPath, 'utf-8');

  // Fast path: no async or await in file
  if (!originalContent.includes('async ') && !originalContent.includes('await ')) {
    console.log(`↷ ${filename}: no async/await, skipping`);
    return true;
  }

  try {
    const result = await esbuild.transform(originalContent, {
      loader: 'js',
      target: 'es2016',
      format: 'cjs'
    });

    fs.writeFileSync(inputPath, result.code);
    const stats = fs.statSync(inputPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`✓ ${filename} transpiled (${sizeKB} KB)`);
    return true;
  } catch (err) {
    console.error(`✖ Failed to transpile ${filename}:`, err.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Handle: node build.js --transpile [file1 file2 ...]
  if (args.includes('--transpile')) {
    const files = args.filter(a => a !== '--transpile' && !a.startsWith('-'));

    // No explicit list → transpile all providers/*.js
    if (files.length === 0) {
      if (!fs.existsSync(outDir)) {
        console.error('providers/ directory not found. Run build first.');
        process.exit(1);
      }

      const allProviderFiles = fs
        .readdirSync(outDir)
        .filter(f => f.endsWith('.js'));

      console.log(`Transpiling ${allProviderFiles.length} provider file(s)...`);
      for (const file of allProviderFiles) {
        // eslint-disable-next-line no-await-in-loop
        await transpileSingleFile(file);
      }
      return;
    }

    console.log(`Transpiling ${files.length} file(s)...`);
    for (const file of files) {
      const filename = file.endsWith('.js') ? file : file + '.js';
      // eslint-disable-next-line no-await-in-loop
      await transpileSingleFile(filename);
    }
    return;
  }

  // Normal build: node build.js [optional providerName...]
  const providers = getProvidersToBuild();
  if (providers.length === 0) {
    console.log('No providers found in src/providers.');
    console.log('Create a provider in src/providers/<name>/index.js or src/providers/<name>.js');
    return;
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`Building ${providers.length} provider(s)...\n`);

  let success = 0;
  let failed = 0;

  for (const provider of providers) {
    // eslint-disable-next-line no-await-in-loop
    const result = await buildProvider(provider);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  console.log(`\nDone! ${success} built, ${failed} skipped/failed.`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
