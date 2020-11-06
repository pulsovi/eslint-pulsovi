const fs = require('fs');
fs.path = require('path');
const sha1 = require('sha1');
const childProcess = require('child_process');
const readline = require('readline');
const diff = require("diff");
const chalk = require("chalk");
const JSONParse = require('json-parse-safe');

const [, , eslintfile] = process.argv;

async function compareFiles(fileA, fileB) {
  return await sum(fileA) === await sum(fileB);
}

async function createEslintFile(path) {
  const availableTypes = (await fs.promises.readdir(__dirname)
    ).filter(name => name.endsWith(".eslintrc.json"));
  let response;
  while (!(response > 0 && response <= availableTypes.length))
    response = await prompt("Select type :\n" + availableTypes.map((name, index) => `${index + 1}: ${name.slice(0, -14)} \n`).join(""));
  const file = fs.path.resolve(__dirname, availableTypes[response - 1]);
  await fs.promises.copyFile(file, path);
}

function endProcess(subprocess) {
  if (subprocess.exitCode !== null)
    return Promise.resolve(subprocess.exitCode);
  return new Promise(resolve => {
    subprocess.on('close', () => resolve(subprocess.exitCode));
  });
}

function endWatcher(watcher) {
  return new Promise(resolve => {
    watcher.on("close", resolve);
  });
}

async function executeAt(cb, ms) {
  await sleep(ms);
  cb();
}

async function exists(path) {
  try {
    const stats = await fs.promises.stat(path);
    return stats;
  } catch(err) {
    if (err.code === "ENOENT") return false;
    else throw err;
  }
}

async function fixLineEnding(filepath, le="\n") {
  const content = await fs.promises.readFile(filepath, "utf8");
  const fixedContent = content
    .replace(/\r\r\n/gu, "\n")
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n");
  return fs.promises.writeFile(filepath, fixedContent);
}

function getDistFile() {
  if (eslintfile)
    return fs.path.resolve(eslintfile);
  return fs.path.resolve(".eslintrc.json");
}

async function getEslintType(distFile) {
  const fileContent = await fs.promises.readFile(distFile, "utf8");
  const { error, value: fileValue } = JSONParse(fileContent);

  if (error) {
    const { message } = error;

    error.message = `\nUnable to parse your eslint config file\n${error.message}`;
    if ((/^Unexpected token , in JSON at position \d+$/u).test(message)) {
      const position = error.message.split(" ").pop();
      const lines = fileContent.slice(0, position).split("\n");
      const line = lines.length;
      const pos = lines.pop().length + 1;

      error.message += `\n    ${distFile}:${line}:${pos}`;
    }
    throw error;
  }

  if (fileValue.env.browser) {
    if (fileValue.env.node) return "node-browser";
    if (fileValue.plugins.includes("react")) return "react";
    throw new Error("Type de projet non pris en charge.");
  } else {
    if (fileValue.env.node) return "node";
    throw new Error("Type de projet non pris en charge.");
  }
}

async function getLocalFile(distFile) {
  const type = await getEslintType(distFile);
  return fs.path.resolve(__dirname, `${type}.eslintrc.json`);
}

async function handleEvent(event, filename, src, dest, currentHash) {
  if (filename !== fs.path.basename(src) || event !== "change") return;

  if (await sum(src) !== currentHash)
    await fixLineEnding(src);

  const hash = await sum(src);

  if (hash !== currentHash) {
    const srcContent = await fs.promises.readFile(src, "utf8");
    const destContent = await fs.promises.readFile(dest, "utf8");
    console.log(`\n\nfrom ${src}`)
    diff.diffLines(destContent, srcContent).forEach(write_diff);
    await fs.promises.copyFile(src, dest);
  }

  return hash;
}

function meld(fileA, fileB) {
  if (!process.env.PATH.split(":").includes("C:\\Program Files (x86)\\Meld\\lib"))
    process.env.PATH += ";C:\\Program Files (x86)\\Meld\\lib";

  const subprocess = childProcess.spawn("C:\\Program Files (x86)\\Meld\\Meld.exe", [fileA, fileB]);
  return endProcess(subprocess);
}

async function merge(fileA, fileB) {
  await Promise.all([fileA, fileB].map(fixLineEnding));
  if (await compareFiles(fileA, fileB)) return;

  let response = "y";
  while(response.toLowerCase() === "y") {
    await meld(fileA, fileB);
    if (await compareFiles(fileA, fileB)) return;
    do {
      response = await prompt("The files dos not matche, retry ? y/N", "N");
    } while (!["y","n"].includes(response.toLowerCase()));
  }

  throw new Error("Uncompleted merge.");
}

function prompt(message, defaultValue) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer || defaultValue || '');
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sum(filepath) {
  const content = await fs.promises.readFile(filepath);
  return sha1(content);
}

async function watch() {
  const distFile = getDistFile();
  if (!await exists(distFile))
    await createEslintFile(distFile)
  const localFile = await getLocalFile(distFile);
  return watchFiles(distFile, localFile);
}

async function watchFiles(fileA, fileB) {
  console.log("Merging ...");
  await merge(fileA, fileB);
  let currentHash = await sum(fileA);
  let running = false;
  const watchers = [[fileA, fileB], [fileB, fileA]].map(([src, dest]) => {
    return fs.watch(fs.path.dirname(src), watcher);
    function watcher(event, filename, force=false){
      if (running && !force) return;
      running = true;
      handleEvent(event, filename, src, dest, currentHash)
      .then(newHash => {
        running = false;
        currentHash = newHash;
      })
      .catch(err => {
        if (err.code === "EBUSY") return executeAt(() => watcher(event, filename, true), 200);
        console.log(chalk.red("HANDLE EVENT ERROR"), err);
        process.exit();
      });
    }
  });
  console.log("Watching started.");
  await Promise.all(watchers.map(endWatcher));
}

function write_diff(chunk) {
  var value = chunk.value;
  if (chunk.added) {
    process.stdout.write(chalk.green(value));
  } else if (chunk.removed) {
    process.stdout.write(chalk.red(value));
  } else {
    const lines = value.split('\n');
    if (lines.length > 6) {
      process.stdout.write(lines.slice(0, 3).join("\n"));
      process.stdout.write(`\n${lines[3].replace(/^(\s*).*$/u, "$1")}...\n`);
      process.stdout.write(lines.slice(-4).join("\n"));
    } else process.stdout.write(value);
  }
}

module.exports = {
  watch,
};
