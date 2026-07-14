import fs from "fs";

process.on("unhandledRejection", (reason) => {
  const msg = `Unhandled Rejection: ${reason}\n${reason?.stack || ""}\n`;
  fs.writeFileSync("stderr.log", msg, { flag: "a" });
});

process.on("uncaughtException", (error) => {
  const msg = `Uncaught Exception: ${error}\n${error?.stack || ""}\n`;
  fs.writeFileSync("stderr.log", msg, { flag: "a" });
});

try {
  await import("./dist/src/server.js");
} catch (error) {
  const msg = `Import Error: ${error}\n${error?.stack || ""}\n`;
  fs.writeFileSync("stderr.log", msg, { flag: "a" });
  throw error;
}
