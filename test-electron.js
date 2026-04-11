const electron = require("electron");
console.log("electron type:", typeof electron);
console.log("electron keys:", Object.keys(electron).join(", "));
console.log("electron.app:", typeof electron.app);

if (electron.app) {
  electron.app.whenReady().then(() => {
    console.log("App ready!");
    electron.app.quit();
  });
} else {
  console.log("electron.app is undefined!");
  process.exit(1);
}
