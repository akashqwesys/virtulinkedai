const electron = require("electron");
console.log("electron type:", typeof electron);
if (electron.app) {
  console.log("App found, version:", electron.app.getVersion());
  electron.app.quit();
} else {
  console.log("App is undefined. Exported keys:", Object.keys(electron));
  process.exit(1);
}
