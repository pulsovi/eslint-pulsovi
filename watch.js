const fs = require('fs');
fs.path = require('path');
const sha1 = require('sha1');
const childProcess = require('child_process');
const readline = require('readline');
const diff = require("diff");
const chalk = require("chalk");

async function main() {
  const distFile = getDistFile();
  if (!await exists(distFile))
    throw new Error("La création de fichier .eslintrc.json n'est pas encore prise en charge.");
  const localFile = await getLocalFile(distFile);
  return watchFiles(distFile, localFile);
}

async function compareFiles(fileA, fileB) {
  return await sum(fileA) === await sum(fileB);
}

function endProcess(subprocess) {
  if (subprocess.exitCode !== null)
    return promise.resolve(subprocess.exitCode);
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

function exists(path) {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, stats) => {
      if (err) {
        if (err.code === "ENOENT") resolve(false);
        else reject(err);
      }
      else resolve(stats);
    })
  });
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
  if (process.argv.length < 3) {
    return fs.path.resolve(".eslintrc.json");
  }
}

async function getEslintType(distFile) {
  const fileContent = await fs.promises.readFile(distFile, "utf8");
  const fileValue = JSON.parse(fileContent);
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

function sum(filepath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filepath, (err, content) => {
      if (err) reject(err);
      else resolve(sha1(content));
    })
  });
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

main()
  .then(() => { console.log("end of main"); })
  .catch(err => { console.log("Error on main :", err); });
