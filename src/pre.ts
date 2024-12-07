import { registerDeployStart } from "./lib/deploy";

async function preprocess() {
  await registerDeployStart();
}

preprocess().catch(e => {
  console.error(e.message);
});
