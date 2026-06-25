#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const API_BASE = 'https://prism-stone-pre.byering.com/api';
const AUTH_CACHE_PATH = join(homedir(), '.wucaishi-component-workflow', 'auth.json');

function fail(message, code = 1) {
	console.error(`错误：${message}`);
	process.exit(code);
}

function parseArgs(argv) {
	const args = {
		name: null,
		phone: null,
		password: null,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const nextValue = () => {
			const value = argv[i + 1];
			if (!value || value.startsWith('--')) {
				fail(`${arg} 缺少参数值`);
			}
			i += 1;
			return value;
		};

		if (arg === '-h' || arg === '--help') {
			printHelp();
			process.exit(0);
		} else if (arg === '--name') {
			args.name = nextValue();
		} else if (arg === '--phone') {
			args.phone = nextValue();
		} else if (arg === '--password') {
			args.password = nextValue();
		} else {
			fail(`未知参数：${arg}`);
		}
	}

	if (!args.name || !args.name.trim()) {
		fail('必须传入 --name 组件名');
	}

	args.name = args.name.trim();
	args.phone = args.phone ? args.phone.trim() : null;
	args.password = args.password ? args.password.trim() : null;
	return args;
}

function printHelp() {
	console.log(`usage: check_component_name_exists.mjs --name COMPONENT_NAME [options]

创建组件模板前校验组件名称是否已存在。

options:
  -h, --help                    显示帮助
  --name COMPONENT_NAME          组件名，必填
  --phone PHONE                 登录账号，首次登录必填；之后可读取本地缓存
  --password PASSWORD           登录密码，首次登录必填；之后可读取本地缓存`);
}

async function loadSavedCredentials() {
	try {
		const raw = await readFile(AUTH_CACHE_PATH, 'utf8');
		const saved = JSON.parse(raw);
		if (saved && typeof saved.phone === 'string' && typeof saved.password === 'string') {
			return {
				phone: saved.phone.trim(),
				password: saved.password.trim(),
			};
		}
	} catch {
		return null;
	}
	return null;
}

async function saveCredentials(phone, password) {
	const payload = JSON.stringify({ phone, password }, null, 2);
	await mkdir(dirname(AUTH_CACHE_PATH), { recursive: true, mode: 0o700 });
	await writeFile(AUTH_CACHE_PATH, payload, { mode: 0o600 });
	await chmod(AUTH_CACHE_PATH, 0o600);
}

async function resolveCredentials(args) {
	const saved = await loadSavedCredentials();
	const phone = args.phone || saved?.phone;
	const password = args.password || saved?.password;

	if (!phone || !password) {
		fail(`缺少登录账号或密码。请先传入 --phone 登录账号 --password 登录密码，登录成功后会保存到本地：${AUTH_CACHE_PATH}`);
	}

	return { phone, password };
}

async function requestJson(method, url, { body, token } = {}) {
	const headers = { Accept: 'application/json' };
	const init = { method, headers };
	if (body !== undefined) {
		headers['Content-Type'] = 'application/json';
		init.body = JSON.stringify(body);
	}
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	let response;
	try {
		response = await fetch(url, init);
	} catch (error) {
		fail(`请求失败：${method} ${url}\n${error.message}`);
	}

	const raw = await response.text();
	if (!response.ok) {
		fail(`HTTP ${response.status}：${method} ${url}\n${raw}`);
	}

	try {
		return JSON.parse(raw);
	} catch {
		fail(`接口返回不是 JSON：${method} ${url}\n${raw}`);
	}
}

function entityOrFail(payload, apiName) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		fail(`${apiName} 返回不是对象：${String(payload)}`);
	}
	if (String(payload.code) !== '10000') {
		fail(`${apiName} 返回失败：${JSON.stringify(payload, null, 2)}`);
	}
	if (!payload.entity || typeof payload.entity !== 'object' || Array.isArray(payload.entity)) {
		fail(`${apiName} 返回缺少 entity：${JSON.stringify(payload, null, 2)}`);
	}
	return payload.entity;
}

async function login(phone, password) {
	const body = { phone, smsCode: password };
	const payload = await requestJson('POST', `${API_BASE}/web/auth/login`, { body });
	const entity = entityOrFail(payload, '测试登录');
	if (!entity.accessToken) {
		fail(`测试登录返回缺少 entity.accessToken：${JSON.stringify(payload, null, 2)}`);
	}
	return entity.accessToken;
}

async function checkExists(token, name) {
	const payload = await requestJson('POST', `${API_BASE}/admin/deliverable-h5-components/exists`, {
		body: { name },
		token,
	});
	const entity = entityOrFail(payload, '组件名称存在性校验');
	if (typeof entity.exists !== 'boolean') {
		fail(`组件名称存在性校验返回缺少 boolean entity.exists：${JSON.stringify(payload, null, 2)}`);
	}
	return entity.exists;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const credentials = await resolveCredentials(args);
	console.log(`API 域名：${API_BASE}`);
	console.log(`登录账号：${credentials.phone}`);
	console.log(`待校验组件名：${args.name}`);

	const token = await login(credentials.phone, credentials.password);
	await saveCredentials(credentials.phone, credentials.password);
	const exists = await checkExists(token, args.name);

	if (exists) {
		fail(`组件名称已存在，请更换组件名称：${args.name}`, 2);
	}

	console.log(`组件名称可用：${args.name}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));
