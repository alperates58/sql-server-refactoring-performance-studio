/**
 * SQL Server Refactoring & Performance Studio
 * Plan Parser Unit Tests (Sprint 3)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseShowPlanXML, getOperatorCategory } = require('../server/services/planParser');

describe('Plan Parser - ShowPlanXML Engine', () => {

  it('handles null, undefined or empty XML gracefully without throwing', () => {
    const resNull = parseShowPlanXML(null);
    assert.strictEqual(resNull.totalSubTreeCost, 0);
    assert.deepStrictEqual(resNull.operators, []);
    assert.deepStrictEqual(resNull.warnings, []);

    const resEmpty = parseShowPlanXML('   ');
    assert.strictEqual(resEmpty.totalSubTreeCost, 0);
    assert.deepStrictEqual(resEmpty.operators, []);
  });

  it('handles malformed XML safely', () => {
    const resBad = parseShowPlanXML('<ShowPlanXML><UnclosedTag>');
    assert.ok(resBad !== null);
    assert.strictEqual(resBad.totalSubTreeCost, 0);
  });

  it('parses ShowPlanXML statement cost and statement type', () => {
    const sampleXml = `
      <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.5">
        <BatchSequence>
          <Batch>
            <Statements>
              <StmtSimple StatementText="SELECT * FROM Customers WHERE City = 'Ankara'" StatementSubTreeCost="0.0425" StatementType="SELECT" QueryHash="0x12345678">
                <QueryPlan DegreeOfParallelism="1">
                  <RelOp NodeId="0" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimatedTotalSubtreeCost="0.0425" EstimateRows="12">
                  </RelOp>
                </QueryPlan>
              </StmtSimple>
            </Statements>
          </Batch>
        </BatchSequence>
      </ShowPlanXML>
    `;
    const plan = parseShowPlanXML(sampleXml);
    assert.strictEqual(plan.totalSubTreeCost, 0.0425);
    assert.strictEqual(plan.statementType, 'SELECT');
    assert.strictEqual(plan.queryHash, '0x12345678');
    assert.strictEqual(plan.operators.length, 1);
    assert.strictEqual(plan.seeks, 1);
    assert.strictEqual(plan.scans, 0);
  });

  it('constructs a hierarchical RelOp operator tree preserving children: []', () => {
    const sampleXml = `
      <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
        <BatchSequence><Batch><Statements>
          <StmtSimple StatementSubTreeCost="1.5" StatementType="SELECT">
            <QueryPlan>
              <RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimatedTotalSubtreeCost="1.5" EstimateRows="100">
                <NestedLoops>
                  <RelOp NodeId="1" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimatedTotalSubtreeCost="0.5" EstimateRows="50">
                  </RelOp>
                  <RelOp NodeId="2" PhysicalOp="Index Scan" LogicalOp="Index Scan" EstimatedTotalSubtreeCost="0.8" EstimateRows="50">
                  </RelOp>
                </NestedLoops>
              </RelOp>
            </QueryPlan>
          </StmtSimple>
        </Statements></Batch></BatchSequence>
      </ShowPlanXML>
    `;
    const plan = parseShowPlanXML(sampleXml);
    assert.strictEqual(plan.operators.length, 3);
    assert.ok(plan.tree !== null);
    assert.strictEqual(plan.tree.nodeId, 0);
    assert.strictEqual(plan.tree.physicalOp, 'Nested Loops');
    assert.strictEqual(plan.tree.children.length, 2);
    assert.strictEqual(plan.tree.children[0].nodeId, 1);
    assert.strictEqual(plan.tree.children[1].nodeId, 2);
  });

  it('categorizes operators correctly into ACCESS, JOIN, SORT, AGGREGATE, SPOOL, PARALLELISM, OTHER', () => {
    assert.strictEqual(getOperatorCategory('Index Scan'), 'ACCESS');
    assert.strictEqual(getOperatorCategory('Table Scan'), 'ACCESS');
    assert.strictEqual(getOperatorCategory('Clustered Index Seek'), 'ACCESS');
    assert.strictEqual(getOperatorCategory('Nested Loops'), 'JOIN');
    assert.strictEqual(getOperatorCategory('Hash Match', 'Inner Join'), 'JOIN');
    assert.strictEqual(getOperatorCategory('Merge Join'), 'JOIN');
    assert.strictEqual(getOperatorCategory('Sort'), 'SORT');
    assert.strictEqual(getOperatorCategory('Stream Aggregate'), 'AGGREGATE');
    assert.strictEqual(getOperatorCategory('Hash Match', 'Aggregate'), 'AGGREGATE');
    assert.strictEqual(getOperatorCategory('Table Spool'), 'SPOOL');
    assert.strictEqual(getOperatorCategory('Distribute Streams'), 'PARALLELISM');
    assert.strictEqual(getOperatorCategory('Compute Scalar'), 'OTHER');
  });

  describe('Cardinality Mismatch Engine (4-Tier)', () => {
    it('detects <3x ratio as Normal (no mismatch)', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="1.0">
              <QueryPlan>
                <RelOp NodeId="0" PhysicalOp="Index Seek" EstimateRows="100">
                  <RunTimeInformation>
                    <RunTimeCountersPerThread ActualRows="150" />
                  </RunTimeInformation>
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.strictEqual(plan.cardinalityMismatches.length, 0);
    });

    it('detects 3x-10x ratio as LOW severity mismatch', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="1.0">
              <QueryPlan>
                <RelOp NodeId="0" PhysicalOp="Index Seek" EstimateRows="20">
                  <RunTimeInformation>
                    <RunTimeCountersPerThread ActualRows="100" />
                  </RunTimeInformation>
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.strictEqual(plan.cardinalityMismatches.length, 1);
      assert.strictEqual(plan.cardinalityMismatches[0].severity, 'LOW');
      assert.strictEqual(plan.cardinalityMismatches[0].ratio, 5);
    });

    it('detects 10x-100x ratio as MEDIUM severity mismatch', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="1.0">
              <QueryPlan>
                <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" EstimateRows="10">
                  <RunTimeInformation>
                    <RunTimeCountersPerThread ActualRows="500" />
                  </RunTimeInformation>
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.strictEqual(plan.cardinalityMismatches.length, 1);
      assert.strictEqual(plan.cardinalityMismatches[0].severity, 'MEDIUM');
      assert.strictEqual(plan.cardinalityMismatches[0].ratio, 50);
    });

    it('detects >=100x ratio as HIGH / CRITICAL severity mismatch', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="1.0">
              <QueryPlan>
                <RelOp NodeId="0" PhysicalOp="Table Scan" EstimateRows="1">
                  <RunTimeInformation>
                    <RunTimeCountersPerThread ActualRows="15000" />
                  </RunTimeInformation>
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.strictEqual(plan.cardinalityMismatches.length, 1);
      assert.strictEqual(plan.cardinalityMismatches[0].severity, 'HIGH');
      assert.strictEqual(plan.cardinalityMismatches[0].ratio, 15000);
    });
  });

  describe('Memory Grant Extraction', () => {
    it('extracts memory grant details and flags excessive grants', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="5.0">
              <QueryPlan>
                <MemoryGrantInfo SerialRequiredMemory="2048" SerialDesiredMemory="32768" RequiredMemory="2048" DesiredMemory="32768" RequestedMemory="32768" GrantWaitTime="0" GrantedMemory="32768" MaxUsedMemory="1024" />
                <RelOp NodeId="0" PhysicalOp="Sort" LogicalOp="Sort" EstimatedTotalSubtreeCost="5.0" EstimateRows="1000">
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.ok(plan.memoryGrant !== null);
      assert.strictEqual(plan.memoryGrant.grantedMemoryKb, 32768);
      assert.strictEqual(plan.memoryGrant.requestedMemoryKb, 32768);
      assert.strictEqual(plan.memoryGrant.maxUsedMemoryKb, 1024);
      assert.strictEqual(plan.memoryGrant.isExcessive, true);
      // Excessive grant should also generate a warning
      assert.ok(plan.warnings.some(w => w.kind === 'EXCESSIVE_MEMORY_GRANT'));
    });
  });

  describe('Plan Warnings Extraction', () => {
    it('extracts NoJoinPredicate, SpillToTempDb and Implicit Conversion warnings', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="10.0">
              <QueryPlan>
                <Warnings UnmatchedIndexes="true">
                  <SpillToTempDb SpillLevel="1" SpilledThreadCount="4" />
                  <PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT_IMPLICIT(int, [col], 0)" />
                </Warnings>
                <RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimatedTotalSubtreeCost="10.0" EstimateRows="100">
                  <Warnings NoJoinPredicate="true" />
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.ok(plan.warnings.some(w => w.kind === 'NO_JOIN_PREDICATE'));
      assert.ok(plan.warnings.some(w => w.kind === 'SPILL_TEMPDB'));
      assert.ok(plan.warnings.some(w => w.kind === 'IMPLICIT_CONVERSION'));
    });
  });

  describe('Missing Index Recommendations', () => {
    it('extracts missing indexes and generates safe CREATE INDEX DDL with review warning', () => {
      const xml = `
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="15.0">
              <QueryPlan>
                <MissingIndexes>
                  <MissingIndexGroup Impact="85.45">
                    <MissingIndex Database="[SalesDB]" Schema="[dbo]" Table="[Orders]">
                      <ColumnGroup Usage="EQUALITY">
                        <Column Name="[CustomerId]" />
                        <Column Name="[Status]" />
                      </ColumnGroup>
                      <ColumnGroup Usage="INEQUALITY">
                        <Column Name="[OrderDate]" />
                      </ColumnGroup>
                      <ColumnGroup Usage="INCLUDE">
                        <Column Name="[TotalAmount]" />
                        <Column Name="[Discount]" />
                      </ColumnGroup>
                    </MissingIndex>
                  </MissingIndexGroup>
                </MissingIndexes>
                <RelOp NodeId="0" PhysicalOp="Table Scan" LogicalOp="Table Scan" EstimatedTotalSubtreeCost="15.0" EstimateRows="50000">
                </RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
      `;
      const plan = parseShowPlanXML(xml);
      assert.strictEqual(plan.missingIndexes.length, 1);
      const mi = plan.missingIndexes[0];
      assert.strictEqual(mi.impact, 85.45);
      assert.strictEqual(mi.table, '[Orders]');
      assert.strictEqual(mi.schema, '[dbo]');
      assert.deepStrictEqual(mi.equalityColumns, ['[CustomerId]', '[Status]']);
      assert.deepStrictEqual(mi.inequalityColumns, ['[OrderDate]']);
      assert.deepStrictEqual(mi.includedColumns, ['[TotalAmount]', '[Discount]']);
      assert.ok(mi.ddl.includes('CREATE NONCLUSTERED INDEX [IX_Orders_Missing] ON [dbo].[Orders]'));
      assert.ok(mi.ddl.includes('([CustomerId], [Status], [OrderDate])'));
      assert.ok(mi.ddl.includes('INCLUDE ([TotalAmount], [Discount])'));
      assert.strictEqual(mi.requiresManualReview, true);
    });
  });

});
