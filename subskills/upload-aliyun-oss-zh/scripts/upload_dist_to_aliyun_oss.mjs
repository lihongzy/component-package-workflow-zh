#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://prism-stone-pre.byering.com/api';
const AUTH_CACHE_PATH = join(homedir(), '.wucaishi-component-workflow', 'auth.json');

function fail(message, code = 1) {
	console.error(`错误：${message}`);
	process.exit(code);
}

function parseArgs(argv) {
	const args = {
		projectRoot: '.',
		dist: null,
		prefix: null,
		phone: null,
		password: null,
		expiresInSeconds: 600,
		skipScan: false,
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
		} else if (arg === '--project-root') {
			args.projectRoot = nextValue();
		} else if (arg === '--dist') {
			args.dist = nextValue();
		} else if (arg === '--prefix') {
			args.prefix = nextValue();
		} else if (arg === '--phone') {
			args.phone = nextValue();
		} else if (arg === '--password') {
			args.password = nextValue();
		} else if (arg === '--expires-in-seconds') {
			args.expiresInSeconds = Number.parseInt(nextValue(), 10);
			if (!Number.isFinite(args.expiresInSeconds) || args.expiresInSeconds <= 0) {
				fail('--expires-in-seconds 必须是正整数');
			}
		} else if (arg === '--skip-scan') {
			args.skipScan = true;
		} else {
			fail(`未知参数：${arg}`);
		}
	}

	return args;
}

function printHelp() {
	console.log(`usage: upload_dist_to_aliyun_oss.mjs [options]

登录 VoxBean 预发环境并上传 dist 下所有文件到阿里云 OSS

options:
  -h, --help                              显示帮助
  --project-root PROJECT_ROOT             项目根目录，默认当前目录
  --dist DIST                             dist 目录，默认 project-root/dist
  --prefix PREFIX                         手动覆盖 OSS 目录前缀；默认 h5/components/{package.name}/{package.version}
  --phone PHONE                           登录账号，首次登录必填；之后可读取本地缓存
  --password PASSWORD                     登录密码，首次登录必填；之后可读取本地缓存
  --expires-in-seconds EXPIRES            presign 有效期，默认 600 秒
  --skip-scan                             跳过 file:// 和本机绝对路径扫描`);
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
	const phone = args.phone ? args.phone.trim() : saved?.phone;
	const password = args.password ? args.password.trim() : saved?.password;

	if (!phone || !password) {
		fail(`缺少登录账号或密码。请先传入 --phone 登录账号 --password 登录密码，登录成功后会保存到本地：${AUTH_CACHE_PATH}`);
	}

	return { phone, password };
}

async function requestJson(method, url, { body, token } = {}) {
	const headers = { Accept: 'application/json', 'X-Device-Id': 'codex-component-publisher' };
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
	const body = { phone, password };
	const payload = await requestJson('POST', `${API_BASE}/web/auth/login`, { body });
	const entity = entityOrFail(payload, '测试登录');
	if (!entity.accessToken) {
		fail(`测试登录返回缺少 entity.accessToken：${JSON.stringify(payload, null, 2)}`);
	}
	return entity.accessToken;
}

async function presign(token, prefix, fileName, contentType, expiresInSeconds) {
	const params = new URLSearchParams({
		fileName,
		prefix,
		expiresInSeconds: String(expiresInSeconds),
		contentType,
	});
	const payload = await requestJson('GET', `${API_BASE}/bean/storage/oss/presign?${params}`, { token });
	const entity = entityOrFail(payload, 'OSS presign');
	const missing = ['accessId', 'policy', 'signature', 'host', 'objectKey'].filter((key) => !entity[key]);
	if (missing.length > 0) {
		fail(`OSS presign 返回缺少字段 ${missing.join(', ')}：${JSON.stringify(payload, null, 2)}`);
	}
	return entity;
}

async function createDeliverableH5Component(token, payload) {
	const response = await requestJson('POST', `${API_BASE}/admin/deliverable-h5-components/create`, {
		body: payload,
		token,
	});
	return entityOrFail(response, '新增组件');
}

async function uploadForm(entity, filePath, contentType) {
	const bytes = await readFile(filePath);
	const form = new FormData();
	form.set('key', entity.objectKey);
	form.set('OSSAccessKeyId', entity.accessId);
	form.set('policy', entity.policy);
	form.set('Signature', entity.signature);
	form.set('success_action_status', '200');
	form.set('Content-Type', entity.contentType || contentType);
	form.set('file', new Blob([bytes], { type: contentType }), basename(filePath));

	let response;
	try {
		response = await fetch(entity.host, { method: 'POST', body: form });
	} catch (error) {
		fail(`OSS 上传失败：${entity.objectKey}\n${error.message}`);
	}

	const raw = await response.text();
	if (!response.ok) {
		fail(`OSS 上传失败 HTTP ${response.status}：${entity.objectKey}\n${raw}`);
	}
}

async function listDistFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listDistFiles(fullPath)));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function toPosixPath(pathValue) {
	return pathValue.split('\\').join('/');
}

async function scanDist(files) {
	const textSuffixes = new Set(['.html', '.css', '.js', '.mjs', '.json', '.map', '.txt', '.svg']);
	const absPathPattern = /(?<![A-Za-z0-9_])\/(Users|home|var|tmp|opt|private)\//;
	const blockers = [];
	const warnings = [];

	for (const filePath of files) {
		if (!textSuffixes.has(extname(filePath).toLowerCase())) {
			continue;
		}
		const text = await readFile(filePath, 'utf8');
		if (text.includes('file://') || absPathPattern.test(text)) {
			blockers.push(filePath);
		}
		if (/(?:src|href)=["']\/assets\//.test(text) || text.includes('url("/assets/') || text.includes("url('/assets/")) {
			warnings.push(filePath);
		}
	}

	return { blockers, warnings };
}

const MIME_TYPES = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.map': 'application/json',
	'.txt': 'text/plain',
	'.pdf': 'application/pdf',
};

function guessContentType(filePath) {
	return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function normalizePrefix(prefix) {
	const normalized = String(prefix || '')
		.trim()
		.replace(/^\/+|\/+$/g, '');
	if (!normalized) {
		fail('prefix 不能为空');
	}
	return normalized;
}

async function loadManifest(projectRoot) {
	const manifestPath = resolve(projectRoot, 'src', 'manifest.json');
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch (error) {
		fail(`无法读取组件 manifest：${manifestPath}\n${error.message}`);
	}

	const missing = ['name', 'description', 'version', 'props'].filter((field) => manifest[field] === undefined);
	if (missing.length > 0) {
		fail(`src/manifest.json 缺少必填字段：${missing.join(', ')}`);
	}
	if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
		fail('src/manifest.json 的 name 必须是非空字符串');
	}
	if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
		fail('src/manifest.json 的 description 必须是非空字符串');
	}
	if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
		fail('src/manifest.json 的 version 必须是非空字符串');
	}
	if (!Array.isArray(manifest.props) || manifest.props.length === 0) {
		fail('src/manifest.json 的 props 必须是非空数组');
	}

	return manifest;
}

function buildCreatePayload(manifest, sourceUrl) {
	const payload = {
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		props: manifest.props,
		source: sourceUrl,
	};

	for (const field of ['usageScenarios', 'limitations', 'remark']) {
		if (manifest[field] !== undefined) {
			payload[field] = manifest[field];
		}
	}

	return payload;
}

export function validateManifestPackageCompatibility(manifest, packageInfo) {
	const errors = [];
	if (manifest.version !== packageInfo.version) {
		errors.push(`src/manifest.json 的 version (${manifest.version}) 与 package.json 的 version (${packageInfo.version}) 不一致`);
	}
	if (manifest.packageName !== undefined && manifest.packageName !== packageInfo.name) {
		errors.push(`src/manifest.json 的 packageName (${manifest.packageName}) 与 package.json 的 name (${packageInfo.name}) 不一致`);
	}
	return { errors };
}

function normalizePackagePathPart(value, fieldName) {
	const normalized = String(value || '')
		.trim()
		.replace(/^@/, '')
		.replace(/\//g, '-');
	if (!normalized) {
		fail(`package.json 缺少有效的 ${fieldName} 字段`);
	}
	if (normalized.includes('..') || normalized.startsWith('.') || normalized.endsWith('.')) {
		fail(`package.json 的 ${fieldName} 字段不适合作为 OSS 路径：${value}`);
	}
	return normalized;
}

async function loadPackageInfo(projectRoot) {
	const packageJsonPath = resolve(projectRoot, 'package.json');
	let packageJson;
	try {
		packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
	} catch (error) {
		fail(`无法读取项目根目录下的 package.json：${packageJsonPath}\n${error.message}`);
	}

	const name = normalizePackagePathPart(packageJson.name, 'name');
	const version = normalizePackagePathPart(packageJson.version, 'version');
	return {
		name,
		version,
		prefix: `h5/components/${name}/${version}`,
	};
}

async function hashFiles(files, distDir) {
	const hash = createHash('sha256');
	for (const filePath of files) {
		const rel = toPosixPath(relative(distDir, filePath));
		hash.update(rel);
		hash.update('\0');
		hash.update(await readFile(filePath));
		hash.update('\0');
	}
	return hash.digest('hex');
}

async function pathIsDirectory(pathValue) {
	try {
		return (await stat(pathValue)).isDirectory();
	} catch {
		return false;
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const existingToken = process.env.COMPONENT_AUTH_TOKEN;
	const credentials = existingToken ? null : await resolveCredentials(args);
	if (!existingToken) {
		args.phone = credentials.phone;
		args.password = credentials.password;
	}
	const projectRoot = resolve(args.projectRoot);
	const distDir = args.dist ? resolve(args.dist) : resolve(projectRoot, 'dist');

	if (!(await pathIsDirectory(distDir))) {
		fail(`dist 目录不存在：${distDir}`);
	}

	const files = await listDistFiles(distDir);
	if (files.length === 0) {
		fail(`dist 目录为空：${distDir}`);
	}

	const manifest = await loadManifest(projectRoot);

	if (!args.skipScan) {
		const { blockers, warnings } = await scanDist(files);
		if (blockers.length > 0) {
			fail(`发现 file:// 或本机绝对路径，请先修复：\n${blockers.map((item) => `- ${item}`).join('\n')}`);
		}
		if (warnings.length > 0) {
			console.log('警告：发现 /assets/... 根路径资源，部署到子目录时可能失效：');
			for (const item of warnings) {
				console.log(`- ${item}`);
			}
		}
	}

	const packageInfo = await loadPackageInfo(projectRoot);
	const compatibility = validateManifestPackageCompatibility(manifest, packageInfo);
	if (compatibility.errors.length > 0) {
		fail(compatibility.errors.join('\n'));
	}

	const prefix = normalizePrefix(args.prefix || packageInfo.prefix);

	console.log(`API 域名：${API_BASE}`);
	console.log(`登录账号：${existingToken ? '使用 COMPONENT_AUTH_TOKEN' : credentials.phone}`);
	console.log(`dist 路径：${distDir}`);
	console.log(`manifest：${resolve(projectRoot, 'src', 'manifest.json')}`);
	console.log(`组件名称：${manifest.name}`);
	console.log(`组件版本：${manifest.version}`);
	console.log(`OSS prefix：${prefix}`);
	console.log(`待上传文件数：${files.length}`);

	const token = existingToken || (await login(credentials.phone, credentials.password));
	if (!existingToken) {
		await saveCredentials(credentials.phone, credentials.password);
	}
	const uploaded = [];
	let totalSize = 0;

	for (const filePath of files) {
		const rel = toPosixPath(relative(distDir, filePath));
		const contentType = guessContentType(filePath);
		const signed = await presign(token, prefix, rel, contentType, args.expiresInSeconds);
		await uploadForm(signed, filePath, contentType);
		const size = (await stat(filePath)).size;
		totalSize += size;
		uploaded.push({
			relativePath: rel,
			objectKey: signed.objectKey,
			publicUrl: signed.publicUrl,
			contentType: signed.contentType || contentType,
			size,
		});
		console.log(`已上传：${rel} -> ${signed.objectKey}`);
	}

	const entry = uploaded.find((item) => item.relativePath === 'index.html') || uploaded[0];
	const result = {
		prefix,
		entryObjectKey: entry.objectKey,
		entryUrl: entry.publicUrl,
		fileCount: uploaded.length,
		totalSizeBytes: totalSize,
		sourceHash: await hashFiles(files, distDir),
		files: uploaded,
	};

	if (!entry.publicUrl) {
		fail('上传成功，但 presign 返回缺少入口文件 publicUrl，无法作为新增组件接口的 source');
	}

	const createPayload = buildCreatePayload(manifest, entry.publicUrl);
	const componentRecord = await createDeliverableH5Component(token, createPayload);
	result.component = componentRecord;

	console.log('新增组件成功：');
	console.log(JSON.stringify(componentRecord, null, 2));
	console.log('上传完成：');
	console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => fail(error.stack || error.message || String(error)));
}
