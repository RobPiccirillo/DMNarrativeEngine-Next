import { afterEach,expect,it,vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import request from 'supertest';
import { runCanonicalTurn } from '../../src/services/turn/__tests__/baseAppGate/runCanonicalTurn';

vi.mock('../db/campaignDb.js',()=>({openCampaignDb:vi.fn(()=>{throw new Error('gameplay opened staging DB');})}));
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();roots.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true}));});

it('real frontend turn writes survive disk route replay/reopen with absent and damaged staging artifacts',async()=> {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase2-gameplay-'));roots.push(root);
    vi.stubEnv('DATA_DIR',root);vi.stubEnv('NODE_ENV','production');
    vi.stubEnv('MODS_DIR',path.join(root,'mods'));vi.stubEnv('BUNDLED_MODS_DIR',path.join(root,'bundled'));
    vi.doMock('../lib/embedder.js',()=>({embedText:vi.fn(),buildLoreText:vi.fn(),resolveIndexingSpeed:vi.fn()}));
    vi.doMock('../lib/vectorStore.js',()=>({storeLoreEmbedding:vi.fn(),deleteCampaignEmbeddings:vi.fn()}));
    vi.doMock('../services/nlpPipeline.js',()=>({registerNlpPipeline:vi.fn()}));
    vi.doMock('../services/vectorService.js',()=>({
        storeArchiveEmbedding:vi.fn(),storeLoreEmbedding:vi.fn(),deleteArchiveEmbedding:vi.fn(),deleteAllArchiveEmbeddings:vi.fn(),
        getEmbeddingStatus:vi.fn(),EMBEDDING_VERSION:1,getDb:()=>null,embedText:async()=>null,buildArchiveText:()=>'',buildLoreText:()=>'',
        warmup:vi.fn(),embedBatch:vi.fn(),getActiveDims:()=>0,getActiveModelId:()=>'',isModelReady:()=>false,isJobRunning:()=>false,
        searchArchiveCandidates:()=>[],searchLoreCandidates:()=>[],
    }));
    const {createCampaignsRouter}=await import('../routes/campaigns.js');
    const {createArchiveRouter}=await import('../routes/archive.js');
    const {createTransferRouter}=await import('../routes/transfer.js');
    const app=express();app.use(express.json());app.use(createCampaignsRouter());app.use(createArchiveRouter());app.use(createTransferRouter());
    const result=await runCanonicalTurn();
    const stateWrite=result.fetchLog.find(f=>f.method==='PUT' && f.url.endsWith('/state'));
    const archiveWrite=result.fetchLog.find(f=>f.method==='POST' && f.url.endsWith('/archive'));
    expect(stateWrite).toBeTruthy();expect(archiveWrite).toBeTruthy();
    for(const damaged of [false,true]) {
        const id=damaged?'damaged':'fresh';
        if(damaged) {
            fs.mkdirSync(path.join(root,'migration-staging/partial/work'),{recursive:true});
            fs.writeFileSync(path.join(root,'migration-staging/partial/work/campaign.sqlite'),'corrupt-unrelated');
        }
        await request(app).put('/api/campaigns/'+id).send({id,name:'Synthetic'}).expect(200);
        await request(app).put(`/api/campaigns/${id}/state`).send(stateWrite!.body).expect(200);
        await request(app).post(`/api/campaigns/${id}/archive`).send(archiveWrite!.body).expect(200);
        const reloaded=await request(app).get(`/api/campaigns/${id}/state`).expect(200);
        expect(reloaded.body.messages).toEqual((stateWrite!.body as {messages:unknown}).messages);
        expect(fs.readFileSync(path.join(root,'campaigns',id+'.archive.md'),'utf8')).toContain('## SCENE 001');
    }
    const before=fs.readdirSync(path.join(root,'campaigns')).sort();
    await request(app).post('/api/campaigns/import').send({version:1,campaign:{id:'forbidden'},authorityControl:{}}).expect(400);
    expect(fs.readdirSync(path.join(root,'campaigns')).sort()).toEqual(before);
    const {openCampaignDb}=await import('../db/campaignDb.js');expect(openCampaignDb).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root,'authority'))).toBe(false);
},30000);
