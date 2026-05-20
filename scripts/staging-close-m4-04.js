#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Full close: Technical (04A) + WA B2 (04C).
 */

require('dotenv').config();

const { closeFull } = require('./staging/stagingClose');

const report = closeFull();
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
