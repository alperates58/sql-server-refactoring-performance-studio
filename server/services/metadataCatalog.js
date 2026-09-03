/**
 * SQL Server Refactoring & Performance Studio
 * In-Memory Metadata Catalog for Schema-Aware IntelliSense (Phase 2.5 Scope Extension)
 *
 * Guardrails:
 * 1. Zero queries per keystroke: All autocompletion is powered from this in-memory cache.
 * 2. Zero view executions: Column metadata is queried exclusively via sys.columns/sys.types.
 * 3. Metadata freshness: Carries lastUpdatedAt timestamp.
 * 4. Active Database Priority: Prioritizes current database objects when ranking.
 */

const { createObjectRef } = require('./canonicalObject');
const db = require('./sqlServer');

// Standard T-SQL Keywords
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE',
  'IS NULL', 'IS NOT NULL', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
  'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'TOP', 'DISTINCT',
  'AS', 'UNION', 'UNION ALL', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'OVER', 'PARTITION BY', 'NOLOCK', 'INDEX', 'FOR', 'FETCH NEXT', 'OFFSET', 'ROWS ONLY',
  'SET', 'BEGIN', 'TRANSACTION', 'COMMIT', 'ROLLBACK', 'CROSS APPLY', 'OUTER APPLY',
  'COALESCE', 'NULLIF', 'IIF', 'CHOOSE'
];

// Standard T-SQL Functions
const SQL_FUNCTIONS = [
  { name: 'COUNT', detail: 'COUNT(expression | *) - Satır sayısını hesaplar', returnType: 'BIGINT' },
  { name: 'SUM', detail: 'SUM(expression) - Değerlerin toplamını hesaplar', returnType: 'NUMERIC' },
  { name: 'AVG', detail: 'AVG(expression) - Aritmetik ortalama', returnType: 'NUMERIC' },
  { name: 'MIN', detail: 'MIN(expression) - Minimum değer', returnType: 'ANY' },
  { name: 'MAX', detail: 'MAX(expression) - Maksimum değer', returnType: 'ANY' },
  { name: 'ISNULL', detail: 'ISNULL(check_expression, replacement_value)', returnType: 'ANY' },
  { name: 'COALESCE', detail: 'COALESCE(v1, v2, ...) - İlk non-null değeri döndürür', returnType: 'ANY' },
  { name: 'CONVERT', detail: 'CONVERT(data_type, expression [, style])', returnType: 'ANY' },
  { name: 'CAST', detail: 'CAST(expression AS data_type)', returnType: 'ANY' },
  { name: 'DATEADD', detail: 'DATEADD(datepart, number, date)', returnType: 'DATETIME' },
  { name: 'DATEDIFF', detail: 'DATEDIFF(datepart, startdate, enddate)', returnType: 'INT' },
  { name: 'GETDATE', detail: 'GETDATE() - Geçerli sunucu tarih ve saati', returnType: 'DATETIME' },
  { name: 'SYSUTCDATETIME', detail: 'SYSUTCDATETIME() - UTC tarih ve saati', returnType: 'DATETIME2' },
  { name: 'ROW_NUMBER', detail: 'ROW_NUMBER() OVER (...) - Sıra numarası üretir', returnType: 'BIGINT' },
  { name: 'RANK', detail: 'RANK() OVER (...) - Derecelendirme üretir', returnType: 'BIGINT' },
  { name: 'DENSE_RANK', detail: 'DENSE_RANK() OVER (...) - Boşluksuz derecelendirme', returnType: 'BIGINT' },
  { name: 'SUBSTRING', detail: 'SUBSTRING(expression, start, length)', returnType: 'NVARCHAR' },
  { name: 'LEN', detail: 'LEN(string) - Karakter uzunluğu', returnType: 'INT' },
  { name: 'LTRIM', detail: 'LTRIM(string) - Baştaki boşlukları siler', returnType: 'NVARCHAR' },
  { name: 'RTRIM', detail: 'RTRIM(string) - Sondaki boşlukları siler', returnType: 'NVARCHAR' },
  { name: 'TRIM', detail: 'TRIM(string) - Boşlukları temizler', returnType: 'NVARCHAR' },
  { name: 'STRING_AGG', detail: 'STRING_AGG(expression, separator)', returnType: 'NVARCHAR(MAX)' },
  { name: 'LOWER', detail: 'LOWER(string) - Küçük harfe çevirir', returnType: 'NVARCHAR' },
  { name: 'UPPER', detail: 'UPPER(string) - Büyük harfe çevirir', returnType: 'NVARCHAR' }
];

// SQL Snippets
const SQL_SNIPPETS = [
  {
    prefix: 'sel',
    label: 'sel → SELECT * FROM',
    body: 'SELECT\n    *\nFROM ',
    description: 'Temel SELECT şablonu'
  },
  {
    prefix: 'selw',
    label: 'selw → SELECT * FROM ... WHERE',
    body: 'SELECT\n    *\nFROM \nWHERE ',
    description: 'Filtreli SELECT şablonu'
  },
  {
    prefix: 'cte',
    label: 'cte → WITH CTE AS (...)',
    body: 'WITH CTE AS (\n    SELECT \n)\nSELECT\n    *\nFROM CTE;',
    description: 'Common Table Expression şablonu'
  },
  {
    prefix: 'join',
    label: 'join → LEFT JOIN ... ON ...',
    body: 'LEFT JOIN  AS  ON . = .',
    description: 'LEFT JOIN şablonu'
  },
  {
    prefix: 'case',
    label: 'case → CASE WHEN ... THEN ... END',
    body: 'CASE\n    WHEN  THEN \n    ELSE \nEND',
    description: 'CASE WHEN koşul ifadesi'
  }
];

class MetadataCatalog {
  constructor() {
    this.lastUpdatedAt = new Date().toISOString();
    this.databases = ['MikroDB_V16_LIDER25', 'RAPOR_DB', 'MikroDB_V16_TEST'];
    this.schemas = ['dbo'];
    this.tables = [];
    this.views = [];
    this.columns = []; // { database, schema, table, name, dataType, ordinal, nullable }
    this.synonyms = [];
    this.keywords = SQL_KEYWORDS;
    this.functions = SQL_FUNCTIONS;
    this.snippets = SQL_SNIPPETS;

    // Load initial demo catalog
    this.loadDemoCatalog();
  }

  loadDemoCatalog() {
    this.lastUpdatedAt = new Date().toISOString();
    this.databases = ['MikroDB_V16_LIDER25', 'RAPOR_DB', 'MikroDB_V16_TEST'];
    this.schemas = ['dbo'];

    // Physical Tables with full column metadata
    this.tables = [
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'STOK_HAREKETLERI',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.STOK_HAREKETLERI',
        type: 'TABLE',
        columns: [
          { name: 'sth_id', dataType: 'int', nullable: false },
          { name: 'sth_stok_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'sth_tip', dataType: 'tinyint', nullable: false },
          { name: 'sth_cins', dataType: 'tinyint', nullable: false },
          { name: 'sth_evrakno', dataType: 'nvarchar(20)', nullable: true },
          { name: 'sth_tarih', dataType: 'datetime', nullable: false },
          { name: 'sth_miktar', dataType: 'float', nullable: false },
          { name: 'sth_tutar', dataType: 'float', nullable: false },
          { name: 'sth_giris_depo', dataType: 'int', nullable: true },
          { name: 'sth_cikis_depo', dataType: 'int', nullable: true },
          { name: 'sth_isemri_kod', dataType: 'nvarchar(25)', nullable: true }
        ]
      },
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'STOKLAR',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.STOKLAR',
        type: 'TABLE',
        columns: [
          { name: 'sto_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'sto_isim', dataType: 'nvarchar(50)', nullable: false },
          { name: 'sto_kisa_adi', dataType: 'nvarchar(20)', nullable: true },
          { name: 'sto_birim1_ad', dataType: 'nvarchar(10)', nullable: true },
          { name: 'sto_birim1_katsayi', dataType: 'float', nullable: true },
          { name: 'sto_anagrup_kod', dataType: 'nvarchar(25)', nullable: true },
          { name: 'sto_altgrup_kod', dataType: 'nvarchar(25)', nullable: true },
          { name: 'sto_standartmaliyet', dataType: 'float', nullable: true }
        ]
      },
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'ISEMIRLERI',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.ISEMIRLERI',
        type: 'TABLE',
        columns: [
          { name: 'is_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'is_ismi', dataType: 'nvarchar(50)', nullable: false },
          { name: 'is_emirtarihi', dataType: 'datetime', nullable: false },
          { name: 'is_baslamatarihi', dataType: 'datetime', nullable: true },
          { name: 'is_bitistarihi', dataType: 'datetime', nullable: true },
          { name: 'is_durumu', dataType: 'tinyint', nullable: false }
        ]
      },
      {
        database: 'RAPOR_DB',
        schema: 'dbo',
        name: 'STOK_HAREKETLERI',
        canonicalId: 'RAPOR_DB.dbo.STOK_HAREKETLERI',
        type: 'TABLE',
        columns: [
          { name: 'sth_id', dataType: 'int', nullable: false },
          { name: 'sth_stok_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'sth_tarih', dataType: 'datetime', nullable: false },
          { name: 'sth_miktar', dataType: 'float', nullable: false },
          { name: 'sth_tutar', dataType: 'float', nullable: false }
        ]
      },
      {
        database: 'RAPOR_DB',
        schema: 'dbo',
        name: 'STOKLAR',
        canonicalId: 'RAPOR_DB.dbo.STOKLAR',
        type: 'TABLE',
        columns: [
          { name: 'sto_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'sto_isim', dataType: 'nvarchar(50)', nullable: false },
          { name: 'sto_birim1_ad', dataType: 'nvarchar(10)', nullable: true }
        ]
      },
      {
        database: 'RAPOR_DB',
        schema: 'dbo',
        name: 'SIPARISLER',
        canonicalId: 'RAPOR_DB.dbo.SIPARISLER',
        type: 'TABLE',
        columns: [
          { name: 'sip_evrakno', dataType: 'nvarchar(20)', nullable: false },
          { name: 'sip_tarih', dataType: 'datetime', nullable: false },
          { name: 'sip_stok_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'sip_miktar', dataType: 'float', nullable: false },
          { name: 'sip_kalan_miktar', dataType: 'float', nullable: false },
          { name: 'sip_teslim_tarihi', dataType: 'datetime', nullable: true }
        ]
      }
    ];

    // Views with column metadata
    this.views = [
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'AA_URETIM_MALZEME_PLANLAMA',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_URETIM_MALZEME_PLANLAMA',
        type: 'VIEW',
        health: 38,
        risk: 'critical',
        columns: [
          { name: 'Ana İş Emri', dataType: 'nvarchar(25)', nullable: true },
          { name: 'İş Kodu', dataType: 'nvarchar(25)', nullable: true },
          { name: 'Sipariş No', dataType: 'nvarchar(20)', nullable: true },
          { name: 'Ürün Kodu', dataType: 'nvarchar(25)', nullable: true },
          { name: 'Ürün Adı', dataType: 'nvarchar(50)', nullable: true },
          { name: 'Kalan Miktar', dataType: 'float', nullable: false },
          { name: 'Seviye', dataType: 'int', nullable: true },
          { name: 'Tüketim Kod', dataType: 'nvarchar(25)', nullable: true },
          { name: 'Tüketim Ad', dataType: 'nvarchar(50)', nullable: true },
          { name: 'Birim Tüketim', dataType: 'float', nullable: true }
        ]
      },
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'AA_ISEMRI_MALZEME_DURUMLARI',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_ISEMRI_MALZEME_DURUMLARI',
        type: 'VIEW',
        health: 44,
        risk: 'critical',
        columns: [
          { name: 'İş Kodu', dataType: 'nvarchar(25)', nullable: true },
          { name: 'Kalan Miktar', dataType: 'float', nullable: false },
          { name: 'Mevcut Stok', dataType: 'float', nullable: true }
        ]
      },
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'AA_STOK_DURUMU',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_STOK_DURUMU',
        type: 'VIEW',
        health: 58,
        risk: 'high',
        columns: [
          { name: 'StokKodu', dataType: 'nvarchar(25)', nullable: false },
          { name: 'StokAdi', dataType: 'nvarchar(50)', nullable: false },
          { name: 'ToplamGiris', dataType: 'float', nullable: false },
          { name: 'ToplamCikis', dataType: 'float', nullable: false },
          { name: 'Bakiye', dataType: 'float', nullable: false }
        ]
      },
      {
        database: 'RAPOR_DB',
        schema: 'dbo',
        name: 'AA_STOK_DURUMU',
        canonicalId: 'RAPOR_DB.dbo.AA_STOK_DURUMU',
        type: 'VIEW',
        health: 70,
        risk: 'medium',
        columns: [
          { name: 'StokKodu', dataType: 'nvarchar(25)', nullable: false },
          { name: 'StokAdi', dataType: 'nvarchar(50)', nullable: false },
          { name: 'BakiyeMiktar', dataType: 'float', nullable: false }
        ]
      },
      {
        database: 'RAPOR_DB',
        schema: 'dbo',
        name: 'AA_STOK_HAREKET_OZET',
        canonicalId: 'RAPOR_DB.dbo.AA_STOK_HAREKET_OZET',
        type: 'VIEW',
        health: 49,
        risk: 'high',
        columns: [
          { name: 'sth_stok_kod', dataType: 'nvarchar(25)', nullable: false },
          { name: 'HareketSayisi', dataType: 'int', nullable: false },
          { name: 'ToplamMiktar', dataType: 'float', nullable: false }
        ]
      }
    ];

    // Synonyms
    this.synonyms = [
      {
        database: 'MikroDB_V16_LIDER25',
        schema: 'dbo',
        name: 'SYN_STOK',
        canonicalId: 'MikroDB_V16_LIDER25.dbo.SYN_STOK',
        type: 'SYNONYM',
        targetCanonicalId: 'RAPOR_DB.dbo.STOKLAR'
      }
    ];
  }

  /**
   * Load catalog from scan results and query sys.columns / sys.types metadata.
   * NOTE: Never executes views!
   */
  async loadFromScan(scanData) {
    if (!scanData || !scanData.views) return;
    this.lastUpdatedAt = new Date().toISOString();
    this.databases = scanData.selectedDatabases || this.databases;

    // 1. Process Views from Scan
    const newViews = [];
    for (const v of scanData.views) {
      newViews.push({
        database: v.database,
        schema: v.schema || 'dbo',
        name: v.name || v.view_name,
        canonicalId: v.canonicalId,
        type: 'VIEW',
        health: v.healthScore || v.health || 60,
        risk: v.riskCategory || v.risk || 'medium',
        columns: [] // will be enriched from sys.columns if live
      });
    }

    // 2. Fetch live columns from sys.columns without view execution
    const enrichedTables = [];
    const enrichedViews = [...newViews];

    for (const dbName of this.databases) {
      let pool;
      try {
        pool = db.getPool(dbName);
      } catch (_) {
        continue;
      }
      if (!pool || !pool.connected) continue;

      try {
        // Query sys.columns for both tables and views in this DB safely
        const colsRes = await pool.request().query(`
          SELECT
            '${dbName}' AS database_name,
            s.name AS schema_name,
            o.name AS object_name,
            o.type_desc AS object_type,
            c.name AS column_name,
            t.name AS data_type,
            c.column_id AS ordinal_position,
            c.is_nullable
          FROM sys.columns c
          JOIN sys.objects o ON o.object_id = c.object_id
          JOIN sys.schemas s ON s.schema_id = o.schema_id
          JOIN sys.types t ON t.user_type_id = c.user_type_id
          WHERE o.is_ms_shipped = 0
            AND o.type IN ('U', 'V')
          ORDER BY s.name, o.name, c.column_id;
        `);

        const rows = colsRes.recordset || [];
        const objColMap = new Map(); // object_name.toLowerCase() -> columns[]

        for (const row of rows) {
          const key = `${dbName}.${row.schema_name}.${row.object_name}`.toLowerCase();
          if (!objColMap.has(key)) {
            objColMap.set(key, {
              database: dbName,
              schema: row.schema_name,
              name: row.object_name,
              type: row.object_type === 'USER_TABLE' ? 'TABLE' : 'VIEW',
              columns: []
            });
          }
          objColMap.get(key).columns.push({
            name: row.column_name,
            dataType: row.data_type,
            ordinal: row.ordinal_position,
            nullable: Boolean(row.is_nullable)
          });
        }

        // Merge discovered tables & view columns
        for (const obj of objColMap.values()) {
          const canonical = `${obj.database}.${obj.schema}.${obj.name}`;
          if (obj.type === 'TABLE') {
            enrichedTables.push({
              database: obj.database,
              schema: obj.schema,
              name: obj.name,
              canonicalId: canonical,
              type: 'TABLE',
              columns: obj.columns
            });
          } else {
            const vIndex = enrichedViews.findIndex(ev => ev.canonicalId.toLowerCase() === canonical.toLowerCase());
            if (vIndex >= 0) {
              enrichedViews[vIndex].columns = obj.columns;
            }
          }
        }
      } catch (err) {
        console.warn(`[MetadataCatalog] Could not load sys.columns for ${dbName}:`, err.message);
      }
    }

    if (enrichedViews.length > 0) this.views = enrichedViews;
    if (enrichedTables.length > 0) this.tables = enrichedTables;
  }

  /**
   * Get metadata catalog formatted for frontend IntelliSense.
   * Prioritizes activeDatabase objects.
   */
  getCatalog(activeDatabase = null) {
    const activeDb = (activeDatabase || this.databases[0] || '').toLowerCase();

    // Sorter function: active DB items come first
    const sortByActiveDb = (a, b) => {
      const aIsActive = (a.database || '').toLowerCase() === activeDb;
      const bIsActive = (b.database || '').toLowerCase() === activeDb;
      if (aIsActive && !bIsActive) return -1;
      if (!aIsActive && bIsActive) return 1;
      return (a.name || '').localeCompare(b.name || '');
    };

    return {
      lastUpdatedAt: this.lastUpdatedAt,
      activeDatabase: activeDatabase || this.databases[0],
      databases: this.databases,
      schemas: this.schemas,
      tables: [...this.tables].sort(sortByActiveDb),
      views: [...this.views].sort(sortByActiveDb),
      synonyms: this.synonyms,
      keywords: this.keywords,
      functions: this.functions,
      snippets: this.snippets
    };
  }
}

const catalogInstance = new MetadataCatalog();

module.exports = catalogInstance;
