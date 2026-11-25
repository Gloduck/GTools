import {Buffer} from 'buffer';

const HASH_BYTES = 20;
const utf8 = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});

function invalid(detail) {
    throw new Error('Invalid Git index: ' + detail);
}

// The stage walker does not apply the mandatory 'link' extension of split indexes.
// Read the on-disk entries, including their cached working-file sizes, in index order.
async function readIndexFile(disk, path, signal, expectedHash) {
    const file = await disk.readBlob(path, {signal});
    const data = Buffer.from(await file.arrayBuffer());
    const end = data.length - HASH_BYTES;
    if (end < 12 || data.toString('ascii', 0, 4) !== 'DIRC') invalid(path);
    const version = data.readUInt32BE(4);
    if (![2, 3, 4].includes(version)) throw new Error('Unsupported Git index version: ' + version);
    const checksum = data.subarray(end);
    if (expectedHash || checksum.some(byte => byte !== 0)) {
        const hash = Buffer.from(await crypto.subtle.digest('SHA-1', data.subarray(0, end)));
        if (!hash.equals(checksum) || (expectedHash && hash.toString('hex') !== expectedHash)) invalid(path + ' checksum');
    }

    const entries = [];
    const count = data.readUInt32BE(8);
    let offset = 12;
    let previous = Buffer.alloc(0);
    for (let i = 0; i < count; i++) {
        const start = offset;
        if (start + 62 > end) invalid('truncated entry');
        const mode = data.readUInt32BE(start + 24);
        const size = data.readUInt32BE(start + 36);
        const oid = data.toString('hex', start + 40, start + 60);
        const flags = data.readUInt16BE(start + 60);
        const extended = Boolean(flags & 0x4000);
        offset = start + (extended ? 64 : 62);
        if (offset >= end || (extended && version === 2)) invalid('entry flags');
        const extra = extended ? data.readUInt16BE(start + 62) : 0;
        if (extra & ~0x6000) invalid('unknown entry flags');
        let prefix = 0;
        if (version === 4) {
            let byte = data[offset++];
            let strip = byte & 127;
            while (byte & 128) {
                if (offset >= end || strip >= previous.length) invalid('compressed pathname');
                byte = data[offset++];
                strip = (strip + 1) * 128 + (byte & 127);
            }
            if (strip > previous.length) invalid('compressed pathname');
            prefix = previous.length - strip;
        }
        const nul = data.indexOf(0, offset);
        if (nul < 0 || nul >= end) invalid('unterminated pathname');
        const suffix = data.subarray(offset, nul);
        previous = prefix ? Buffer.concat([previous.subarray(0, prefix), suffix]) : suffix;
        const name = utf8.decode(previous);
        entries.push({path: name, oid, mode, size, stage: (flags >> 12) & 3,
            skip: Boolean((flags & 0x8000) || (extra & 0x4000)), intentToAdd: Boolean(extra & 0x2000)});
        offset = version === 4 ? nul + 1 : start + Math.ceil((nul + 1 - start) / 8) * 8;
        if (offset > end) invalid('entry padding');
    }

    let link;
    while (offset < end) {
        if (offset + 8 > end) invalid('extension header');
        const signature = data.toString('ascii', offset, offset + 4);
        const length = data.readUInt32BE(offset + 4);
        offset += 8;
        if (length > end - offset) invalid('extension size');
        if (signature === 'link') link = data.subarray(offset, offset + length);
        else if (signature !== 'sdir' && !/^[A-Z]/.test(signature)) throw new Error('Unsupported Git index extension: ' + signature);
        offset += length;
    }
    return {entries, link};
}

// Each EWAH marker counts a run of all-zero/all-one 64-bit words, then literal words.
function readBitmap(link, offset, entryCount) {
    if (offset + 8 > link.length) invalid('split index bitmap header');
    const bits = link.readUInt32BE(offset);
    const words = link.readUInt32BE(offset + 4);
    offset += 8;
    const end = offset + words * 8;
    if (bits > entryCount || end + 4 > link.length) invalid('split index bitmap size');
    const positions = [];
    let position = 0;
    while (offset < end) {
        const marker = link.readBigUInt64BE(offset);
        offset += 8;
        const run = Number((marker >> 1n) & 0xffffffffn) * 64;
        const literals = Number(marker >> 33n);
        if (position + run > Math.ceil(bits / 64) * 64 || offset + literals * 8 > end) invalid('split index bitmap run');
        if (marker & 1n) {
            for (let i = position; i < Math.min(position + run, bits); i++) positions.push(i);
        }
        position += run;
        for (let i = 0; i < literals; i++) {
            let word = link.readBigUInt64BE(offset);
            offset += 8;
            for (let bit = position; word; bit++, word >>= 1n) {
                if (bit >= bits) invalid('split index bitmap position');
                if (word & 1n) positions.push(bit);
            }
            position += 64;
        }
    }
    return {positions, next: end + 4}; // trailing current-running-length-word pointer
}

export async function readIndexEntries(disk, signal) {
    const {entries, link} = await readIndexFile(disk, '.git/index', signal);
    if (!link) return entries;
    if (link.length < HASH_BYTES) invalid('split index link');
    const hash = link.toString('hex', 0, HASH_BYTES);
    const shared = /^0+$/.test(hash) ? [] : (await readIndexFile(disk, '.git/sharedindex.' + hash, signal, hash)).entries;
    if (link.length === HASH_BYTES) return shared.concat(entries);
    const deleted = readBitmap(link, HASH_BYTES, shared.length);
    const replaced = readBitmap(link, deleted.next, shared.length);
    if (replaced.next !== link.length || replaced.positions.length > entries.length) invalid('split index entries');
    for (const [i, position] of replaced.positions.entries()) {
        shared[position] = {...entries[i], path: shared[position].path};
    }
    for (const position of deleted.positions) shared[position] = null;
    return shared.filter(Boolean).concat(entries.slice(replaced.positions.length));
}
