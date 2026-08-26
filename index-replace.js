#!/usr/bin/env node

import { program } from 'commander/esm.mjs';
import JSON5 from 'json5';
import path from 'path';
import { promises as fsp } from 'fs';
import kleur from 'kleur';

import { ImagePool, preprocessors, encoders } from '@squoosh/lib';

function clamp(v, min, max) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

const suffix = ['B', 'KB', 'MB'];
function prettyPrintSize(size) {
  const base = Math.floor(Math.log2(size) / 10);
  const index = clamp(base, 0, 2);
  return (size / 2 ** (10 * index)).toFixed(2) + suffix[index];
}

function progressTracker(results) {
  // Custom renderer instead of ora: the line is only written when its
  // content changes and is overwritten in place with \r (no clearing),
  // so the whole line never flashes.
  const tracker = {};
  tracker.progressOffset = 0;
  tracker.totalOffset = 0;
  let status = '';
  let progress = '';
  let lastRendered = null;
  let active = true;
  const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
  function render() {
    if (!active) return;
    const line = progress + kleur.bold(status);
    if (line === lastRendered) return;
    lastRendered = line;
    // Pad with spaces to clear any leftover characters from a longer line.
    const visible = stripAnsi(line).length;
    const pad = Math.max(0, (process.stdout.columns || 80) - visible - 1);
    process.stdout.write('\r' + line + ' '.repeat(pad));
  }
  tracker.setStatus = (text) => {
    status = text || '';
    render();
  };
  tracker.setProgress = (done, total) => {
    const completeness =
      (tracker.progressOffset + done) / (tracker.totalOffset + total);
    progress =
      kleur.dim(`${done}/${total} `) +
      kleur.cyan(`▐${'▨'.repeat((completeness * 10) | 0).padEnd(10, '╌')}▌ `);
    render();
  };
  tracker.finish = (text) => {
    active = false;
    process.stdout.write('\r' + kleur.green('✔ ') + kleur.bold(text) + '\n');
  };
  // Print a single result as soon as it is ready
  tracker.printResult = (result) => {
    let out = `\n ${kleur.cyan(result.file)}: ${prettyPrintSize(result.size)}`;
    for (const { outputFile, size: outputSize, infoText } of result.outputs) {
      out += `\n  ${kleur.dim('└')} ${kleur.cyan(
        outputFile.padEnd(5),
      )} → ${prettyPrintSize(outputSize)}`;
      const percent = ((outputSize / result.size) * 100).toPrecision(3);
      out += ` (${kleur[outputSize > result.size ? 'red' : 'green'](
        percent + '%',
      )})`;
      if (infoText) out += kleur.yellow(infoText);
    }
    // Hide the progress line, print the result, then redraw it.
    active = false;
    process.stdout.write('\r' + ' '.repeat(Math.max(0, process.stdout.columns - 1)) + '\r');
    console.log(out);
    active = true;
    render();
  };
  render();
  return tracker;
}

async function getInputFiles(paths) {
  const validFiles = [];

  for (const inputPath of paths) {
    const files = (await fsp.lstat(inputPath)).isDirectory()
      ? (await fsp.readdir(inputPath, {withFileTypes: true})).filter(dirent => dirent.isFile()).map(dirent => path.join(inputPath, dirent.name))
      : [inputPath];
    for (const file of files) {
      try {
        await fsp.stat(file);
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.warn(
            `Warning: Input file does not exist: ${path.resolve(file)}`,
          );
          continue;
        } else {
          throw err;
        }
      }

      validFiles.push(file);
    }
  }

  return validFiles;
}

async function processFiles(files) {
  files = await getInputFiles(files);

  const imagePool = new ImagePool();

  const results = new Map();
  const progress = progressTracker(results);

  progress.setStatus('Decoding...');
  progress.totalOffset = files.length;
  progress.setProgress(0, files.length);

  // Create output directory
  await fsp.mkdir(program.opts().outputDir, { recursive: true });

  let decoded = 0;
  let decodedFiles = await Promise.all(
    files.map(async (file) => {
      const image = imagePool.ingestImage(file);
      await image.decoded;
      results.set(image, {
        file,
        size: (await image.decoded).size,
        outputs: [],
      });
      progress.setProgress(++decoded, files.length);
      return image;
    }),
  );

  const preprocessOptions = {};

  for (const preprocessorName of Object.keys(preprocessors)) {
    if (!program.opts()[preprocessorName]) {
      continue;
    }
    preprocessOptions[preprocessorName] = JSON5.parse(
      program.opts()[preprocessorName],
    );
  }

  for (const image of decodedFiles) {
    image.preprocess(preprocessOptions);
  }

  await Promise.all(decodedFiles.map((image) => image.decoded));

  progress.progressOffset = decoded;
  progress.setStatus(
    'Encoding... ' + kleur.dim(`(${imagePool.workerPool.numWorkers} threads)`),
  );
  progress.setProgress(0, files.length);

  const jobs = [];
  let jobsStarted = 0;
  let jobsFinished = 0;
  for (const image of decodedFiles) {
    const originalFile = results.get(image).file;

    const encodeOptions = {
      optimizerButteraugliTarget: Number(
        program.opts().optimizerButteraugliTarget,
      ),
      maxOptimizerRounds: Number(program.opts().maxOptimizerRounds),
    };
    for (const encName of Object.keys(encoders)) {
      if (!program.opts()[encName]) {
        continue;
      }
      const encParam = program.opts()[encName];
      const encConfig =
        encParam.toLowerCase() === 'auto' ? 'auto' : JSON5.parse(encParam);
      encodeOptions[encName] = encConfig;
    }
    jobsStarted++;
    const job = image.encode(encodeOptions).then(async () => {
      jobsFinished++;
      const outputPath = path.join(
        program.opts().outputDir,
        program.opts().suffix +
          path.basename(originalFile, path.extname(originalFile)),
      );
      for (const output of Object.values(image.encodedWith)) {
        const outputFile = `${outputPath}.${(await output).extension}`;
        await fsp.writeFile(outputFile, (await output).binary);
        results
          .get(image)
          .outputs.push(Object.assign(await output, { outputFile }));
      }
      progress.setProgress(jobsFinished, jobsStarted);
    });
    jobs.push(job);
  }

  // update the progress to account for multi-format
  progress.setProgress(jobsFinished, jobsStarted);
  // Wait for all jobs to finish
  await Promise.all(jobs);
  await imagePool.close();
  // Print all results only after everything is finished
  if (program.opts().showResults) {
    for (const image of decodedFiles) {
      progress.printResult(results.get(image));
    }
  }
  progress.finish(
    program.opts().showResults ? 'Squoosh results' : 'Done',
  );
}

program
  .name('squoosh-cli')
  .arguments('<files...>')
  .option('-d, --output-dir <dir>', 'Output directory', '.')
  .option('-s, --suffix <suffix>', 'Append suffix to output files', '')
  .option(
    '--max-optimizer-rounds <rounds>',
    'Maximum number of compressions to use for auto optimizations',
    '6',
  )
  .option(
    '--optimizer-butteraugli-target <butteraugli distance>',
    'Target Butteraugli distance for auto optimizer',
    '1.4',
  )
  .option(
    '--show-results',
    'Print per-file results (default: progress bar only)',
  )
  .action(processFiles);

// Create a CLI option for each supported preprocessor
for (const [key, value] of Object.entries(preprocessors)) {
  program.option(`--${key} [config]`, value.description);
}
// Create a CLI option for each supported encoder
for (const [key, value] of Object.entries(encoders)) {
  program.option(
    `--${key} [config]`,
    `Use ${value.name} to generate a .${value.extension} file with the given configuration`,
  );
}

program.parse(process.argv);
