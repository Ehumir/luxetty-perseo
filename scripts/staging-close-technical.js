#!/usr/bin/env node
'use strict';

/**
 * M4-04A — Technical staging close (no WA required).
 * Usage: PERSEO_STAGING_CONFIRMED=true npm run staging:close:technical
 */

require('dotenv').config();

const { closeTechnical } = require('./staging/stagingClose');

const report = closeTechnical();
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
