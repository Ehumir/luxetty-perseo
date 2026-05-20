#!/usr/bin/env node
'use strict';

/**
 * M4-04C — WA smoke B2 close (10 QA phones).
 */

require('dotenv').config();

const { closeWa } = require('./staging/stagingClose');

const report = closeWa(10);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
