import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadTestArguments} from './test-helpers.js';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forwardedArguments = process.argv.slice(2);
const nodeTestFiles = [
    ...await collectTestFiles(resolve(frontendRoot, 'test/unit')),
].map((path) => relative(frontendRoot, path)).sort();

const nodeArguments = ['--test', ...nodeTestFiles];
if (forwardedArguments.length) nodeArguments.push('--', ...forwardedArguments);
await run(process.execPath, nodeArguments, {cwd: frontendRoot});

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await run(npm, ['--prefix', 'test', 'test'], {
    cwd: frontendRoot,
    env: {
        ...process.env,
        FRONTEND_TEST_ARGUMENTS: JSON.stringify(loadTestArguments(forwardedArguments, {cwd: frontendRoot})),
    },
});

async function collectTestFiles(directory) {
    const result = [];
    let entries;
    try {
        entries = await readdir(directory, {withFileTypes: true});
    } catch (error) {
        if (error?.code === 'ENOENT') return result;
        throw error;
    }
    for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) result.push(...await collectTestFiles(path));
        else if (entry.isFile() && entry.name.endsWith('.test.js')) result.push(path);
    }
    return result;
}

function run(command, args, options) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {...options, stdio: 'inherit'});
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) resolvePromise();
            else reject(new Error(signal ? `${command} terminated by ${signal}` : `${command} exited with code ${code}`));
        });
    });
}
