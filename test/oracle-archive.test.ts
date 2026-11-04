import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {pool} from '../src/db/pool.js';
import {interpretLines} from '../src/modules/oracle/iching.js';
import {setup,newUser} from './helpers.js';
let app:FastifyInstance;
beforeAll(async()=>{app=await setup();});afterAll(async()=>{await app.close();await pool.end();});
async function row(userId:string|null,createdAt:string,{favorite=false,privateMode=false,expiresAt=null,complete=true}: {favorite?:boolean;privateMode?:boolean;expiresAt?:string|null;complete?:boolean}={}){
  const id=randomUUID();await pool.query('INSERT INTO oracle_casts(id,token_hash,user_id,topic,question,basis_json,created_at,favorite,private_mode,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,'qa-token',userId,'wealth','Synthetic archive reading',complete?interpretLines([7,7,7,7,7,7]):null,createdAt,favorite,privateMode,expiresAt]);return id;
}
describe('hexagram calendar and collection archive',()=>{
  it('returns the latest actual hexagram above each date and paginates a multi-reading day',async()=>{
    const user=await newUser(app);let latest='';
    for(let i=0;i<30;i++)latest=await row(user.id,new Date(Date.UTC(2026,10,3,12,0,i)).toISOString());
    await pool.query('UPDATE oracle_casts SET basis_json=$2 WHERE id=$1',[latest,interpretLines([8,8,8,8,8,8])]);
    const headers={...user.auth,'x-timezone':'UTC'};
    const first=await app.inject({method:'GET',url:'/oracle/archive?month=2026-11&day=2026-11-03',headers});
    expect(first.statusCode,first.body).toBe(200);expect(first.json().days).toEqual([{date:'2026-11-03',count:30,bits:'000000',number:2}]);
    expect(first.json().casts[0].id).toBe(latest);expect(first.json().hasMore).toBe(true);
    const next=(await app.inject({method:'GET',url:'/oracle/archive?month=2026-11&day=2026-11-03&page=1',headers})).json();
    expect(next.casts).toHaveLength(6);expect(next.hasMore).toBe(false);expect(next.days[0].count).toBe(30);
  });
  it('groups by local date across month boundaries and hides other, private, guest, temporary and incomplete records',async()=>{
    const user=await newUser(app),other=await newUser(app);
    const oct=await row(user.id,'2026-11-01T06:30:00Z'),nov=await row(user.id,'2026-11-01T08:30:00Z',{favorite:true});
    await row(other.id,'2026-11-01T08:30:00Z');await row(null,'2026-11-01T08:30:00Z');await row(user.id,'2026-11-01T08:30:00Z',{privateMode:true});await row(user.id,'2026-11-01T08:30:00Z',{complete:false});await row(user.id,'2026-11-01T08:30:00Z',{expiresAt:'2099-01-01T00:00:00Z'});
    const get=(query:string)=>app.inject({method:'GET',url:'/oracle/archive?'+query,headers:{...user.auth,'x-timezone':'America/Los_Angeles'}});
    const october=await get('month=2026-10');expect(october.statusCode,october.body).toBe(200);expect(october.json().casts.map((c:any)=>c.id)).toEqual([oct]);expect(october.json().days).toEqual([{date:'2026-10-31',count:1,bits:'111111',number:1}]);
    const november=await get('month=2026-11&day=2026-11-01');expect(november.json().casts.map((c:any)=>c.id)).toEqual([nov]);
    const favorites=await get('favorites=true');expect(favorites.statusCode,favorites.body).toBe(200);expect(favorites.json().total).toBe(1);expect(favorites.json().distinctHexagrams).toBe(1);
    await app.inject({method:'PATCH',url:`/oracle/casts/${nov}`,headers:user.auth,payload:{favorite:false}});expect((await get('favorites=true')).json().total).toBe(0);
    expect((await get('day=2026-02-31')).statusCode).toBe(400);expect((await get('month=2026-11&day=2026-10-31')).statusCode).toBe(400);expect((await app.inject({method:'GET',url:'/oracle/archive'})).statusCode).toBe(401);
  });
  it('paginates beyond the old hundred-record journal window and counts every marked day',async()=>{
    const user=await newUser(app);
    for(let i=0;i<105;i++)await row(user.id,`2026-10-${String(i%28+1).padStart(2,'0')}T12:00:00Z`,{favorite:i%2===0});
    const headers={...user.auth,'x-timezone':'UTC'};
    const ids=new Set<string>();let page=0;
    do{const response=await app.inject({method:'GET',url:`/oracle/archive?month=2026-10&page=${page}`,headers});expect(response.statusCode,response.body).toBe(200);const data=response.json();expect(data.total).toBe(105);expect(data.days.reduce((sum:number,d:any)=>sum+d.count,0)).toBe(105);for(const c of data.casts){expect(ids.has(c.id)).toBe(false);ids.add(c.id);}if(!data.hasMore)break;page++;}while(page<10);
    expect(ids.size).toBe(105);expect(page).toBe(4);
    expect((await app.inject({method:'GET',url:'/oracle/archive?favorites=true&hexagram=1',headers})).json().total).toBe(53);
  });
});
