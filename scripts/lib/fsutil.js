'use strict';

const fs = require('node:fs');
const path = require('node:path');

function atomicWrite(target, content) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

module.exports = {atomicWrite};
