/**
 * Dependency Engine
 *
 * Constructs the directed dependency graph using sys.sql_expression_dependencies.
 * Computes downstream depth, upstream dependents (blast radius), circular dependencies,
 * unresolved entities, and repeated base-table access paths.
 */

function buildDependencyStats(views = [], edges = []) {
  const viewMap = new Map();
  const viewByName = new Map();
  for (const v of views) {
    viewMap.set(v.object_id, v);
    viewByName.set(v.view_name.toUpperCase(), v);
  }

  // Build adjacency lists
  // outgoing: source_object_id -> edges
  // incoming: target_object_id -> edges
  const outgoing = new Map();
  const incoming = new Map();

  for (const e of edges) {
    const srcId = e.source_object_id;
    if (!outgoing.has(srcId)) outgoing.set(srcId, []);
    outgoing.get(srcId).push(e);

    const tgtId = e.target_object_id;
    if (tgtId != null) {
      if (!incoming.has(tgtId)) incoming.set(tgtId, []);
      incoming.get(tgtId).push(e);
    }
  }

  // Helper to check if an object is a base table
  function isTableType(typeDesc) {
    const t = String(typeDesc || '').toUpperCase();
    return t.includes('TABLE') || t === 'U' || t === 'USER_TABLE';
  }

  // Helper to check if an object is a view
  function isViewType(typeDesc, targetId) {
    if (targetId && viewMap.has(targetId)) return true;
    const t = String(typeDesc || '').toUpperCase();
    return t.includes('VIEW') || t === 'V';
  }

  // Helper to check if an object is a function
  function isFunctionType(typeDesc) {
    const t = String(typeDesc || '').toUpperCase();
    return t.includes('FUNCTION') || t === 'FN' || t === 'IF' || t === 'TF';
  }

  // Compute downstream metrics for a given root view
  function downstreamAnalysis(rootId, rootName) {
    let maxDepth = 1;
    const visitedInPath = new Set([rootId]);
    const transitiveObjects = new Set();
    const baseTablePaths = new Map(); // tableId -> array of path strings
    const baseTableNames = new Map(); // tableId -> name
    const downstreamViews = new Set();
    const downstreamFunctions = new Set();
    const cycles = [];
    const unresolved = [];

    function dfs(currentId, currentDepth, currentPath) {
      maxDepth = Math.max(maxDepth, currentDepth);
      const outEdges = outgoing.get(currentId) || [];

      for (const edge of outEdges) {
        // Handle unresolved references
        if (edge.target_object_id == null) {
          unresolved.push({
            targetName: edge.target_name,
            targetSchema: edge.target_schema,
            isAmbiguous: edge.is_ambiguous
          });
          continue;
        }

        const targetId = edge.target_object_id;
        const targetName = edge.target_name || (viewMap.get(targetId)?.view_name) || `Obj_${targetId}`;
        const targetType = edge.target_type;

        transitiveObjects.add(targetId);

        // Check for circular dependency
        if (visitedInPath.has(targetId)) {
          cycles.push([...currentPath, targetName]);
          continue;
        }

        const isTable = isTableType(targetType);
        const isView = isViewType(targetType, targetId);
        const isFunc = isFunctionType(targetType);

        if (isTable) {
          if (!baseTablePaths.has(targetId)) {
            baseTablePaths.set(targetId, []);
            baseTableNames.set(targetId, targetName);
          }
          baseTablePaths.get(targetId).push([...currentPath, targetName].join(' → '));
        }

        if (isFunc) {
          downstreamFunctions.add(targetName);
        }

        if (isView) {
          downstreamViews.add(targetId);
          visitedInPath.add(targetId);
          dfs(targetId, currentDepth + 1, [...currentPath, targetName]);
          visitedInPath.delete(targetId);
        }
      }
    }

    dfs(rootId, 1, [rootName]);

    // Calculate repeated base tables (tables reachable through >= 2 distinct paths)
    const repeatedBaseTables = [];
    for (const [tableId, paths] of baseTablePaths.entries()) {
      if (paths.length > 1) {
        repeatedBaseTables.push({
          tableId,
          tableName: baseTableNames.get(tableId),
          pathCount: paths.length,
          paths: paths.slice(0, 5) // keep up to 5 sample paths
        });
      }
    }

    return {
      depth: maxDepth,
      baseTableCount: baseTablePaths.size,
      baseTableList: Array.from(baseTableNames.values()),
      transitiveDependencyCount: transitiveObjects.size,
      repeatedBaseTableCount: repeatedBaseTables.length,
      repeatedBaseTablePaths: repeatedBaseTables,
      downstreamViewCount: downstreamViews.size,
      downstreamFunctionCount: downstreamFunctions.size,
      cycles,
      unresolved
    };
  }

  // Compute upstream dependents (blast radius)
  function upstreamAnalysis(rootId) {
    const visited = new Set();
    const queue = [rootId];
    const upstreamViews = [];

    while (queue.length > 0) {
      const currentId = queue.shift();
      const inEdges = incoming.get(currentId) || [];

      for (const edge of inEdges) {
        const callerId = edge.source_object_id;
        if (!visited.has(callerId)) {
          visited.add(callerId);
          queue.push(callerId);
          if (viewMap.has(callerId)) {
            upstreamViews.push(viewMap.get(callerId).view_name);
          }
        }
      }
    }

    return {
      dependentCount: visited.size,
      upstreamViews: upstreamViews.slice(0, 30) // sample for impact chain
    };
  }

  // Build findings specifically arising from graph topology
  function buildGraphFindings(stats) {
    const findings = [];

    // Excessive depth finding
    if (stats.depth > 3) {
      const penalty = Math.min(12, (stats.depth - 3) * 3);
      findings.push({
        code: 'EXCESSIVE_DEPTH',
        title: 'Deep dependency hierarchy',
        severity: stats.depth >= 6 ? 'CRITICAL' : 'HIGH',
        healthPenalty: penalty,
        symbol: '∞',
        category: 'architecture',
        evidenceGrade: 'D',
        explanation: `${stats.depth} seviye derinlik tespit edildi (önerilen azami 3). Optimizer karmaşık iç içe view ağaçlarını açarken optimize zaman aşımı ve hatalı cardinality kestirimleri yapabilir.`
      });
    }

    // Repeated base table access finding
    if (stats.repeatedBaseTableCount > 0) {
      const penalty = Math.min(18, stats.repeatedBaseTableCount * 6);
      const names = stats.repeatedBaseTablePaths.map(r => `${r.tableName} (${r.pathCount} yol)`).join(', ');
      findings.push({
        code: 'REPEATED_BASE_TABLE',
        title: 'Repeated base table access paths',
        severity: stats.repeatedBaseTableCount >= 3 ? 'CRITICAL' : 'HIGH',
        healthPenalty: penalty,
        symbol: '⇄',
        category: 'io_pressure',
        evidenceGrade: 'D',
        explanation: `${stats.repeatedBaseTableCount} farklı fiziksel tabloya çoklu dependency dalı üzerinden erişiliyor (${names}). Kritik not: SQL Server CTE'leri varsayılan olarak materialize etmez; tek tarama iddiası yalnız execution plan ve IO kanıtıyla doğrulanabilir.`
      });
    }

    // High blast radius finding
    if (stats.dependentCount >= 10) {
      const penalty = Math.min(8, Math.floor(stats.dependentCount / 10) * 2);
      findings.push({
        code: 'HIGH_BLAST_RADIUS',
        title: 'High dependency blast radius',
        severity: stats.dependentCount >= 20 ? 'HIGH' : 'WARNING',
        healthPenalty: penalty,
        symbol: '⊛',
        category: 'risk',
        evidenceGrade: 'D',
        explanation: `Bu view, üst katmandaki ${stats.dependentCount} nesne/rapor tarafından doğrudan veya dolaylı olarak çağrılmaktadır. Olası bir şema/semantik değişiklik geniş çaplı regresyon riski taşır.`
      });
    }

    // Cycles finding
    if (stats.cycles.length > 0) {
      findings.push({
        code: 'CIRCULAR_DEPENDENCY',
        title: 'Circular dependency detected',
        severity: 'CRITICAL',
        healthPenalty: 20,
        symbol: '⟳',
        category: 'architecture',
        evidenceGrade: 'D',
        explanation: `View bağımlılık zincirinde döngüsel referans tespit edildi: ${stats.cycles[0].join(' → ')}.`
      });
    }

    // Unresolved finding
    if (stats.unresolved.length > 0) {
      const missing = stats.unresolved.map(u => u.targetName).join(', ');
      findings.push({
        code: 'UNRESOLVED_DEPENDENCY',
        title: 'Unresolved object reference',
        severity: 'WARNING',
        healthPenalty: 5,
        symbol: '?',
        category: 'schema',
        evidenceGrade: 'D',
        explanation: `View tanımında katalogda eşleşmeyen referanslar tespit edildi: ${missing}. Silinmiş nesne veya dinamik SQL kalıntısı olabilir.`
      });
    }

    return findings;
  }

  // Aggregate stats map
  const statsMap = new Map();
  for (const v of views) {
    const down = downstreamAnalysis(v.object_id, v.view_name);
    const up = upstreamAnalysis(v.object_id);
    const directCount = (outgoing.get(v.object_id) || []).length;
    const combined = {
      ...down,
      ...up,
      directDependencyCount: directCount
    };
    combined.graphFindings = buildGraphFindings(combined);
    statsMap.set(v.object_id, combined);
  }

  return statsMap;
}

/**
 * Builds an interactive visual subgraph for a specific view:
 * Contains target view, immediate upstream views, downstream views,
 * base tables reached, and functions.
 */
function extractSubGraph(viewNameOrId, views = [], edges = []) {
  const viewMap = new Map(views.map(v => [v.object_id, v]));
  const targetView = typeof viewNameOrId === 'number'
    ? viewMap.get(viewNameOrId)
    : views.find(v => v.view_name.equalsIgnoreCase ? v.view_name.equalsIgnoreCase(viewNameOrId) : v.view_name.toLowerCase() === String(viewNameOrId).toLowerCase());

  if (!targetView) return null;

  const targetId = targetView.object_id;
  const nodes = new Map();
  const graphEdges = [];

  // Add target node
  nodes.set(targetId, {
    id: targetId,
    name: targetView.view_name,
    type: 'TARGET',
    health: targetView.health || 100,
    risk: targetView.risk?.level || 'LOW',
    riskScore: targetView.risk?.score || 0
  });

  // Outgoing edges from target (downstream)
  for (const e of edges) {
    if (e.source_object_id === targetId) {
      const tgtId = e.target_object_id || `unresolved_${e.target_name}`;
      let type = 'TABLE';
      const tdesc = String(e.target_type || '').toUpperCase();
      if (tdesc.includes('VIEW')) type = 'VIEW';
      else if (tdesc.includes('FUNCTION')) type = 'FUNCTION';
      else if (e.target_object_id == null) type = 'UNRESOLVED';

      if (!nodes.has(tgtId)) {
        nodes.set(tgtId, {
          id: tgtId,
          name: e.target_name,
          type,
          health: viewMap.get(tgtId)?.health || null
        });
      }
      graphEdges.push({
        source: targetId,
        target: tgtId,
        type: 'downstream'
      });
    }

    // Incoming edges to target (upstream)
    if (e.target_object_id === targetId) {
      const srcId = e.source_object_id;
      const srcView = viewMap.get(srcId);
      if (!nodes.has(srcId)) {
        nodes.set(srcId, {
          id: srcId,
          name: e.source_name || srcView?.view_name,
          type: 'UPSTREAM_VIEW',
          health: srcView?.health || null
        });
      }
      graphEdges.push({
        source: srcId,
        target: targetId,
        type: 'upstream'
      });
    }
  }

  return {
    target: targetView.view_name,
    nodes: Array.from(nodes.values()),
    edges: graphEdges
  };
}

module.exports = { buildDependencyStats, extractSubGraph };
