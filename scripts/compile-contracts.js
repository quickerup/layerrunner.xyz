const fs = require('fs');
const path = require('path');
const { runTolkCompiler } = require('@ton/tolk-js');

const contractsDir = path.join(__dirname, '..', 'contracts');
const buildDir = path.join(__dirname, '..', 'build');

async function compileFile(fileName) {
  const entrypointFileName = path.join(contractsDir, fileName);
  const result = await runTolkCompiler({
    entrypointFileName,
    fsReadCallback: (filePath) => fs.readFileSync(filePath, 'utf-8'),
  });

  if (result.status === 'error') {
    throw new Error(`${fileName}: ${result.message}`);
  }

  fs.mkdirSync(buildDir, { recursive: true });
  const outFile = path.join(buildDir, fileName.replace(/\.tolk$/, '.boc.json'));
  fs.writeFileSync(outFile, JSON.stringify({ codeBoc: result.codeBoc64, fiftCode: result.fiftCode }, null, 2));
  console.log(`compiled ${fileName} -> ${path.relative(process.cwd(), outFile)}`);
}

async function main() {
  const files = fs.readdirSync(contractsDir).filter((f) => f.endsWith('.tolk'));
  if (files.length === 0) {
    console.log('no .tolk contracts found in contracts/');
    return;
  }
  for (const file of files) {
    const source = fs.readFileSync(path.join(contractsDir, file), 'utf-8');
    if (!/\bfun\s+onInternalMessage\s*\(/.test(source)) {
      console.log(`skipping ${file} (no onInternalMessage — shared/library module, not an entrypoint)`);
      continue;
    }
    await compileFile(file);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
