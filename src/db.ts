import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import logger from './utils/logger.js';
import type { ServerElement, Snapshot } from './types.js';

export interface Tenant {
  id: string;
  name: string;
  workspace_path: string;
  created_at: string;
  last_accessed_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export interface ElementVersion {
  id: number;
  element_id: string;
  project_id: string;
  version: number;
  data: ServerElement;
  operation: 'create' | 'update' | 'delete';
  created_at: string;
}

const DEFAULT_PROJECT_ID = 'default';
const DEFAULT_TENANT_ID = 'default';

let db: Database.Database;
let activeTenantId: string = DEFAULT_TENANT_ID;
let activeProjectId: string = DEFAULT_PROJECT_ID;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function initDb(dbPath?: string): void {
  const resolvedPath = dbPath
    || process.env.EXCALIDRAW_DB_PATH
    || path.join(os.homedir(), '.excalidraw-mcp', 'excalidraw.db');

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  runMigrations();

  // Ensure default tenant exists
  const defaultTenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(DEFAULT_TENANT_ID);
  if (!defaultTenant) {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO tenants (id, name, workspace_path, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?)').run(
      DEFAULT_TENANT_ID, 'Default', '(none)', now, now
    );
  }

  // Ensure default project exists and is linked to default tenant
  const defaultProject = db.prepare('SELECT id FROM projects WHERE id = ?').get(DEFAULT_PROJECT_ID);
  if (!defaultProject) {
    db.prepare('INSERT INTO projects (id, name, description, tenant_id) VALUES (?, ?, ?, ?)').run(
      DEFAULT_PROJECT_ID, 'Default', 'Default project', DEFAULT_TENANT_ID
    );
  }

  logger.info(`SQLite database initialized at ${resolvedPath}`);
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      workspace_path   TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      last_accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS elements (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      data        TEXT NOT NULL,
      label_text  TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      is_deleted  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS element_versions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      element_id  TEXT NOT NULL,
      project_id  TEXT NOT NULL,
      version     INTEGER NOT NULL,
      data        TEXT NOT NULL,
      operation   TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      elements    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_elements_project ON elements(project_id);
    CREATE INDEX IF NOT EXISTS idx_elements_type ON elements(project_id, type);
    CREATE INDEX IF NOT EXISTS idx_elements_deleted ON elements(project_id, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_versions_element ON element_versions(element_id);
    CREATE INDEX IF NOT EXISTS idx_versions_project ON element_versions(project_id, created_at);
  `);

  // FTS table
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='elements_fts'"
  ).get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE elements_fts USING fts5(
        element_id,
        label_text,
        type
      );
    `);
  }

  // Migration: add tenant_id to projects if it doesn't exist (upgrading from older schema)
  const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  const hasTenantCol = cols.some(c => c.name === 'tenant_id');
  if (!hasTenantCol) {
    db.exec(`ALTER TABLE projects ADD COLUMN tenant_id TEXT REFERENCES tenants(id)`);
    logger.info('Migrated: added tenant_id column to projects');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id)`);

  // Migration: assign orphan projects (no tenant_id) to default tenant
  const orphans = db.prepare('SELECT id FROM projects WHERE tenant_id IS NULL').all() as { id: string }[];
  if (orphans.length > 0) {
    // Ensure default tenant exists for migration
    const defTenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(DEFAULT_TENANT_ID);
    if (!defTenant) {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO tenants (id, name, workspace_path, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?)').run(
        DEFAULT_TENANT_ID, 'Default', '(none)', now, now
      );
    }
    db.prepare('UPDATE projects SET tenant_id = ? WHERE tenant_id IS NULL').run(DEFAULT_TENANT_ID);
    logger.info(`Migrated: assigned ${orphans.length} orphan projects to default tenant`);
  }
}

function extractLabelText(element: ServerElement): string | null {
  if (element.label?.text) return element.label.text;
  if (element.text) return element.text;
  return null;
}

// Resolve effective project ID: explicit override > in-memory active
function pid(override?: string): string {
  return override ?? activeProjectId;
}

// Given a tenant ID, return its default project (creating one if needed)
export function getDefaultProjectForTenant(tenantId: string): string {
  const row = db.prepare(
    'SELECT id FROM projects WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(tenantId) as { id: string } | undefined;

  if (row) return row.id;

  const id = `${tenantId}-default`;
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO projects (id, name, description, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, 'Default', 'Default project', tenantId, now, now);
  return id;
}

// ── Element CRUD ──

export function getElement(id: string, projectId?: string): ServerElement | undefined {
  const row = db.prepare(
    'SELECT data FROM elements WHERE id = ? AND project_id = ? AND is_deleted = 0'
  ).get(id, pid(projectId)) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}

export function hasElement(id: string, projectId?: string): boolean {
  const row = db.prepare(
    'SELECT 1 FROM elements WHERE id = ? AND project_id = ? AND is_deleted = 0'
  ).get(id, pid(projectId));
  return !!row;
}

export function setElement(id: string, element: ServerElement, projectId?: string): void {
  const p = pid(projectId);
  const now = new Date().toISOString();
  const data = JSON.stringify(element);
  const labelText = extractLabelText(element);
  const existing = db.prepare(
    'SELECT version, is_deleted FROM elements WHERE id = ? AND project_id = ?'
  ).get(id, p) as { version: number; is_deleted: number } | undefined;

  if (existing) {
    const newVersion = existing.is_deleted ? 1 : (existing.version + 1);
    db.prepare(`
      UPDATE elements SET type = ?, data = ?, label_text = ?, updated_at = ?, version = ?, is_deleted = 0
      WHERE id = ? AND project_id = ?
    `).run(element.type, data, labelText, now, newVersion, id, p);

    recordVersion(id, newVersion, data, existing.is_deleted ? 'create' : 'update', p);
    updateFts(id, labelText, element.type);
  } else {
    db.prepare(`
      INSERT INTO elements (id, project_id, type, data, label_text, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, p, element.type, data, labelText, now, now);

    recordVersion(id, 1, data, 'create', p);
    insertFts(id, labelText, element.type);
  }
}

export function deleteElement(id: string, projectId?: string): boolean {
  const p = pid(projectId);
  const existing = db.prepare(
    'SELECT version, data FROM elements WHERE id = ? AND project_id = ? AND is_deleted = 0'
  ).get(id, p) as { version: number; data: string } | undefined;

  if (!existing) return false;

  const newVersion = existing.version + 1;
  db.prepare(`
    UPDATE elements SET is_deleted = 1, version = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(newVersion, new Date().toISOString(), id, p);

  recordVersion(id, newVersion, existing.data, 'delete', p);
  deleteFts(id);
  return true;
}

export function getAllElements(projectId?: string): ServerElement[] {
  const rows = db.prepare(
    'SELECT data FROM elements WHERE project_id = ? AND is_deleted = 0'
  ).all(pid(projectId)) as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}

export function getElementCount(projectId?: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM elements WHERE project_id = ? AND is_deleted = 0'
  ).get(pid(projectId)) as { count: number };
  return row.count;
}

export function clearElements(projectId?: string): number {
  const p = pid(projectId);
  const now = new Date().toISOString();
  const elements = getAllElements(p);

  const stmt = db.prepare(`
    UPDATE elements SET is_deleted = 1, version = version + 1, updated_at = ?
    WHERE project_id = ? AND is_deleted = 0
  `);

  const clearTx = db.transaction(() => {
    const info = stmt.run(now, p);
    for (const el of elements) {
      recordVersion(el.id, (el.version || 1) + 1, JSON.stringify(el), 'delete', p);
      deleteFts(el.id);
    }
    return info.changes;
  });

  return clearTx() as number;
}

export function queryElements(type?: string, filter?: Record<string, any>, projectId?: string): ServerElement[] {
  let elements = getAllElements(projectId);
  if (type) {
    elements = elements.filter(el => el.type === type);
  }
  if (filter) {
    elements = elements.filter(el => {
      return Object.entries(filter).every(([key, value]) => {
        return (el as any)[key] === value;
      });
    });
  }
  return elements;
}

export function searchElements(query: string, projectId?: string): ServerElement[] {
  const rows = db.prepare(`
    SELECT e.data FROM elements e
    INNER JOIN elements_fts fts ON fts.element_id = e.id
    WHERE elements_fts MATCH ? AND e.project_id = ? AND e.is_deleted = 0
  `).all(query, pid(projectId)) as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}

// ── FTS helpers ──

function insertFts(elementId: string, labelText: string | null, type: string): void {
  db.prepare('INSERT INTO elements_fts (element_id, label_text, type) VALUES (?, ?, ?)').run(
    elementId, labelText || '', type
  );
}

function updateFts(elementId: string, labelText: string | null, type: string): void {
  deleteFts(elementId);
  insertFts(elementId, labelText, type);
}

function deleteFts(elementId: string): void {
  db.prepare("DELETE FROM elements_fts WHERE element_id = ?").run(elementId);
}

// ── Version history ──

function recordVersion(elementId: string, version: number, data: string, operation: string, projectId?: string): void {
  db.prepare(`
    INSERT INTO element_versions (element_id, project_id, version, data, operation)
    VALUES (?, ?, ?, ?, ?)
  `).run(elementId, pid(projectId), version, data, operation);
}

export function getElementHistory(elementId: string, limit: number = 50, projectId?: string): ElementVersion[] {
  const rows = db.prepare(`
    SELECT id, element_id, project_id, version, data, operation, created_at
    FROM element_versions WHERE element_id = ? AND project_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(elementId, pid(projectId), limit) as any[];
  return rows.map(r => ({ ...r, data: JSON.parse(r.data) }));
}

export function getProjectHistory(limit: number = 100, projectId?: string): ElementVersion[] {
  const rows = db.prepare(`
    SELECT id, element_id, project_id, version, data, operation, created_at
    FROM element_versions WHERE project_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(pid(projectId), limit) as any[];
  return rows.map(r => ({ ...r, data: JSON.parse(r.data) }));
}

// ── Snapshots ──

export function saveSnapshot(name: string, elements: ServerElement[], projectId?: string): void {
  const data = JSON.stringify(elements);
  db.prepare(`
    INSERT OR REPLACE INTO snapshots (project_id, name, elements, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(pid(projectId), name, data);
}

export function getSnapshot(name: string, projectId?: string): Snapshot | undefined {
  const row = db.prepare(
    'SELECT name, elements, created_at FROM snapshots WHERE name = ? AND project_id = ?'
  ).get(name, pid(projectId)) as { name: string; elements: string; created_at: string } | undefined;

  if (!row) return undefined;
  return { name: row.name, elements: JSON.parse(row.elements), createdAt: row.created_at };
}

export function listSnapshots(projectId?: string): { name: string; elementCount: number; createdAt: string }[] {
  const rows = db.prepare(
    'SELECT name, elements, created_at FROM snapshots WHERE project_id = ? ORDER BY created_at DESC'
  ).all(pid(projectId)) as { name: string; elements: string; created_at: string }[];
  return rows.map(r => ({
    name: r.name,
    elementCount: (JSON.parse(r.elements) as any[]).length,
    createdAt: r.created_at
  }));
}

// ── Tenants ──

export function ensureTenant(id: string, name: string, workspacePath: string): Tenant {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Tenant | undefined;

  if (existing) {
    db.prepare('UPDATE tenants SET last_accessed_at = ? WHERE id = ?').run(now, id);
    return { ...existing, last_accessed_at: now };
  }

  db.prepare(
    'INSERT INTO tenants (id, name, workspace_path, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, workspacePath, now, now);

  return { id, name, workspace_path: workspacePath, created_at: now, last_accessed_at: now };
}

export function setActiveTenant(id: string): void {
  const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(id);
  if (!tenant) throw new Error(`Tenant "${id}" not found`);
  activeTenantId = id;

  // Auto-set active project to the tenant's first project, creating a default if none exists
  const firstProject = db.prepare(
    'SELECT id FROM projects WHERE tenant_id = ? ORDER BY created_at ASC LIMIT 1'
  ).get(id) as { id: string } | undefined;

  if (firstProject) {
    activeProjectId = firstProject.id;
  } else {
    const defaultId = `${id}-default`;
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO projects (id, name, description, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(defaultId, 'Default', 'Default project', id, now, now);
    activeProjectId = defaultId;
  }

  logger.info(`Active tenant set to "${id}", active project: "${activeProjectId}"`);
}

export function getActiveTenant(): Tenant {
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(activeTenantId) as Tenant;
}

export function getActiveTenantId(): string {
  return activeTenantId;
}

export function listTenants(): Tenant[] {
  return db.prepare('SELECT * FROM tenants ORDER BY last_accessed_at DESC').all() as Tenant[];
}

// ── Projects ──

export function createProject(name: string, description?: string): Project {
  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO projects (id, name, description, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, description || null, activeTenantId, now, now);
  return { id, name, description: description || null, tenant_id: activeTenantId, created_at: now, updated_at: now };
}

export function listProjects(): Project[] {
  return db.prepare('SELECT * FROM projects WHERE tenant_id = ? ORDER BY updated_at DESC').all(activeTenantId) as Project[];
}

export function setActiveProject(id: string): void {
  const project = db.prepare('SELECT id, tenant_id FROM projects WHERE id = ?').get(id) as { id: string; tenant_id: string } | undefined;
  if (!project) throw new Error(`Project "${id}" not found`);
  if (project.tenant_id !== activeTenantId) {
    throw new Error(`Project "${id}" belongs to tenant "${project.tenant_id}", not the active tenant "${activeTenantId}"`);
  }
  activeProjectId = id;
}

export function getActiveProject(): Project {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(activeProjectId) as Project;
}

export function getActiveProjectId(): string {
  return activeProjectId;
}

// ── Bulk operations (for sync endpoint) ──

export function bulkReplaceElements(elements: ServerElement[], projectId?: string): number {
  const tx = db.transaction(() => {
    clearElements(projectId);
    for (const el of elements) {
      setElement(el.id, el, projectId);
    }
    return elements.length;
  });
  return tx();
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info('SQLite database closed');
  }
}
