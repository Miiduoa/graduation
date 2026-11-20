'use strict';

// Exercise the deployed Node 22 module loader without Jest/Babel transforms.
const assert = require('node:assert/strict');
const { parseFragment } = require('parse5');

assert.equal(typeof parseFragment, 'function', 'parse5 must expose parseFragment to CommonJS');
const fragment = parseFragment('<p>臺灣 &amp; 安全</p><script>discard()</script>');
assert.equal(fragment.childNodes?.[0]?.nodeName, 'p');
assert.equal(fragment.childNodes?.[0]?.childNodes?.[0]?.value, '臺灣 & 安全');
assert.equal(fragment.childNodes?.[1]?.nodeName, 'script');
