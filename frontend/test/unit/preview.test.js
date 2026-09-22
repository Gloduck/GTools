import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreviewPath, resolvePreviewUrl, rewriteCss} from '../../src/shared/preview/resources.js';
import {createPreviewSession} from '../../src/shared/preview/index.js';

test('preview paths normalize within a case-sensitive virtual root', () => {
    assert.equal(normalizePreviewPath('/site//./a/../Index.html'), 'site/Index.html');
    assert.deepEqual(resolvePreviewUrl('../images/a%20b.svg?q=1#icon', 'site/css/main.css'), {path: 'site/images/a b.svg', suffix: '?q=1#icon', hash: '#icon'});
    assert.equal(resolvePreviewUrl('/shared/a.css', 'site/index.html').path, 'shared/a.css');
    for (const value of ['https://example.org/a', 'data:image/png,abc', '//cdn/a', '#id', '../../../escape']) assert.equal(resolvePreviewUrl(value, 'site/index.html'), null);
    assert.throws(() => normalizePreviewPath('../escape'), /escapes/);
});

test('CSS parser rewrites imports and url functions without rewriting comments or strings', async () => {
    const refs = [];
    const css = await rewriteCss('/* url(no.png) */ @import "nested/base.css" screen; @import url(other.css); a{content:"url(fake.png)";background:linear-gradient(red,blue),url("a (1).png");mask:url(icon.svg#x)}', async (url) => {
        refs.push(url);
        return `ROOT/${url}`;
    });
    assert.deepEqual(refs.sort(), ['nested/base.css', 'other.css', 'a (1).png', 'icon.svg#x'].sort());
    assert.match(css, /content:"url\(fake.png\)"/);
    assert.match(css, /url\("ROOT\/a \(1\).png"\)/);
    assert.match(css, /@import "ROOT\/nested\/base.css" screen/);
});

test('session rejects normalized duplicate paths and nonliteral content', () => {
    const file = {path: 'a.html', mimeType: 'text/html', content: '<p>literal</p>'};
    assert.throws(() => createPreviewSession([file, {...file, path: './a.html'}]), /Duplicate/);
    assert.throws(() => createPreviewSession([{...file, content: () => ''}]), /Expected/);
});

test('session replacement, error state, immediate subscription, reset and idempotent cleanup', async () => {
    const events = new EventTarget();
    globalThis.window = events;
    const session = createPreviewSession([]);
    const states = [];
    const unsubscribe = session.subscribe((state) => states.push(state));
    assert.equal(states.length, 1);
    await assert.rejects(session.open('missing.html'), /not previewable/);
    assert.match(session.getState().error, /missing.html/);
    const previousRevision = session.getState().revision;
    await session.setFiles([]);
    assert.ok(session.getState().revision > previousRevision);
    session.reset();
    assert.equal(session.getState().path, '');
    assert.equal(session.getState().error, null);
    unsubscribe();
    const count = states.length;
    session.dispose();
    session.dispose();
    assert.equal(states.length, count);
    assert.equal(session.getState().disposed, true);
    assert.throws(() => session.setFiles([]), /disposed/);
    delete globalThis.window;
});
