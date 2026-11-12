#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pug = require('pug');
const stylus = require('stylus');

const pages = ['index', 'popupdict', 'pronunciation', 'homophones', 'pronguide']
  .map(name => ({source: `${name}.jade`, output: `${name}.html`, type: 'pug'}));
pages.push({source: 'zd-extension/frame.jade', output: 'zd-extension/frame.html', type: 'pug', pretty: true});
const styles = ['css/style', 'css/pronunciation', 'zd-extension/css/zoopdog',
  'zd-extension/css/zoopdog-frame', 'zd-extension/css/zd-pron']
  .map(name => ({source: `${name}.styl`, output: `${name}.css`, type: 'stylus'}));

async function buildSite({root = path.resolve(__dirname, '..'), inputs = [...pages, ...styles], check = false} = {}) {
  const differences = [];
  for (const input of inputs) {
    const source = path.join(root, input.source);
    const destination = path.join(root, input.output);
    let output;
    if (input.type === 'pug') {
      output = pug.renderFile(source, {pretty: Boolean(input.pretty)});
    } else if (input.type === 'stylus') {
      output = await new Promise((resolve, reject) => {
        stylus(fs.readFileSync(source, 'utf8')).set('filename', source).render((error, css) => error ? reject(error) : resolve(css));
      });
    } else throw new Error(`Unknown input type: ${input.type}`);
    if (check) {
      if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) differences.push(input.output);
    } else {
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, output);
    }
  }
  return differences;
}

async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const selected = argv.includes('--pages') ? pages : argv.includes('--styles') ? styles : [...pages, ...styles];
  const differences = await buildSite({inputs: selected, check});
  if (differences.length) {
    console.error(`Generated files differ: ${differences.join(', ')}`);
    process.exitCode = 1;
  } else console.log(check ? 'Generated files match.' : 'Generated files written.');
}

module.exports = {buildSite, main};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
