(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BazdidyarDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STABLE_ID = /^[a-z0-9][a-z0-9._-]+$/;
  const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

  function requireStableId(value, label) {
    if (typeof value !== 'string' || !STABLE_ID.test(value)) {
      throw new Error(`INVALID_STABLE_ID:${label || 'id'}`);
    }
    return value;
  }

  function requireVersion(value) {
    if (typeof value !== 'string' || !VERSION.test(value)) {
      throw new Error('INVALID_SEMANTIC_VERSION');
    }
    return value;
  }

  function safeRelativePath(value) {
    if (typeof value !== 'string' || !value.endsWith('.json')) throw new Error('INVALID_DOMAIN_PATH');
    const normalized = value.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('../') || normalized.includes('/..')) {
      throw new Error('UNSAFE_DOMAIN_PATH');
    }
    if (!/^[a-zA-Z0-9._/-]+$/.test(normalized)) throw new Error('INVALID_DOMAIN_PATH');
    return normalized;
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') throw new Error('INVALID_DOMAIN_MANIFEST');
    requireStableId(manifest.manifestId, 'manifestId');
    requireVersion(manifest.version);
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('EMPTY_DOMAIN_MANIFEST');
    const files = manifest.files.map(item => {
      if (!item || typeof item !== 'object') throw new Error('INVALID_MANIFEST_ENTRY');
      return {
        id: requireStableId(item.id, 'manifest.files.id'),
        path: safeRelativePath(item.path),
        kind: requireStableId(item.kind, 'manifest.files.kind'),
        required: item.required !== false
      };
    });
    if (new Set(files.map(item => item.id)).size !== files.length) throw new Error('DUPLICATE_MANIFEST_ID');
    if (new Set(files.map(item => item.path)).size !== files.length) throw new Error('DUPLICATE_MANIFEST_PATH');
    return {...manifest, files};
  }

  function assetIdentity(asset) {
    return asset.id || asset.catalogId || asset.packId || asset.conditionDocumentId;
  }

  function assetVersion(asset) {
    if (typeof asset.version === 'string') return asset.version;
    if (typeof asset.catalogVersion === 'string') return asset.catalogVersion;
    if (typeof asset.schemaVersion === 'string' && VERSION.test(asset.schemaVersion)) return asset.schemaVersion;
    if (typeof asset.schemaVersion === 'number') return `${asset.schemaVersion}.0.0`;
    return null;
  }

  class CatalogRegistry {
    constructor() { this.assets = new Map(); }

    register(asset, sourcePath) {
      if (!asset || typeof asset !== 'object') throw new Error('INVALID_DOMAIN_ASSET');
      const id = requireStableId(assetIdentity(asset), 'asset identity');
      const version = requireVersion(assetVersion(asset));
      const key = `${id}@${version}`;
      if (this.assets.has(key)) throw new Error(`DUPLICATE_DOMAIN_ASSET:${key}`);
      const frozen = Object.freeze({...asset, __sourcePath: sourcePath || null});
      this.assets.set(key, frozen);
      return frozen;
    }

    get(id, version) {
      requireStableId(id, 'lookup id');
      if (version) return this.assets.get(`${id}@${requireVersion(version)}`) || null;
      const candidates = [...this.assets.entries()]
        .filter(([key]) => key.startsWith(`${id}@`))
        .sort(([a], [b]) => b.localeCompare(a, 'en', {numeric: true}));
      return candidates.length ? candidates[0][1] : null;
    }

    list() { return [...this.assets.values()]; }
  }

  async function fetchJson(url, fetchImpl) {
    const perform = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!perform) throw new Error('FETCH_NOT_AVAILABLE');
    const response = await perform(url, {cache: 'no-cache', credentials: 'same-origin'});
    if (!response || !response.ok) throw new Error(`DOMAIN_FETCH_FAILED:${url}`);
    return response.json();
  }

  async function loadDomain(baseUrl, fetchImpl) {
    const base = String(baseUrl || './domain').replace(/\/$/, '');
    const manifest = validateManifest(await fetchJson(`${base}/manifest.json`, fetchImpl));
    const registry = new CatalogRegistry();
    const failures = [];
    for (const entry of manifest.files) {
      try {
        const asset = await fetchJson(`${base}/${entry.path}`, fetchImpl);
        registry.register(asset, entry.path);
      } catch (error) {
        failures.push({entry, error: String(error && error.message || error)});
        if (entry.required) throw error;
      }
    }
    return {manifest, registry, failures};
  }

  return {
    CatalogRegistry,
    loadDomain,
    requireStableId,
    requireVersion,
    safeRelativePath,
    validateManifest
  };
});
