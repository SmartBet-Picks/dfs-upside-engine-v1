import test from "node:test";
import assert from "node:assert/strict";
import { runPrivateUpsideEngine } from "../src/privateUpsideEngine.js";

function runPrivateEngine(body) {
  let payload;
  let statusCode = 200;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(json) {
      payload = json;
      return this;
    }
  };

  runPrivateUpsideEngine({ body }, res);
  return { payload, statusCode };
}

test("showdown keeps upside Strong Captain plays in the captain role", () => {
  const csv = `name,team,position,salary,projection,ceiling,floor,ownership,boom,bust,value,minutes,game_total,team_total,spread,pace,usage,volatility
Target,A,CPT,8000,28,54,14,20,15,20,3.0,25,200,100,5,95,20,20
Alpha,B,FLEX,10000,40,70,26,30,25,15,4,34,210,105,4,98,28,18
Bravo,C,FLEX,9500,35,65,22,20,23,25,3.7,32,205,104,6,96,27,22
Charlie,D,FLEX,9000,32,60,20,18,20,20,3.5,30,200,100,8,94,24,25
Delta,E,FLEX,8500,30,58,18,22,18,10,3.4,31,198,99,5,92,22,15
Echo,F,FLEX,7000,24,45,12,10,12,35,3.4,26,195,96,9,90,15,30
Foxtrot,G,FLEX,6000,20,40,10,9,10,35,3.3,25,195,96,9,90,15,30
Golf,H,FLEX,5000,18,32,8,8,8,35,3.6,22,195,96,9,90,15,30`;

  const { payload, statusCode } = runPrivateEngine({
    csv,
    date: "2026-05-30",
    sport: "nba",
    platform: "draftkings",
    slateType: "showdown",
    contestType: "gpp"
  });

  assert.equal(statusCode, 200);
  const target = payload.publicResult.find((player) => player.playerName === "Target");
  assert.equal(target.captainTier, "Strong Captain");
  assert.equal(target.captainScore, 58);
  assert.equal(target.bestRole, "Captain");
});
