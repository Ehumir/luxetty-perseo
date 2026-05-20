#!/usr/bin/env node
'use strict';

/**
 * M4-04B — WA smoke B1 close (min 3 QA phones).
 */

require('dotenv').config();

const { closeWa } = require('./staging/stagingClose');

const report = closeWa(3);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
