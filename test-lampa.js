#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

var source = fs.readFileSync('lampa.js', 'utf8');
var mirrorFunction = source.match(
    /function rezka2Mirror\(\) \{[\s\S]*?\n    \}/
);

assert(mirrorFunction, 'rezka2Mirror() was not found');

function mirrorFor(value) {
    var context = {
        Lampa: {
            Storage: {
                get: function () {
                    return value;
                }
            }
        }
    };

    vm.runInNewContext(mirrorFunction[0] + '\nresult = rezka2Mirror();', context);
    return context.result;
}

assert.strictEqual(mirrorFor(''), 'https://rezka.fi');
assert.strictEqual(mirrorFor('https://kvk.zone'), 'https://rezka.fi');
assert.strictEqual(mirrorFor('kvk.zone/'), 'https://rezka.fi');
assert.strictEqual(mirrorFor('rezka.fi'), 'https://rezka.fi');
assert.strictEqual(mirrorFor('https://rezka.fi/'), 'https://rezka.fi');

assert(
    source.indexOf("var url = host + '/ajax/login/';") !== -1,
    'HDrezka login endpoint changed unexpectedly'
);
assert(
    source.indexOf("var url = embed + 'engine/ajax/search.php';") !== -1,
    'HDrezka search endpoint changed unexpectedly'
);

console.log('lampa.js HDrezka configuration checks passed');
