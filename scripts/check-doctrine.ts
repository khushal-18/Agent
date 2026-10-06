import { loadDoctrine } from "../src/core/doctrine/load";

const d = loadDoctrine("v1");
console.log(`Doctrine ${d.version} loaded: ${d.laws.length} laws, ${d.banned_patterns.length} banned patterns.`);