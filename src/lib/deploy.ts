import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import * as core from "@actions/core";
import { DOT_DEPLOY_API_BASE_URL } from "./constants";
import { HttpClient } from "@actions/http-client";
import { RegisterDeployResponse } from "./types";

export enum DeploymentType {
  Normal = "normal",
  Rollback = "rollback",
  Promotion = "promotion",
  BlueGreen = "blue_green",
}

export type DeployPayload = {
  version: string;
  deploymentType: DeploymentType;
  environment: string;
  secret: string; // this secret is used to report the workflow information back to the server
  deploymentId: string;
};

/**
 * Returns the payload that was used to trigger the workflow run.
 * If the payload is not found or is incorrect, the function will throw an error.
 */
export function getClientPayload(): DeployPayload {
  const eventsPath = process.env.GITHUB_EVENT_PATH;
  if (!eventsPath) {
    throw new Error("GITHUB_EVENT_PATH is not defined");
  }

  const payload = JSON.parse(readFileSync(eventsPath, "utf8"));
  if (!payload.client_payload) {
    throw new Error("Client payload is missing");
  }

  if (
    !payload.client_payload.version ||
    typeof payload.client_payload.version !== "string"
  ) {
    throw new Error("Client payload is missing the build version");
  }

  if (
    !payload.client_payload.deployment_type ||
    typeof payload.client_payload.deployment_type !== "string"
  ) {
    throw new Error("Client payload is missing the deploymentType");
  }

  if (
    !payload.client_payload.environment ||
    typeof payload.client_payload.environment !== "string"
  ) {
    throw new Error("Client payload is missing the environment");
  }

  if (
    !payload.client_payload.secret ||
    typeof payload.client_payload.secret !== "string"
  ) {
    throw new Error("Client payload is missing the secret");
  }

  core.setSecret(payload.client_payload.secret);

  if (
    !payload.client_payload.deployment_id ||
    typeof payload.client_payload.deployment_id !== "string"
  ) {
    throw new Error("Client payload is missing the deploymentId");
  }

  return {
    version: payload.client_payload.build_id,
    deploymentType: payload.client_payload.deployment_type as DeploymentType,
    environment: payload.client_payload.environment,
    secret: payload.client_payload.secret,
    deploymentId: payload.client_payload.deployment_id,
  };
}

export function getMetadata() {
  const repositoryId = process.env.GITHUB_REPOSITORY_ID;
  const runId = process.env.GITHUB_RUN_ID;
  const branch = process.env.GITHUB_REF_NAME;
  const orgLogin = process.env.GITHUB_REPOSITORY_OWNER;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
  const payload = getClientPayload();

  return {
    repository_id: Number(repositoryId),
    workflow_run_id: Number(runId),
    workflow_run_attempt: Number(runAttempt),
    branch_name: branch,
    org_login: orgLogin,
    version: payload.version,
  };
}

export async function registerDeployStart() {
  // Save the metadata to a temp file and upload it to the build artifact
  let tmpDir: string = "";

  try {
    const metadata = getMetadata();
    const payload = getClientPayload();
    core.debug("Notifying dot-deploy of build start");

    const client = new HttpClient("dot-deploy");
    const url = `${DOT_DEPLOY_API_BASE_URL}/actions/deploys/register`;
    const body = {
      ...metadata,
      deployment_id: payload.deploymentId,
    };

    const headers = {
      Authorization: `Bearer ${payload.secret}`,
    };

    core.debug(`Registering deploy start at ${url}`);
    core.debug(`Request payload: ${JSON.stringify(body)}`);

    const response = await client.postJson<RegisterDeployResponse>(
      url,
      body,
      headers,
    );

    if (response.statusCode <= 299) {
      core.debug("Successfully registered deploy start");
    } else {
      core.debug("Failed to register deploy start");
      core.debug(`Status: ${response.statusCode}`);
      core.debug(`Body: ${JSON.stringify(response.result)}`);
      throw new Error(
        `Failed to register deploy start: Got response code ${response.statusCode}`,
      );
    }

    if (response.result?.status !== "ok") {
      core.debug(`Status: ${response.statusCode}`);
      core.debug(`Body: ${JSON.stringify(response.result)}`);
      throw new Error("Failed because the server returned a non-ok status");
    }

    const buildId = getClientPayload().version;

    core.setOutput("version", buildId);
    core.saveState("version", buildId);
  } catch (error) {
    core.error("Error registering deploy start");
    core.setFailed(error as Error);
    throw error;
  } finally {
    if (tmpDir) {
      fs.rmdir(tmpDir).catch(() => {
        core.debug("Error removing temp directory");
      });
    }
  }
}
