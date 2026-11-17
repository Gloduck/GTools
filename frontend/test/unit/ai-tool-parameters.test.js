import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOptionalToolParametersNullable, normalizeToolArguments} from '../../src/shared/ai/tool-parameters.js';

const schema = {
    type: 'object',
    properties: {
        required: {type: 'string'},
        mode: {type: 'string', enum: ['auto', 'manual']},
        count: {type: 'number'},
        enabled: {type: 'boolean'},
        nested: {type: 'object', properties: {kind: {type: 'string', enum: ['text', 'binary']}, path: {type: 'string'}}, required: ['path']},
        files: {type: 'array', items: {type: 'object', properties: {kind: {type: 'string', enum: ['text', 'binary']}, path: {type: 'string'}}, required: ['path']}},
        input: {type: 'object'},
        args: {description: 'Any JSON value'},
        nullable: {type: ['string', 'null']},
    },
    required: ['required'],
};

test('optional schemas accept null including nested enums without changing required fields', () => {
    const original = structuredClone(schema);
    const result = makeOptionalToolParametersNullable(schema);
    assert.deepEqual(result.properties.mode.type, ['string', 'null']);
    assert.deepEqual(result.properties.mode.enum, ['auto', 'manual', null]);
    assert.deepEqual(result.properties.nested.properties.kind.enum, ['text', 'binary', null]);
    assert.deepEqual(result.properties.files.items.properties.kind.enum, ['text', 'binary', null]);
    assert.deepEqual(result.properties.required, schema.properties.required);
    assert.deepEqual(result.properties.files.items.properties.path, {type: 'string'});
    assert.deepEqual(result.required, ['required']);
    assert.deepEqual(schema, original);
});

test('optional null controls are omitted but required, nullable and arbitrary JSON null survive', () => {
    const value = {required: null, mode: null, count: null, enabled: null,
        nested: {kind: null, path: null}, files: [{kind: null, path: null}, null],
        input: {value: null, items: [null], nested: {value: null}}, args: null, nullable: null, unknown: null};
    const original = structuredClone(value);
    assert.deepEqual(normalizeToolArguments(value, schema), {
        required: null, nested: {path: null}, files: [{path: null}, null],
        input: {value: null, items: [null], nested: {value: null}}, args: null, nullable: null, unknown: null,
    });
    assert.deepEqual(value, original);
});

test('normalization preserves meaningful empty strings, zero and false', () => {
    const value = {required: '', mode: '', count: 0, enabled: false, args: {value: null}};
    assert.deepEqual(normalizeToolArguments(value, schema), value);
});
