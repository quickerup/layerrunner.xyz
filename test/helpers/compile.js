const fs = require('fs');
const path = require('path');
const { runTolkCompiler } = require('@ton/tolk-js');
const { Cell } = require('@ton/core');

const contractsDir = path.join(__dirname, '..', '..', 'contracts');

/** Compiles a contract in contracts/ (by filename) and returns its code Cell. */
async function compileTolk(fileName) {
  const entrypointFileName = path.join(contractsDir, fileName);
  const result = await runTolkCompiler({
    entrypointFileName,
    fsReadCallback: (filePath) => fs.readFileSync(filePath, 'utf-8'),
  });

  if (result.status === 'error') {
    throw new Error(`${fileName}: ${result.message}`);
  }

  return Cell.fromBoc(Buffer.from(result.codeBoc64, 'base64'))[0];
}

module.exports = { compileTolk };
