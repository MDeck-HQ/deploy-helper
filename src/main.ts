import * as core from "@actions/core";

async function run() {
  // Export outputs
  core.setOutput("version", core.getState("version"));
  core.setOutput("environment", core.getState("environment"));
  core.setOutput("deployment_type", core.getState("deployment_type"));
  core.setOutput("deployment_id", core.getState("deployment_id"));
}

run().catch(console.error);
