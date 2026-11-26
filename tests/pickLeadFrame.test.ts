import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {pickLeadFrame} from "@/portal/pickLeadFrame";

describe("first responding lead frame",()=>{
  let listeners:Set<(msg:unknown,sender:chrome.runtime.MessageSender)=>unknown>;
  let calls:{args?:unknown[]}[];
  let complete:()=>void;
  beforeEach(()=>{
    vi.useFakeTimers();listeners=new Set();calls=[];
    vi.stubGlobal("chrome",{
      runtime:{onMessage:{addListener:vi.fn(fn=>listeners.add(fn)),removeListener:vi.fn(fn=>listeners.delete(fn))}},
      scripting:{executeScript:vi.fn(injection=>{
        calls.push(injection);
        // The all-frames call stays pending until idle frames time out.
        return injection.args ? new Promise<void>(resolve=>{complete=resolve;}) : Promise.resolve([]);
      })}
    });
  });
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
  function reply(tabId:number,token:unknown,result:unknown,frameId=0){
    for(const fn of [...listeners])fn({type:"portal/leadPicked",token,result},{tab:{id:tabId},frameId} as chrome.runtime.MessageSender);
  }
  it("returns a selected subframe before the other frames finish and cancels idle pickers",async()=>{
    const pending=pickLeadFrame(7);const token=calls[0]!.args![0];
    reply(7,token,{label:"Lead B",key:"site:B"},3);
    await expect(pending).resolves.toEqual({label:"Lead B",key:"site:B",frameId:3});
    expect(calls).toHaveLength(2);expect(listeners.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
    complete();await Promise.resolve();
  });
  it("ignores other tabs and stale rounds",async()=>{
    const pending=pickLeadFrame(7);const token=calls[0]!.args![0];
    reply(8,token,{label:"Wrong tab",key:"x"});reply(7,"old",{label:"Stale",key:"x"});
    expect(listeners.size).toBe(1);
    reply(7,token,null);await expect(pending).resolves.toBeNull();
    expect(listeners.size).toBe(0);
  });
  it("rearms on an idle round and removes its listener",async()=>{
    const pending=pickLeadFrame(7);complete();
    await expect(pending).resolves.toBe("timeout");expect(listeners.size).toBe(0);
  });
  it("has a bounded fallback if frame execution never completes",async()=>{
    const pending=pickLeadFrame(7);await vi.advanceTimersByTimeAsync(22000);
    await expect(pending).resolves.toBe("timeout");expect(listeners.size).toBe(0);
  });
});
