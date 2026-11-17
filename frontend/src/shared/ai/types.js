/**
 * AI 协议策略的公共契约；连接配置与协议实现分开，业务不得读取原始协议字段。
 * @typedef {Object} AiStrategy
 * @property {(request: AiRespondRequest) => Promise<AiResponse>} respond 生成回答；失败通过异常返回。
 * @property {(request?: AiListModelsRequest) => Promise<string[]>} listModels 按需查询模型，不是生成回答的前置步骤。
 * @property {(request: AiGenerateImageRequest) => Promise<AiGeneratedImage>} generateImage 生成或编辑图片。
 */

/**
 * @typedef {Object} AiConnection
 * @property {string} baseUrl
 * @property {string} apiKey
 */

/**
 * @typedef {Object} AiStrategyConfig
 * @property {AiConnection | (() => AiConnection)} [connection] 函数形式在请求开始时读取当前连接。
 * @property {typeof globalThis.fetch} fetch
 */

/**
 * @typedef {Object} AiClientConfig
 * @property {string} [protocol] 策略注册名；当前仅实现 openai。
 * @property {AiConnection | (() => AiConnection)} [connection]
 * @property {typeof globalThis.fetch} [fetch]
 * @property {number[]} [retryDelaysMs] 响应尚未开始时的重试间隔。
 */

/**
 * 不透明续接令牌，只能交回产生它的客户端；绑定策略实例及连接地址、密钥。
 * 业务不得读取、复制或持久化它；续轮 input 只包含新增消息和工具结果。
 * @typedef {Readonly<object>} AiContinuation
 */

/** @typedef {{type: 'text', text: string}} AiInputText */
/** @typedef {{type: 'image', url: string, detail?: string}} AiInputImage */
/** @typedef {{role: 'user' | 'assistant' | 'system', content: string | (AiInputText | AiInputImage)[]}} AiInputMessage */
/** @typedef {{type: 'tool_result', callId: string, output: unknown}} AiToolResult 输入必须可序列化为 JSON，字符串可直接作为结果。 */
/** @typedef {string | (AiInputMessage | AiToolResult)[]} AiInput */

/**
 * @typedef {Object} AiFunctionTool
 * @property {'function'} type
 * @property {string} name
 * @property {string} [description]
 * @property {Record<string, unknown>} parameters JSON Schema。
 * @property {boolean} [strict]
 */
/** @typedef {AiFunctionTool | {type: 'web_search'} | {type: 'image'}} AiTool */

/**
 * @typedef {Object} AiResponseFormat
 * @property {'json_schema'} type
 * @property {string} name
 * @property {Record<string, unknown>} schema
 * @property {boolean} [strict]
 */

/**
 * @typedef {Object} AiResponseOptions
 * @property {boolean} [store]
 * @property {boolean} [stream] 默认启用流式，也兼容服务端直接返回完整 JSON。
 * @property {string} [reasoningEffort]
 * @property {string} [verbosity]
 * @property {number} [maxOutputTokens]
 * @property {AiResponseFormat} [responseFormat]
 */

/**
 * @typedef {Object} AiRespondRequest
 * @property {string} model
 * @property {string} [instructions]
 * @property {AiInput} [input] 首次为初始上下文；携带 continuation 时只传新增输入。
 * @property {AiContinuation} [continuation]
 * @property {AiTool[]} [tools]
 * @property {AiResponseOptions} [options]
 * @property {AbortSignal} [signal]
 * @property {(event: AiStreamEvent) => void} [onEvent] 只有需要展示回答的调用才传入。
 */

/** @typedef {{url: string, title: string}} AiSource */
/** @typedef {{type: 'text' | 'refusal', text: string}} AiMessageContent */
/** @typedef {{type: 'message', role: 'assistant', content: AiMessageContent[], sources: AiSource[]}} AiMessageOutput */
/** @typedef {{type: 'tool_call', id: string, name: string, arguments: Record<string, unknown>}} AiToolCall 仅完整、可执行的调用；执行与审批归 Agent。 */
/** @typedef {{type: 'image', status: string, base64: string, format: string}} AiImageOutput 原生图片结果，按状态决定是否可使用。 */
/** @typedef {{type: string, query?: string, queries?: string[], url?: string, pattern?: string}} AiWebSearchAction */
/** @typedef {{type: 'web_search', status: string, action: AiWebSearchAction, sources: AiSource[], error: string | null}} AiWebSearchOutput 已由服务端执行，不当成本地函数调用。 */
/** @typedef {{type: 'reasoning'}} AiReasoningOutput 推理所需原始内容留在策略的续接状态中。 */
/** @typedef {{type: 'unsupported', name: string, status?: string}} AiUnsupportedOutput 包含未完成工具调用，不能执行；审查调用必须拒绝此类额外输出。 */
/** @typedef {AiMessageOutput | AiToolCall | AiImageOutput | AiWebSearchOutput | AiReasoningOutput | AiUnsupportedOutput} AiOutput */

/**
 * output 是当前响应的完整中立消息快照，消费者覆盖显示，不能再次追加全文。
 * reset 仅在真正开始一次请求尝试时发出；重试等待和终止不会清空已有显示。
 * @typedef {{type: 'reset'} | {type: 'output', output: AiMessageOutput[]}} AiStreamEvent
 */

/**
 * @typedef {Object} AiUsage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} totalTokens
 * @property {number} [cachedInputTokens] 缺失表示服务端未提供缓存统计。
 */

/**
 * @typedef {Object} AiResponse
 * @property {AiOutput[]} output 按服务端输出顺序归一化的结果。
 * @property {string} status 通常为 completed 或 incomplete；失败通过异常返回。
 * @property {AiUsage | null} usage
 * @property {AiContinuation} continuation
 * @property {{bytes: number, ms?: number}} meta 策略提供接收字节数；客户端补充含重试等待的耗时。
 */

/**
 * 只有显式 retryable: true 才允许重试；收到有效流事件后的错误不得标记可重试。
 * @typedef {Error & {retryable?: boolean, retryAfterMs?: number}} AiRequestError
 */

/** @typedef {{signal?: AbortSignal}} AiListModelsRequest */

/**
 * @typedef {Object} AiGenerateImageRequest
 * @property {string} model
 * @property {string} prompt
 * @property {AbortSignal} [signal]
 * @property {Blob} [inputBlob] 提供输入图片时执行编辑。
 * @property {string} [inputName]
 * @property {number} [inputWidth]
 * @property {number} [inputHeight]
 * @property {Blob} [maskBlob]
 * @property {string} [maskName]
 * @property {string} [size]
 * @property {string} [quality]
 * @property {string} [background]
 * @property {string} [outputFormat] 默认 png。
 * @property {number} [frameCount]
 * @property {number} [frameDurationMs]
 * @property {string} [outputPath] 用于输出大小限制的错误定位，不由策略写入文件。
 * @property {number} [maxOutputBytes]
 */

/**
 * 图片接口返回已下载、校验大小的 Blob；与 respond 的原生 base64 图片输出分别建模。
 * @typedef {{type: 'image', status: 'completed', blob: Blob, format: string, usage: AiUsage | null}} AiGeneratedImage
 */

export {};
