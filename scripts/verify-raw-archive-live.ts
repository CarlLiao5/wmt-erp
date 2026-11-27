import {createDb} from '../packages/db/src/db.js';
import {writeArchive,readArchive,normalizeRaw} from '../packages/db/src/raw-archive.js';
import {verifyArchivedCoverage} from '../packages/db/src/raw-archive-coverage.js';
import assert from 'node:assert/strict';
const {pool}=createDb();
try{
 const [rows]:any=await pool.query("SELECT CAST(id AS CHAR) AS id,tenant_id,store_id,resource,external_id,CAST(payload AS CHAR) AS payload,http_status,correlation_id,received_at FROM raw_payloads FORCE INDEX(raw_payload_resource_store_time_idx) WHERE tenant_id=? AND resource=? AND store_id=? ORDER BY received_at DESC LIMIT 1",['default','item-report','prod-001']);
 assert.equal(rows.length,1);const source=normalizeRaw(rows[0]);const file=await writeArchive('.local/raw-archives',[source]);const restored=await readArchive(file);assert.deepEqual(restored,[source]);assert(await verifyArchivedCoverage(pool,restored[0]));console.log(JSON.stringify({verified:true,tenant:source.tenant_id,store:source.store_id,resource:source.resource,records:1,archive:file,normalizedCoverage:true,deleted:0}));
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}process.exit(process.exitCode??0);
