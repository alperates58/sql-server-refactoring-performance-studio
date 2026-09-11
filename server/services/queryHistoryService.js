/**
 * SQL Server Refactoring & Performance Studio
 * Query History Service (Sprint 7)
 *
 * Provides:
 * - Persistent execution history tracking via WorkspaceStorage (SQLite / JSON)
 * - Search, filtering by database, success status, and pagination
 * - Execution statistics (total runs, success rate, avg duration, top queries)
 * - Compression and deduplication of repeated queries
 */

const { defaultStorage } = require('./workspaceStorage');

class QueryHistoryService {
  constructor(storage = defaultStorage) {
    this.storage = storage;
  }

  recordExecution(data, options = {}) {
    return this.storage.saveQueryHistory(data, options);
  }

  getHistory(options = {}) {
    return this.storage.listQueryHistory(options);
  }

  getHistoryById(id) {
    return this.storage.getQueryHistoryById(id);
  }

  deleteHistory(id) {
    return this.storage.deleteQueryHistory(id);
  }

  clearHistory() {
    return this.storage.clearQueryHistory();
  }

  enforceRetention(maxEntries = 10000) {
    if (this.storage && typeof this.storage.enforceHistoryRetention === 'function') {
      return this.storage.enforceHistoryRetention(maxEntries);
    }
  }

  getHistoryStats() {
    const { items: allItems } = this.storage.listQueryHistory({ limit: 500 });
    const totalExecutions = allItems.reduce((acc, it) => acc + (it.executionCount || 1), 0);
    const successfulExecutions = allItems.filter(it => it.success).reduce((acc, it) => acc + (it.executionCount || 1), 0);
    const successRate = totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 100) : 100;
    const avgDurationMs = allItems.length > 0 ? Math.round(allItems.reduce((acc, it) => acc + it.durationMs, 0) / allItems.length) : 0;
    const totalLogicalReads = allItems.reduce((acc, it) => acc + it.logicalReads, 0);

    return {
      uniqueQueries: allItems.length,
      totalExecutions,
      successRate,
      avgDurationMs,
      totalLogicalReads
    };
  }
}

const defaultQueryHistoryService = new QueryHistoryService();

module.exports = {
  QueryHistoryService,
  defaultQueryHistoryService
};
