import("./dist/src/server.js").catch(error => {
  import("fs").then(fs => {
    fs.writeFileSync("stderr.log", `Import Error: ${error}\n${error?.stack || ""}\n`, { flag: "a" });
  }).catch(err => {
    console.error("Failed to write to stderr.log:", err);
  });
});
