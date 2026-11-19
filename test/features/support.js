// cucumber-js's setup for these scenarios: pubtest's steps (GRAMMAR.md), its
// HTTP steps sent to the service a scenario's Given started (`this.service`),
// and a step may take as long as a test could under node:test.
import * as cucumber from "@cucumber/cucumber";
import { register } from "@sustenaut/pubtest";

cucumber.setDefaultTimeout(60_000);
register(cucumber, {
  client: (world) => (method, path, headers, body) => {
    if (!world.service) throw new Error("no service: a Given starts the one the scenario asks");
    return world.service(method, path, headers, body);
  },
});
