/**
 * SQL Server Refactoring & Performance Studio
 * Dependency Graph & Analysis Engine
 *
 * Implements:
 * - Downstream traversal & max depth
 * - Transitive dependency collection
 * - Base tables reached & repeated base table paths (CTE disclaimer applied)
 * - Cycle detection via DFS recursion stack
 * - Unresolved entity tracking
 * - Upstream reverse dependency analysis (Blast Radius)
 * - Filterable visual SubGraph extraction (depth: 1/2/3/all, direction: both/upstream/downstream)
 */

function buildDependencyStats(views = [], rawEdges = []) {
  const viewMap = new Map(views.map(v => [v.object_id, v]));
  const outgoing = new Map();
  const incoming = new Map();

  for (const e of rawEdges) {
    if (!outgoing.has(e.source_object_id)) outgoing.set(e.source_object_id, []);
    outgoing.get(e.source_object_id).push(e);

    if (e.target_object_id != null) {
      if (!incoming.has(e.target_object_id)) incoming.set(e.target_object_id, []);
      incoming.get(e.target_object_id).push(e);
    }
  }

  function downstreamAnalysis(rootId, rootName) {
    let maxDepth = 1;
    const baseTablePaths = new Map();
    const baseTableNames = new Map();
    const transitiveObjects = new Set();
    const downstreamViews = new Set();
    const downstreamFunctions = new Set();
    const cycles = [];
    const unresolved = [];

    function traverse(currentId, currentDepth, currentPath, visitedInBranch) {
      if (currentDepth > maxDepth) maxDepth = currentDepth;

      const edges = outgoing.get(currentId) || [];
      for (const edge of edges) {
        const targetId = edge.target_object_id;
        const targetName = edge.target_name;
        const targetType = String(edge.target_type || '').toUpperCase();

        if (targetId == null) {
          unresolved.push({
            name: targetName,
            referencedBy: currentId,
            edge: edge
          });
          continue;
        }

        if (visitedInBranch.has(targetId)) {
          cycles.push({
            path: [...currentPath, targetName],
            cycleAt: targetName
          });
          continue;
        }

        transitiveObjects.add(targetId);

        if (targetType.includes('VIEW')) {
          downstreamViews.add(targetId);
          const nextVisited = new Set(visitedInBranch).add(targetId);
          traverse(targetId, currentDepth + 1, [...currentPath, targetName], nextVisited);
        } else if (targetType.includes('TABLE')) {
          if (!baseTablePaths.has(targetId)) {
            baseTablePaths.set(targetId, []);
            baseTableNames.set(targetId, targetName);
          }
          baseTablePaths.get(targetId).push([...currentPath, targetName]);
        } else if (targetType.includes('FUNCTION')) {
          downstreamFunctions.add(targetId);
        }
      }
    }

    const initialVisited = new Set([rootId]);
    traverse(rootId, 1, [rootName], initialVisited);

    const repeatedBaseTables = [];
    for (const [tableId, paths] of baseTablePaths.entries()) {
      if (paths.length > 1) {
        repeatedBaseTables.push({
          tableId,
          tableName: baseTableNames.get(tableId),
          pathCount: paths.length,
          paths
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
      upstreamViews: upstreamViews.slice(0, 30)
    };
  }

  function buildGraphFindings(stats) {
    const findings = [];

    if (stats.depth > 3) {
      findings.push({
        code: 'EXCESSIVE_DEPTH',
        title: `Aşırı Bağımlılık Derinliği (Depth: ${stats.depth})`,
        severity: stats.depth >= 6 ? 'CRITICAL' : 'HIGH',
        category: 'STRUCTURAL',
        evidenceGrade: 'D',
        symbol: '⌁',
        healthPenalty: Math.min(12, (stats.depth - 3) * 3),
        explanation: `View ${stats.depth} seviye iç içe dependency içeriyor. SQL Server optimizer plan karmaşıklığı artar.`
      });
    }

    if (stats.repeatedBaseTableCount > 0) {
      const sample = stats.repeatedBaseTablePaths.slice(0, 3).map(r => `${r.tableName} (${r.pathCount} yol)`).join(', ');
      findings.push({
        code: 'REPEATED_BASE_TABLE_PATHS',
        title: `Mükerrer Base Tablo Erişimi (${stats.repeatedBaseTableCount} tablo)`,
        severity: stats.repeatedBaseTableCount >= 3 ? 'CRITICAL' : 'HIGH',
        category: 'STRUCTURAL',
        evidenceGrade: 'D',
        symbol: '⇄',
        healthPenalty: Math.min(18, stats.repeatedBaseTableCount * 6),
        explanation: `Aynı base tabloya birden fazla dependency dalı üzerinden erişiliyor: ${sample}. (Not: CTE bu tekrarları otomatik tek scan yapmaz).`
      });
    }

    if (stats.cycles.length > 0) {
      findings.push({
        code: 'CIRCULAR_DEPENDENCY',
        title: `Döngüsel Bağımlılık (Cycle Detected)`,
        severity: 'CRITICAL',
        category: 'STRUCTURAL',
        evidenceGrade: 'D',
        symbol: '↻',
        healthPenalty: 20,
        explanation: `View bağımlılık zincirinde döngü tespit edildi.`
      });
    }

    if (stats.unresolved.length > 0) {
      findings.push({
        code: 'UNRESOLVED_DEPENDENCY',
        title: `Çözülememiş Referans (${stats.unresolved.length} nesne)`,
        severity: 'MEDIUM',
        category: 'STRUCTURAL',
        evidenceGrade: 'D',
        symbol: '?',
        healthPenalty: Math.min(10, stats.unresolved.length * 3),
        explanation: `View tanımında katalogda eşleşmeyen bağımlılıklar bulundu.`
      });
    }

    return findings;
  }

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
 * Enhanced Subgraph Extractor with Depth & Direction Filtering
 */
function extractSubGraph(viewNameOrId, views = [], edges = [], options = {}) {
  const maxDepth = options.depth === 'all' ? 99 : Number(options.depth || 2);
  const direction = options.direction || 'both'; // 'both' | 'downstream' | 'upstream'

  const viewMap = new Map(views.map(v => [v.object_id, v]));
  const viewByName = new Map(views.map(v => [String(v.view_name).toLowerCase(), v]));

  const targetView = typeof viewNameOrId === 'number'
    ? viewMap.get(viewNameOrId)
    : viewByName.get(String(viewNameOrId).toLowerCase());

  if (!targetView) return null;

  const targetId = targetView.object_id;
  const nodes = new Map();
  const graphEdges = [];
  const edgeKeySet = new Set();

  function addNode(id, name, type, health = null, risk = null, riskScore = null, extra = {}) {
    const key = String(id);
    if (!nodes.has(key)) {
      nodes.set(key, {
        id: key,
        name: name || key,
        type,
        health,
        risk: risk || (health != null ? (health < 50 ? 'CRITICAL' : health < 75 ? 'HIGH' : 'LOW') : null),
        riskScore: riskScore || (health != null ? Math.max(0, 100 - health) : null),
        ...extra
      });
    }
  }

  function addEdge(source, target, type, depth = 1) {
    const key = `${source}->${target}`;
    if (!edgeKeySet.has(key)) {
      edgeKeySet.add(key);
      graphEdges.push({
        source: String(source),
        target: String(target),
        type,
        depth
      });
    }
  }

  // Add target view node
  addNode(targetId, targetView.view_name, 'TARGET', targetView.health || 85, targetView.risk?.level || 'HIGH', targetView.risk?.score || 72, { isTarget: true });

  const outgoing = new Map();
  const incoming = new Map();
  for (const e of edges) {
    if (!outgoing.has(e.source_object_id)) outgoing.set(e.source_object_id, []);
    outgoing.get(e.source_object_id).push(e);

    if (e.target_object_id != null) {
      if (!incoming.has(e.target_object_id)) incoming.set(e.target_object_id, []);
      incoming.get(e.target_object_id).push(e);
    }
  }

  // Downstream Traversal (BFS up to maxDepth)
  if (direction === 'both' || direction === 'downstream') {
    const downQueue = [{ id: targetId, depth: 1 }];
    const downVisited = new Set([targetId]);

    while (downQueue.length > 0) {
      const { id: currId, depth: currDepth } = downQueue.shift();
      if (currDepth > maxDepth) continue;

      const out = outgoing.get(currId) || [];
      for (const e of out) {
        const tgtId = e.target_object_id != null ? e.target_object_id : `unresolved_${e.target_name}`;
        let type = 'TABLE';
        const tdesc = String(e.target_type || '').toUpperCase();
        if (tdesc.includes('VIEW')) type = 'VIEW';
        else if (tdesc.includes('FUNCTION')) type = 'FUNCTION';
        else if (e.target_object_id == null) type = 'UNRESOLVED';

        const tgtView = viewMap.get(tgtId);
        addNode(tgtId, e.target_name, type, tgtView?.health || null);
        addEdge(currId, tgtId, 'downstream', currDepth);

        if (type === 'VIEW' && !downVisited.has(tgtId) && currDepth < maxDepth) {
          downVisited.add(tgtId);
          downQueue.push({ id: tgtId, depth: currDepth + 1 });
        }
      }
    }
  }

  // Upstream Traversal (BFS up to maxDepth)
  if (direction === 'both' || direction === 'upstream') {
    const upQueue = [{ id: targetId, depth: 1 }];
    const upVisited = new Set([targetId]);

    while (upQueue.length > 0) {
      const { id: currId, depth: currDepth } = upQueue.shift();
      if (currDepth > maxDepth) continue;

      const inList = incoming.get(currId) || [];
      for (const e of inList) {
        const srcId = e.source_object_id;
        const srcView = viewMap.get(srcId);

        addNode(srcId, e.source_name || srcView?.view_name, 'UPSTREAM_VIEW', srcView?.health || 70);
        addEdge(srcId, currId, 'upstream', currDepth);

        if (!upVisited.has(srcId) && currDepth < maxDepth) {
          upVisited.add(srcId);
          upQueue.push({ id: srcId, depth: currDepth + 1 });
        }
      }
    }
  }

  // Identify repeated base tables in the extracted subgraph
  const tableCounts = new Map();
  for (const e of graphEdges) {
    const tgt = nodes.get(e.target);
    if (tgt && tgt.type === 'TABLE') {
      tableCounts.set(e.target, (tableCounts.get(e.target) || 0) + 1);
    }
  }
  for (const [tId, count] of tableCounts.entries()) {
    const node = nodes.get(tId);
    if (node) {
      node.pathCount = count;
      if (count > 1) {
        node.isHot = true;
      }
    }
  }

  return {
    target: targetView.view_name,
    nodes: Array.from(nodes.values()),
    edges: graphEdges
  };
}

module.exports = {
  buildDependencyStats,
  extractSubGraph
};
