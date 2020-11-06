#!/usr/bin/env node

const watcher = require("../index");

watcher.watch()
  .then(() => { console.log("end of main"); })
  .catch(err => { console.log("Error on main :", err, err.stack); });
