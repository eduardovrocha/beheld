import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { DevProfileEvent } from "../types";
import { getDevProfileDir } from "../daemon";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

interface SessionFileEntry {
  date: string;
  path: string;
  event_count: number;
}

interface SessionIndex {
  files: SessionFileEntry[];
}

// Module-level cache: reset when base dir changes (test isolation)
let _cachedDir: string | null = null;
let _currentFile: string | null = null;
let _currentDate: string | null = null;

function getSessionsDir(): string {
  const dir = getDevProfileDir();
  if (dir !== _cachedDir) {
    _cachedDir = dir;
    _currentFile = null;
    _currentDate = null;
  }
  return path.join(dir, "sessions");
}

function getIndexFile(): string {
  return path.join(getSessionsDir(), "index.json");
}

function ensureDirs(): void {
  const base = getDevProfileDir();
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const sessions = getSessionsDir();
  if (!fs.existsSync(sessions)) fs.mkdirSync(sessions, { recursive: true });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadIndex(): SessionIndex {
  const f = getIndexFile();
  if (!fs.existsSync(f)) return { files: [] };
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as SessionIndex;
  } catch {
    return { files: [] };
  }
}

function saveIndex(index: SessionIndex): void {
  fs.writeFileSync(getIndexFile(), JSON.stringify(index, null, 2));
}

function createNewFile(): string {
  const date = today();
  const uuid = randomUUID().slice(0, 8);
  const filePath = path.join(getSessionsDir(), `${date}_${uuid}.jsonl`);
  fs.writeFileSync(filePath, "");

  const index = loadIndex();
  index.files.push({ date, path: filePath, event_count: 0 });
  saveIndex(index);

  _currentFile = filePath;
  _currentDate = date;
  return filePath;
}

function getActiveFile(): string {
  ensureDirs();
  const date = today();

  // Rotate on new day
  if (_currentDate !== date) {
    return createNewFile();
  }

  // Rotate on size limit
  if (_currentFile && fs.existsSync(_currentFile)) {
    const { size } = fs.statSync(_currentFile);
    if (size >= MAX_FILE_SIZE) return createNewFile();
    return _currentFile;
  }

  // Resume existing file for today from index
  const index = loadIndex();
  const todayFiles = index.files.filter((f) => f.date === date);
  if (todayFiles.length > 0) {
    const last = todayFiles[todayFiles.length - 1];
    if (fs.existsSync(last.path)) {
      const { size } = fs.statSync(last.path);
      if (size < MAX_FILE_SIZE) {
        _currentFile = last.path;
        _currentDate = date;
        return last.path;
      }
    }
  }

  return createNewFile();
}

export function writeEvent(event: DevProfileEvent): void {
  const filePath = getActiveFile();
  fs.appendFileSync(filePath, JSON.stringify(event) + "\n");

  const index = loadIndex();
  const entry = index.files.find((f) => f.path === filePath);
  if (entry) {
    entry.event_count++;
    saveIndex(index);
  }
}

export function getSessionsInfo(): { files: SessionFileEntry[] } {
  return loadIndex();
}
