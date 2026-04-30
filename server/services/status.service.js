const packageInfo = require("../../package.json");

function getBuildVersion() {
  return (
    process.env.STOCKBRIDGE_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_URL ||
    packageInfo.version
  );
}

function getVersionStatus() {
  return {
    version: getBuildVersion()
  };
}

module.exports = {
  getVersionStatus
};
