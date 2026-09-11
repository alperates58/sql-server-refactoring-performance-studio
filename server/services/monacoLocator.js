/**
 * SQL Server Refactoring & Performance Studio
 * Local Monaco Editor Asset Locator (Sprint 7.1)
 *
 * Ensures 100% offline Monaco Editor availability without CDN dependencies.
 * Searches local node_modules, public vendor directory, and OS installations.
 */

const fs = require('fs');
const path = require('path');

function resolveLocalMonacoPath(customCandidate = null) {
  const candidates = [];

  if (customCandidate) {
    candidates.push({ path: customCandidate, source: 'CUSTOM' });
  }

  if (process.env.MONACO_VS_PATH) {
    candidates.push({ path: process.env.MONACO_VS_PATH, source: 'ENV' });
  }

  // Project node_modules
  candidates.push({
    path: path.join(__dirname, '..', '..', 'node_modules', 'monaco-editor', 'min', 'vs'),
    source: 'NODE_MODULES'
  });

  // Project public/vendor
  candidates.push({
    path: path.join(__dirname, '..', '..', 'public', 'vendor', 'monaco', 'vs'),
    source: 'PUBLIC_VENDOR'
  });

  // Microsoft Office built-in ACCMonaco distribution (Windows 64-bit and 32-bit)
  if (process.platform === 'win32') {
    candidates.push({
      path: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\ACCMonaco\\vs',
      source: 'OFFICE_ACCMONACO'
    });
    candidates.push({
      path: 'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\ACCMonaco\\vs',
      source: 'OFFICE_ACCMONACO_X86'
    });
  }

  for (const c of candidates) {
    if (c.path && fs.existsSync(c.path)) {
      const loaderFile = path.join(c.path, 'loader.js');
      if (fs.existsSync(loaderFile)) {
        return {
          available: true,
          path: c.path,
          source: c.source,
          webPrefix: '/vendor/monaco/vs'
        };
      }
    }
  }

  return {
    available: false,
    path: null,
    source: 'NONE',
    webPrefix: null
  };
}

module.exports = {
  resolveLocalMonacoPath
};
