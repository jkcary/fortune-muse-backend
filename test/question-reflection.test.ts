import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
vi.mock('../src/modules/ai/llm.js',()=>({generateJson:vi.fn()}));
import {generateJson} from '../src/modules/ai/llm.js';
import {QuestionReflectionOutput,reflectionText} from '../src/modules/garden/questionReflection.js';
import {pool} from '../src/db/pool.js';
import {setup,newUser} from './helpers.js';
let app:FastifyInstance;
beforeAll(async()=>{app=await setup();});beforeEach(()=>{vi.mocked(generateJson).mockReset();});afterAll(async()=>{await app.close();await pool.end();});
const points=['证据：你报告消息发出一天未获回复，这不能单独证明对方拒绝。','假设：忙碌或遗漏也可能解释未回复，目前无法区分。','验证：可发一次简短确认，观察是否回复；仍无回应时，保留不确定结论。'];
const payload={language:'zh-Hans',thought:'给合作方发消息一天没回，担心被拒绝。',fact:'一天未收到回复。',concern:'对方可能不想合作。'};
const ai=(data:any)=>({data,provider:'test',model:'reasoning'}) as any;
describe('scientific key-point reflection',()=>{
  it('uses all reported inputs with precise scientific reasoning and returns three points under 200 displayed characters',async()=>{
    vi.mocked(generateJson).mockResolvedValueOnce(ai({points}));
    const res=await app.inject({method:'POST',url:'/garden/question-reflection',payload});expect(res.statusCode,res.body).toBe(200);expect(res.json()).toMatchObject({points,language:'zh-Hans',aiGenerated:true,generator:'test:reasoning'});
    expect([...reflectionText(res.json().points)].length).toBeLessThanOrEqual(200);
    const request=vi.mocked(generateJson).mock.calls[0][1];const input=JSON.parse(request.messages[0].content);expect(input).toEqual({thought:payload.thought,reportedFact:payload.fact,unverifiedConcern:payload.concern});
    expect(request.system).toContain('Do not infer causation');expect(request.system).toContain('not independent verification');expect(request.system).toContain('Simplified Chinese');
    expect((await pool.query('SELECT * FROM garden_moments')).rowCount).toBe(0);
  });
  it('counts numbering, punctuation and Unicode code points without silently cutting model output',()=>{
    expect(QuestionReflectionOutput.safeParse({points:['x'.repeat(65),'y'.repeat(65),'z'.repeat(65)]}).success).toBe(false);
    expect(QuestionReflectionOutput.safeParse({points:['😀'.repeat(20),'😀'.repeat(20),'😀'.repeat(20)]}).success).toBe(true);
    expect(QuestionReflectionOutput.safeParse({points:['one','two']}).success).toBe(false);
  });
  it('rejects empty, oversized, unknown and unsafe inputs before calling AI',async()=>{
    for(const body of [{language:'zh-Hans'}, {...payload,thought:'x'.repeat(401)}, {...payload,unknown:true}, {...payload,thought:'我想自杀'}])expect((await app.inject({method:'POST',url:'/garden/question-reflection',payload:body})).statusCode).toBe(400);
    expect(generateJson).not.toHaveBeenCalled();
  });
  it('returns retryable errors instead of a fixed fallback for offline, long, invalid or failed model output',async()=>{
    for(const output of [null,ai({points:['x'.repeat(100),'y'.repeat(100),'z'.repeat(100)]}),ai({points:['one']})]){
      vi.mocked(generateJson).mockResolvedValueOnce(output);const res=await app.inject({method:'POST',url:'/garden/question-reflection',payload});expect(res.statusCode).toBe(503);expect(res.json().points).toBeUndefined();
    }
    vi.mocked(generateJson).mockRejectedValueOnce(new Error('offline'));expect((await app.inject({method:'POST',url:'/garden/question-reflection',payload})).statusCode).toBe(503);
    vi.mocked(generateJson).mockResolvedValueOnce(ai({points}));expect((await app.inject({method:'POST',url:'/garden/question-reflection',payload})).statusCode).toBe(200);
  });
  it('coalesces concurrent requests, bounds input per locale, and keeps daily count separate',async()=>{
    vi.mocked(generateJson).mockImplementation(async()=>{await new Promise(r=>setTimeout(r,30));return ai({points});});
    const results=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/garden/question-reflection',payload})));expect(results.every(r=>r.statusCode===200)).toBe(true);expect(generateJson).toHaveBeenCalledTimes(1);
    for(const language of ['en-US','en-GB','zh-Hant'])expect((await app.inject({method:'POST',url:'/garden/question-reflection',payload:{...payload,language}})).statusCode).toBe(200);
    expect(vi.mocked(generateJson).mock.calls.at(-1)![1].system).toContain('Traditional Chinese');
    const user=await newUser(app);await app.inject({method:'POST',url:'/garden/moment',headers:user.auth,payload:{kind:'joy'}});
    await app.inject({method:'POST',url:'/garden/question-reflection',headers:user.auth,payload});
    const state=(await app.inject({method:'GET',url:'/garden',headers:user.auth})).json();expect(state.momentCount).toBe(1);expect(state.todayKind).toBe('joy');
    expect((await app.inject({method:'POST',url:'/garden/question-reflection',headers:{authorization:'Bearer invalid'},payload})).statusCode).toBe(401);
  });
});
