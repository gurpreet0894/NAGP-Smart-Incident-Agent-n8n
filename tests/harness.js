// Minimal harness that runs an n8n Code-node body outside n8n.
// It exposes the same globals the Code node has: $input, $('Node'), $runIndex.
const fs = require('fs');
const path = require('path');

function loadCode(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'code', file), 'utf8');
}

/**
 * @param {string} file       code file name
 * @param {object} inputJson  json of the incoming item
 * @param {object} nodes      map: node name -> array of json objects that node produced
 * @param {number} runIndex
 */
function runCode(file, inputJson, nodes = {}, runIndex = 0) {
  const $input = { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] };
  const $ = (name) => {
    const items = (nodes[name] ?? []).map((json) => ({ json }));
    return { first: () => items[0], last: () => items[items.length - 1], all: () => items };
  };
  const fn = new Function('$input', '$', '$runIndex', loadCode(file));
  const result = fn($input, $, runIndex);
  return result.map((r) => r.json);
}

module.exports = { runCode };
