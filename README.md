# Squoosh

A single-file Windows executable wrapper for the Squoosh CLI, designed for batch image processing.

![Static Badge](https://img.shields.io/badge/Node-v16.20.2-blue)


## Usage

### 1. Default configuration from Squoosh desktop App

```
.\squoosh-cli.exe --mozjpeg '{"quality": 75}' -d target_path source_path
```

This processes images from `source_path` and writes the output to `target_path`. Without `source_path`, it processes all images at current path.

### 2. Resize and suffix 

```
.\squoosh-cli.exe --mozjpeg '{"quality": 75}' --resize '{"enabled": true, "width": 720}' --suffix -small -d small
```

This compresses images and resizes them to a width of 720 pixels before saving them to with `-small` suffix the `small` folder.

## Notes

- It do not support wildcard at Windows.
- It do not overwrite existing files.
- target_path will automatically created.


## Build
### Requirements

- Windows
- Node.js 16.20.2

Install dependencies `npm.cmd install` and then edit line 180-181 in `node_modules\@squoosh\cli\src\index.js` to fix suffix becoming prefix from 
```
program.opts().suffix +
    path.basename(originalFile, path.extname(originalFile))
```
to
```
path.basename(originalFile, path.extname(originalFile)) + 
    program.opts().suffix
```

Build the executable:

```
npm.cmd run build:exe
```

The built executable will be generated at `dist/squoosh-cli.exe`
