import assert from 'node:assert/strict';
import test from 'node:test';
import {installDemoApi} from '../../src/shared/demo-api.js';

function createDemoTarget(locale = 'en-US') {
    const calls = [];
    const target = {
        location: {href: 'https://preview.test/GTools/'},
        localStorage: {getItem: (key) => key === 'ui-locale' ? locale : null},
        fetch: async (...args) => {
            calls.push(args);
            return new Response('network');
        },
    };
    return {target, calls};
}

test('场景：仅拦截当前站点白名单中的演示接口', async () => {
    const {target, calls} = createDemoTarget();
    const restore = installDemoApi({target});

    const mocked = await target.fetch('/api/github/hotSearches');
    const passthrough = await target.fetch('/api/ssh/session');
    const external = await target.fetch('https://api.github.com/search/repositories?q=vue');

    assert.deepEqual((await mocked.json()).data, ['vuejs/core', 'quarkusio/quarkus', 'microsoft/vscode']);
    assert.equal(await passthrough.text(), 'network');
    assert.equal(await external.text(), 'network');
    assert.equal(calls.length, 2);

    restore();
    assert.notEqual(target.fetch, undefined);
});

test('场景：磁力搜索和详情返回页面需要的数据结构', async () => {
    const {target} = createDemoTarget();
    installDemoApi({target});

    const handlers = await target.fetch('/api/torrent/listHandlers').then((response) => response.json());
    const search = await target.fetch('/api/torrent/search?keyword=demo&pageIndex=2').then((response) => response.json());
    const detail = await target.fetch(`/api/torrent/queryDetail?id=${search.data.items[0].id}`).then((response) => response.json());

    assert.equal(handlers.data[0].code, 'demo');
    assert.equal(search.data.index, 2);
    assert.equal(search.data.hasNext, false);
    assert.match(search.data.items[0].name, /^demo - /);
    assert.equal(detail.data.fileCount, 3);
    assert.equal(detail.data.files.length, 3);
    assert.ok(detail.data.hash);
});

test('场景：演示剪贴板支持保存、查询和删除', async () => {
    const {target} = createDemoTarget();
    installDemoApi({target});

    await target.fetch('/api/clipboard/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id: 'test-board', content: 'hello', contentType: 'text'}),
    });
    const saved = await target.fetch('/api/clipboard/query?id=test-board').then((response) => response.json());
    await target.fetch('/api/clipboard/delete?id=test-board', {method: 'DELETE'});
    const deleted = await target.fetch('/api/clipboard/query?id=test-board').then((response) => response.json());

    assert.equal(saved.data.content, 'hello');
    assert.equal(saved.data.contentType, 'text');
    assert.equal(deleted.data, null);
});

test('场景：WebRTC 页面读取模拟配置且创建和加入不会访问网络', async () => {
    const {target, calls} = createDemoTarget();
    installDemoApi({target});

    const config = await target.fetch('/api/webrtc/v1/config').then((response) => response.json());
    const created = await target.fetch('/api/webrtc/v1/sessions', {method: 'POST'}).then((response) => response.json());
    const joined = await target.fetch('/api/webrtc/v1/sessions/join', {method: 'POST'}).then((response) => response.json());

    assert.equal(config.code, 200);
    assert.equal(config.data.maxParticipants, 10);
    assert.deepEqual(config.data.iceServers, []);
    assert.equal(created.msg, 'DEMO_FEATURE_UNAVAILABLE');
    assert.equal(joined.msg, 'DEMO_FEATURE_UNAVAILABLE');
    assert.equal(calls.length, 0);
});

test('场景：磁力结果和默认剪贴板内容跟随中英文界面', async () => {
    const english = createDemoTarget('en-US').target;
    const chinese = createDemoTarget('zh-CN').target;
    installDemoApi({target: english});
    installDemoApi({target: chinese});

    const englishSearch = await english.fetch('/api/torrent/search').then((response) => response.json());
    const chineseSearch = await chinese.fetch('/api/torrent/search').then((response) => response.json());
    const englishClipboard = await english.fetch('/api/clipboard/query?id=demo').then((response) => response.json());
    const chineseClipboard = await chinese.fetch('/api/clipboard/query?id=demo').then((response) => response.json());

    assert.equal(englishSearch.data.items[0].name, 'Example Linux Distribution Image');
    assert.equal(chineseSearch.data.items[0].name, '示例 Linux 发行版镜像');
    assert.match(englishClipboard.data.content, /Welcome/);
    assert.match(chineseClipboard.data.content, /欢迎体验/);
});
