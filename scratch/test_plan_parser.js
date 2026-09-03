const { parseShowPlanXML } = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/planParser');

const sampleXml = `
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.5">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM STOK_HAREKETLERI WHERE sto_kod = 'TEST'" StatementSubTreeCost="1.25" StatementEstRows="120" OptimizationLevel="FULL">
          <QueryPlan>
            <MissingIndexes>
              <MissingIndexGroup Impact="85.4">
                <MissingIndex Database="[MikroDB_V16]" Schema="[dbo]" Table="[STOK_HAREKETLERI]">
                  <ColumnGroup Usage="EQUALITY">
                    <Column Name="[sth_stok_kod]"/>
                  </ColumnGroup>
                  <ColumnGroup Usage="INCLUDE">
                    <Column Name="[sth_tarih]"/>
                    <Column Name="[sth_miktar]"/>
                  </ColumnGroup>
                </MissingIndex>
              </MissingIndexGroup>
            </MissingIndexes>
            <Warnings>
              <SpillToTempDb Level="1" SpillType="HashSpill" />
            </Warnings>
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="120" EstimatedTotalSubtreeCost="1.25">
              <Object Table="[STOK_HAREKETLERI]" Index="[PK_STOK_HAREKETLERI]" />
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>
`;

const parsed = parseShowPlanXML(sampleXml);
console.log('Parsed ShowPlan:', JSON.stringify(parsed, null, 2));

if (parsed.warnings.length !== 1 || parsed.missingIndexes.length !== 1 || parsed.topOperators.length !== 1) {
  console.error('ShowPlan parse test failed!');
  process.exit(1);
}

console.log('\n>>> ShowPlanXML Parser test PASSED! <<<');
