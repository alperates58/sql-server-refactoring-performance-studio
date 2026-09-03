/**
 * SQL Server Refactoring & Performance Studio
 * ShowPlanXML Decomposition & Operator Intelligence Service
 *
 * Implements:
 * - RelOp extraction with PhysicalOp, LogicalOp, NodeId, SubTreeCost, EstimatedRows
 * - Actual vs Estimated Cardinality Comparison (mismatch detection >= 10x, >= 100x)
 * - Expensive Operator identification (Top Cost %, Scans vs Seeks, Key Lookups, Sort Spills)
 * - Plan Warnings detection (Missing Statistics, Implicit Conversions, TempDB Spills)
 * - Missing Indexes recommendations extracted from <MissingIndexes> XML block
 */

/**
 * Parses raw SQL Server ShowPlanXML into structured performance findings.
 */
function parseShowPlanXML(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') {
    return { error: 'ShowPlan XML verisi boş.' };
  }

  const operators = [];
  const warnings = [];
  const missingIndexes = [];
  const cardinalityMismatches = [];

  // 1. Extract Statement Attributes
  const subtreeCostMatch = xmlString.match(/StatementSubTreeCost="([^"]+)"/);
  const totalSubTreeCost = subtreeCostMatch ? parseFloat(subtreeCostMatch[1]) : 1.0;

  const estRowsMatch = xmlString.match(/StatementEstRows="([^"]+)"/);
  const totalEstRows = estRowsMatch ? parseFloat(estRowsMatch[1]) : 0;

  const optLevelMatch = xmlString.match(/OptimizationLevel="([^"]+)"/);
  const optimizationLevel = optLevelMatch ? optLevelMatch[1] : 'FULL';

  // 2. Extract RelOp Operators
  const relOpRegex = /<RelOp\b([^>]*?)(?:\/?>|>([\s\S]*?)<\/RelOp>)/g;
  let relOpMatch;

  while ((relOpMatch = relOpRegex.exec(xmlString)) !== null) {
    const attrsStr = relOpMatch[1];
    const innerContent = relOpMatch[2] || '';

    const nodeId = (attrsStr.match(/NodeId="(\d+)"/) || [])[1] || '0';
    const physicalOp = (attrsStr.match(/PhysicalOp="([^"]+)"/) || [])[1] || 'Unknown';
    const logicalOp = (attrsStr.match(/LogicalOp="([^"]+)"/) || [])[1] || physicalOp;
    const estCost = parseFloat((attrsStr.match(/EstimatedTotalSubtreeCost="([^"]+)"/) || [])[1] || '0');
    const estRows = parseFloat((attrsStr.match(/EstimateRows="([^"]+)"/) || [])[1] || '1');
    const estCpu = parseFloat((attrsStr.match(/EstimateCPU="([^"]+)"/) || [])[1] || '0');
    const estIo = parseFloat((attrsStr.match(/EstimateIO="([^"]+)"/) || [])[1] || '0');

    // Check for actual rows in RuntimeInformation (if Actual plan)
    let actualRows = null;
    let actualExecutions = null;
    const runtimeMatch = innerContent.match(/<RuntimeCountersPerThread\b([^>]+)/);
    if (runtimeMatch) {
      const rowMatch = runtimeMatch[1].match(/ActualRows="(\d+)"/);
      if (rowMatch) actualRows = parseInt(rowMatch[1], 10);
      const execMatch = runtimeMatch[1].match(/ActualExecutions="(\d+)"/);
      if (execMatch) actualExecutions = parseInt(execMatch[1], 10);
    }

    // Check for Table / Object Name
    let targetObject = '';
    const objMatch = innerContent.match(/<Object\b[^>]*Table="\[([^\]]+)\]"/);
    if (objMatch) {
      targetObject = objMatch[1];
    } else {
      const rawObjMatch = innerContent.match(/<Object\b[^>]*Table="([^"]+)"/);
      if (rawObjMatch) targetObject = rawObjMatch[1];
    }

    // Check for Key Lookup / RID Lookup
    const isLookup = attrsStr.includes('Lookup="1"') || attrsStr.includes('Lookup="true"') || innerContent.includes('Lookup="1"') || innerContent.includes('Lookup="true"');
    const isScan = physicalOp.toLowerCase().includes('scan');

    const opCostPct = totalSubTreeCost > 0 ? Math.min(100, Math.round((estCost / totalSubTreeCost) * 100)) : 0;

    const opData = {
      nodeId: parseInt(nodeId, 10),
      physicalOp,
      logicalOp,
      targetObject,
      isLookup,
      isScan,
      cost: estCost,
      costPercent: opCostPct,
      estimatedRows: estRows,
      actualRows,
      actualExecutions,
      estimatedIO: estIo,
      estimatedCPU: estCpu
    };

    // Cardinality Error Check (if actual rows available)
    if (actualRows != null && estRows > 0) {
      const ratio = actualRows / estRows;
      if (ratio >= 10 || ratio <= 0.1) {
        const severity = (ratio >= 100 || ratio <= 0.01) ? 'CRITICAL' : 'HIGH';
        const factor = ratio >= 1 ? `${Math.round(ratio)}x Under-estimated` : `${Math.round(1 / ratio)}x Over-estimated`;
        cardinalityMismatches.push({
          nodeId: opData.nodeId,
          operator: physicalOp,
          object: targetObject,
          estimated: estRows,
          actual: actualRows,
          factor,
          severity
        });
      }
    }

    operators.push(opData);
  }

  // 3. Extract Warnings (<Warnings>...</Warnings>)
  const warningRegex = /<Warnings\b([^>]*?)>([\s\S]*?)<\/Warnings>/g;
  let warnMatch;
  while ((warnMatch = warningRegex.exec(xmlString)) !== null) {
    const wText = warnMatch[2];
    if (wText.includes('SpillToTempDb')) {
      warnings.push({
        type: 'SPILL_TEMPDB',
        title: 'TempDB Spill Tespit Edildi',
        severity: 'CRITICAL',
        detail: 'Hafıza yetersizliği nedeniyle Sort veya Hash Match işlemi diske (TempDB) yazdı.'
      });
    }
    if (wText.includes('ColumnsWithNoStatistics')) {
      warnings.push({
        type: 'MISSING_STATS',
        title: 'İstatistik Eksikliği',
        severity: 'HIGH',
        detail: 'Sorgu optimizasyonu sırasında güncel olmayan veya eksik istatistik kullanıldı.'
      });
    }
    if (wText.includes('PlanAffectingConvert')) {
      warnings.push({
        type: 'IMPLICIT_CONVERSION',
        title: 'Performansı Etkileyen Tip Dönüşümü (Implicit Conversion)',
        severity: 'HIGH',
        detail: 'Filtre şartında veya join kolonunda veri tipi uyuşmazlığı nedeniyle indeks seek engelleniyor olabilir.'
      });
    }
  }

  // 4. Extract Missing Indexes
  const missingIdxRegex = /<MissingIndexGroup\b[^>]*Impact="([^"]+)"[\s\S]*?<MissingIndex\b[^>]*Database="\[([^\]]+)\]"\s+Schema="\[([^\]]+)\]"\s+Table="\[([^\]]+)\]"[\s\S]*?<\/MissingIndexGroup>/g;
  let miMatch;
  while ((miMatch = missingIdxRegex.exec(xmlString)) !== null) {
    const impact = parseFloat(miMatch[1]) || 0;
    const dbName = miMatch[2];
    const schema = miMatch[3];
    const table = miMatch[4];

    // Extract equality & inequality columns
    const groupBlock = miMatch[0];
    const eqCols = [];
    const eqRegex = /<ColumnGroup\s+Usage="EQUALITY">([\s\S]*?)<\/ColumnGroup>/;
    const eqMatch = groupBlock.match(eqRegex);
    if (eqMatch) {
      const colRegex = /<Column\s+Name="\[([^\]]+)\]"/g;
      let c;
      while ((c = colRegex.exec(eqMatch[1])) !== null) eqCols.push(c[1]);
    }

    const ineqCols = [];
    const ineqRegex = /<ColumnGroup\s+Usage="INEQUALITY">([\s\S]*?)<\/ColumnGroup>/;
    const ineqMatch = groupBlock.match(ineqRegex);
    if (ineqMatch) {
      const colRegex = /<Column\s+Name="\[([^\]]+)\]"/g;
      let c;
      while ((c = colRegex.exec(ineqMatch[1])) !== null) ineqCols.push(c[1]);
    }

    const incCols = [];
    const incRegex = /<ColumnGroup\s+Usage="INCLUDE">([\s\S]*?)<\/ColumnGroup>/;
    const incMatch = groupBlock.match(incRegex);
    if (incMatch) {
      const colRegex = /<Column\s+Name="\[([^\]]+)\]"/g;
      let c;
      while ((c = colRegex.exec(incMatch[1])) !== null) incCols.push(c[1]);
    }

    const allKeys = [...eqCols, ...ineqCols];
    const indexName = `IX_${table}_${allKeys.slice(0, 2).join('_') || 'Perf'}`;
    const createDdl = `CREATE NONCLUSTERED INDEX [${indexName}] ON [${schema}].[${table}] (${allKeys.map(k => `[${k}]`).join(', ')})${incCols.length > 0 ? ` INCLUDE (${incCols.map(k => `[${k}]`).join(', ')})` : ''};`;

    missingIndexes.push({
      impact: Math.round(impact),
      table: `${schema}.${table}`,
      equalityColumns: eqCols,
      inequalityColumns: ineqCols,
      includeColumns: incCols,
      indexDdl: createDdl
    });
  }

  // Identify Top Expensive Operators
  const topOperators = [...operators]
    .sort((a, b) => b.costPercent - a.costPercent)
    .slice(0, 5);

  return {
    totalSubTreeCost,
    totalEstRows,
    optimizationLevel,
    operatorCount: operators.length,
    topOperators,
    operators: operators.slice(0, 30),
    warnings,
    missingIndexes,
    cardinalityMismatches
  };
}

module.exports = {
  parseShowPlanXML
};
