// Fails fast with a readable message; Node < 22 cannot expand the test glob.
const REQUIRED_MAJOR = 22;
const major = Number(process.versions.node.split('.')[0]);
if (major < REQUIRED_MAJOR) {
  console.error(`talk-to-bro-personally requires Node >= ${REQUIRED_MAJOR} (found ${process.versions.node}). Run \`nvm use\` (see .nvmrc) and retry.`);
  process.exit(1);
}
