function isSchema(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function allowsNull(schema) {
    if (!isSchema(schema)) return true;
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    return (schema.type === undefined || types.includes('null'))
        && (!Array.isArray(schema.enum) || schema.enum.includes(null));
}

// 只扩展可选属性；数组元素和 required 保持原有约束。
export function makeOptionalToolParametersNullable(schema, optional = false) {
    if (!isSchema(schema)) return schema;
    const result = {...schema};
    if (isSchema(schema.properties)) {
        const required = new Set(schema.required || []);
        result.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, property]) =>
            [name, makeOptionalToolParametersNullable(property, !required.has(name))]));
    }
    if (isSchema(schema.items)) result.items = makeOptionalToolParametersNullable(schema.items);
    if (optional && !allowsNull(schema)) {
        result.description = [schema.description, 'Omit or pass null to leave this parameter unspecified.'].filter(Boolean).join(' ');
        if (schema.type !== undefined) {
            const types = Array.isArray(schema.type) ? schema.type : [schema.type];
            result.type = [...new Set([...types, 'null'])];
        }
        if (Array.isArray(schema.enum)) result.enum = schema.enum.includes(null) ? [...schema.enum] : [...schema.enum, null];
    }
    return result;
}

// 可选参数的 null 视为未提供；自由 JSON 和原本可空的业务值保持原样。
export function normalizeToolArguments(value, schema) {
    if (!isSchema(schema)) return value;
    if (Array.isArray(value)) {
        return isSchema(schema.items) ? value.map((item) => normalizeToolArguments(item, schema.items)) : value;
    }
    if (!isSchema(value) || !isSchema(schema.properties)) return value;
    const result = {...value};
    const required = new Set(schema.required || []);
    for (const [name, property] of Object.entries(schema.properties)) {
        if (!Object.hasOwn(value, name)) continue;
        if (value[name] === null && !required.has(name) && !allowsNull(property)) delete result[name];
        else result[name] = normalizeToolArguments(value[name], property);
    }
    return result;
}
