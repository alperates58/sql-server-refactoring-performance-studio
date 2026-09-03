/**
 * SQL Server Refactoring & Performance Studio
 * Cross-Database Dependency Graph & Analysis Engine (Phase 2.5)
 *
 * Implements:
 * - Canonical ObjectRef internal identity
 * - Cross-database dependency traversal across in-scope databases
 * - Out-of-scope database entity isolation
 * - Linked Server (four-part name) hop detection
 * - Synonym resolution (sys.synonyms)
 * - Resolution evidence tagging (LOCAL, CROSS_DATABASE, SYNONYM, OUT_OF_SCOPE, LINKED_SERVER, UNRESOLVED)
 * - Technical limitation note for Dynamic SQL
 * - Multi-database blast radius and repeated base table tracking
 * - Subgraph extraction with depth and direction filtering
 */

const { createObjectRef, parseCanonicalId } = require('./canonicalObject');

/**
 * Builds cross-database dependency statistics and topology.
 *
 * @param {Array} views - Array of view objects with { name, schema_name, database, object_id, definition }
 * @param {Array} rawEdges - Raw dependency rows from sys.sql_expression_dependencies + synonyms
 * @param {Array} selectedDatabases - List of databases in active analysis scope
 * @param {Map} synonymMap - Map of canonicalId -> target ObjectRef
 */
function buildDependencyStats(views = [], rawEdges = [], selectedDatabases = [], synonymMap = new Map()) {
  const scopeSet = new Set((selectedDatabases || []).map(d => d.toLowerCase()));

  // Map of canonicalId -> view
  const viewMap = new Map();
  for (const v of views) {
    const db = v.database || (selectedDatabases[0] || '');
    const schema = v.schema_name || v.schema || 'dbo';
    const name = v.view_name || v.name;
    const ref = createObjectRef({ database: db, schema, name, type: 'VIEW' });
    v.canonicalId = ref.canonicalId;
    v.objectRef = ref;
    viewMap.set(ref.canonicalId.toLowerCase(), v);
  }

  const outgoing = new Map(); // canonicalId.toLowerCase() -> normalized edges
  const incoming = new Map(); // canonicalId.toLowerCase() -> normalized edges
  const normalizedEdges = [];

  for (const raw of rawEdges) {
    const srcDb = raw.source_database || (selectedDatabases[0] || '');
    const srcSchema = raw.source_schema || 'dbo';
    const srcName = raw.source_name;
    const srcRef = createObjectRef({ database: srcDb, schema: srcSchema, name: srcName, type: 'VIEW' });

    // Target extraction (4-part expression)
    let tgtServer = raw.referenced_server_name || null;
    let tgtDb = raw.referenced_database_name || srcDb;
    let tgtSchema = raw.referenced_schema_name || 'dbo';
    let tgtName = raw.referenced_entity_name || raw.target_name;
    let tgtType = String(raw.target_type || 'UNKNOWN').toUpperCase();

    let resolutionCategory = 'LOCAL';
    let resolutionMethod = 'CATALOG_EXPRESSION';
    let evidenceText = `${srcDb}.${srcName} -> ${tgtDb}.${tgtName}`;

    // 1. Linked Server Detection
    if (tgtServer) {
      resolutionCategory = 'LINKED_SERVER';
      resolutionMethod = 'FOUR_PART_NAME';
      tgtType = 'LINKED_SERVER';
      evidenceText = `Linked Server Hop: [${tgtServer}].[${tgtDb}].[${tgtSchema}].[${tgtName}]`;
    }
    // 2. Cross-Database Check
    else if (tgtDb.toLowerCase() !== srcDb.toLowerCase()) {
      if (scopeSet.has(tgtDb.toLowerCase())) {
        resolutionCategory = 'CROSS_DATABASE';
        resolutionMethod = 'CROSS_DB_CATALOG';
        evidenceText = `Cross-Database: ${srcDb} -> ${tgtDb}`;
      } else {
        resolutionCategory = 'OUT_OF_SCOPE';
        resolutionMethod = 'UNSCANNED_DATABASE';
        tgtType = 'OUT_OF_SCOPE_DB';
        evidenceText = `Kapsam Dışı Veritabanı: ${tgtDb} (Analiz kapsamına dahil edilmedi)`;
      }
    }

    // 3. Synonym Resolution
    const candidateTgtId = tgtServer
      ? `${tgtServer}.${tgtDb}.${tgtSchema}.${tgtName}`
      : `${tgtDb}.${tgtSchema}.${tgtName}`;

    if (synonymMap.has(candidateTgtId.toLowerCase())) {
      const synTarget = synonymMap.get(candidateTgtId.toLowerCase());
      resolutionCategory = 'SYNONYM';
      resolutionMethod = 'SYNONYM_MAPPING';
      evidenceText = `Synonym Çözümleme: ${candidateTgtId} -> ${synTarget.canonicalId}`;
      tgtServer = synTarget.server;
      tgtDb = synTarget.database;
      tgtSchema = synTarget.schema;
      tgtName = synTarget.name;
      tgtType = synTarget.type;
    }

    if (!tgtName) {
      resolutionCategory = 'UNRESOLVED';
      resolutionMethod = 'MISSING_METADATA';
      tgtType = 'UNRESOLVED';
    }

    const tgtRef = createObjectRef({
      server: tgtServer,
      database: tgtDb,
      schema: tgtSchema,
      name: tgtName,
      type: tgtType
    });

    const edge = {
      sourceCanonicalId: srcRef.canonicalId,
      sourceDatabase: srcRef.database,
      sourceName: srcRef.name,
      sourceType: srcRef.type,
      targetCanonicalId: tgtRef.canonicalId,
      targetDatabase: tgtRef.database,
      targetServer: tgtRef.server,
      targetName: tgtRef.name,
      targetType: tgtRef.type,
      category: resolutionCategory,
      resolutionMethod,
      evidenceText,
      isCrossDb: resolutionCategory === 'CROSS_DATABASE',
      isLinkedServer: resolutionCategory === 'LINKED_SERVER',
      isOutOfScope: resolutionCategory === 'OUT_OF_SCOPE',
      isSynonym: resolutionCategory === 'SYNONYM',
      isAmbiguous: Boolean(raw.is_ambiguous)
    };

    normalizedEdges.push(edge);

    const sKey = srcRef.canonicalId.toLowerCase();
    const tKey = tgtRef.canonicalId.toLowerCase();

    if (!outgoing.has(sKey)) outgoing.set(sKey, []);
    outgoing.get(sKey).push(edge);

    if (!incoming.has(tKey)) incoming.set(tKey, []);
    incoming.get(tKey).push(edge);
  }

  // --- Downstream & Upstream Traversal Per View ---
  function downstreamAnalysis(rootCanonicalId) {
    let maxDepth = 1;
    const baseTablePaths = new Map(); // canonicalId -> paths
    const baseTableNames = new Map(); // canonicalId -> ObjectRef
    const transitiveObjects = new Set();
    const downstreamViews = new Set();
    const downstreamFunctions = new Set();
    const outOfScopeNodes = new Set();
    const linkedServerNodes = new Set();
    const cycles = [];
    const unresolved = [];

    function traverse(currentId, currentDepth, currentPath, visitedInBranch) {
      if (currentDepth > maxDepth) maxDepth = currentDepth;

      const edges = outgoing.get(currentId.toLowerCase()) || [];
      for (const edge of edges) {
        const targetId = edge.targetCanonicalId;
        const targetType = edge.targetType;

        if (edge.category === 'UNRESOLVED') {
          unresolved.push({
            name: edge.targetName,
            referencedBy: currentId,
            edge
          });
          continue;
        }

        if (edge.category === 'OUT_OF_SCOPE') {
          outOfScopeNodes.add(targetId);
          continue;
        }

        if (edge.category === 'LINKED_SERVER') {
          linkedServerNodes.add(targetId);
          continue;
        }

        if (visitedInBranch.has(targetId.toLowerCase())) {
          cycles.push({
            path: [...currentPath, targetId],
            cycleAt: targetId
          });
          continue;
        }

        transitiveObjects.add(targetId);

        if (targetType.includes('VIEW')) {
          downstreamViews.add(targetId);
          const nextVisited = new Set(visitedInBranch).add(targetId.toLowerCase());
          traverse(targetId, currentDepth + 1, [...currentPath, targetId], nextVisited);
        } else if (targetType.includes('TABLE')) {
          const tKey = targetId.toLowerCase();
          if (!baseTablePaths.has(tKey)) {
            baseTablePaths.set(tKey, []);
            baseTableNames.set(tKey, targetId);
          }
          baseTablePaths.get(tKey).push([...currentPath, targetId]);
        } else if (targetType.includes('FUNCTION')) {
          downstreamFunctions.add(targetId);
        }
      }
    }

    const initialVisited = new Set([rootCanonicalId.toLowerCase()]);
    traverse(rootCanonicalId, 1, [rootCanonicalId], initialVisited);

    const repeatedBaseTables = [];
    for (const [tableKey, paths] of baseTablePaths.entries()) {
      if (paths.length > 1) {
        repeatedBaseTables.push({
          canonicalId: baseTableNames.get(tableKey),
          tableName: baseTableNames.get(tableKey).split('.').pop(),
          pathCount: paths.length,
          paths
        });
      }
    }

    return {
      depth: maxDepth,
      baseTableCount: baseTablePaths.size,
      repeatedBaseTableCount: repeatedBaseTables.length,
      repeatedBaseTables,
      transitiveCount: transitiveObjects.size,
      downstreamViewCount: downstreamViews.size,
      downstreamFunctionCount: downstreamFunctions.size,
      outOfScopeCount: outOfScopeNodes.size,
      linkedServerCount: linkedServerNodes.size,
      cycles,
      unresolved
    };
  }

  function upstreamAnalysis(rootCanonicalId) {
    const upstreamDependents = new Set();
    const visited = new Set([rootCanonicalId.toLowerCase()]);
    const queue = [rootCanonicalId.toLowerCase()];

    while (queue.length > 0) {
      const current = queue.shift();
      const inEdges = incoming.get(current) || [];
      for (const edge of inEdges) {
        const srcId = edge.sourceCanonicalId;
        const sKey = srcId.toLowerCase();
        if (!visited.has(sKey)) {
          visited.add(sKey);
          upstreamDependents.add(srcId);
          queue.push(sKey);
        }
      }
    }

    return {
      dependentCount: upstreamDependents.size,
      dependents: Array.from(upstreamDependents)
    };
  }

  // Calculate stats for each view
  const statsMap = new Map();
  for (const v of views) {
    const cId = v.canonicalId;
    const downstream = downstreamAnalysis(cId);
    const upstream = upstreamAnalysis(cId);

    statsMap.set(cId.toLowerCase(), {
      canonicalId: cId,
      ...downstream,
      ...upstream,
      dynamicSqlLimitation: 'Dynamic SQL dependencies cannot be fully discovered from catalog metadata.'
    });
  }

  return {
    statsMap,
    normalizedEdges
  };
}

/**
 * Extracts a filtered visual subgraph for a selected view across databases.
 */
function extractSubGraph(rootCanonicalId, views = [], rawEdges = [], options = {}) {
  const depthLimit = options.depth === 'all' ? 999 : Number(options.depth || 2);
  const direction = options.direction || 'both'; // 'both', 'downstream', 'upstream'
  const rootKey = String(rootCanonicalId || '').toLowerCase();

  const viewLookup = new Map();
  for (const v of views) {
    const k = (v.canonicalId || v.name || v.view_name).toLowerCase();
    viewLookup.set(k, v);
  }

  const outgoing = new Map();
  const incoming = new Map();
  for (const e of rawEdges) {
    const sKey = (e.sourceCanonicalId || e.source_name || '').toLowerCase();
    const tKey = (e.targetCanonicalId || e.target_name || '').toLowerCase();

    if (!outgoing.has(sKey)) outgoing.set(sKey, []);
    outgoing.get(sKey).push(e);

    if (!incoming.has(tKey)) incoming.set(tKey, []);
    incoming.get(tKey).push(e);
  }

  const nodeSet = new Map(); // key -> node
  const edgeSet = new Set();

  function addNode(canonicalId, role = 'view', database = '', server = null) {
    const k = canonicalId.toLowerCase();
    if (!nodeSet.has(k)) {
      const v = viewLookup.get(k);
      const parsed = parseCanonicalId(canonicalId, database);
      nodeSet.set(k, {
        id: canonicalId,
        canonicalId: canonicalId,
        name: parsed.name,
        schema: parsed.schema,
        database: parsed.database || database,
        server: parsed.server || server,
        type: role,
        health: v ? (v.healthScore || v.health || 60) : null,
        risk: v ? (v.riskCategory || v.risk || 'medium') : null,
        isTarget: k === rootKey
      });
    }
  }

  // Always add root
  const rootObj = viewLookup.get(rootKey);
  const rootDb = rootObj ? (rootObj.database || '') : '';
  addNode(rootCanonicalId, 'target', rootDb);

  // Downstream BFS
  if (direction === 'both' || direction === 'downstream') {
    const queue = [{ id: rootCanonicalId, depth: 0 }];
    const visited = new Set([rootKey]);

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depth >= depthLimit) continue;

      const edges = outgoing.get(id.toLowerCase()) || [];
      for (const e of edges) {
        const tId = e.targetCanonicalId || e.target_name;
        const tKey = tId.toLowerCase();
        let role = 'table';
        if (e.isLinkedServer) role = 'linked_server';
        else if (e.isOutOfScope) role = 'out_of_scope';
        else if (e.isSynonym) role = 'synonym';
        else if (e.targetType?.includes('VIEW')) role = 'view';
        else if (e.targetType?.includes('FUNCTION')) role = 'function';

        addNode(tId, role, e.targetDatabase, e.targetServer);
        edgeSet.add(e);

        if (!visited.has(tKey) && (role === 'view' || role === 'synonym')) {
          visited.add(tKey);
          queue.push({ id: tId, depth: depth + 1 });
        }
      }
    }
  }

  // Upstream BFS
  if (direction === 'both' || direction === 'upstream') {
    const queue = [{ id: rootCanonicalId, depth: 0 }];
    const visited = new Set([rootKey]);

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depth >= depthLimit) continue;

      const edges = incoming.get(id.toLowerCase()) || [];
      for (const e of edges) {
        const sId = e.sourceCanonicalId || e.source_name;
        const sKey = sId.toLowerCase();

        addNode(sId, 'view', e.sourceDatabase);
        edgeSet.add(e);

        if (!visited.has(sKey)) {
          visited.add(sKey);
          queue.push({ id: sId, depth: depth + 1 });
        }
      }
    }
  }

  return {
    nodes: Array.from(nodeSet.values()),
    edges: Array.from(edgeSet),
    dynamicSqlLimitation: 'Dynamic SQL dependencies cannot be fully discovered from catalog metadata.'
  };
}

module.exports = {
  buildDependencyStats,
  extractSubGraph
};
