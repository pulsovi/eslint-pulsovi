#!/usr/bin/env node

const watcher = require("../index");

watcher.watch()
  // eslint-disable-next-line no-console
  .catch(err => { console.error(err); });
