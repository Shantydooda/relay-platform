'use strict';
const { runPackage } = require('./data-app.cjs');
const { normalizeCsv } = require('../../agent-runtime/src/csv.cjs');
const { inventory } = require('../../link-runtime/src/inventory.cjs');
let input = '',
  size = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  size += Buffer.byteLength(chunk);
  if (size > 1024 * 1024) process.exit(1);
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const request = JSON.parse(input);
    let result;
    if (request.recipe === 'csv-normalize-v1')
      result = {
        output: normalizeCsv(Buffer.from(request.content)).csv.toString(),
      };
    else if (request.recipe === 'link-inventory-v1')
      result = { output: JSON.stringify(inventory(request.content), null, 2) };
    else if (request.recipe === 'builder-data-app-v1')
      result = runPackage(request.appPackage, request.content);
    else throw new Error('Unsupported recipe');
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stdout.write(JSON.stringify({ error: true }));
  }
});
