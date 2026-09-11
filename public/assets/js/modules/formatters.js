/**
 * SQL Server Refactoring & Performance Studio
 * Unified Value & Date/Time Formatters (Sprint 8)
 *
 * Provides standardized formatting across all screens:
 * - Turkish locale (tr-TR) number formatting with technical precision
 * - Duration formatting (<1 ms, ms, s, m s)
 * - Compact number abbreviation (842, 12,4 B, 1,8 Mn, 2,1 Mr)
 * - Byte sizing (KB, MB, GB)
 * - Formatted date/time strings
 */

(function (global) {
  'use strict';

  /**
   * Standard Turkish locale number formatting with dot thousands separator
   * @param {number|bigint|string} val
   * @param {number} [fractionDigits=0]
   * @returns {string} e.g. "1.234.567"
   */
  function formatNumber(val, fractionDigits = 0) {
    if (val === null || val === undefined || val === '') return '—';
    const num = Number(val);
    if (Number.isNaN(num)) return String(val);

    return new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(num);
  }

  /**
   * Human-readable execution duration formatter
   * @param {number} ms
   * @returns {string} e.g. "< 1 ms", "42 ms", "1,84 sn", "2 dk 14 sn"
   */
  function formatDuration(ms) {
    if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '—';
    const n = Number(ms);

    if (n < 0) return '0 ms';
    if (n < 1) return '< 1 ms';
    if (n < 1000) return `${Math.round(n)} ms`;

    const seconds = n / 1000;
    if (seconds < 60) {
      const formattedSec = seconds.toLocaleString('tr-TR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2
      });
      return `${formattedSec} sn`;
    }

    if (seconds >= 3600) {
      const hours = Math.floor(seconds / 3600);
      const remainingMins = Math.floor((seconds % 3600) / 60);
      if (remainingMins === 0) return `${hours} sa`;
      return `${hours} sa ${remainingMins} dk`;
    }

    const mins = Math.floor(seconds / 60);
    const remainingSecs = Math.round(seconds % 60);
    if (remainingSecs === 0) return `${mins} dk`;
    return `${mins} dk ${remainingSecs} sn`;
  }

  /**
   * Compact number formatting with Turkish suffix abbreviations
   * @param {number|bigint} val
   * @returns {string} e.g. "1,8 Mn", "12,4 B", "4,1 Mr"
   */
  function formatCompactNumber(val) {
    if (val === null || val === undefined || val === '') {
      return '0';
    }
    const num = Number(val);
    if (Number.isNaN(num)) {
      return '0';
    }

    const exact = formatNumber(num, 0);
    const abs = Math.abs(num);

    let formatted = '';
    if (abs >= 1_000_000_000) {
      const b = (num / 1_000_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
      formatted = `${b} Mr`;
    } else if (abs >= 1_000_000) {
      const m = (num / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
      formatted = `${m} Mn`;
    } else if (abs >= 1_000) {
      const k = (num / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
      formatted = `${k} B`;
    } else {
      formatted = exact;
    }

    return formatted;
  }

  /**
   * Human-readable byte size formatter
   * @param {number} bytes
   * @returns {string} e.g. "450 KB", "12,5 MB", "1,2 GB"
   */
  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '0 B';
    const n = Number(bytes);
    if (n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;

    const kb = n / 1024;
    if (kb < 1024) {
      return `${kb.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} KB`;
    }

    const mb = kb / 1024;
    if (mb < 1024) {
      return `${mb.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
    }

    const gb = mb / 1024;
    return `${gb.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} GB`;
  }

  /**
   * Standard Turkish date/time format
   * @param {Date|string|number} date
   * @param {boolean} [includeTime=true]
   * @returns {string} e.g. "11.09.2026 15:30"
   */
  function formatDate(date, includeTime = true) {
    if (!date) return '-';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '-';

    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {})
    };

    return d.toLocaleString('tr-TR', options);
  }

  /**
   * Relative time formatter
   * @param {Date|string|number} date
   * @returns {string} e.g. "az önce", "5 dk önce", "2 saat önce", "dün"
   */
  function formatRelativeTime(date) {
    if (!date) return '-';
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '-';

    const now = Date.now();
    const diffSec = Math.round((now - d.getTime()) / 1000);

    if (diffSec <= 15) return 'az önce';
    if (diffSec < 60) return `${diffSec} sn önce`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} saat önce`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'dün';
    if (diffDays < 30) return `${diffDays} gün önce`;

    return formatDate(d, false);
  }

  const StudioFormatters = {
    formatNumber,
    formatDuration,
    formatCompactNumber,
    formatBytes,
    formatDate,
    formatRelativeTime
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StudioFormatters;
  } else {
    global.StudioFormatters = StudioFormatters;
  }
})(typeof window !== 'undefined' ? window : globalThis);
