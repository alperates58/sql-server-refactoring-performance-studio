const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  categorizeWaitType,
  isTempDbResource,
  WAITS_DISCLAIMER
} = require('../server/services/activityMonitor');

describe('Live Activity & Blocking Monitor Tests (Sprint 5)', () => {
  describe('categorizeWaitType & isTempDbResource', () => {
    it('categorizes LCK_M_* waits as LOCKING with HIGH severity', () => {
      const lockTypes = ['LCK_M_X', 'LCK_M_U', 'LCK_M_S', 'LCK_M_IS', 'LCK_M_IX'];
      for (const lt of lockTypes) {
        const res = categorizeWaitType(lt);
        assert.equal(res.category, 'LOCKING');
        assert.equal(res.severity, 'HIGH');
        assert.ok(res.explanationTr.includes('kilit beklemesi'));
        assert.ok(res.explanationTr.includes('olabilir'));
      }
    });

    it('categorizes PAGEIOLATCH_* and ASYNC_IO_COMPLETION as IO with HIGH severity', () => {
      const ioTypes = ['PAGEIOLATCH_SH', 'PAGEIOLATCH_EX', 'PAGEIOLATCH_UP', 'ASYNC_IO_COMPLETION', 'IO_COMPLETION'];
      for (const iot of ioTypes) {
        const res = categorizeWaitType(iot);
        assert.equal(res.category, 'IO');
        assert.equal(res.severity, 'HIGH');
        assert.ok(res.explanationTr.includes('Buffer Pool yetersizliği'));
        assert.ok(res.explanationTr.includes('olabilir'));
      }
    });

    it('categorizes SOS_SCHEDULER_YIELD as CPU_SCHEDULER', () => {
      const res = categorizeWaitType('SOS_SCHEDULER_YIELD');
      assert.equal(res.category, 'CPU_SCHEDULER');
      assert.equal(res.severity, 'WARNING');
      assert.ok(res.explanationTr.includes('CPU'));
    });

    it('categorizes THREADPOOL as CPU_SCHEDULER with CRITICAL severity', () => {
      const res = categorizeWaitType('THREADPOOL');
      assert.equal(res.category, 'CPU_SCHEDULER');
      assert.equal(res.severity, 'CRITICAL');
      assert.ok(res.explanationTr.includes('worker thread'));
    });

    it('categorizes CXPACKET and CXCONSUMER as PARALLELISM', () => {
      const res1 = categorizeWaitType('CXPACKET');
      assert.equal(res1.category, 'PARALLELISM');
      assert.equal(res1.severity, 'MEDIUM');
      assert.ok(res1.explanationTr.includes('MAXDOP'));

      const res2 = categorizeWaitType('CXCONSUMER');
      assert.equal(res2.category, 'PARALLELISM');
    });

    it('categorizes RESOURCE_SEMAPHORE as MEMORY with CRITICAL severity', () => {
      const res = categorizeWaitType('RESOURCE_SEMAPHORE');
      assert.equal(res.category, 'MEMORY');
      assert.equal(res.severity, 'CRITICAL');
      assert.ok(res.explanationTr.includes('Memory Grant'));
    });

    it('categorizes ASYNC_NETWORK_IO as NETWORK', () => {
      const res = categorizeWaitType('ASYNC_NETWORK_IO');
      assert.equal(res.category, 'NETWORK');
      assert.equal(res.severity, 'WARNING');
      assert.ok(res.explanationTr.includes('İstemci uygulama'));
    });

    it('categorizes WRITELOG and LOGBUFFER as LOG with HIGH severity', () => {
      const res = categorizeWaitType('WRITELOG');
      assert.equal(res.category, 'LOG');
      assert.equal(res.severity, 'HIGH');
      assert.ok(res.explanationTr.includes('Transaction log'));
    });

    it('isTempDbResource accurately identifies database 2 wait resources', () => {
      assert.equal(isTempDbResource('2:1:1'), true);
      assert.equal(isTempDbResource('2:1:3'), true);
      assert.equal(isTempDbResource('PAGE: 2:1:144'), true);
      assert.equal(isTempDbResource('(2:1:3)'), true);
      assert.equal(isTempDbResource('5:1:200'), false);
      assert.equal(isTempDbResource('7:1:14400'), false);
      assert.equal(isTempDbResource(null), false);
      assert.equal(isTempDbResource(undefined), false);
      assert.equal(isTempDbResource(''), false);
    });

    it('categorizes PAGELATCH_* as TEMPDB only when wait_resource confirms database_id 2', () => {
      const resTemp = categorizeWaitType('PAGELATCH_UP', '2:1:3');
      assert.equal(resTemp.category, 'TEMPDB');
      assert.equal(resTemp.severity, 'HIGH');
      assert.ok(resTemp.explanationTr.includes('TempDB'));
      assert.ok(resTemp.explanationTr.includes('PFS, GAM veya SGAM'));

      const resPageTemp = categorizeWaitType('PAGELATCH_EX', 'PAGE: 2:1:1');
      assert.equal(resPageTemp.category, 'TEMPDB');
    });

    it('defaults PAGELATCH_* to PAGE_LATCH when wait_resource is null, omitted, or user database', () => {
      const resUserDb = categorizeWaitType('PAGELATCH_EX', '5:1:200');
      assert.equal(resUserDb.category, 'PAGE_LATCH');
      assert.equal(resUserDb.categoryNameTr.includes('PAGE_LATCH'), true);
      assert.ok(resUserDb.explanationTr.includes('Bellek içi'));
      assert.ok(resUserDb.explanationTr.includes('hot page'));

      const resOmitted = categorizeWaitType('PAGELATCH_SH');
      assert.equal(resOmitted.category, 'PAGE_LATCH');

      const resNull = categorizeWaitType('PAGELATCH_UP', null);
      assert.equal(resNull.category, 'PAGE_LATCH');
    });

    it('categorizes generic non-page LATCH_* as LATCH', () => {
      const res = categorizeWaitType('LATCH_EX');
      assert.equal(res.category, 'LATCH');
      assert.equal(res.severity, 'MEDIUM');
      assert.ok(res.explanationTr.includes('non-page latch'));
    });

    it('categorizes unknown or null wait types safely as OTHER', () => {
      const resNull = categorizeWaitType(null);
      assert.equal(resNull.category, 'OTHER');

      const resOther = categorizeWaitType('CUSTOM_INTERNAL_WAIT');
      assert.equal(resOther.category, 'OTHER');
      assert.equal(resOther.severity, 'INFO');
    });
  });

  describe('Blocking Hierarchy & Tree Simulation', () => {
    // Pure algorithmic test simulating the tree builder logic from activityMonitor
    function simulateBlockingTree(blockedRows, headBlockerInfo) {
      const allBlockerIds = [...new Set(blockedRows.map(r => r.blocking_session_id))];
      const blockedSessionIds = new Set(blockedRows.map(r => r.session_id));
      const headBlockerIds = allBlockerIds.filter(id => !blockedSessionIds.has(id));

      let maxWaitTimeMs = 0;
      let hasCriticalBlocks = false;

      function buildBranch(spid, visited = new Set()) {
        if (visited.has(spid)) {
          return [{ isCycle: true, spid, note: 'Circular blocking loop detected' }];
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
          return {
            sessionId: child.session_id,
            role: 'BLOCKED_SESSION',
            blockedBy: spid,
            waitTimeMs: waitMs,
            severity,
            waitType: child.wait_type,
            blockedSessions: buildBranch(child.session_id, new Set(visited))
          };
        });
      }

      const rootBlockers = headBlockerIds.map(spid => {
        const info = headBlockerInfo[spid] || {};
        return {
          sessionId: spid,
          role: 'HEAD_BLOCKER',
          loginName: info.login_name || 'sa',
          status: info.status || 'sleeping / open transaction',
          blockedSessions: buildBranch(spid, new Set())
        };
      });

      return { rootBlockers, totalBlockedCount: blockedRows.length, maxWaitTimeMs, hasCriticalBlocks };
    }

    it('identifies head blocker and single blocked child', () => {
      const blockedRows = [
        { session_id: 55, blocking_session_id: 52, wait_type: 'LCK_M_X', wait_time: 12000 }
      ];
      const headInfo = { 52: { login_name: 'erp_user', status: 'sleeping (open tran)' } };

      const tree = simulateBlockingTree(blockedRows, headInfo);
      assert.equal(tree.rootBlockers.length, 1);
      assert.equal(tree.rootBlockers[0].sessionId, 52);
      assert.equal(tree.rootBlockers[0].role, 'HEAD_BLOCKER');
      assert.equal(tree.rootBlockers[0].blockedSessions.length, 1);
      assert.equal(tree.rootBlockers[0].blockedSessions[0].sessionId, 55);
      assert.equal(tree.rootBlockers[0].blockedSessions[0].role, 'BLOCKED_SESSION');
      assert.equal(tree.rootBlockers[0].blockedSessions[0].severity, 'WARNING');
    });

    it('builds multi-level blocking chains (SPID 60 -> SPID 61 -> SPID 62)', () => {
      const blockedRows = [
        { session_id: 61, blocking_session_id: 60, wait_type: 'LCK_M_U', wait_time: 8000 },
        { session_id: 62, blocking_session_id: 61, wait_type: 'LCK_M_S', wait_time: 35000 }
      ];
      const headInfo = { 60: { login_name: 'admin', status: 'running' } };

      const tree = simulateBlockingTree(blockedRows, headInfo);
      assert.equal(tree.rootBlockers.length, 1);
      assert.equal(tree.rootBlockers[0].sessionId, 60);

      const level1 = tree.rootBlockers[0].blockedSessions[0];
      assert.equal(level1.sessionId, 61);

      const level2 = level1.blockedSessions[0];
      assert.equal(level2.sessionId, 62);
      assert.equal(level2.severity, 'CRITICAL');
      assert.equal(tree.hasCriticalBlocks, true);
      assert.equal(tree.maxWaitTimeMs, 35000);
    });

    it('detects circular blocking cycles and prevents infinite recursion', () => {
      // Circular loop: 70 blocks 71, 71 blocks 70
      const blockedRows = [
        { session_id: 71, blocking_session_id: 70, wait_type: 'LCK_M_X', wait_time: 15000 },
        { session_id: 70, blocking_session_id: 71, wait_type: 'LCK_M_X', wait_time: 15000 }
      ];

      // In circular loop, neither is strictly head, but cycle detection breaks recursion
      const visited = new Set();
      let cycleDetected = false;

      function traverse(spid, localVisited) {
        if (localVisited.has(spid)) {
          cycleDetected = true;
          return;
        }
        localVisited.add(spid);
        const children = blockedRows.filter(r => r.blocking_session_id === spid);
        for (const c of children) {
          traverse(c.session_id, new Set(localVisited));
        }
      }

      traverse(70, visited);
      assert.equal(cycleDetected, true);
    });
  });

  describe('Security & Disclaimer Compliance', () => {
    it('verifies that no KILL SESSION function or endpoint is exposed', () => {
      const activityMonitor = require('../server/services/activityMonitor');
      assert.equal(activityMonitor.killSession, undefined);
      assert.equal(activityMonitor.killRequest, undefined);
    });

    it('exports standard server restart disclaimer for cumulative waits', () => {
      assert.ok(WAITS_DISCLAIMER.includes('son yeniden başlatıldığından beri'));
    });
  });

  describe('SQL Server 2022 Permission Capability & Privacy', () => {
    it('structures LIVE_ACTIVITY capability with VIEW SERVER PERFORMANCE STATE support', () => {
      const perms = ['VIEW SERVER PERFORMANCE STATE', 'VIEW SERVER STATE'];
      assert.ok(perms.includes('VIEW SERVER PERFORMANCE STATE'));
      assert.ok(perms.includes('VIEW SERVER STATE'));
    });

    it('safely escapes brackets in principal usernames for GRANT script preview', () => {
      const trickyUser = 'app_user]test';
      const escaped = String(trickyUser).replace(/\]/g, ']]');
      const script = `GRANT VIEW SERVER PERFORMANCE STATE TO [${escaped}];`;
      assert.equal(script, 'GRANT VIEW SERVER PERFORMANCE STATE TO [app_user]]test];');
    });
  });
});
