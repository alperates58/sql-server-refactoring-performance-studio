/**
 * SQL Server Refactoring & Performance Studio
 * Canonical Object Reference Model
 *
 * Guardrail Enforcement:
 * - Internal object identity must NOT be a plain string.
 * - Represents entities as an ObjectRef structure:
 *   { server, database, schema, name, type, canonicalId }
 * - Local object canonicalId: database.schema.object
 * - Linked Server canonicalId: server.database.schema.object
 * - Type is explicitly preserved to distinguish same-named objects (e.g., Table vs Synonym).
 */

class ObjectRef {
  constructor({ server = null, database = '', schema = 'dbo', name = '', type = 'UNKNOWN' }) {
    this.server = server ? String(server).trim() : null;
    this.database = String(database || '').trim();
    this.schema = String(schema || 'dbo').trim();
    this.name = String(name || '').trim();
    this.type = String(type || 'UNKNOWN').toUpperCase();

    // Compute canonical key
    if (this.server) {
      this.canonicalId = `${this.server}.${this.database}.${this.schema}.${this.name}`;
    } else if (this.database) {
      this.canonicalId = `${this.database}.${this.schema}.${this.name}`;
    } else {
      this.canonicalId = `${this.schema}.${this.name}`;
    }
  }

  toString() {
    return this.canonicalId;
  }

  toJSON() {
    return {
      server: this.server,
      database: this.database,
      schema: this.schema,
      name: this.name,
      type: this.type,
      canonicalId: this.canonicalId
    };
  }

  isLocal(currentDatabase) {
    if (this.server) return false;
    if (!this.database) return true;
    return this.database.toLowerCase() === String(currentDatabase || '').toLowerCase();
  }

  isCrossDatabase(currentDatabase) {
    if (this.server) return false;
    if (!this.database) return false;
    return this.database.toLowerCase() !== String(currentDatabase || '').toLowerCase();
  }

  isLinkedServer() {
    return Boolean(this.server);
  }
}

/**
 * Factory function to create an ObjectRef
 */
function createObjectRef(opts) {
  return new ObjectRef(opts);
}

/**
 * Parse a canonical ID string into an ObjectRef
 * Examples:
 *   "MikroDB.dbo.AA_PLAN" -> server: null, database: "MikroDB", schema: "dbo", name: "AA_PLAN"
 *   "LINKED01.Db.dbo.Table" -> server: "LINKED01", database: "Db", schema: "dbo", name: "Table"
 */
function parseCanonicalId(str, defaultDatabase = '', defaultType = 'UNKNOWN') {
  if (!str || typeof str !== 'string') {
    return new ObjectRef({ database: defaultDatabase, type: defaultType });
  }

  // Remove bracket wrappers: [Db].[dbo].[Name] -> Db.dbo.Name
  const clean = str.replace(/\[|\]/g, '');
  const parts = clean.split('.');

  if (parts.length >= 4) {
    return new ObjectRef({
      server: parts[0],
      database: parts[1],
      schema: parts[2],
      name: parts.slice(3).join('.'),
      type: defaultType
    });
  } else if (parts.length === 3) {
    return new ObjectRef({
      database: parts[0],
      schema: parts[1],
      name: parts[2],
      type: defaultType
    });
  } else if (parts.length === 2) {
    return new ObjectRef({
      database: defaultDatabase,
      schema: parts[0],
      name: parts[1],
      type: defaultType
    });
  } else {
    return new ObjectRef({
      database: defaultDatabase,
      schema: 'dbo',
      name: parts[0],
      type: defaultType
    });
  }
}

module.exports = {
  ObjectRef,
  createObjectRef,
  parseCanonicalId
};
