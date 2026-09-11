/**
 * SQL Server Refactoring & Performance Studio
 * Live Activity & Blocking / Wait Monitor (Sprint 5)
 *
 * Implements:
 * - sys.dm_exec_requests + sys.dm_exec_sessions active query tracking
 * - Hierarchical Blocking Tree: HEAD_BLOCKER, BLOCKED_SESSION, BLOCKING_CHAIN
 * - Cycle detection and severity grading (INFO, WARNING, CRITICAL)
 * - Wait type categorization: LOCKING, IO, CPU_SCHEDULER, PARALLELISM, MEMORY, NETWORK, LOG, TEMPDB, OTHER
 * - Plain Turkish explanations with tentative wording ("olabilir")
 * - sys.dm_os_wait_stats cumulative wait analysis with server restart disclaimer
 * - Permission resilience (VIEW SERVER STATE / VIEW SERVER PERFORMANCE STATE)
 * - STRICT READ-ONLY GUARDRAIL: No KILL SESSION capability whatsoever
 */

const db = require('./sqlServer');

const WAITS_DISCLAIMER = 'Bu veriler SQL Server servisi son yeniden başlatıldığından beri biriken (kümülatif) sayaçlardır.';

// Harmless system/idle wait types to exclude from wait analysis
const IGNORED_SYSTEM_WAITS = new Set([
  'BROKER_EVENTHANDLER',
  'BROKER_RECEIVE_WAITFOR',
  'BROKER_TASK_STOP',
  'BROKER_TO_FLUSH',
  'BROKER_TRANSMITTER',
  'CHECKPOINT_QUEUE',
  'CHKPT',
  'CLR_AUTO_EVENT',
  'CLR_MANUAL_EVENT',
  'CLR_SEMAPHORE',
  'CXCONSUMER',
  'DIRTY_PAGE_POLL',
  'DISPATCHER_QUEUE_SEMAPHORE',
  'EXECSYNC',
  'FSAGENT',
  'FT_IFTS_SCHEDULER_IDLE_WAIT',
  'FT_IFTSHC_MUTEX',
  'HADR_CLUSAPI_CALL',
  'HADR_FILESTREAM_IOMSG',
  'HADR_LOGCAPTURE_WAIT',
  'HADR_NOTIFICATION_DEQUEUE',
  'HADR_TIMER_TASK',
  'HADR_WORK_QUEUE',
  'KSOURCE_WAKEUP',
  'LAZYWRITER_SLEEP',
  'LOGMGR_QUEUE',
  'MEMORY_ALLOCATION_EXT',
  'ONDEMAND_TASK_QUEUE',
  'PARALLEL_REDO_DRAIN_WORKER',
  'PARALLEL_REDO_LOG_CACHE',
  'PARALLEL_REDO_TRAN_LIST',
  'PARALLEL_REDO_WORKER_SYNC',
  'PARALLEL_REDO_WORKER_WAIT_WORK',
  'PREEMPTIVE_HADR_LEASE_MECHANISM',
  'PREEMPTIVE_OS_AUTHENTICATIONOPS',
  'PREEMPTIVE_OS_AUTHORIZATIONOPS',
  'PREEMPTIVE_OS_COMOPS',
  'PREEMPTIVE_OS_CREATEFILE',
  'PREEMPTIVE_OS_CRYPTOPS',
  'PREEMPTIVE_OS_DEVICEOPS',
  'PREEMPTIVE_OS_FILEOPS',
  'PREEMPTIVE_OS_GENERICOPS',
  'PREEMPTIVE_OS_LIBRARYOPS',
  'PREEMPTIVE_OS_LOOKUPACCOUNTSID',
  'PREEMPTIVE_OS_PIPEOPS',
  'PREEMPTIVE_OS_QUERYREGISTRY',
  'PREEMPTIVE_OS_REPORTEVENT',
  'PREEMPTIVE_OS_SECURITYOPS',
  'PREEMPTIVE_OS_SERVICEOPS',
  'PREEMPTIVE_OS_SQMCHECK',
  'PREEMPTIVE_OS_WAITFORSINGLEOBJECT',
  'PREEMPTIVE_OS_WRITEFILEGATHER',
  'PREEMPTIVE_XE_CALLBACKEXECUTE',
  'PREEMPTIVE_XE_DISPATCHER',
  'PREEMPTIVE_XE_GETTARGETSTATE',
  'PREEMPTIVE_XE_SESSIONCOMMIT',
  'PREEMPTIVE_XE_TARGETINIT',
  'PWAIT_ALL_COMPONENTS_INITIALIZED',
  'PWAIT_EXTENSIBILITY_CLEANUP_TASK',
  'QDS_ASYNC_QUEUE',
  'QDS_CLEANUP_STALE_QUERIES_TASK_MAIN_LOOP_SLEEP',
  'QDS_PERSIST_TASK_MAIN_LOOP_SLEEP',
  'QDS_SHUTDOWN_QUEUE',
  'REDO_THREAD_PENDING_WORK',
  'REQUEST_FOR_DEADLOCK_SEARCH',
  'RESOURCE_QUEUE',
  'SERVER_IDLE_CHECK',
  'SLEEP_BPOOL_FLUSH',
  'SLEEP_DBSTARTUP',
  'SLEEP_DCOMSTARTUP',
  'SLEEP_MASTERDBREADY',
  'SLEEP_MASTERMDREADY',
  'SLEEP_MASTERUPGRADED',
  'SLEEP_MSDBSTARTUP',
  'SLEEP_SYSTEMTASK',
  'SLEEP_TASK',
  'SLEEP_TEMPDBSTARTUP',
  'SNI_HTTP_ACCEPT',
  'SOS_WORK_DISPATCHER',
  'SP_SERVER_DIAGNOSTICS_SLEEP',
  'SQLTRACE_BUFFER_FLUSH',
  'SQLTRACE_INCREMENTAL_FLUSH_SLEEP',
  'SQLTRACE_WAIT_ENTRIES',
  'STARTUP_DEPENDENCY_MANAGER',
  'WAIT_FOR_RESULTS',
  'WAITFOR',
  'WAITFOR_TASKSHUTDOWN',
  'WAIT_XTP_HOST_WAIT',
  'WAIT_XTP_OFFLINE_CKPT_NEW_LOG',
  'WAIT_XTP_CKPT_CLOSE',
  'XE_DISPATCHER_JOIN',
  'XE_DISPATCHER_WAIT',
  'XE_LIVE_TARGET_TVF',
  'XE_TIMER_EVENT'
]);

/**
 * Checks if a wait_resource string belongs to database_id 2 (tempdb)
 * Formats: "2:file_id:page_id", "2:1:1", "PAGE: 2:1:1", "(2:1:3)"
 */
function isTempDbResource(waitResource) {
  if (!waitResource || typeof waitResource !== 'string') return false;
  const trimmed = waitResource.trim();
  return /^(?:PAGE:\s*|\()?\s*2\s*:\s*\d+\s*:\s*\d+/i.test(trimmed);
}

/**
 * Categorizes SQL Server wait types into functional groups with tentative Turkish explanations
 */
function categorizeWaitType(waitType, waitResource = null) {
  if (!waitType || typeof waitType !== 'string') {
    return {
      category: 'OTHER',
      categoryNameTr: 'Diğer / Boş',
      explanationTr: 'Belirlenmiş bir bekleme tipi bulunmuyor.',
      severity: 'INFO'
    };
  }

  const wt = waitType.toUpperCase().trim();

  // 1. Locking Waits (LCK_M_*)
  if (wt.startsWith('LCK_M_')) {
    return {
      category: 'LOCKING',
      categoryNameTr: 'Kilit Çekişmesi (Locking)',
      explanationTr: 'Satır, sayfa veya tablo kilit beklemesi. Uzun süren transactionlar veya eksik indeksler kaynaklı olabilir.',
      severity: 'HIGH'
    };
  }

  // 2. Disk I/O Waits
  if (wt.startsWith('PAGEIOLATCH_') || wt === 'ASYNC_IO_COMPLETION' || wt === 'IO_COMPLETION') {
    return {
      category: 'IO',
      categoryNameTr: 'Disk Okuma / Yazma (I/O)',
      explanationTr: 'Veri sayfalarının diskten belleğe okunması bekleniyor. Buffer Pool yetersizliği veya yüksek table scan kaynaklı olabilir.',
      severity: 'HIGH'
    };
  }

  // 3. CPU / Scheduler Waits
  if (wt === 'SOS_SCHEDULER_YIELD' || wt === 'THREADPOOL') {
    return {
      category: 'CPU_SCHEDULER',
      categoryNameTr: 'İşlemci / CPU Kuyruğu',
      explanationTr: 'Sorgu CPU çekirdeğinde çalışmak için sıra bekliyor. Yoğun CPU tüketen sorgular veya worker thread yetersizliği olabilir.',
      severity: wt === 'THREADPOOL' ? 'CRITICAL' : 'WARNING'
    };
  }

  // 4. Parallelism Coordination
  if (wt === 'CXPACKET' || wt === 'CXCONSUMER') {
    return {
      category: 'PARALLELISM',
      categoryNameTr: 'Paralelizm Koordinasyonu',
      explanationTr: 'Paralel çalışan threadler arasındaki senkronizasyon beklemesi. MAXDOP ayarı veya dengesiz veri dağılımı ile ilişkili olabilir.',
      severity: 'MEDIUM'
    };
  }

  // 5. Memory Grants
  if (wt.startsWith('RESOURCE_SEMAPHORE') || wt === 'CMEMTHREAD') {
    return {
      category: 'MEMORY',
      categoryNameTr: 'Bellek Tahsisi (Memory Grant)',
      explanationTr: 'Sorgu yürütülmek için çalışma belleği (Sort/Hash Grant) bekliyor. Büyük sorting veya join işlemleri kaynaklı olabilir.',
      severity: 'CRITICAL'
    };
  }

  // 6. Network IO
  if (wt === 'ASYNC_NETWORK_IO') {
    return {
      category: 'NETWORK',
      categoryNameTr: 'İstemci Ağ İletişimi',
      explanationTr: 'SQL Server veriyi hazırladı ancak istemci uygulama sonuçları yavaş tüketiyor (Fetch gecikmesi) olabilir.',
      severity: 'WARNING'
    };
  }

  // 7. Transaction Log
  if (wt === 'WRITELOG' || wt === 'LOGBUFFER') {
    return {
      category: 'LOG',
      categoryNameTr: 'Transaction Log Yazımı',
      explanationTr: 'Log kayıtlarının diske kalıcı olarak yazılması bekleniyor. Yavaş log diski veya sık tekil COMMIT işlemleri olabilir.',
      severity: 'HIGH'
    };
  }

  // 8. In-Memory Page Latch (PAGELATCH_*)
  if (wt.startsWith('PAGELATCH_')) {
    const isTempDb = isTempDbResource(waitResource);
    if (isTempDb) {
      return {
        category: 'TEMPDB',
        categoryNameTr: 'TempDB Tahsis Çekişmesi (PAGELATCH)',
        explanationTr: 'TempDB sistem sayfalarında (PFS/GAM/SGAM tahsis sayfaları, Veritabanı ID: 2) çekişme yaşanıyor olabilir. Eşzamanlı geçici tablo veya tablo değişkeni yükü incelenmelidir.',
        severity: 'HIGH'
      };
    }

    return {
      category: 'PAGE_LATCH',
      categoryNameTr: 'Bellek Sayfası Çekişmesi (PAGE_LATCH)',
      explanationTr: 'Bellek içi veri veya indeks sayfası çekişmesi (In-memory page latch). Sıcak sayfa (hot page), artan anahtarlı (identity/sequence) tablolarda yoğun eşzamanlı INSERT veya concurrency darboğazı olabilir.',
      severity: 'HIGH'
    };
  }

  // 9. Non-Page Latches (LATCH_*)
  if (wt.startsWith('LATCH_')) {
    return {
      category: 'LATCH',
      categoryNameTr: 'İç Sistem Mandalı (Non-Page Latch)',
      explanationTr: 'SQL Server dahili bellek veri yapıları senkronizasyon beklemesi (non-page latch) olabilir.',
      severity: 'MEDIUM'
    };
  }

  return {
    category: 'OTHER',
    categoryNameTr: 'Diğer Sistem Beklemesi',
    explanationTr: 'Çeşitli iç sistem olayları veya arka plan senkronizasyonu olabilir.',
    severity: 'INFO'
  };
}

/**
 * Checks for missing permission error and produces safe guidance (SQL Server 2022+ aware)
 */
function checkPermissionError(err) {
  const msg = err?.message || '';
  if (
    err?.number === 297 ||
    err?.number === 300 ||
    msg.includes('VIEW SERVER STATE') ||
    msg.includes('VIEW SERVER PERFORMANCE STATE')
  ) {
    const rawUser = db.status().user || 'kullanici';
    const cleanUser = String(rawUser).replace(/\]/g, ']]');
    return {
      isPermissionError: true,
      capability: 'LIVE_ACTIVITY',
      available: false,
      requiredPermissions: ['VIEW SERVER PERFORMANCE STATE', 'VIEW SERVER STATE'],
      requiredPermission: 'VIEW SERVER PERFORMANCE STATE',
      message: 'Canlı aktivite ve wait DMV\'lerini okumak için VIEW SERVER PERFORMANCE STATE veya VIEW SERVER STATE izni gereklidir.',
      grantScript: `-- SQL Server 2022+ için (önerilen en az yetki ilkesi):\nGRANT VIEW SERVER PERFORMANCE STATE TO [${cleanUser}];\n-- veya SQL Server 2019 ve öncesi için:\nGRANT VIEW SERVER STATE TO [${cleanUser}];`
    };
  }
  return { isPermissionError: false };
}

/**
 * Retrieves currently executing requests and sessions
 */
async function getActiveRequests(database = null) {
  const status = db.status();
  const targetDb = database || status.primaryDatabase;
  const pool = db.getPool(targetDb);

  if (!pool) {
    return {
      ok: false,
      error: 'SQL Server bağlantısı aktif değil.',
      requests: []
    };
  }

  try {
    const query = `
      SELECT 
        r.session_id,
        r.request_id,
        r.status AS request_status,
        r.command,
        r.blocking_session_id,
        r.wait_type,
        r.wait_time,
        r.last_wait_type,
        r.wait_resource,
        r.cpu_time,
        r.total_elapsed_time,
        r.reads,
        r.writes,
        r.logical_reads,
        r.row_count,
        r.granted_query_memory * 8 AS granted_memory_kb,
        s.login_name,
        s.host_name,
        s.program_name,
        s.status AS session_status,
        DB_NAME(r.database_id) AS database_name,
        SUBSTRING(t.text, (r.statement_start_offset/2) + 1,
          ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
            ELSE r.statement_end_offset END - r.statement_start_offset)/2) + 1) AS sql_text,
        t.text AS full_sql_text
      FROM sys.dm_exec_requests r
      JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE s.is_user_process = 1
        AND r.session_id <> @@SPID
      ORDER BY r.cpu_time DESC, r.total_elapsed_time DESC;
    `;

    const res = await pool.request().query(query);
    const rows = res.recordset || [];

    const requests = rows.map(r => {
      const waitCat = categorizeWaitType(r.wait_type, r.wait_resource);
      const rawSql = (r.sql_text || r.full_sql_text || '').trim();
      const safeSqlText = rawSql.length > 2000 ? `${rawSql.substring(0, 2000)}... [Kısaltıldı / Truncated]` : rawSql;

      return {
        sessionId: r.session_id,
        requestId: r.request_id,
        requestStatus: r.request_status,
        sessionStatus: r.session_status,
        command: r.command,
        blockingSessionId: r.blocking_session_id || 0,
        isBlocked: Boolean(r.blocking_session_id && r.blocking_session_id > 0),
        waitType: r.wait_type || '—',
        waitTimeMs: r.wait_time || 0,
        waitCategory: waitCat.category,
        waitCategoryName: waitCat.categoryNameTr,
        waitExplanation: waitCat.explanationTr,
        waitSeverity: waitCat.severity,
        waitResource: r.wait_resource || '—',
        cpuTimeMs: r.cpu_time || 0,
        totalElapsedTimeMs: r.total_elapsed_time || 0,
        reads: r.reads || 0,
        writes: r.writes || 0,
        logicalReads: r.logical_reads || 0,
        rowCount: r.row_count || 0,
        grantedMemoryKb: r.granted_memory_kb || 0,
        loginName: r.login_name || '—',
        hostName: r.host_name || '—',
        programName: r.program_name || '—',
        databaseName: r.database_name || targetDb,
        sqlText: safeSqlText
      };
    });

    return {
      ok: true,
      count: requests.length,
      requests
    };
  } catch (err) {
    const perm = checkPermissionError(err);
    if (perm.isPermissionError) {
      return {
        ok: false,
        permissionMissing: true,
        capability: perm.capability,
        available: perm.available,
        requiredPermissions: perm.requiredPermissions,
        requiredPermission: perm.requiredPermission,
        error: perm.message,
        grantScript: perm.grantScript,
        requests: []
      };
    }
    return {
      ok: false,
      error: db.sanitizeError(err).message,
      requests: []
    };
  }
}

/**
 * Builds hierarchical Blocking Tree with cycle protection and root blocker discovery
 */
async function getBlockingTree(database = null) {
  const status = db.status();
  const targetDb = database || status.primaryDatabase;
  const pool = db.getPool(targetDb);

  if (!pool) {
    return {
      ok: false,
      error: 'SQL Server bağlantısı aktif değil.',
      rootBlockers: [],
      totalBlockedCount: 0
    };
  }

  try {
    // 1. Query blocked requests
    const blockedQuery = `
      SELECT 
        r.session_id,
        r.blocking_session_id,
        r.wait_type,
        r.wait_time,
        r.wait_resource,
        r.status AS request_status,
        r.command,
        r.cpu_time,
        r.total_elapsed_time,
        s.login_name,
        s.host_name,
        s.program_name,
        DB_NAME(r.database_id) AS database_name,
        SUBSTRING(t.text, (r.statement_start_offset/2) + 1,
          ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
            ELSE r.statement_end_offset END - r.statement_start_offset)/2) + 1) AS sql_text,
        t.text AS full_sql_text
      FROM sys.dm_exec_requests r
      JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
      WHERE s.is_user_process = 1
        AND r.blocking_session_id > 0
        AND r.session_id <> @@SPID;
    `;

    const blockedRes = await pool.request().query(blockedQuery);
    const blockedRows = blockedRes.recordset || [];

    if (blockedRows.length === 0) {
      return {
        ok: true,
        database: targetDb,
        rootBlockers: [],
        totalBlockedCount: 0,
        maxWaitTimeMs: 0,
        hasCriticalBlocks: false,
        message: 'Şu anda aktif hiçbir blocking (kilit beklemesi) bulunmuyor.'
      };
    }

    // Collect all unique blocker session IDs
    const allBlockerIds = [...new Set(blockedRows.map(r => r.blocking_session_id))];
    const blockedSessionIds = new Set(blockedRows.map(r => r.session_id));

    // Head blockers are blockers that are NOT themselves in the blockedSessionIds list
    const headBlockerIds = allBlockerIds.filter(id => !blockedSessionIds.has(id));

    // 2. Query info for all head blocker sessions (they might be sleeping in open transactions)
    let headBlockerInfoMap = new Map();
    if (headBlockerIds.length > 0) {
      const idList = headBlockerIds.map((_, i) => `@id${i}`).join(', ');
      const headQuery = `
        SELECT 
          s.session_id,
          s.status AS session_status,
          s.login_name,
          s.host_name,
          s.program_name,
          s.open_transaction_count,
          r.command,
          r.status AS request_status,
          r.wait_type,
          r.wait_time,
          DB_NAME(r.database_id) AS database_name,
          COALESCE(
            SUBSTRING(t.text, (r.statement_start_offset/2) + 1,
              ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
                ELSE r.statement_end_offset END - r.statement_start_offset)/2) + 1),
            c_txt.text
          ) AS sql_text
        FROM sys.dm_exec_sessions s
        LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
        OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
        LEFT JOIN sys.dm_exec_connections c ON s.session_id = c.session_id
        OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) c_txt
        WHERE s.session_id IN (${idList});
      `;

      const headReq = pool.request();
      headBlockerIds.forEach((id, i) => headReq.input(`id${i}`, id));
      const headRes = await headReq.query(headQuery);
      for (const h of headRes.recordset || []) {
        headBlockerInfoMap.set(h.session_id, h);
      }
    }

    // 3. Build tree recursively with cycle detection
    let maxWaitTimeMs = 0;
    let hasCriticalBlocks = false;

    function buildBranch(spid, visited = new Set()) {
      if (visited.has(spid)) {
        return { isCycle: true, spid, note: 'Circular blocking loop detected' };
      }
      visited.add(spid);

      const directChildren = blockedRows.filter(r => r.blocking_session_id === spid);

      return directChildren.map(child => {
        const waitMs = child.wait_time || 0;
        if (waitMs > maxWaitTimeMs) maxWaitTimeMs = waitMs;
        let severity = 'INFO';
        if (waitMs >= 30000) {
          severity = 'CRITICAL';
          hasCriticalBlocks = true;
        } else if (waitMs >= 5000) {
          severity = 'WARNING';
        }

        const waitCat = categorizeWaitType(child.wait_type, child.wait_resource);
        const rawChildSql = (child.sql_text || child.full_sql_text || '').trim();
        const childSafeSql = rawChildSql.length > 2000 ? `${rawChildSql.substring(0, 2000)}... [Kısaltıldı / Truncated]` : rawChildSql;

        const node = {
          sessionId: child.session_id,
          role: 'BLOCKED_SESSION',
          blockedBy: spid,
          waitTimeMs: waitMs,
          severity,
          waitType: child.wait_type || 'LCK_M_*',
          waitCategory: waitCat.category,
          waitCategoryName: waitCat.categoryNameTr,
          waitExplanation: waitCat.explanationTr,
          waitResource: child.wait_resource || '—',
          loginName: child.login_name || '—',
          hostName: child.host_name || '—',
          programName: child.program_name || '—',
          command: child.command || '—',
          sqlText: childSafeSql,
          blockedSessions: buildBranch(child.session_id, new Set(visited))
        };
        return node;
      });
    }

    // Construct root blockers
    const rootBlockers = (headBlockerIds.length > 0 ? headBlockerIds : allBlockerIds).map(spid => {
      const info = headBlockerInfoMap.get(spid) || {};
      const openTrans = info.open_transaction_count || 0;
      const statusText = info.session_status === 'sleeping' && openTrans > 0
        ? `Açık Transaction Bekliyor (${openTrans} açık tran)`
        : (info.request_status || info.session_status || 'Aktif');

      const rawHeadSql = (info.sql_text || '—').trim();
      const headSafeSql = rawHeadSql.length > 2000 ? `${rawHeadSql.substring(0, 2000)}... [Kısaltıldı / Truncated]` : rawHeadSql;

      const children = buildBranch(spid, new Set());

      return {
        sessionId: spid,
        role: 'HEAD_BLOCKER',
        loginName: info.login_name || '—',
        hostName: info.host_name || '—',
        programName: info.program_name || '—',
        status: statusText,
        openTransactions: openTrans,
        sqlText: headSafeSql,
        directBlockedCount: children.length,
        blockedSessions: children
      };
    });

    return {
      ok: true,
      database: targetDb,
      rootBlockers,
      totalBlockedCount: blockedRows.length,
      maxWaitTimeMs,
      hasCriticalBlocks
    };
  } catch (err) {
    const perm = checkPermissionError(err);
    if (perm.isPermissionError) {
      return {
        ok: false,
        permissionMissing: true,
        capability: perm.capability,
        available: perm.available,
        requiredPermissions: perm.requiredPermissions,
        requiredPermission: perm.requiredPermission,
        error: perm.message,
        grantScript: perm.grantScript,
        rootBlockers: [],
        totalBlockedCount: 0
      };
    }
    return {
      ok: false,
      error: db.sanitizeError(err).message,
      rootBlockers: [],
      totalBlockedCount: 0
    };
  }
}

/**
 * Retrieves cumulative wait statistics from sys.dm_os_wait_stats
 */
async function getCumulativeWaits(topN = 25) {
  const pool = db.getPool();

  if (!pool) {
    return {
      ok: false,
      error: 'SQL Server bağlantısı aktif değil.',
      disclaimer: WAITS_DISCLAIMER,
      waits: []
    };
  }

  try {
    const query = `
      SELECT TOP (@topLimit)
        wait_type,
        waiting_tasks_count,
        wait_time_ms,
        max_wait_time_ms,
        signal_wait_time_ms,
        wait_time_ms - signal_wait_time_ms AS resource_wait_time_ms
      FROM sys.dm_os_wait_stats
      WHERE wait_time_ms > 0
      ORDER BY wait_time_ms DESC;
    `;

    const request = pool.request();
    request.input('topLimit', Number(topN) * 3 || 75); // Request more so we can filter system waits

    const res = await request.query(query);
    const rows = res.recordset || [];

    // Filter out benign background/system waits
    const significantWaits = rows.filter(r => !IGNORED_SYSTEM_WAITS.has(r.wait_type.toUpperCase().trim()));

    // Total wait time across significant waits for percentage
    const totalWaitTime = significantWaits.reduce((acc, r) => acc + Number(r.wait_time_ms || 0), 0);

    const waits = significantWaits.slice(0, topN).map(r => {
      const waitTime = Number(r.wait_time_ms || 0);
      const signalTime = Number(r.signal_wait_time_ms || 0);
      const resourceTime = Number(r.resource_wait_time_ms || 0);
      const percentOfTotal = totalWaitTime > 0 ? Math.round((waitTime / totalWaitTime) * 1000) / 10 : 0;

      const catInfo = categorizeWaitType(r.wait_type, null);

      return {
        waitType: r.wait_type,
        waitingTasksCount: Number(r.waiting_tasks_count || 0),
        waitTimeMs: waitTime,
        maxWaitTimeMs: Number(r.max_wait_time_ms || 0),
        signalWaitTimeMs: signalTime,
        resourceWaitTimeMs: resourceTime,
        percentOfTotal,
        category: catInfo.category,
        categoryName: catInfo.categoryNameTr,
        explanation: catInfo.explanationTr,
        severity: catInfo.severity
      };
    });

    // Grouping by category
    const categoryTotals = {};
    for (const w of waits) {
      if (!categoryTotals[w.category]) {
        categoryTotals[w.category] = {
          category: w.category,
          categoryName: w.categoryName,
          totalWaitTimeMs: 0,
          tasksCount: 0
        };
      }
      categoryTotals[w.category].totalWaitTimeMs += w.waitTimeMs;
      categoryTotals[w.category].tasksCount += w.waitingTasksCount;
    }

    return {
      ok: true,
      waitTypeNature: 'CUMULATIVE_SERVER_STATS',
      disclaimer: WAITS_DISCLAIMER,
      noticeTr: 'Bu sayaçlar SQL Server servisi son başlatıldığından (veya DBCC SQLPERF ile sıfırlandığından) beri toplam değerlerdir. Anlık bekleme durumu için Aktif İstekler sekmesindeki bekleme olaylarını inceleyiniz.',
      totalWaitTimeMs: totalWaitTime,
      count: waits.length,
      waits,
      categories: Object.values(categoryTotals).sort((a, b) => b.totalWaitTimeMs - a.totalWaitTimeMs)
    };
  } catch (err) {
    const perm = checkPermissionError(err);
    if (perm.isPermissionError) {
      return {
        ok: false,
        permissionMissing: true,
        capability: perm.capability,
        available: perm.available,
        requiredPermissions: perm.requiredPermissions,
        requiredPermission: perm.requiredPermission,
        error: perm.message,
        grantScript: perm.grantScript,
        disclaimer: WAITS_DISCLAIMER,
        waits: []
      };
    }
    return {
      ok: false,
      error: db.sanitizeError(err).message,
      disclaimer: WAITS_DISCLAIMER,
      waits: []
    };
  }
}

module.exports = {
  getActiveRequests,
  getBlockingTree,
  getCumulativeWaits,
  categorizeWaitType,
  isTempDbResource,
  WAITS_DISCLAIMER
};
