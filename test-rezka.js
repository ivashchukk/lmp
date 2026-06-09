#!/usr/bin/env node

'use strict';

var https = require('https');
var querystring = require('querystring');
var zlib = require('zlib');

var baseUrl = new URL(process.env.REZKA_URL || 'https://rezka.fi/');
var login = process.env.REZKA_LOGIN || '';
var password = process.env.REZKA_PASSWORD || '';
var searchQuery = process.env.REZKA_QUERY || 'Матрица';
var userAgent = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';
var cookies = {};

if (!login || !password) {
    console.error('Set REZKA_LOGIN and REZKA_PASSWORD before running this test.');
    process.exit(2);
}

function updateCookies(headers) {
    (headers['set-cookie'] || []).forEach(function (header) {
        var pair = header.split(';', 1)[0];
        var separator = pair.indexOf('=');

        if (separator > 0) {
            cookies[pair.slice(0, separator)] = pair.slice(separator + 1);
        }
    });
}

function cookieHeader() {
    return Object.keys(cookies).map(function (name) {
        return name + '=' + cookies[name];
    }).join('; ');
}

function request(path, options, body) {
    options = options || {};

    return new Promise(function (resolve, reject) {
        var headers = Object.assign({
            'User-Agent': userAgent,
            'Accept': '*/*',
            'Referer': baseUrl.href
        }, options.headers || {});
        var cookie = cookieHeader();

        if (cookie) headers.Cookie = cookie;
        if (body) headers['Content-Length'] = Buffer.byteLength(body);

        var req = https.request({
            protocol: baseUrl.protocol,
            hostname: baseUrl.hostname,
            port: baseUrl.port || 443,
            path: path,
            method: options.method || 'GET',
            headers: headers,
            timeout: 15000
        }, function (res) {
            var chunks = [];

            updateCookies(res.headers);
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                var responseBody = Buffer.concat(chunks);

                if (res.headers['content-encoding'] === 'gzip') {
                    try {
                        responseBody = zlib.gunzipSync(responseBody);
                    } catch (error) {
                        reject(error);
                        return;
                    }
                }

                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: responseBody.toString('utf8')
                });
            });
        });

        req.on('timeout', function () {
            req.destroy(new Error('request timed out'));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function hasCors(headers) {
    return Boolean(headers['access-control-allow-origin']);
}

function parseJson(body) {
    try {
        return JSON.parse(body);
    } catch (error) {
        return null;
    }
}

async function main() {
    var home = await request('/');
    console.log('GET /:', home.status,
        '| login gate:', /action="\/ajax\/login\/"/.test(home.body),
        '| CORS:', hasCors(home.headers));

    // This intentionally matches lampa.js rezka2Login().
    var loginBody = querystring.stringify({
        login_name: login,
        login_password: password,
        login_not_save: 0
    });
    var loginResponse = await request('/ajax/login/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': baseUrl.origin,
            'X-Requested-With': 'XMLHttpRequest'
        }
    }, loginBody);
    var loginJson = parseJson(loginResponse.body);

    console.log('POST /ajax/login/:', loginResponse.status,
        '| JSON:', Boolean(loginJson),
        '| success:', Boolean(loginJson && loginJson.success),
        '| cookies:', Object.keys(cookies).join(', ') || 'none',
        '| CORS:', hasCors(loginResponse.headers));

    if (!loginJson || !loginJson.success) {
        console.log('Login message:',
            loginJson && loginJson.message ? loginJson.message : 'unrecognized response');
        process.exitCode = 1;
        return;
    }

    var authenticatedHome = await request('/');
    var stillLoginGate = /action="\/ajax\/login\/"/.test(authenticatedHome.body);
    console.log('Authenticated GET /:', authenticatedHome.status,
        '| login gate:', stillLoginGate,
        '| catalog markers:', /b-content__inline_items|b-topnav/.test(authenticatedHome.body));

    var searchBody = querystring.stringify({ q: searchQuery });
    var search = await request('/engine/ajax/search.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Origin': baseUrl.origin,
            'X-Requested-With': 'XMLHttpRequest'
        }
    }, searchBody);
    console.log('POST search:', search.status,
        '| bytes:', Buffer.byteLength(search.body),
        '| result items:', (search.body.match(/<li><a href=/g) || []).length,
        '| links:', (search.body.match(/<a\b/g) || []).length,
        '| JSON:', Boolean(parseJson(search.body)),
        '| login gate:', /action="\/ajax\/login\/"/.test(search.body));
    if (!(search.body.match(/<li><a href=/g) || []).length) {
        console.log('Search response preview:',
            search.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240));
    }

    if (stillLoginGate || search.status !== 200) process.exitCode = 1;
}

main().catch(function (error) {
    console.error('Test failed:', error.message);
    process.exitCode = 1;
});
