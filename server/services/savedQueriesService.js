/**
 * SQL Server Refactoring & Performance Studio
 * Workbench Saved Queries Service (Sprint 6)
 *
 * Dedicated collection separate from Refactor Workspaces:
 * - Save, list, update, delete user queries
 * - Favorite toggle
 * - Database context association
 */

const { defaultStorage } = require('./workspaceStorage');

class SavedQueriesService {
  constructor(storage = defaultStorage) {
    this.storage = storage;
  }

  saveQuery({ id, name, sql, database, isFavorite }) {
    if (!name || !name.trim()) {
      throw new Error('Sorgu adı (name) zorunludur.');
    }
    if (!sql || !sql.trim()) {
      throw new Error('Sorgu metni (sql) boş olamaz.');
    }

    return this.storage.saveWorkbenchQuery({
      id,
      name: name.trim(),
      sql: sql.trim(),
      database: database || null,
      isFavorite: Boolean(isFavorite)
    });
  }

  getQuery(id) {
    return this.storage.getWorkbenchQueryById(id);
  }

  listQueries(options = {}) {
    return this.storage.listWorkbenchQueries(options);
  }

  toggleFavorite(id) {
    const q = this.storage.getWorkbenchQueryById(id);
    if (!q) throw new Error('Sorgu bulunamadı.');
    q.isFavorite = !q.isFavorite;
    return this.storage.saveWorkbenchQuery(q);
  }

  deleteQuery(id) {
    return this.storage.deleteWorkbenchQuery(id);
  }
}

const defaultSavedQueriesService = new SavedQueriesService(defaultStorage);

module.exports = {
  SavedQueriesService,
  defaultSavedQueriesService
};
