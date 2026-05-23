import * as fs from "fs";
import * as path from "path";
import { gzipSync } from "zlib";
import type { BeheldEvent } from "../types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export interface SessionFile {
  session_id: string;
  date: string;
  path: string;
  events: number;
  size_bytes: number;
}

export interface SessionIndex {
  files: SessionFile[];
  updated_at: string;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-_]/g, "-").slice(0, 64);
}

function dateOf(timestamp?: string): string {
  return (timestamp ? new Date(timestamp) : new Date()).toISOString().slice(0, 10);
}

export class JsonlWriter {
  private sessionsDir: string;
  private indexPath: string;
  // session_id → current file path on disk
  private sessionFiles = new Map<string, string>();

  constructor(baseDir: string) {
    this.sessionsDir = path.join(baseDir, "sessions");
    this.indexPath = path.join(this.sessionsDir, "index.json");
    this.ensureDirs(baseDir);
  }

  private ensureDirs(baseDir: string): void {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    }
  }

  private filePath(sessionId: string, date: string): string {
    return path.join(this.sessionsDir, `${date}_${sanitizeId(sessionId)}.jsonl`);
  }

  private loadIndex(): SessionIndex {
    if (!fs.existsSync(this.indexPath)) {
      return { files: [], updated_at: new Date().toISOString() };
    }
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as SessionIndex;
    } catch {
      return { files: [], updated_at: new Date().toISOString() };
    }
  }

  private saveIndex(idx: SessionIndex): void {
    idx.updated_at = new Date().toISOString();
    fs.writeFileSync(this.indexPath, JSON.stringify(idx, null, 2));
  }

  private compressAndRotate(filePath: string): void {
    const data = fs.readFileSync(filePath);
    fs.writeFileSync(`${filePath}.gz`, gzipSync(data));
    fs.unlinkSync(filePath);
  }

  async write(event: BeheldEvent): Promise<void> {
    const { session_id, timestamp } = event;
    const date = dateOf(timestamp);

    let fp = this.sessionFiles.get(session_id) ?? this.filePath(session_id, date);

    // Rotate on size limit
    if (fs.existsSync(fp) && fs.statSync(fp).size >= MAX_FILE_SIZE) {
      this.compressAndRotate(fp);
      fp = this.filePath(session_id, date);
    }

    this.sessionFiles.set(session_id, fp);
    fs.appendFileSync(fp, JSON.stringify(event) + "\n");

    // Update index
    const idx = this.loadIndex();
    let entry = idx.files.find((f) => f.path === fp);
    if (!entry) {
      entry = { session_id, date, path: fp, events: 0, size_bytes: 0 };
      idx.files.push(entry);
    }
    entry.events++;
    entry.size_bytes = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
    this.saveIndex(idx);
  }

  async index(): Promise<SessionIndex> {
    const idx = this.loadIndex();
    // Sync size_bytes from disk in case files were modified outside this process
    for (const entry of idx.files) {
      if (fs.existsSync(entry.path)) {
        entry.size_bytes = fs.statSync(entry.path).size;
      }
    }
    return idx;
  }
}
