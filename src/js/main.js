import * as d3 from "d3";
import * as topojson from "topojson-client";
import scrollama from "scrollama";

// Temporary dependency check — remove once Phase 2 infrastructure is in place.
console.log("[deps] d3 version:", d3.version);
console.log("[deps] topojson-client feature():", typeof topojson.feature === "function");
console.log("[deps] scrollama():", typeof scrollama === "function");
