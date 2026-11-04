import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
vi.mock('../src/modules/ai/llm.js',()=>({generateJson:vi.fn()}));
import { generateJson } from '../src/modules/ai/llm.js';
import { pool } from '../src/db/pool.js';
import { setup,newUser } from './helpers.js';
import { exportUserData,deleteUser } from '../src/modules/account/routes.js';
let app:FastifyInstance;
beforeAll(async()=>{app=await setup();});
beforeEach(()=>{vi.mocked(generateJson).mockReset();});
afterAll(async()=>{await app.close();await pool.end();});
const options={priorityQuestion:'Which need should these five name cards address?',priorities:['A clear job title on each card','Contact details the five people actually use','A problem each person wants help solving'],costQuestion:'What would you try before printing any cards?',costs:['Ask one person about the wording','Draft five examples without ordering','Check one real contact detail']};
const ai=(data:unknown)=>({data,provider:'test-ai',model:'personal-options'}) as any;
async function cast(auth:Record<string,string>={},privateMode=false){
  const id=randomUUID(),token=randomUUID()+randomUUID(),headers={...auth,'x-oracle-token':token};
  const created=await app.inject({method:'POST',url:'/oracle/casts',headers,payload:{id,token,topic:'wealth',question:'I want to help five people design name cards. Where should I begin?',context:'I have not printed any cards. I want to identify a problem for each person.',ageConfirmed:true,informationConfirmed:true,privateMode}});expect(created.statusCode).toBe(200);
  await app.inject({method:'POST',url:`/oracle/casts/${id}/rounds`,headers,payload:{complete:true}});
  await app.inject({method:'PATCH',url:`/oracle/casts/${id}/journey`,headers,payload:{selectedDoor:'a'}});
  await pool.query('UPDATE oracle_casts SET glimpse_json=$2 WHERE id=$1',[id,{doors:[{id:'a',title:'Talk to five people first',experiment:'List five names and one problem for each.'}]}]);
  return {id,headers};
}
const generate=(c:Awaited<ReturnType<typeof cast>>,body:object={language:'en-US'})=>app.inject({method:'POST',url:`/oracle/casts/${c.id}/door-exercise`,headers:c.headers,payload:body});
describe('personal AI door exercise',()=>{
  it('uses the actual question, context, chosen path and requested locale; caches and coalesces generation',async()=>{
    const c=await cast();
    vi.mocked(generateJson).mockImplementation(async()=>{await new Promise(r=>setTimeout(r,30));return ai(options);});
    const results=await Promise.all([generate(c,{language:'zh-Hans'}),generate(c,{language:'zh-Hans'})]);
    expect(results.every(r=>r.statusCode===200)).toBe(true);expect(generateJson).toHaveBeenCalledTimes(1);
    const content=results[0].json().cast.doorExerciseContent;
    expect(content.priorities[0]).toEqual({id:'p1',label:options.priorities[0]});expect(content.language).toBe('zh-Hans');expect(content.aiGenerated).toBe(true);
    const request=vi.mocked(generateJson).mock.calls[0][1];expect(request.messages[0].content).toContain('five people');expect(request.messages[0].content).toContain('Talk to five people first');expect(request.system).toContain('Simplified Chinese');
    expect((await generate(c,{language:'en-GB'})).json().cast.doorExerciseContent).toEqual(content);expect(generateJson).toHaveBeenCalledTimes(1);
  });
  it('generates and caches a reflection for both actual option labels; saves versioned choices',async()=>{
    const c=await cast();vi.mocked(generateJson).mockResolvedValueOnce(ai(options));await generate(c);
    const reflected={summary:'Checking the five people’s actual contact details lets you learn before printing.',prompt:'Which one person could confirm their preferred contact details first?'};
    vi.mocked(generateJson).mockResolvedValueOnce(ai(reflected));
    const selection={priority:'p2',cost:'c3'};
    const result=await generate(c,{language:'en-US',selection});expect(result.statusCode,result.body).toBe(200);expect(result.json().cast.doorExerciseContent.reflections[0]).toMatchObject({...selection,...reflected});
    const input=vi.mocked(generateJson).mock.calls[1][1].messages[0].content;expect(input).toContain(options.priorities[1]);expect(input).toContain(options.costs[2]);
    await generate(c,{language:'zh-Hant',selection});expect(generateJson).toHaveBeenCalledTimes(2);
    const saved=await app.inject({method:'PATCH',url:`/oracle/casts/${c.id}/journey`,headers:c.headers,payload:{doorExercise:{version:1,door:'a',...selection}}});expect(saved.statusCode).toBe(200);
    const bad=await generate(c,{selection:{priority:'p4',cost:'c1'}});expect(bad.statusCode).toBe(400);expect(generateJson).toHaveBeenCalledTimes(2);
    expect((await app.inject({method:'PATCH',url:`/oracle/casts/${c.id}/journey`,headers:c.headers,payload:{doorExercise:{door:'a',priority:'growth',cost:'time'}}})).statusCode).toBe(409);
  });
  it('never substitutes fixed options on offline, invalid or provider failures and allows retry',async()=>{
    const c=await cast();
    for(const response of [null,ai({...options,priorities:['same','same','same']}),ai({foo:'invalid'})]){
      vi.mocked(generateJson).mockResolvedValueOnce(response);expect((await generate(c)).statusCode).toBe(503);
      expect((await pool.query('SELECT door_exercise_json FROM oracle_casts WHERE id=$1',[c.id])).rows[0].door_exercise_json).toBeNull();
    }
    vi.mocked(generateJson).mockRejectedValueOnce(new Error('provider offline'));expect((await generate(c)).statusCode).toBe(503);
    vi.mocked(generateJson).mockResolvedValueOnce(ai(options));expect((await generate(c)).statusCode).toBe(200);
    vi.mocked(generateJson).mockResolvedValueOnce(null);expect((await generate(c,{selection:{priority:'p1',cost:'c1'}})).statusCode).toBe(503);
    const row=(await pool.query('SELECT door_exercise_json,journey_json FROM oracle_casts WHERE id=$1',[c.id])).rows[0];expect(row.door_exercise_json.reflections).toEqual([]);expect(row.journey_json.selectedDoor).toBe('a');
  });
  it('checks ownership, selected door and expiry, including expiry during generation',async()=>{
    const c=await cast();
    expect((await app.inject({method:'POST',url:`/oracle/casts/${c.id}/door-exercise`,payload:{}})).statusCode).toBe(404);
    await pool.query('UPDATE oracle_casts SET journey_json=$2 WHERE id=$1',[c.id,{selectedDoor:null}]);expect((await generate(c)).statusCode).toBe(400);expect(generateJson).not.toHaveBeenCalled();
    await pool.query('UPDATE oracle_casts SET journey_json=$2 WHERE id=$1',[c.id,{selectedDoor:'a'}]);
    vi.mocked(generateJson).mockImplementationOnce(async()=>{await pool.query("UPDATE oracle_casts SET expires_at=now()-interval '1 minute' WHERE id=$1",[c.id]);return ai(options);});
    expect((await generate(c)).statusCode).toBe(404);expect((await pool.query('SELECT door_exercise_json FROM oracle_casts WHERE id=$1',[c.id])).rows[0].door_exercise_json).toBeNull();
  });
  it('preserves private action work through generation, retries, export and deletion',async()=>{
    const user=await newUser(app),c=await cast(user.auth),other=await newUser(app);
    const actionNotes='Alice — clear title\nBob — contact details\nCarol — a readable layout\nDan — print size\nEve — an editable file';
    const save=(headers=c.headers)=>app.inject({method:'PATCH',url:`/oracle/casts/${c.id}/journey`,headers,payload:{action:'List five people and their problems',actionNotes}});
    vi.mocked(generateJson).mockImplementationOnce(async()=>{expect((await save()).statusCode).toBe(200);return ai(options);});
    const result=await generate(c);expect(result.json().cast.journey.actionNotes).toBe(actionNotes);expect((await save()).json().cast.journey.actionNotes).toBe(actionNotes);
    expect((await save(other.auth as any)).statusCode).toBe(404);
    expect((await app.inject({method:'PATCH',url:`/oracle/casts/${c.id}/journey`,headers:c.headers,payload:{actionNotes:'x'.repeat(6001)}})).statusCode).toBe(400);
    const data=await exportUserData(user.id);expect(data.oracleReadings[0].journey_json.actionNotes).toBe(actionNotes);expect(data.oracleReadings[0].door_exercise_json.aiGenerated).toBe(true);
    await deleteUser(user.id);expect((await pool.query('SELECT id FROM oracle_casts WHERE id=$1',[c.id])).rowCount).toBe(0);
  });
});
